package main

import (
	"bytes"
	"crypto/sha1"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeRootfsKeystore places raw keystore bytes at a container path inside
// rootfs, creating the directories on the way.
func writeRootfsKeystore(t *testing.T, rootfs, containerPath string, content []byte) {
	t.Helper()
	abs := filepath.Join(rootfs, strings.TrimPrefix(containerPath, "/"))
	mustMkdirAll(t, filepath.Dir(abs))
	mustWriteFile(t, abs, string(content))
}

func hasPath(paths []string, want string) bool {
	for _, p := range paths {
		if p == want {
			return true
		}
	}
	return false
}

func TestFindJVMKeystoresFromJavaHome(t *testing.T) {
	rootfs := t.TempDir()
	s := &spec{rootfs: rootfs, env: map[string]string{"JAVA_HOME": "/opt/java"}}
	cacerts := filepath.Join(rootfs, "opt/java/lib/security/cacerts")
	mustMkdirAll(t, filepath.Dir(cacerts))
	mustWriteFile(t, cacerts, "x")

	if got := findJVMKeystores(s); len(got) != 1 || got[0] != cacerts {
		t.Fatalf("findJVMKeystores = %v; want [%q]", got, cacerts)
	}
}

// jssecacerts overrides cacerts in the JVM's default trust manager, so both are
// found when both are present.
func TestFindJVMKeystoresIncludesJssecacerts(t *testing.T) {
	rootfs := t.TempDir()
	s := &spec{rootfs: rootfs, env: map[string]string{"JAVA_HOME": "/opt/java"}}
	dir := filepath.Join(rootfs, "opt/java/lib/security")
	mustMkdirAll(t, dir)
	mustWriteFile(t, filepath.Join(dir, "cacerts"), "x")
	mustWriteFile(t, filepath.Join(dir, "jssecacerts"), "x")

	got := findJVMKeystores(s)
	if !hasPath(got, filepath.Join(dir, "cacerts")) || !hasPath(got, filepath.Join(dir, "jssecacerts")) {
		t.Fatalf("findJVMKeystores = %v; want both cacerts and jssecacerts", got)
	}
}

// JAVA_HOME unset, a JVM at a known fixed directory instead: Debian's, or one of
// RHEL's, each followed through its symlink to the real file.
func TestFindJVMKeystoresFromKnownDirs(t *testing.T) {
	for _, dir := range []string{"etc/ssl/certs/java", "etc/pki/java", "etc/pki/ca-trust/extracted/java"} {
		t.Run(dir, func(t *testing.T) {
			rootfs := t.TempDir()
			s := &spec{rootfs: rootfs, env: map[string]string{}}
			cacerts := filepath.Join(rootfs, dir, "cacerts")
			mustMkdirAll(t, filepath.Dir(cacerts))
			mustWriteFile(t, cacerts, "x")

			if got := findJVMKeystores(s); !hasPath(got, cacerts) {
				t.Fatalf("findJVMKeystores = %v; want it to include %q", got, cacerts)
			}
		})
	}
}

// A keystore reachable by two candidate paths (JAVA_HOME's cacerts symlinked to
// a known fixed path) is returned once, not injected into twice.
func TestFindJVMKeystoresDeduplicates(t *testing.T) {
	rootfs := t.TempDir()
	s := &spec{rootfs: rootfs, env: map[string]string{"JAVA_HOME": "/opt/java"}}
	real := filepath.Join(rootfs, "etc/ssl/certs/java/cacerts")
	mustMkdirAll(t, filepath.Dir(real))
	mustWriteFile(t, real, "x")
	mustMkdirAll(t, filepath.Join(rootfs, "opt/java/lib/security"))
	mustSymlink(t, "/etc/ssl/certs/java/cacerts", filepath.Join(rootfs, "opt/java/lib/security/cacerts"))

	if got := findJVMKeystores(s); len(got) != 1 || got[0] != real {
		t.Fatalf("findJVMKeystores = %v; want the single real path %q", got, real)
	}
}

// JAVA_HOME names a directory with no keystore, and no known path has one
// either, so nothing is found.
func TestFindJVMKeystoresNoneFound(t *testing.T) {
	s := &spec{rootfs: t.TempDir(), env: map[string]string{"JAVA_HOME": "/opt/java"}}
	if got := findJVMKeystores(s); len(got) != 0 {
		t.Fatalf("found keystores where there are none: %v", got)
	}
}

// A java on PATH is followed through its symlinks to the JDK it belongs to,
// JDK 9 on and JDK 8 alike. A relative PATH entry, or one leading out of the
// rootfs, is passed over.
func TestFindJVMKeystoresFollowsJavaOnPath(t *testing.T) {
	for name, c := range map[string]struct{ java, cacerts string }{
		"JDK 21": {"opt/jdk-21/bin/java", "opt/jdk-21/lib/security/cacerts"},
		"JDK 8":  {"opt/jdk8/jre/bin/java", "opt/jdk8/jre/lib/security/cacerts"},
	} {
		t.Run(name, func(t *testing.T) {
			rootfs := t.TempDir()
			s := &spec{rootfs: rootfs, env: map[string]string{"PATH": "relative:/escape:/usr/local/bin"}}
			mustSymlink(t, "../../../../../../../../outside", filepath.Join(rootfs, "escape"))
			mustMkdirAll(t, filepath.Join(rootfs, filepath.Dir(c.java)))
			mustWriteFile(t, filepath.Join(rootfs, c.java), "java")
			mustMkdirAll(t, filepath.Join(rootfs, "usr/local/bin"))
			mustSymlink(t, "/"+c.java, filepath.Join(rootfs, "usr/local/bin/java"))
			cacerts := filepath.Join(rootfs, c.cacerts)
			mustMkdirAll(t, filepath.Dir(cacerts))
			mustWriteFile(t, cacerts, "x")

			if got := findJVMKeystores(s); !hasPath(got, cacerts) {
				t.Fatalf("findJVMKeystores = %v; want it to include %q", got, cacerts)
			}
		})
	}
}

// A JDK that neither JAVA_HOME nor PATH names, such as a Gradle toolchain, is
// not injected into, so a later step can still remove it.
func TestFindJVMKeystoresLeavesOtherJDKsAlone(t *testing.T) {
	rootfs := t.TempDir()
	s := &spec{rootfs: rootfs, env: map[string]string{"HOME": "/root", "PATH": "/usr/bin"}}
	for _, root := range []string{"usr/lib/jvm/jdk-21", "root/.gradle/jdks/temurin-17"} {
		mustMkdirAll(t, filepath.Join(rootfs, root, "lib/security"))
		mustWriteFile(t, filepath.Join(rootfs, root, "lib/security/cacerts"), "x")
	}

	if got := findJVMKeystores(s); len(got) != 0 {
		t.Fatalf("findJVMKeystores = %v; want none", got)
	}
}

// A cacerts that is a directory, not a file, is not a keystore to inject into.
func TestFindJVMKeystoresIgnoresANonRegularFile(t *testing.T) {
	rootfs := t.TempDir()
	s := &spec{rootfs: rootfs, env: map[string]string{"JAVA_HOME": "/opt/java"}}
	mustMkdirAll(t, filepath.Join(rootfs, "opt/java/lib/security/cacerts"))
	if got := findJVMKeystores(s); len(got) != 0 {
		t.Fatalf("a directory was taken for a keystore: %v", got)
	}
}

func TestInsertIntoKeystoreJKS(t *testing.T) {
	path := mustWriteKeystore(t, keystore(2, trustedEntry(2, "digicert", otherDER)))
	if _, err := insertIntoKeystore(path, testCA); err != nil {
		t.Fatalf("insertIntoKeystore: %v", err)
	}
	out, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out, []byte(injectedAlias)) || !bytes.Contains(out, testDER) {
		t.Error("the CA was not inserted into the JKS")
	}
	// Well-formed and sealed: removal reads it back without complaint.
	if _, err := removeFromBinaryStore(path, [][]byte{testDER}); err != nil {
		t.Fatalf("the injected keystore is not one removal accepts: %v", err)
	}
}

