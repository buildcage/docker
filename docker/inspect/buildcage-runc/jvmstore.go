package main

// A JVM already in the base image (eclipse-temurin, amazoncorretto, gradle,
// maven, ...) reads its trusted roots from its own keystore at
// $JAVA_HOME/lib/security/cacerts and consults neither the system CA store nor
// the CA-trust environment variables the wrapper otherwise sets. So `mvn`,
// `gradle` and `java` do not trust the proxy's CA the way the rest of a step's
// tooling does. This adds the CA to that keystore for the step's duration, the
// same mirror-and-bind way the system store is handled: the injection lands in
// the scratch mirror, never the real file, and the layer sweep is what takes it
// back out of a keystore a step went on to change.
//
// A step that installs a JRE part-way through is a different case, already
// covered by the anchors ca-certificates-java imports; this is for the JVMs that
// were there from the start. One the step itself downloads is not there yet to
// inject into.

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// errNotAKeystore means the file discovery pointed at does not begin with
// either keystore magic, so injection has nothing it knows how to write.
var errNotAKeystore = errors.New("not a JKS or PKCS#12 keystore")

// The alias of the injected entry in either keystore shape, and its creation
// time in a JKS. The time is fixed so the entry is byte-for-byte the same every
// build, which keeps the gatekeeper comparing like with like; the alias only
// has to not collide with one the keystore already uses.
const (
	injectedAlias        = "buildcage-proxy-ca"
	injectedCreationTime = 1700000000000
)

// injectedAliasFor suffixes all but the first alias, since a keystore keeps one
// entry per alias.
func injectedAliasFor(i int) string {
	if i == 0 {
		return injectedAlias
	}
	return fmt.Sprintf("%s-%d", injectedAlias, i)
}

// The keystore file names a JVM's default trust manager reads, in the order it
// prefers them: jssecacerts overrides cacerts entirely when it is present, so
// the CA has to go into whichever exist, not cacerts alone.
var jvmKeystoreNames = []string{"jssecacerts", "cacerts"}

// Security directories tried when JAVA_HOME is unset. JAVA_HOME covers the Java
// base images this is aimed at; these catch a JVM installed at a fixed location
// without it. /etc/ssl/certs/java is Debian's ca-certificates-java output and
// the /etc/pki ones are RHEL's, each a symlink resolveInRoot follows to the
// real file.
var knownJVMKeystoreDirs = []string{
	"/etc/ssl/certs/java",
	"/etc/pki/java",
	"/etc/pki/ca-trust/extracted/java",
}

// Directories holding one JDK per entry, for a second JDK or one without
// JAVA_HOME. ~ is the step user's home. Gradle's toolchains nest one more level
// on some versions.
var jdkParentDirs = []struct {
	dir   string
	depth int
}{
	{"/usr/lib/jvm", 1},
	{"/usr/java", 1},
	{"/opt/java", 1},
	{"~/.sdkman/candidates/java", 1},
	{"~/.gradle/jdks", 2},
	{"~/.jdks", 1},
	{"~/.asdf/installs/java", 1},
}

// Most JDK roots taken from jdkParentDirs. Each keystore found is mirrored for
// every step, so this bounds that cost.
const maxListedJDKs = 32

// securityDirs is where a JDK rooted at root keeps its keystores: lib/security
// from JDK 9 on, jre/lib/security in a JDK 8.
func securityDirs(root string) []string {
	return []string{
		filepath.Join(root, "lib", "security"),
		filepath.Join(root, "jre", "lib", "security"),
	}
}

// javaOnPath returns the JDK root of each java on the step's PATH, followed
// through its symlinks (/usr/bin/java to /etc/alternatives to the JDK), as
// container paths. A JDK 8's jre/bin/java gives its jre/, whose lib/security
// is the one it reads.
func javaOnPath(s *spec) []string {
	var roots []string
	for _, dir := range filepath.SplitList(s.env["PATH"]) {
		if !filepath.IsAbs(dir) {
			continue
		}
		resolved, err := resolveInRoot(s.rootfs, filepath.Join(dir, "java"))
		if err != nil {
			continue
		}
		if info, err := os.Stat(resolved); err == nil && info.Mode().IsRegular() {
			roots = append(roots, filepath.Dir(filepath.Dir(containerPathOf(s.rootfs, resolved))))
		}
	}
	return roots
}

