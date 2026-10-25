package main

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func loadEnv(t *testing.T, bundle string) map[string]string {
	t.Helper()
	s, err := loadSpec(bundle)
	if err != nil {
		t.Fatal(err)
	}
	return s.env
}

// ownCASource fails the test unless a file is bound read-only at ownCAPath, and
// returns the file bound there.
func ownCASource(t *testing.T, bundle string) string {
	t.Helper()
	m := findMount(t, loadMounts(t, bundle), ownCAPath)
	if opts, _ := m["options"].([]any); !slices.Equal(opts, []any{"rbind", "ro", "nosuid", "nodev", "noexec"}) {
		t.Fatalf("%s is bound with %v", ownCAPath, opts)
	}
	source, _ := m["source"].(string)
	return source
}

// Additive variables (NODE_EXTRA_CA_CERTS, DENO_CERT) get their own file
// holding only the proxy's CA, so a tool's built-in bundle stays intact.
// Replacing variables (REQUESTS_CA_BUNDLE, PIP_CERT, SSL_CERT_FILE) get
// pointed at the system store instead, which already carries both.
func TestInjectSetsEachUnsetVariableAccordingToItsKind(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	env := loadEnv(t, bundle)

	for _, additive := range []string{"NODE_EXTRA_CA_CERTS", "DENO_CERT"} {
		if env[additive] != ownCAPath {
			t.Errorf("%s = %q, want %q", additive, env[additive], ownCAPath)
		}
	}
	own, err := os.ReadFile(ownCASource(t, bundle))
	if err != nil {
		t.Fatal(err)
	}
	if string(own) != string(testCA) {
		t.Fatalf("own CA file = %q", own)
	}

	systemStorePath := "/etc/ssl/certs/ca-certificates.crt"
	for _, replacing := range []string{"REQUESTS_CA_BUNDLE", "PIP_CERT", "SSL_CERT_FILE"} {
		if env[replacing] != systemStorePath {
			t.Errorf("%s = %q, want %q", replacing, env[replacing], systemStorePath)
		}
	}

	if _, set := env["CURL_CA_BUNDLE"]; set {
		t.Error("CURL_CA_BUNDLE should be left unset; curl already reads the system store")
	}

	// The CA goes into the scratch mirror bind-mounted over the store's
	// directory, never into the real rootfs directly.
	mount := findMount(t, loadMounts(t, bundle), "/etc/ssl/certs")
	scratchDir, _ := mount["source"].(string)
	mirrored, err := os.ReadFile(filepath.Join(scratchDir, "ca-certificates.crt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(mirrored), string(testCA)) || !strings.HasPrefix(string(mirrored), "ORIGINAL-ROOTS") {
		t.Fatalf("scratch mirror not patched correctly: %q", mirrored)
	}

	store, err := os.ReadFile(filepath.Join(rootfs, "etc", "ssl", "certs", "ca-certificates.crt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(store) != "ORIGINAL-ROOTS\n" {
		t.Fatalf("the real store must stay untouched until the step changes it: %q", store)
	}
}

// A step that already points a variable somewhere of its own keeps that
// choice; the CA is appended to that file instead of the variable being
// redirected, so whatever the author put there is not discarded.
func TestInjectAppendsToAnAlreadySetVariableInstead(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"DENO_CERT=/custom/roots.pem"})
	mustMkdirAll(t, filepath.Join(rootfs, "custom"))
	mustWriteFile(t, filepath.Join(rootfs, "custom", "roots.pem"), "CUSTOM\n")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	env := loadEnv(t, bundle)
	if env["DENO_CERT"] != "/custom/roots.pem" {
		t.Fatalf("DENO_CERT was redirected to %q", env["DENO_CERT"])
	}

	mount := findMount(t, loadMounts(t, bundle), "/custom")
	scratchDir, _ := mount["source"].(string)
	custom, err := os.ReadFile(filepath.Join(scratchDir, "roots.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(custom), string(testCA)) {
		t.Fatal("the CA was not appended to the custom file")
	}

	real, err := os.ReadFile(filepath.Join(rootfs, "custom", "roots.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if string(real) != "CUSTOM\n" {
		t.Fatalf("the real file must stay untouched until the step changes it: %q", real)
	}
}

// An append-only variable that is set gets the CA in the file it names.
func TestInjectAppendsToAnAppendOnlyVariable(t *testing.T) {
	for _, name := range []string{"GIT_SSL_CAINFO", "npm_config_cafile", "AWS_CA_BUNDLE", "CARGO_HTTP_CAINFO", "BUNDLE_SSL_CA_CERT"} {
		t.Run(name, func(t *testing.T) {
			useFakeRsync(t)
			bundle, rootfs := newBundle(t, []string{name + "=/custom/roots.pem"})
			mustMkdirAll(t, filepath.Join(rootfs, "custom"))
			mustWriteFile(t, filepath.Join(rootfs, "custom", "roots.pem"), "CUSTOM\n")

			restore, err := inject(bundle, testCA)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = restore.finish() }()

			mirrorHolds(t, loadMounts(t, bundle), "/custom", "roots.pem")
			if got := loadEnv(t, bundle)[name]; got != "/custom/roots.pem" {
				t.Errorf("%s was redirected to %q", name, got)
			}
		})
	}
}

// Unset, it stays unset: the tool reads its default trust.
func TestInjectLeavesAnUnsetAppendOnlyVariableUnset(t *testing.T) {
	for name, newBundleFn := range map[string]func(*testing.T, []string) (string, string){
		"with a store": newBundle,
		"no store":     newBundleNoStore,
	} {
		t.Run(name, func(t *testing.T) {
			useFakeRsync(t)
			bundle, _ := newBundleFn(t, []string{"PATH=/usr/bin"})

			restore, err := inject(bundle, testCA)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = restore.finish() }()

			env := loadEnv(t, bundle)
			for _, variable := range []string{"GIT_SSL_CAINFO", "npm_config_cafile", "NPM_CONFIG_CAFILE", "AWS_CA_BUNDLE", "CARGO_HTTP_CAINFO", "BUNDLE_SSL_CA_CERT"} {
				if value, set := env[variable]; set {
					t.Errorf("%s was set to %q", variable, value)
				}
			}
		})
	}
}