func TestInsertIntoKeystorePKCS12(t *testing.T) {
	root := testCert(t, "digicert")
	ca := testCert(t, "buildcage")
	path := mustWritePKCS12(t, passwordlessStore(t, root))
	if _, err := insertIntoKeystore(path, certPEM(ca)); err != nil {
		t.Fatalf("insertIntoKeystore: %v", err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	certs, _, err := decodePKCS12(content)
	if err != nil {
		t.Fatalf("the injected store no longer decodes: %v", err)
	}
	if len(certs) != 2 {
		t.Errorf("the injected store holds %d certificates, want 2", len(certs))
	}
}

func TestInsertIntoKeystoreNeedsACertificate(t *testing.T) {
	path := mustWriteKeystore(t, keystore(2, trustedEntry(2, "digicert", otherDER)))
	if _, err := insertIntoKeystore(path, []byte("no PEM certificate here")); !errors.Is(err, errNotACertificate) {
		t.Fatalf("got %v, want errNotACertificate", err)
	}
}

func TestInsertIntoKeystoreRejectsNonKeystore(t *testing.T) {
	path := mustWriteKeystore(t, []byte("not a keystore, just some bytes"))
	if _, err := insertIntoKeystore(path, testCA); !errors.Is(err, errNotAKeystore) {
		t.Fatalf("got %v, want errNotAKeystore", err)
	}
}

func TestInsertIntoKeystoreRejectsTooSmall(t *testing.T) {
	path := mustWriteKeystore(t, []byte{0xfe, 0xed})
	if _, err := insertIntoKeystore(path, testCA); !errors.Is(err, errNotAKeystore) {
		t.Fatalf("got %v, want errNotAKeystore", err)
	}
}

func TestInsertIntoKeystoreRejectsTooLarge(t *testing.T) {
	t.Cleanup(func(prev int64) func() { return func() { maxKeystoreBytes = prev } }(maxKeystoreBytes))
	maxKeystoreBytes = 4
	path := mustWriteKeystore(t, keystore(2, trustedEntry(2, "digicert", otherDER)))
	if _, err := insertIntoKeystore(path, testCA); !errors.Is(err, errNotAKeystore) {
		t.Fatalf("got %v, want errNotAKeystore", err)
	}
}

// A PKCS#12 under a password of its own reaches injection as a keystore
// but cannot be rewritten; the error is reported for the caller to skip on.
func TestInsertIntoKeystoreReportsADecodeFailure(t *testing.T) {
	ca := testCert(t, "buildcage")
	path := mustWritePKCS12(t, encryptedStore(t, ca))
	if _, err := insertIntoKeystore(path, certPEM(ca)); err == nil {
		t.Fatal("want the decode failure to be reported")
	}
}

func TestInsertIntoKeystoreReportsAStatFailure(t *testing.T) {
	path := mustWriteKeystore(t, keystore(2, trustedEntry(2, "digicert", otherDER)))
	useBrokenBundleFile(t, &brokenFile{failStat: true})
	if _, err := insertIntoKeystore(path, testCA); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want the stat failure", err)
	}
}

func TestInsertIntoKeystoreReportsAReadFailure(t *testing.T) {
	path := mustWriteKeystore(t, keystore(2, trustedEntry(2, "digicert", otherDER)))
	useBrokenBundleFile(t, &brokenFile{failReadAt: 1})
	if _, err := insertIntoKeystore(path, testCA); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want the read failure", err)
	}
}