// listedJDKs returns the JDKs among the entries of jdkParentDirs as container
// paths, each once, at most maxListedJDKs of them. An entry counts as a JDK when
// it has a security directory; one that does not is looked inside where the
// parent allows a second level. Each directory is resolved inside the rootfs
// before it is read, so a symlink cannot point the listing at the host.
func listedJDKs(s *spec) []string {
	var home string
	var roots []string
	seen := map[string]bool{}
	isJDK := func(root string) bool {
		for _, dir := range securityDirs(root) {
			if resolved, err := resolveInRoot(s.rootfs, dir); err == nil {
				if info, err := os.Stat(resolved); err == nil && info.IsDir() {
					return true
				}
			}
		}
		return false
	}
	var list func(dir string, depth int) bool
	list = func(dir string, depth int) bool {
		resolved, err := resolveInRoot(s.rootfs, dir)
		if err != nil {
			return true
		}
		entries, err := os.ReadDir(resolved)
		if err != nil {
			return true
		}
		for _, entry := range entries {
			root := filepath.Join(dir, entry.Name())
			if !isJDK(root) {
				if depth > 1 && !list(root, depth-1) {
					return false
				}
				continue
			}
			// sdkman's current, or /usr/lib/jvm/default-java, names a JDK
			// already listed.
			resolvedRoot, _ := resolveInRoot(s.rootfs, root)
			if seen[resolvedRoot] {
				continue
			}
			seen[resolvedRoot] = true
			if len(roots) == maxListedJDKs {
				logf("more than %d JDKs under the usual directories; those from %s on do not get the CA", maxListedJDKs, root)
				return false
			}
			roots = append(roots, root)
		}
		return true
	}
	for _, parent := range jdkParentDirs {
		dir := parent.dir
		if rest, ok := strings.CutPrefix(dir, "~/"); ok {
			if home == "" {
				uid, _ := s.processUser()
				home = homeOf(s, uid)
			}
			dir = filepath.Join(home, rest)
		}
		if !list(dir, parent.depth) {
			break
		}
	}
	return roots
}

// findJVMKeystores returns the resolved host paths of every JVM keystore inside
// the rootfs: JAVA_HOME's first, then each java on PATH's, the known fixed
// directories, and the JDKs in the usual places. Each is deduplicated by where
// it resolves, so a symlinked one, or a JDK sharing the distribution's, is not
// injected twice.
func findJVMKeystores(s *spec) []string {
	var dirs []string
	if home := s.env["JAVA_HOME"]; home != "" {
		dirs = append(dirs, securityDirs(home)...)
	}
	for _, root := range javaOnPath(s) {
		dirs = append(dirs, securityDirs(root)...)
	}
	dirs = append(dirs, knownJVMKeystoreDirs...)
	for _, root := range listedJDKs(s) {
		dirs = append(dirs, securityDirs(root)...)
	}

	var keystores []string
	seen := map[string]bool{}
	for _, dir := range dirs {
		for _, name := range jvmKeystoreNames {
			resolved, err := resolveInRoot(s.rootfs, filepath.Join(dir, name))
			if err != nil || seen[resolved] {
				continue
			}
			if info, err := os.Stat(resolved); err == nil && info.Mode().IsRegular() {
				seen[resolved] = true
				keystores = append(keystores, resolved)
			}
		}
	}
	return keystores
}

// insertIntoKeystore adds a trusted-certificate entry for the CA to the keystore
// at path, rewriting it in place. Like removeFromBinaryStore it reads the file
// once and dispatches on its magic. On success it returns the keystore's
// pre-injection bytes for the caller to restore later. An error leaves the
// keystore untouched for the caller to report, so the step's JVM does not trust
// the CA.
func insertIntoKeystore(path string, ca []byte) ([]byte, error) {
	ders := certificateDERs(ca)
	if len(ders) == 0 {
		return nil, errNotACertificate
	}

	f, err := openBundle(path, os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, asNotRegular(path, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	size := info.Size()
	if size < int64(len(keystoreMagic)) || size > maxKeystoreBytes {
		return nil, errNotAKeystore
	}
	content := make([]byte, size)
	if _, err := f.ReadAt(content, 0); err != nil && err != io.EOF {
		return nil, err
	}

	// Every certificate in the CA file, as appendCA adds for the PEM stores, so
	// a multi-certificate CA is trusted whole rather than only its first.
	var injected []byte
	switch {
	case bytes.HasPrefix(content, keystoreMagic):
		injected, err = keystoreWith(content, ders)
	case looksLikePKCS12(content):
		injected, err = pkcs12With(content, ders)
	default:
		return nil, errNotAKeystore
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}

	if _, err := f.WriteAt(injected, 0); err != nil {
		return nil, err
	}
	// Returns content alongside a Truncate error; the caller ignores it there.
	return content, f.Truncate(int64(len(injected)))
}