// npm reads npm_config_cafile in any case. Two spellings naming one file add
// the CA to it once.
func TestInjectMatchesNpmConfigCafileInAnyCase(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{
		"NPM_CONFIG_CAFILE=/a/ca.pem",
		"npm_config_cafile=/a/ca.pem",
		"Npm_Config_Cafile=/b/ca.pem",
	})
	for _, dir := range []string{"a", "b"} {
		mustMkdirAll(t, filepath.Join(rootfs, dir))
		mustWriteFile(t, filepath.Join(rootfs, dir, "ca.pem"), "OWN\n")
	}

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = restore.finish() }()

	mounts := loadMounts(t, bundle)
	mirrorHolds(t, mounts, "/b", "ca.pem")
	scratchDir, _ := findMount(t, mounts, "/a")["source"].(string)
	got, err := os.ReadFile(filepath.Join(scratchDir, "ca.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(string(got), string(testCA)); n != 1 {
		t.Errorf("the CA is in /a/ca.pem %d times, want once", n)
	}
}

// A variable pointing at a file nested inside the system store directory is
// injected in the store's own mirror, not bound on its own: a bind under the
// store mount would be shadowed by it, so the nested file would otherwise never
// get the CA (and, left to map order, the store itself could be the one skipped).
func TestInjectFoldsATargetNestedUnderTheStore(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"DENO_CERT=/etc/ssl/certs/company/roots.pem"})
	mustMkdirAll(t, filepath.Join(rootfs, "etc", "ssl", "certs", "company"))
	mustWriteFile(t, filepath.Join(rootfs, "etc", "ssl", "certs", "company", "roots.pem"), "COMPANY\n")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	mounts := loadMounts(t, bundle)
	for _, m := range mounts {
		if m["destination"] == "/etc/ssl/certs/company" {
			t.Fatal("the nested target got its own bind, which the store mount shadows")
		}
	}

	// Both the store bundle and the nested file are injected in the store's one
	// mirror.
	mount := findMount(t, mounts, "/etc/ssl/certs")
	scratchDir, _ := mount["source"].(string)
	for _, rel := range []string{"ca-certificates.crt", "company/roots.pem"} {
		got, err := os.ReadFile(filepath.Join(scratchDir, rel))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(got), string(testCA)) {
			t.Errorf("%s did not get the CA in the store mirror: %q", rel, got)
		}
	}
}

// mirrorHolds checks that each named file in the mirror bound at dest carries
// the CA.
func mirrorHolds(t *testing.T, mounts []map[string]any, dest string, names ...string) {
	t.Helper()
	scratchDir, _ := findMount(t, mounts, dest)["source"].(string)
	for _, name := range names {
		got, err := os.ReadFile(filepath.Join(scratchDir, name))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(got), string(testCA)) {
			t.Errorf("%s under %s did not get the CA: %q", name, dest, got)
		}
	}
}

// hasMount reports whether a mount in the spec sits at dest.
func hasMount(mounts []map[string]any, dest string) bool {
	return slices.ContainsFunc(mounts, func(m map[string]any) bool { return m["destination"] == dest })
}

// A variable pointing above the store directory takes the store into its own
// bind: a separate store bind under it would conflict with it, leaving the
// variable's file without the CA.
func TestInjectFoldsTheStoreIntoAnAncestorTarget(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"SSL_CERT_FILE=/etc/ssl/corp.pem"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	mustWriteFile(t, filepath.Join(rootfs, "etc", "ssl", "corp.pem"), "CORP\n")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mounts := loadMounts(t, bundle)
	if hasMount(mounts, "/etc/ssl/certs") {
		t.Error("the store got a bind of its own under the variable's")
	}
	mirrorHolds(t, mounts, "/etc/ssl", "corp.pem", "certs/ca-certificates.crt")
	if env := loadEnv(t, bundle); env["SSL_CERT_FILE"] != "/etc/ssl/corp.pem" {
		t.Errorf("SSL_CERT_FILE was redirected to %q", env["SSL_CERT_FILE"])
	}

	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]string{
		"etc/ssl/corp.pem":                  "CORP\n",
		"etc/ssl/certs/ca-certificates.crt": "ORIGINAL-ROOTS\n",
	} {
		if got, _ := os.ReadFile(filepath.Join(rootfs, path)); string(got) != want {
			t.Errorf("%s = %q, want it untouched", path, got)
		}
	}
}