func TestInsertIntoKeystoreReportsAWriteFailure(t *testing.T) {
	path := mustWriteKeystore(t, keystore(2, trustedEntry(2, "digicert", otherDER)))
	useBrokenBundleFile(t, &brokenFile{failWriteAt: 1})
	if _, err := insertIntoKeystore(path, testCA); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want the write failure", err)
	}
}

func TestInsertIntoKeystoreRefusesAPathThatIsNotThere(t *testing.T) {
	if _, err := insertIntoKeystore(filepath.Join(t.TempDir(), "gone"), testCA); err == nil {
		t.Fatal("expected a missing keystore to be reported")
	}
}

// inject discovers the base image's JVM keystore and adds the CA to the scratch
// mirror bound over it, never the real file, the same as the system store.
func TestInjectAddsCAToTheJVMKeystore(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"JAVA_HOME=/opt/java"})
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/cacerts",
		keystore(2, trustedEntry(2, "digicert", otherDER)))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	mount := findMount(t, loadMounts(t, bundle), "/opt/java/lib/security")
	scratch, _ := mount["source"].(string)
	mirrored, err := os.ReadFile(filepath.Join(scratch, "cacerts"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(mirrored, []byte(injectedAlias)) || !bytes.Contains(mirrored, testDER) {
		t.Fatal("the CA was not inserted into the mirrored keystore")
	}

	real, err := os.ReadFile(filepath.Join(rootfs, "opt/java/lib/security/cacerts"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(real, []byte(injectedAlias)) {
		t.Fatal("the real keystore was modified before the step touched it")
	}
}

// jssecacerts overrides cacerts, so both keystores in a JDK's security directory
// get the CA, not cacerts alone.
func TestInjectAddsCAToBothJVMKeystores(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"JAVA_HOME=/opt/java"})
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/cacerts",
		keystore(2, trustedEntry(2, "digicert", otherDER)))
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/jssecacerts",
		keystore(2, trustedEntry(2, "digicert", otherDER)))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	mount := findMount(t, loadMounts(t, bundle), "/opt/java/lib/security")
	scratch, _ := mount["source"].(string)
	for _, name := range []string{"cacerts", "jssecacerts"} {
		mirrored, err := os.ReadFile(filepath.Join(scratch, name))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(mirrored, []byte(injectedAlias)) || !bytes.Contains(mirrored, testDER) {
			t.Errorf("the CA was not inserted into the mirrored %s", name)
		}
	}
}

