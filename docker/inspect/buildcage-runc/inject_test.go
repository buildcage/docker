package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// newBundleNoStore lays out a bundle with no CA store at all under
// rootfs/etc/ssl/certs, the node:*-slim shape: no OS trust store, only
// Node's own bundled roots, which findSystemStore cannot find.
func newBundleNoStore(t *testing.T, env []string) (bundle, rootfs string) {
	t.Helper()
	bundle = t.TempDir()
	rootfs = filepath.Join(bundle, "rootfs")
	// /etc exists, as it does in any real base image (passwd, hostname, ...);
	// only etc/ssl/certs and its siblings are absent, which is what actually
	// makes findSystemStore fail.
	mustMkdirAll(t, filepath.Join(rootfs, "etc"))

	config := map[string]any{
		"root":    map[string]any{"path": "rootfs"},
		"process": map[string]any{"env": toAny(env)},
	}
	raw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(bundle, "config.json"), string(raw))
	return bundle, rootfs
}

// newBundle is the same bundle with one system CA candidate in the rootfs,
// which is what the store-present half of the decision table needs.
func newBundle(t *testing.T, env []string) (bundle, rootfs string) {
	t.Helper()
	bundle, rootfs = newBundleNoStore(t, env)
	mustMkdirAll(t, filepath.Join(rootfs, "etc", "ssl", "certs"))
	mustWriteFile(t, filepath.Join(rootfs, "etc", "ssl", "certs", "ca-certificates.crt"), "ORIGINAL-ROOTS\n")
	return bundle, rootfs
}

func toAny(env []string) []any {
	out := make([]any, len(env))
	for i, e := range env {
		out[i] = e
	}
	return out
}

func loadEnv(t *testing.T, bundle string) map[string]string {
	t.Helper()
	s, err := loadSpec(bundle)
	if err != nil {
		t.Fatal(err)
	}
	return s.env
}

func loadMounts(t *testing.T, bundle string) []map[string]any {
	t.Helper()
	s, err := loadSpec(bundle)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := s.raw["mounts"].([]any)
	mounts := make([]map[string]any, 0, len(raw))
	for _, m := range raw {
		if entry, ok := m.(map[string]any); ok {
			mounts = append(mounts, entry)
		}
	}
	return mounts
}

func findMount(t *testing.T, mounts []map[string]any, dest string) map[string]any {
	t.Helper()
	for _, m := range mounts {
		if m["destination"] == dest {
			return m
		}
	}
	t.Fatalf("no mount for %s", dest)
	return nil
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
	own, err := os.ReadFile(filepath.Join(rootfs, strings.TrimPrefix(ownCAPath, "/")))
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

// Without an outer directory that cannot be bound, the groups under it still
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
// exist, so it is left alone rather than mirrored. (resolveInRoot resolves such
// a path now, for the anchors' sake, so this is guarded separately.)
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
	if _, err := os.Stat(filepath.Join(rootfs, strings.TrimPrefix(ownCAPath, "/"))); !os.IsNotExist(err) {
		t.Fatalf("own CA file still present: %v", err)
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

	calls := countRsync(t)

	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}
	if *calls != 2 {
		t.Fatalf("got %d rsync invocations for the write-back, want 2 (dry run, then apply)", *calls)
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

	failRsyncOn(t, 2) // the apply, right after a successful dry run

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
	failRsyncOn(t, 2)

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
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})

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
	own, err := os.ReadFile(filepath.Join(rootfs, strings.TrimPrefix(ownCAPath, "/")))
	if err != nil {
		t.Fatal(err)
	}
	if string(own) != string(testCA) {
		t.Fatalf("own CA file = %q", own)
	}

	restore.finish()
	if _, err := os.Stat(filepath.Join(rootfs, strings.TrimPrefix(ownCAPath, "/"))); !os.IsNotExist(err) {
		t.Fatalf("own CA file still present after restore: %v", err)
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

	if mounts := loadMounts(t, bundle); len(mounts) != 0 {
		t.Fatalf("expected no mounts, got %v", mounts)
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

// Not at a store the CA never went into.
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

	if mounts := loadMounts(t, bundle); len(mounts) != 0 {
		t.Errorf("mounted %v, want nothing mirrored", mounts)
	}
	if got := loadEnv(t, bundle)["SSL_CERT_FILE"]; got != ownCAPath {
		t.Errorf("SSL_CERT_FILE = %q, want %q", got, ownCAPath)
	}
}

// A file already at the wrapper's own path belongs to the image, not to this
// run: it is neither overwritten nor removed, and the variables that would
// have pointed at it stay unset.
func TestInjectLeavesAnExistingOwnCAPathAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	existing := filepath.Join(rootfs, strings.TrimPrefix(ownCAPath, "/"))
	mustWriteFile(t, existing, "THE IMAGE PUT THIS HERE")

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	env := loadEnv(t, bundle)
	for _, additive := range []string{"NODE_EXTRA_CA_CERTS", "DENO_CERT"} {
		if _, set := env[additive]; set {
			t.Errorf("%s was pointed at a file this run did not write", additive)
		}
	}

	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(existing)
	if err != nil {
		t.Fatalf("the image's own file was removed: %v", err)
	}
	if string(got) != "THE IMAGE PUT THIS HERE" {
		t.Fatalf("the image's own file was overwritten: %q", got)
	}
}