// Two variables whose files nest share the outer one's bind the same way.
func TestInjectFoldsNestedCustomTargets(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"DENO_CERT=/opt/a/ca.pem", "NODE_EXTRA_CA_CERTS=/opt/a/b/ca.pem"})
	mustMkdirAll(t, filepath.Join(rootfs, "opt", "a", "b"))
	mustWriteFile(t, filepath.Join(rootfs, "opt", "a", "ca.pem"), "A\n")
	mustWriteFile(t, filepath.Join(rootfs, "opt", "a", "b", "ca.pem"), "B\n")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = restore.finish() }()

	mounts := loadMounts(t, bundle)
	if hasMount(mounts, "/opt/a/b") {
		t.Error("the inner target got a bind of its own under the outer one's")
	}
	mirrorHolds(t, mounts, "/opt/a", "ca.pem", "b/ca.pem")
}

// An outer directory that cannot be bound leaves the ones folded into it bound
// as before, so the store keeps the CA even when the variable's file cannot.
func TestInjectFallsBackWhenTheAncestorCannotBeBound(t *testing.T) {
	cases := map[string]struct {
		value string
		lay   func(t *testing.T, rootfs string)
	}{
		"the container root": {"/corp.pem", func(t *testing.T, rootfs string) {
			mustWriteFile(t, filepath.Join(rootfs, "corp.pem"), "CORP\n")
		}},
		"over the store's limits": {"/etc/ssl/corp.pem", func(t *testing.T, rootfs string) {
			mustWriteFile(t, filepath.Join(rootfs, "etc", "ssl", "corp.pem"), "CORP\n")
			mustSparseFile(t, filepath.Join(rootfs, "etc", "ssl", "huge"), maxStoreDirBytes+1)
		}},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			useFakeRsync(t)
			bundle, rootfs := newBundle(t, []string{"SSL_CERT_FILE=" + c.value})
			c.lay(t, rootfs)

			restore, err := inject(bundle, testCA)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = restore.finish() }()

			mounts := loadMounts(t, bundle)
			mirrorHolds(t, mounts, "/etc/ssl/certs", "ca-certificates.crt")
			if dir := filepath.Dir(c.value); dir != "/" && hasMount(mounts, dir) {
				t.Errorf("%s was bound over the limits", dir)
			}
		})
	}
}

// Under an outer directory that cannot be bound, the groups below it still
// fold together: here /etc conflicts with a BuildKit mount, and /etc/ssl takes
// the store in rather than losing to it.
func TestInjectFoldsWhatIsLeftUnderAnAncestorItCannotBind(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"SSL_CERT_FILE=/etc/corp.pem", "NODE_EXTRA_CA_CERTS=/etc/ssl/corp.pem"})
	mountAt(t, bundle, "/etc/hosts")
	mustWriteFile(t, filepath.Join(rootfs, "etc", "corp.pem"), "ETC\n")
	mustWriteFile(t, filepath.Join(rootfs, "etc", "ssl", "corp.pem"), "SSL\n")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = restore.finish() }()

	mounts := loadMounts(t, bundle)
	if hasMount(mounts, "/etc") || hasMount(mounts, "/etc/ssl/certs") {
		t.Errorf("got mounts %v, want only /etc/ssl bound", mounts)
	}
	mirrorHolds(t, mounts, "/etc/ssl", "corp.pem", "certs/ca-certificates.crt")
}

// A relative value is read by the tool from its working directory, which is
// the step's WORKDIR unless the step changes it.
func TestInjectResolvesARelativeVariableFromTheWorkingDirectory(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"SSL_CERT_FILE=certs/ca.pem"})
	setSpecField(t, bundle, "process", func(proc map[string]any) { proc["cwd"] = "/app" })
	mustMkdirAll(t, filepath.Join(rootfs, "app", "certs"))
	mustWriteFile(t, filepath.Join(rootfs, "app", "certs", "ca.pem"), "APP\n")
	mustMkdirAll(t, filepath.Join(rootfs, "certs"))
	mustWriteFile(t, filepath.Join(rootfs, "certs", "ca.pem"), "ROOT\n")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = restore.finish() }()

	mounts := loadMounts(t, bundle)
	mirrorHolds(t, mounts, "/app/certs", "ca.pem")
	if hasMount(mounts, "/certs") {
		t.Error("the value was resolved from / rather than the working directory")
	}
	if env := loadEnv(t, bundle); env["SSL_CERT_FILE"] != "certs/ca.pem" {
		t.Errorf("SSL_CERT_FILE was rewritten to %q", env["SSL_CERT_FILE"])
	}
}