// A step that never touches the keystore leaves the real file alone: finish
// finds the mirror unchanged from its post-injection baseline.
func TestInjectLeavesAnUntouchedKeystoreAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"JAVA_HOME=/opt/java"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	original := keystore(2, trustedEntry(2, "digicert", otherDER))
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/cacerts", original)

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(filepath.Join(rootfs, "opt/java/lib/security/cacerts"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, original) {
		t.Fatal("the real keystore was written to even though nothing changed")
	}
}

// A second JDK on PATH beside JAVA_HOME's gets the CA in a bind of its own, and
// both real keystores are left as they were.
func TestInjectCoversASecondJDK(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"JAVA_HOME=/opt/java/main", "PATH=/opt/java/other/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	original := keystore(2, trustedEntry(2, "digicert", otherDER))
	for _, jdk := range []string{"main", "other"} {
		writeRootfsKeystore(t, rootfs, "/opt/java/"+jdk+"/lib/security/cacerts", original)
	}
	mustMkdirAll(t, filepath.Join(rootfs, "opt/java/other/bin"))
	mustWriteFile(t, filepath.Join(rootfs, "opt/java/other/bin/java"), "java")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mounts := loadMounts(t, bundle)
	for _, jdk := range []string{"main", "other"} {
		scratchDir, _ := findMount(t, mounts, "/opt/java/"+jdk+"/lib/security")["source"].(string)
		got, err := os.ReadFile(filepath.Join(scratchDir, "cacerts"))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(got, testDER) {
			t.Errorf("the %s JDK's keystore did not get the CA", jdk)
		}
	}
	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}
	for _, jdk := range []string{"main", "other"} {
		if got, _ := os.ReadFile(filepath.Join(rootfs, "opt/java", jdk, "lib/security/cacerts")); !bytes.Equal(got, original) {
			t.Errorf("the %s JDK's real keystore was changed", jdk)
		}
	}
}