// A variable pointing outside the rootfs is left as the author wrote it: the
// wrapper runs as root on the host, so following it is what resolveInRoot
// exists to refuse.
func TestInjectLeavesAnUnresolvableVariableAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newBundle(t, []string{"DENO_CERT=../../../../etc/passwd"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	if got := loadEnv(t, bundle)["DENO_CERT"]; got != "../../../../etc/passwd" {
		t.Errorf("DENO_CERT = %q, want it left alone", got)
	}
	if mounts := loadMounts(t, bundle); len(mounts) != 1 {
		t.Fatalf("expected only the store's own mount, got %v", mounts)
	}
}

// Injection is best-effort: anything that stops the CA getting in is logged and
// the step still runs, so a build never fails because the wrapper could not
// place a certificate. Its TLS failures say what happened.
func TestInjectCarriesOnWhenItCannotPlaceItsOwnCAFile(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	// /etc points outside the rootfs, so resolveInRoot refuses it.
	mustSymlink(t, "../../../../outside", filepath.Join(rootfs, "etc"))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	env := loadEnv(t, bundle)
	for _, variable := range caVariables {
		if _, set := env[variable.name]; set {
			t.Errorf("%s was set to a file that could not be placed", variable.name)
		}
	}
	var out strings.Builder
	dumpOwnLog(&out)
	if !strings.Contains(out.String(), "cannot place") {
		t.Errorf("the failure is not in the log:\n%s", out.String())
	}
}

func TestInjectCarriesOnWhenItCannotWriteItsOwnCAFile(t *testing.T) {
	skipIfRoot(t)
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	// The path resolves, /etc being a real directory and the file simply not
	// there yet, but nothing can be created in it.
	mustMakeReadOnly(t, filepath.Join(rootfs, "etc"))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	if got := loadEnv(t, bundle)["NODE_EXTRA_CA_CERTS"]; got != "" {
		t.Errorf("NODE_EXTRA_CA_CERTS = %q, want it left unset", got)
	}
	var out strings.Builder
	dumpOwnLog(&out)
	if !strings.Contains(out.String(), "cannot write") {
		t.Errorf("the failure is not in the log:\n%s", out.String())
	}
}

// The own-CA file is removed when the step ends. Failing to remove it leaves
// a file in the layer, which is worth saying, but the write-back's own result
// is what decides the build.
func TestInjectFinishReportsAnOwnCAFileItCannotRemove(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	// Swap the file for a directory that is not empty, which os.Remove cannot
	// take away.
	ownCA := filepath.Join(rootfs, strings.TrimPrefix(ownCAPath, "/"))
	if err := os.Remove(ownCA); err != nil {
		t.Fatal(err)
	}
	mustMkdirAll(t, filepath.Join(ownCA, "in-the-way"))

	if err := restore.finish(); err != nil {
		t.Fatalf("a leftover own-CA file must not fail the step: %v", err)
	}
	var out strings.Builder
	dumpOwnLog(&out)
	if !strings.Contains(out.String(), "cannot remove") {
		t.Errorf("the failure is not in the log:\n%s", out.String())
	}
}

// A step that swaps an ancestor of the own-CA file for an absolute symlink of
// its own must not have the removal follow it out of the rootfs. Re-resolving
// the path disagrees with where inject wrote it, so it is left rather than
// unlinked.
func TestInjectFinishRefusesAnOwnCAPathASymlinkNowLeadsOutOf(t *testing.T) {
	useTempLog(t)
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	// A file outside the rootfs the old removal would have unlinked by following
	// an absolute symlink out of it.
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(outside, filepath.Base(ownCAPath)), "OUTSIDE\n")

	// The step points /etc, the own-CA file's parent, at that outside path.
	etc := filepath.Join(rootfs, "etc")
	if err := os.RemoveAll(etc); err != nil {
		t.Fatal(err)
	}
	mustSymlink(t, outside, etc)

	if err := restore.finish(); err != nil {
		t.Fatalf("the mismatch must not fail the step: %v", err)
	}
	if _, err := os.Stat(filepath.Join(outside, filepath.Base(ownCAPath))); err != nil {
		t.Fatalf("the removal followed a symlink out of the rootfs: %v", err)
	}
	var out strings.Builder
	dumpOwnLog(&out)
	if !strings.Contains(out.String(), "no longer resolves there") {
		t.Errorf("the refusal is not in the log:\n%s", out.String())
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
// directory is skipped rather than the CA going into the real rootfs.
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
	var out strings.Builder
	dumpOwnLog(&out)
	if !strings.Contains(out.String(), "cannot create a scratch directory") {
		t.Errorf("the failure is not in the log:\n%s", out.String())
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