// A variable pointing at a bundle under a directory that is not there is the
// step's own: nothing can be appended to a file whose directory does not
// exist, so it is left alone rather than mirrored. (resolveInRoot accepts such
// a path, for the anchors' sake, so this is guarded separately.)
func TestInjectLeavesAVariableUnderAMissingDirectoryAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newBundle(t, []string{"DENO_CERT=/not-there/roots.pem"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	for _, m := range loadMounts(t, bundle) {
		if m["destination"] == "/not-there" {
			t.Fatal("a bind was set up for a directory that is not there")
		}
	}
	if env := loadEnv(t, bundle)["DENO_CERT"]; env != "/not-there/roots.pem" {
		t.Fatalf("DENO_CERT was disturbed: %q", env)
	}
}

// Treated as a bundle, a directory would nest the host path inside the store's mirror.
func TestInjectLeavesAVariableNamingADirectoryAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newBundle(t, []string{"SSL_CERT_FILE=/etc/ssl/certs"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	for _, m := range loadMounts(t, bundle) {
		if m["destination"] == ownCAPath {
			continue
		}
		entries, err := os.ReadDir(m["source"].(string))
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range entries {
			if e.IsDir() {
				t.Fatalf("the mirror of %v holds a directory %s", m["destination"], e.Name())
			}
		}
	}
	if env := loadEnv(t, bundle)["SSL_CERT_FILE"]; env != "/etc/ssl/certs" {
		t.Fatalf("SSL_CERT_FILE was disturbed: %q", env)
	}
}

// A step that never touches the store leaves the real rootfs file alone:
// finish() finds the scratch mirror unchanged from its post-injection
// baseline and never writes back.
func TestInjectFinishLeavesAnUntouchedStoreAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}

	store, err := os.ReadFile(filepath.Join(rootfs, "etc", "ssl", "certs", "ca-certificates.crt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(store) != "ORIGINAL-ROOTS\n" {
		t.Fatalf("the real store was written to even though nothing changed: %q", store)
	}
}

// A step that regenerates the store (e.g. apt-get install --reinstall
// ca-certificates) gets its change mirrored back onto the real rootfs.
func TestInjectWritesBackWhenTheStepChangesTheStore(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	mount := findMount(t, loadMounts(t, bundle), "/etc/ssl/certs")
	scratchDir, _ := mount["source"].(string)
	mustWriteFile(t, filepath.Join(scratchDir, "ca-certificates.crt"), "REGENERATED\n")

	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(filepath.Join(rootfs, "etc", "ssl", "certs", "ca-certificates.crt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "REGENERATED\n" {
		t.Fatalf("write-back did not reach the real store: %q", got)
	}
}

// A failure applying the write-back must fail the build rather than ship a
// half-written layer.
func TestInjectWriteBackFailurePropagates(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newBundle(t, []string{"PATH=/usr/bin"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	mount := findMount(t, loadMounts(t, bundle), "/etc/ssl/certs")
	scratchDir, _ := mount["source"].(string)
	mustWriteFile(t, filepath.Join(scratchDir, "ca-certificates.crt"), "REGENERATED\n")

	failRsyncWhen(t, isRsyncApply)

	if err := restore.finish(); err == nil {
		t.Fatal("expected the write-back failure to propagate")
	}
}

// The write-back's failure is the one returned, but a copy the sweep could not
// strip still reaches the log.
func TestInjectWriteBackFailureKeepsTheSweepFailureInTheLog(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mount := findMount(t, loadMounts(t, bundle), "/etc/ssl/certs")
	scratchDir, _ := mount["source"].(string)
	mustWriteFile(t, filepath.Join(scratchDir, "ca-certificates.crt"), "REGENERATED\n")
	mustWriteFile(t, filepath.Join(rootfs, "cacerts.bin"), "EFI-VAR\x00"+string(testDER))
	failRsyncWhen(t, isRsyncApply)

	if err := restore.finish(); err == nil || isCAResidue(err) {
		t.Fatalf("got %v, want the write-back failure", err)
	}
	if !strings.Contains(ownLog.String(), "cannot strip: /cacerts.bin") {
		t.Errorf("the sweep failure is not in the log:\n%s", ownLog.String())
	}
}

func TestInjectSkipsRestoreWhenStepSwapsBundleForASymlink(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	outside := filepath.Join(t.TempDir(), "host-secret")
	mustWriteFile(t, outside, "SECRET")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	mount := findMount(t, loadMounts(t, bundle), "/etc/ssl/certs")
	scratchDir, _ := mount["source"].(string)
	target := filepath.Join(scratchDir, "ca-certificates.crt")
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	mustSymlink(t, outside, target)

	if err := restore.finish(); err != nil {
		t.Fatalf("restore should skip the unrestorable file, not fail the build: %v", err)
	}

	secret, err := os.ReadFile(outside)
	if err != nil {
		t.Fatal(err)
	}
	if string(secret) != "SECRET" {
		t.Fatalf("the symlink target was modified: %q", secret)
	}

	got := filepath.Join(rootfs, "etc", "ssl", "certs", "ca-certificates.crt")
	link, err := os.Readlink(got)
	if err != nil {
		t.Fatalf("write-back did not mirror the step's own symlink: %v", err)
	}
	if link != outside {
		t.Fatalf("got link %q, want %q", link, outside)
	}
}

// A base image with no CA store of its own (node:*-slim before
// ca-certificates is installed, or a scratch/distroless image) must not lose
// every variable just because the system store is missing: all six fall back
// to the same proxy-CA-only file. This is the corepack/node:22-slim and
// apt-install-then-curl/debian:bookworm-slim failure modes under the inspect
// engine; see README.md#limitations for what this fallback does and does not
// cover (ordinary MITM'd traffic works; a passthrough connection's real
// certificate still does not verify).
func TestInjectWithoutSystemStoreFallsBackToOwnCAForEveryVariable(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newBundleNoStore(t, []string{"PATH=/usr/bin"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	env := loadEnv(t, bundle)

	for _, variable := range []string{
		"NODE_EXTRA_CA_CERTS", "DENO_CERT",
		"CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "PIP_CERT", "SSL_CERT_FILE",
	} {
		if env[variable] != ownCAPath {
			t.Errorf("%s = %q, want %q", variable, env[variable], ownCAPath)
		}
	}
	source := ownCASource(t, bundle)
	own, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if string(own) != string(testCA) {
		t.Fatalf("own CA file = %q", own)
	}

	restore.finish()
	if _, err := os.Stat(filepath.Dir(source)); !os.IsNotExist(err) {
		t.Fatalf("own CA scratch directory still present after restore: %v", err)
	}
}

// newBundleWithMounts is newBundle with mounts already in the process spec,
// the way BuildKit hands them over for a cache mount or a bind.
func newBundleWithMounts(t *testing.T, env []string, destinations ...string) (bundle, rootfs string) {
	t.Helper()
	bundle, rootfs = newBundle(t, env)
	s, err := loadSpec(bundle)
	if err != nil {
		t.Fatal(err)
	}
	for _, dest := range destinations {
		s.addBindMount(dest, t.TempDir())
	}
	if err := s.save(); err != nil {
		t.Fatal(err)
	}
	return bundle, rootfs
}

// Mounting over a directory something else already covers would shadow it, so
// the store keeps whatever the build put there and injection is skipped.
func TestInjectSkipsADirectoryAMountAlreadyCovers(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundleWithMounts(t, []string{"PATH=/usr/bin"}, "/etc/ssl")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	for _, m := range loadMounts(t, bundle) {
		if m["destination"] == "/etc/ssl/certs" {
			t.Fatalf("injection mounted over a covered directory: %v", m)
		}
	}
	store, err := os.ReadFile(filepath.Join(rootfs, "etc/ssl/certs/ca-certificates.crt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(store) != "ORIGINAL-ROOTS\n" {
		t.Fatalf("the store was written to: %q", store)
	}
}

// A variable naming a file directly under / would make the mount destination
// the container root. Binding there would shadow the whole filesystem, so the
// CA does not go in at all.
func TestInjectRefusesToBindTheContainerRoot(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newBundleNoStore(t, []string{"CURL_CA_BUNDLE=/roots.pem"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	for _, m := range loadMounts(t, bundle) {
		if m["destination"] != ownCAPath {
			t.Fatalf("mounted %v, want only the own CA file", m)
		}
	}
}

// A directory prepare refuses is skipped rather than failing the build: the
// step runs without the CA there, and its TLS failures say so.
func TestInjectSkipsADirectoryPrepareRefuses(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"DENO_CERT=/big/roots.pem"})
	big := filepath.Join(rootfs, "big")
	mustMkdirAll(t, big)
	mustSparseFile(t, filepath.Join(big, "roots.pem"), maxCustomDirBytes+1)

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	for _, m := range loadMounts(t, bundle) {
		if m["destination"] == "/big" {
			t.Fatalf("injection mounted a directory prepare refused: %v", m)
		}
	}
	// The store the same build does have is still injected.
	findMount(t, loadMounts(t, bundle), "/etc/ssl/certs")
}

// A store too large to mirror never gets the CA, so SSL_CERT_FILE points at the
// proxy-CA-only file rather than at it.
func TestInjectFallsBackWhenTheStoreCannotBeMirrored(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	mustMkdirAll(t, filepath.Join(rootfs, "usr"))
	mustWriteFile(t, filepath.Join(rootfs, "usr/ca.crt"), "ORIGINAL-ROOTS\n")
	mustSparseFile(t, filepath.Join(rootfs, "usr/libhuge.so"), maxStoreDirBytes)
	mustMkdirAll(t, filepath.Join(rootfs, "etc/ssl/certs"))
	mustSymlink(t, "/usr/ca.crt", filepath.Join(rootfs, "etc/ssl/certs/ca-certificates.crt"))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	for _, m := range loadMounts(t, bundle) {
		if m["destination"] != ownCAPath {
			t.Errorf("mounted %v, want nothing mirrored", m)
		}
	}
	if got := loadEnv(t, bundle)["SSL_CERT_FILE"]; got != ownCAPath {
		t.Errorf("SSL_CERT_FILE = %q, want %q", got, ownCAPath)
	}
}

// A mount the step already has at the wrapper's own path is the step's: it is
// not shadowed, and the variables that would have pointed at it stay unset.
func TestInjectLeavesAMountAtTheOwnCAPathAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newBundleWithMounts(t, []string{"PATH=/usr/bin"}, ownCAPath)

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	env := loadEnv(t, bundle)
	for _, additive := range []string{"NODE_EXTRA_CA_CERTS", "DENO_CERT"} {
		if _, set := env[additive]; set {
			t.Errorf("%s was pointed at a file this run did not bind", additive)
		}
	}
	bound := 0
	for _, m := range loadMounts(t, bundle) {
		if m["destination"] == ownCAPath {
			bound++
		}
	}
	if bound != 1 {
		t.Errorf("%d mounts at %s, want only the step's own", bound, ownCAPath)
	}
}

// A variable whose path does not resolve inside the rootfs is left as the
// author wrote it.
func TestInjectLeavesAnUnresolvableVariableAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"DENO_CERT=/custom/roots.pem"})
	mustSymlink(t, "custom", filepath.Join(rootfs, "custom"))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	if got := loadEnv(t, bundle)["DENO_CERT"]; got != "/custom/roots.pem" {
		t.Errorf("DENO_CERT = %q, want it left alone", got)
	}
	for _, m := range loadMounts(t, bundle) {
		if m["destination"] != "/etc/ssl/certs" && m["destination"] != ownCAPath {
			t.Fatalf("mounted %v, want only the store and the own CA file", m)
		}
	}
}

// A bundle without a spec is not something to guess at: there is nothing to
// read the rootfs or the environment out of.
func TestInjectRefusesABundleWithoutASpec(t *testing.T) {
	if _, err := inject(t.TempDir(), testCA); err == nil {
		t.Fatal("expected inject to refuse the bundle")
	}
}

// Without a scratch directory there is nowhere to mirror the store to, so that
// directory is skipped rather than the CA going into the real rootfs, and
// nowhere to write the proxy-CA-only file, so the variables that would name it
// stay unset. The step still runs; its TLS failures say what happened.
func TestInjectSkipsADirectoryItCannotGetAScratchDirFor(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, _ := newBundle(t, []string{"PATH=/usr/bin"})
	blocked := t.TempDir()
	mustWriteFile(t, filepath.Join(blocked, "blocked"), "")
	scratchRoot = filepath.Join(blocked, "blocked", "ca")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	if mounts := loadMounts(t, bundle); len(mounts) != 0 {
		t.Fatalf("expected no mounts, got %v", mounts)
	}
	for _, additive := range []string{"NODE_EXTRA_CA_CERTS", "DENO_CERT"} {
		if _, set := loadEnv(t, bundle)[additive]; set {
			t.Errorf("%s was set to a file that could not be written", additive)
		}
	}
	var out strings.Builder
	dumpOwnLog(&out)
	for _, want := range []string{"cannot create a scratch directory", "cannot write " + ownCAPath} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("%q is not in the log:\n%s", want, out.String())
		}
	}
}

// The variables only take effect once the spec is written back. A spec that
// cannot be saved is logged; the binds are already in place, so the step still
// gets the store it was going to get.
func TestInjectReportsASpecItCannotSave(t *testing.T) {
	skipIfRoot(t)
	useTempLog(t)
	useFakeRsync(t)
	bundle, _ := newBundle(t, []string{"PATH=/usr/bin"})
	if err := os.Chmod(filepath.Join(bundle, "config.json"), 0o444); err != nil {
		t.Fatal(err)
	}

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	var out strings.Builder
	dumpOwnLog(&out)
	if !strings.Contains(out.String(), "cannot update the process spec") {
		t.Errorf("the failure is not in the log:\n%s", out.String())
	}
}

// With the step's layer readable, inject places the anchors, and finish takes
// them back out once the layer has been swept: an image with no store leaves
// nothing of them behind, /etc/pki included.
func TestInjectPlacesAnchorsAndFinishTakesThemBack(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	// The overlay's upper directory is the rootfs itself here, so a sweep of it
	// reaches the anchors the same way it would reach a real layer.
	useMountInfo(t, overlayLine(rootfs, rootfs))

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	for _, anchor := range anchorDirs {
		if _, err := os.Stat(resolvedAnchor(rootfs, anchor.dir)); err != nil {
			t.Fatalf("anchor %s was not placed: %v", anchor.dir, err)
		}
	}

	if err := in.finish(); err != nil {
		t.Fatal(err)
	}
	for _, anchor := range anchorDirs {
		if _, err := os.Lstat(filepath.Join(rootfs, anchor.dir)); !os.IsNotExist(err) {
			t.Fatalf("anchor directory %s was left behind", anchor.dir)
		}
	}
	if _, err := os.Lstat(filepath.Join(rootfs, "etc", "pki")); !os.IsNotExist(err) {
		t.Fatal("/etc/pki was left behind")
	}
}

// A sweep that fails still leaves finish to take the created directories back.
func TestFinishReportsAFailedLayerSweep(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	// A container the sweep cannot rewrite, left in the layer by the step.
	mustWriteFile(t, filepath.Join(rootfs, "cacerts.bin"), "EFI-VAR\x00"+string(testDER))

	if err := in.finish(); err == nil {
		t.Fatal("expected the failed sweep to fail the step")
	}
	if _, err := os.Lstat(filepath.Join(rootfs, "etc", "pki")); !os.IsNotExist(err) {
		t.Error("the anchor directories were left behind")
	}
}

// newSUSEBundle lays out SUSE's store: the bundle under /var/lib/ca-certificates,
// linked from /etc/ssl, beside the certificate directory GnuTLS reads.
func newSUSEBundle(t *testing.T, withBundle bool) (bundle, rootfs string) {
	t.Helper()
	bundle, rootfs = newBundleNoStore(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	pem := filepath.Join(rootfs, "var/lib/ca-certificates/pem")
	mustMkdirAll(t, pem)
	mustWriteFile(t, filepath.Join(pem, "root.pem"), "ORIGINAL-ROOT\n")
	if withBundle {
		mustWriteFile(t, filepath.Join(rootfs, "var/lib/ca-certificates/ca-bundle.pem"), "ORIGINAL-ROOTS\n")
		mustMkdirAll(t, filepath.Join(rootfs, "etc/ssl"))
		mustSymlink(t, "/var/lib/ca-certificates/ca-bundle.pem", filepath.Join(rootfs, "etc/ssl/ca-bundle.pem"))
	}
	return bundle, rootfs
}

// The CA goes into SUSE's GnuTLS directory through the store's mirror, and is
// gone once the step is over.
func TestInjectAddsTheCAToSUSEsCertDir(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newSUSEBundle(t, true)

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mounts := loadMounts(t, bundle)
	if hasMount(mounts, "/var/lib/ca-certificates/pem") {
		t.Error("the directory got a mount of its own inside the store's")
	}
	scratch, _ := findMount(t, mounts, "/var/lib/ca-certificates")["source"].(string)
	if got := mustRead(t, filepath.Join(scratch, "pem", suseCertName)); got != string(testCA) {
		t.Fatalf("the directory's copy holds %q, want the CA alone", got)
	}
	if err := in.finish(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(rootfs, "var/lib/ca-certificates/pem", suseCertName)); !os.IsNotExist(err) {
		t.Fatalf("got %v, want no CA file left in the directory", err)
	}
}

// A step that rebuilds the store with update-ca-certificates leaves neither
// the CA nor a hash link to it in the directory.
func TestSUSEsCertDirIsCleanAfterARebuild(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newSUSEBundle(t, true)

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	scratch, _ := findMount(t, loadMounts(t, bundle), "/var/lib/ca-certificates")["source"].(string)
	pem := filepath.Join(scratch, "pem")
	if err := os.Remove(filepath.Join(pem, suseCertName)); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(pem, "buildcage_proxy_CA.pem"), string(testCA))
	mustSymlink(t, "buildcage_proxy_CA.pem", filepath.Join(pem, "0123abcd.0"))
	mustWriteFile(t, filepath.Join(scratch, "ca-bundle.pem"), "ORIGINAL-ROOTS\n"+string(testCA))

	if err := in.finish(); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(rootfs, "var/lib/ca-certificates/pem"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "root.pem" {
		t.Fatalf("the directory holds %v, want only its own root", entries)
	}
	if got := mustRead(t, filepath.Join(rootfs, "var/lib/ca-certificates/ca-bundle.pem")); got != "ORIGINAL-ROOTS\n" {
		t.Fatalf("the bundle holds %q", got)
	}
}

// Without a store to fold it into, the directory is mirrored on its own.
func TestInjectBindsSUSEsCertDirWithoutAStore(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newSUSEBundle(t, false)

	if _, err := inject(bundle, testCA); err != nil {
		t.Fatal(err)
	}
	scratch, _ := findMount(t, loadMounts(t, bundle), "/var/lib/ca-certificates/pem")["source"].(string)
	if got := mustRead(t, filepath.Join(scratch, suseCertName)); got != string(testCA) {
		t.Fatalf("the directory's copy holds %q, want the CA alone", got)
	}
}

// A step whose layer cannot be read back does not run, whatever
// fail_on_ca_residue says, and nothing is placed in its rootfs.
func TestInjectRefusesAStepWithoutALayerToReadBack(t *testing.T) {
	for _, fail := range []bool{true, false} {
		t.Run(fmt.Sprintf("fail_on_ca_residue %v", fail), func(t *testing.T) {
			useTempLog(t)
			useFakeRsync(t)
			useFailOnCAResidue(t, fail)
			bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
			useMountInfo(t, mountLine(rootfs, "ext4", "rw"))

			if _, err := inject(bundle, testCA); !errors.Is(err, errLayerUnread) {
				t.Fatalf("got %v, want the unread layer to refuse the step", err)
			}
			if entries, _ := os.ReadDir(rootfs); len(entries) != 1 || entries[0].Name() != "etc" {
				t.Errorf("rootfs holds %v, want it untouched", entries)
			}
		})
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
	writeJava(t, filepath.Join(rootfs, "opt/java/other/bin/java"))

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

// Only the JDK a bare `java` runs, the first executable java on PATH, has its
// keystore injected: one further along PATH gets no CA and no mount, so a later
// step can still remove it.
func TestInjectSkipsAJDKFurtherAlongPath(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/opt/stub/bin:/opt/jdk-21/bin:/opt/jdk-17/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	for _, jdk := range []string{"jdk-21", "jdk-17"} {
		writeRootfsKeystore(t, rootfs, "/opt/"+jdk+"/lib/security/cacerts",
			keystore(2, trustedEntry(2, "digicert", otherDER)))
		writeJava(t, filepath.Join(rootfs, "opt", jdk, "bin/java"))
	}
	mustMkdirAll(t, filepath.Join(rootfs, "opt/stub/bin"))
	mustWriteFile(t, filepath.Join(rootfs, "opt/stub/bin/java"), "not executable")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mounts := loadMounts(t, bundle)
	findMount(t, mounts, "/opt/jdk-21/lib/security")
	if hasMount(mounts, "/opt/jdk-17/lib/security") {
		t.Error("the JDK further along PATH has its keystore directory mounted")
	}
	if err := restore.finish(); err != nil {
		t.Fatal(err)
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

// A keystore left half-written stops the step before it runs: the mirror is
// dropped unwritten and the real keystore keeps its bytes. One inside the store
// directory takes the store's bind down with it.
func TestInjectAbandonsAHalfWrittenKeystore(t *testing.T) {
	const javaCacerts = "/opt/java/lib/security/cacerts"
	for name, tc := range map[string]struct {
		newBundle func(t *testing.T, env []string) (string, string)
		keystore  string
	}{
		"in the JDK's own directory":    {newBundleNoStore, javaCacerts},
		"inside the CA store directory": {newBundle, "/etc/ssl/certs/java/cacerts"},
	} {
		t.Run(name, func(t *testing.T) {
			useFakeRsync(t)
			bundle, rootfs := tc.newBundle(t, []string{"JAVA_HOME=/opt/java"})
			pristine := keystore(2, trustedEntry(2, "digicert", otherDER))
			writeRootfsKeystore(t, rootfs, tc.keystore, pristine)
			if tc.keystore != javaCacerts {
				mustMkdirAll(t, filepath.Join(rootfs, filepath.Dir(javaCacerts)))
				mustSymlink(t, tc.keystore, filepath.Join(rootfs, javaCacerts))
			}
			before, err := os.ReadFile(filepath.Join(bundle, "config.json"))
			if err != nil {
				t.Fatal(err)
			}
			useBrokenBundleFile(t, &brokenFile{shortWriteAt: 1})

			_, err = inject(bundle, testCA)
			if !errors.Is(err, errKeystoreHalfWritten) || !strings.Contains(err.Error(), tc.keystore) {
				t.Fatalf("got %v, want the half-written keystore named by its container path", err)
			}
			after, err := os.ReadFile(filepath.Join(bundle, "config.json"))
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(after, before) {
				t.Error("the spec was saved for a step that will not run")
			}
			real, err := os.ReadFile(filepath.Join(rootfs, tc.keystore))
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(real, pristine) {
				t.Error("the real keystore was changed")
			}
			if left, err := os.ReadDir(scratchRoot); err != nil || len(left) != 0 {
				t.Errorf("scratch directories left behind: %v %v", left, err)
			}
		})
	}
}

// Undoing the injection can fail too; that goes to the log on its own line,
// and the error inject returns is still the half-written keystore alone.
func TestInjectLogsAFailureToUndoTheInjection(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newBundleNoStore(t, []string{"JAVA_HOME=/opt/java"})
	writeRootfsKeystore(t, rootfs, "/opt/java/lib/security/cacerts",
		keystore(2, trustedEntry(2, "digicert", otherDER)))
	useBrokenBundleFile(t, &brokenFile{shortWriteAt: 1})
	old := walkDir
	walkDir = func(dir string, fn fs.WalkDirFunc) error {
		if dir == rootfs {
			return errBrokenWalk // the sweep of the step's layer
		}
		return old(dir, fn)
	}
	t.Cleanup(func() { walkDir = old })

	_, err := inject(bundle, testCA)
	if !errors.Is(err, errKeystoreHalfWritten) || errors.Is(err, errBrokenWalk) {
		t.Fatalf("got %v, want the half-written keystore alone", err)
	}
	if !strings.Contains(ownLog.String(), "undoing the CA injection: ") {
		t.Errorf("the failure to undo was not logged:\n%s", ownLog.String())
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