// A step that changes the keystore gets its change written back with the proxy
// CA taken out and its own additions kept.
func TestInjectWritesBackWhenTheStepChangesTheKeystore(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"JAVA_HOME=/opt/java"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/cacerts",
		keystore(2, trustedEntry(2, "digicert", otherDER)))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	mount := findMount(t, loadMounts(t, bundle), "/opt/java/lib/security")
	scratch, _ := mount["source"].(string)
	// The step adds its own root to the already CA-injected keystore.
	stepStore := keystore(2,
		trustedEntry(2, "digicert", otherDER),
		trustedEntry(2, "steproot", []byte("STEP-ROOT")),
		trustedEntry(2, injectedAlias, testDER))
	mustWriteFile(t, filepath.Join(scratch, "cacerts"), string(stepStore))

	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(filepath.Join(rootfs, "opt/java/lib/security/cacerts"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(got, testDER) {
		t.Fatal("the proxy CA was left in the written-back keystore")
	}
	if !bytes.Contains(got, []byte("STEP-ROOT")) {
		t.Fatal("the step's own root was lost in the write-back")
	}
}

// A PKCS#12 keystore the step never touched must be committed byte for byte as
// an unproxied build would have it, even when something else in its directory
// triggers the write-back. Taking the proxy CA back out re-encodes the store,
// which does not reproduce its bytes.
func TestInjectRestoresAnUntouchedKeystoreBesideAChange(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"JAVA_HOME=/opt/java"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	// A real CA, since injecting into a PKCS#12 parses it, unlike the JKS tests'
	// stand-in bytes.
	ca := certPEM(testCert(t, "buildcage"))
	original := keytoolStore(t, "keytool-alias", testCert(t, "digicert"))
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/cacerts", original)
	// A sibling the step will change, so the directory is written back at all.
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/other", []byte("BEFORE\n"))

	restore, err := inject(bundle, ca)
	if err != nil {
		t.Fatal(err)
	}

	mount := findMount(t, loadMounts(t, bundle), "/opt/java/lib/security")
	scratch, _ := mount["source"].(string)
	mustWriteFile(t, filepath.Join(scratch, "other"), "AFTER\n")

	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(filepath.Join(rootfs, "opt/java/lib/security/cacerts"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, original) {
		t.Fatal("the untouched keystore was churned by the inject/strip round trip")
	}
	if sib, _ := os.ReadFile(filepath.Join(rootfs, "opt/java/lib/security/other")); string(sib) != "AFTER\n" {
		t.Fatalf("the step's change to the sibling was lost: %q", sib)
	}
}

// A keystore the step deleted is not restored: it is gone from the mirror, so
// the write-back takes it out of the image rather than putting it back.
func TestInjectDoesNotRestoreADeletedKeystore(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"JAVA_HOME=/opt/java"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	ca := certPEM(testCert(t, "buildcage"))
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/cacerts",
		keytoolStore(t, "keytool-alias", testCert(t, "digicert")))

	restore, err := inject(bundle, ca)
	if err != nil {
		t.Fatal(err)
	}

	mount := findMount(t, loadMounts(t, bundle), "/opt/java/lib/security")
	scratch, _ := mount["source"].(string)
	if err := os.Remove(filepath.Join(scratch, "cacerts")); err != nil {
		t.Fatal(err)
	}

	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(rootfs, "opt/java/lib/security/cacerts")); !os.IsNotExist(err) {
		t.Fatalf("the deleted keystore came back: %v", err)
	}
}

// Failing to restore the pristine keystore fails the step: a half-written
// keystore must not reach the image, so this is fail-closed like the write-back.
func TestInjectFailsWhenItCannotRestoreAKeystore(t *testing.T) {
	useFakeRsync(t)
	old := writeMirrorFile
	writeMirrorFile = func(string, []byte, os.FileMode) error { return errBrokenFile }
	t.Cleanup(func() { writeMirrorFile = old })

	bundle, rootfs := newBundle(t, []string{"JAVA_HOME=/opt/java"})
	ca := certPEM(testCert(t, "buildcage"))
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/cacerts",
		keytoolStore(t, "keytool-alias", testCert(t, "digicert")))
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/other", []byte("BEFORE\n"))

	restore, err := inject(bundle, ca)
	if err != nil {
		t.Fatal(err)
	}

	mount := findMount(t, loadMounts(t, bundle), "/opt/java/lib/security")
	scratch, _ := mount["source"].(string)
	mustWriteFile(t, filepath.Join(scratch, "other"), "AFTER\n")

	if err := restore.finish(); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want the restore failure to fail the step", err)
	}
}

// A keystore that cannot be injected into (here a PKCS#12 under a password of
// its own) is bound but left un-injected, so the step's JVM simply does
// not trust the CA rather than the build failing.
func TestInjectSkipsAnUninjectableKeystore(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"JAVA_HOME=/opt/java"})
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/cacerts",
		encryptedStore(t, testCert(t, "root")))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	mount := findMount(t, loadMounts(t, bundle), "/opt/java/lib/security")
	scratch, _ := mount["source"].(string)
	mirrored, err := os.ReadFile(filepath.Join(scratch, "cacerts"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(mirrored, testDER) {
		t.Fatal("something was injected into a keystore that cannot take it")
	}
}

// A JDK 8 keeps cacerts under jre/lib/security, its JAVA_HOME being the JDK root.
func TestFindJVMKeystoresFromJavaHomeJre(t *testing.T) {
	rootfs := t.TempDir()
	s := &spec{rootfs: rootfs, env: map[string]string{"JAVA_HOME": "/opt/jdk8"}}
	cacerts := filepath.Join(rootfs, "opt/jdk8/jre/lib/security/cacerts")
	mustMkdirAll(t, filepath.Dir(cacerts))
	mustWriteFile(t, cacerts, "x")

	if got := findJVMKeystores(s); !hasPath(got, cacerts) {
		t.Fatalf("findJVMKeystores = %v; want it to include %q", got, cacerts)
	}
}

// Every certificate in the CA is inserted, not only the first, so a multi-cert
// CA leaves the JVM trusting all of it the way the PEM stores do.
func TestKeystoreWithInsertsEveryCert(t *testing.T) {
	out, err := keystoreWith(keystore(2, trustedEntry(2, "digicert", otherDER)),
		[][]byte{testDER, []byte("SECOND-CA")})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out, testDER) || !bytes.Contains(out, []byte("SECOND-CA")) {
		t.Error("not every certificate was inserted")
	}
	_, entries, err := parseKeystore(out[:len(out)-sha1.Size])
	if err != nil {
		t.Fatalf("the result does not parse: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("got %d entries, want the original plus two", len(entries))
	}
}

func TestPKCS12WithInsertsEveryCert(t *testing.T) {
	root := testCert(t, "digicert")
	ca1 := testCert(t, "buildcage-1")
	ca2 := testCert(t, "buildcage-2")
	out, err := pkcs12With(passwordlessStore(t, root), [][]byte{ca1.Raw, ca2.Raw})
	if err != nil {
		t.Fatal(err)
	}
	certs, _, err := decodePKCS12(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(certs) != 3 {
		t.Fatalf("got %d certificates, want the original plus two", len(certs))
	}
}

// A Debian JDK's cacerts is a symlink into the CA store directory, which the
// store's own bind already mirrors; the CA goes into that mirror's copy of the
// keystore rather than a second bind the store mount would shadow.
func TestInjectCoversAKeystoreInsideTheStoreDir(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"JAVA_HOME=/opt/java"})
	writeRootfsKeystore(t, rootfs, "/etc/ssl/certs/java/cacerts",
		keystore(2, trustedEntry(2, "digicert", otherDER)))
	mustMkdirAll(t, filepath.Join(rootfs, "opt/java/lib/security"))
	mustSymlink(t, "/etc/ssl/certs/java/cacerts",
		filepath.Join(rootfs, "opt/java/lib/security/cacerts"))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	// One bind covers the store directory; the keystore is not bound separately.
	for _, m := range loadMounts(t, bundle) {
		if m["destination"] == "/etc/ssl/certs/java" {
			t.Fatal("the keystore was bound separately, which the store mount shadows")
		}
	}

	mount := findMount(t, loadMounts(t, bundle), "/etc/ssl/certs")
	scratch, _ := mount["source"].(string)
	mirrored, err := os.ReadFile(filepath.Join(scratch, "java", "cacerts"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(mirrored, []byte(injectedAlias)) || !bytes.Contains(mirrored, testDER) {
		t.Fatal("the CA was not inserted into the keystore inside the store mirror")
	}

	real, err := os.ReadFile(filepath.Join(rootfs, "etc/ssl/certs/java/cacerts"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(real, []byte(injectedAlias)) {
		t.Fatal("the real keystore was modified before the step touched it")
	}
}
