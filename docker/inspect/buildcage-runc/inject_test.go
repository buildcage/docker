package main

import (
	"encoding/json"
	"os"
	"path/filepath"
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
// Replacing variables (CURL_CA_BUNDLE, REQUESTS_CA_BUNDLE, PIP_CERT,
// SSL_CERT_FILE) get pointed at the system store instead, which already
// carries both.
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
	for _, replacing := range []string{
		"CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "PIP_CERT", "SSL_CERT_FILE",
	} {
		if env[replacing] != systemStorePath {
			t.Errorf("%s = %q, want %q", replacing, env[replacing], systemStorePath)
		}
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

// A step that never touches the store leaves the real rootfs file alone:
// finish() finds the scratch mirror unchanged from its post-injection
// baseline and never writes back.
func TestInjectFinishLeavesAnUntouchedStoreAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})

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

func TestInjectSkipsRestoreWhenStepSwapsBundleForASymlink(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})
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
// ca-certificates is installed, or a scratch/distroless image) gets one
// written for it, at every candidate path: which one a tool reads was decided
// when it was compiled, and Debian's wget goes by its own without consulting
// any variable at all.
func TestInjectWritesAStoreWhenTheImageHasNone(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	for _, candidate := range systemCertFiles {
		written, err := os.ReadFile(filepath.Join(rootfs, strings.TrimPrefix(candidate, "/")))
		if err != nil {
			t.Errorf("%s: %v", candidate, err)
			continue
		}
		if string(written) != string(testCA) {
			t.Errorf("%s = %q, want the CA", candidate, written)
		}
	}

	env := loadEnv(t, bundle)
	for _, replacing := range []string{
		"CURL_CA_BUNDLE", "REQUESTS_CA_BUNDLE", "PIP_CERT", "SSL_CERT_FILE",
	} {
		if env[replacing] != systemCertFiles[0] {
			t.Errorf("%s = %q, want %q", replacing, env[replacing], systemCertFiles[0])
		}
	}
	for _, additive := range []string{"NODE_EXTRA_CA_CERTS", "DENO_CERT"} {
		if env[additive] != ownCAPath {
			t.Errorf("%s = %q, want %q", additive, env[additive], ownCAPath)
		}
	}

	// A written store holds the certificate already, so there is nothing to
	// append and nothing to mirror.
	if mounts := loadMounts(t, bundle); len(mounts) != 0 {
		t.Errorf("got %d mounts, want none for a store this wrapper wrote", len(mounts))
	}

	restore.finish()
	for _, candidate := range systemCertFiles {
		if _, err := os.Stat(filepath.Join(rootfs, strings.TrimPrefix(candidate, "/"))); !os.IsNotExist(err) {
			t.Errorf("%s still present after restore: %v", candidate, err)
		}
	}
	// And the directories written for it, so the layer diff sees nothing.
	for _, dir := range []string{"etc/ssl", "etc/pki"} {
		if _, err := os.Stat(filepath.Join(rootfs, dir)); !os.IsNotExist(err) {
			t.Errorf("%s still present after restore: %v", dir, err)
		}
	}
}

// The anchor goes in whether or not the image shipped a store: the bundle is
// the step's to rebuild, and the anchor is what a rebuild takes the
// certificate back from. On RHEL it is also how GnuTLS sees the certificate at
// all, since p11-kit reads the directory rather than any bundle.
func TestInjectPlacesTheAnchorInEveryKnownDirectory(t *testing.T) {
	useFakeRsync(t)
	for name, newFixture := range map[string]func(*testing.T, []string) (string, string){
		"with a store":    newBundle,
		"without a store": newBundleNoStore,
	} {
		t.Run(name, func(t *testing.T) {
			bundle, rootfs := newFixture(t, []string{"PATH=/usr/bin"})

			restore, err := inject(bundle, testCA)
			if err != nil {
				t.Fatal(err)
			}

			for _, anchor := range anchorDirs {
				path := filepath.Join(rootfs, strings.TrimPrefix(anchor.dir, "/"), anchorName)
				written, err := os.ReadFile(path)
				if err != nil {
					t.Errorf("%s: %v", anchor.dir, err)
					continue
				}
				if string(written) != string(testCA) {
					t.Errorf("%s = %q, want the CA", anchor.dir, written)
				}
			}

			restore.finish()
			for _, anchor := range anchorDirs {
				path := filepath.Join(rootfs, strings.TrimPrefix(anchor.dir, "/"))
				if _, err := os.Stat(path); !os.IsNotExist(err) {
					t.Errorf("%s still present after restore: %v", anchor.dir, err)
				}
			}
		})
	}
}

// An anchor directory is created only because the package that ships it is not
// installed yet. A step that installs it during the step takes the directory
// over, and the undo has to leave it, or the image ends up missing a directory
// an ordinary build of the same Dockerfile has.
func TestInjectLeavesAnAnchorDirectoryTheStepTookOver(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	// The rest of what `apt-get install ca-certificates` unpacks. The anchor
	// directory it ships is already there, put down by the injection.
	mustMkdirAll(t, filepath.Join(rootfs, strings.TrimPrefix(anchorDirs[0].owner, "/")))

	restore.finish()

	kept := filepath.Join(rootfs, strings.TrimPrefix(anchorDirs[0].dir, "/"))
	if _, err := os.Stat(kept); err != nil {
		t.Errorf("%s was taken from the package that owns it: %v", anchorDirs[0].dir, err)
	}
	if entries, err := os.ReadDir(kept); err != nil || len(entries) != 0 {
		t.Errorf("%s = %v (%v), want it left empty", anchorDirs[0].dir, entries, err)
	}
	// The other distributions' tooling is still absent, so theirs go.
	for _, anchor := range anchorDirs[1:] {
		path := filepath.Join(rootfs, strings.TrimPrefix(anchor.dir, "/"))
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("%s still present after restore: %v", anchor.dir, err)
		}
	}
}

// rebuildFromAnchor is what update-ca-certificates leaves behind: the bundle
// concatenated afresh from the anchors, and two links beside it, one named
// after the anchor and one after its hash.
func rebuildFromAnchor(t *testing.T, storeDir string) {
	t.Helper()
	mustWriteFile(t, filepath.Join(storeDir, "ca-certificates.crt"), "REAL-ROOTS\n"+string(testCA))
	mustSymlink(t, filepath.Join(anchorDirs[0].dir, anchorName), filepath.Join(storeDir, "buildcage.pem"))
	mustSymlink(t, "buildcage.pem", filepath.Join(storeDir, "20538016.0"))
}

// assertOnlyRealRoots is the state the store has to be left in either way:
// the step's own roots, and nothing of the injection.
func assertOnlyRealRoots(t *testing.T, storeDir string) {
	t.Helper()
	got, err := os.ReadFile(filepath.Join(storeDir, "ca-certificates.crt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "REAL-ROOTS\n" {
		t.Errorf("bundle = %q, want the step's own roots alone", got)
	}
	for _, left := range []string{"buildcage.pem", "20538016.0"} {
		if _, err := os.Lstat(filepath.Join(storeDir, left)); !os.IsNotExist(err) {
			t.Errorf("%s still present after restore: %v", left, err)
		}
	}
}

// A step that reruns update-ca-certificates rebuilds the bundle from the
// anchors, so the certificate comes back without any of the text it was
// written with, and with two links pointing at the anchor. All of it has to go.
func TestInjectTakesBackWhatARebuiltBundleLeftBehind(t *testing.T) {
	useFakeRsync(t)
	t.Run("in a store this wrapper wrote", func(t *testing.T) {
		bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
		restore, err := inject(bundle, testCA)
		if err != nil {
			t.Fatal(err)
		}
		storeDir := filepath.Join(rootfs, "etc", "ssl", "certs")
		rebuildFromAnchor(t, storeDir)

		restore.finish()
		assertOnlyRealRoots(t, storeDir)
	})

	t.Run("in a store the image shipped", func(t *testing.T) {
		bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})
		restore, err := inject(bundle, testCA)
		if err != nil {
			t.Fatal(err)
		}
		mount := findMount(t, loadMounts(t, bundle), "/etc/ssl/certs")
		scratchDir, _ := mount["source"].(string)
		rebuildFromAnchor(t, scratchDir)

		restore.finish()
		assertOnlyRealRoots(t, filepath.Join(rootfs, "etc", "ssl", "certs"))
	})
}

// A link the image itself shipped broken is the image's own, however much it
// looks like something the undo left behind.
func TestInjectLeavesALinkItDidNotBreakAlone(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	dangling := filepath.Join(rootfs, "etc", "ssl", "certs", "shipped-broken.pem")
	mustSymlink(t, "/gone-before-any-of-this", dangling)

	restore.finish()

	if _, err := os.Lstat(dangling); err != nil {
		t.Fatalf("the image's own link did not survive: %v", err)
	}
}

// A step is free to take away the whole directory the anchor was written
// into, which leaves the undo nothing to look through rather than something
// to fail over.
func TestInjectSurvivesTheStepRemovingAnAnchorDirectory(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(rootfs, strings.TrimPrefix(anchorDirs[0].dir, "/"))); err != nil {
		t.Fatal(err)
	}

	restore.finish()
}

// A file swapped for something the undo has no business opening is left as
// the step left it, and does not stop the rest of the undo.
func TestInjectLeavesWhatItCannotOpenAlone(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	useBrokenBundleFile(t, &brokenFile{notRegular: true})

	restore.finish()

	store := filepath.Join(rootfs, strings.TrimPrefix(systemCertFiles[0], "/"))
	if _, err := os.Stat(store); err != nil {
		t.Fatalf("the file the undo could not open was removed anyway: %v", err)
	}
}

// Failing to look through what the injection wrote says so in the build log
// rather than passing silently.
func TestInjectReportsWhatItCouldNotTakeBack(t *testing.T) {
	useTempLog(t)
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	storeDir := filepath.Join(rootfs, "etc", "ssl", "certs")
	failWalkOn(t, storeDir, 1)

	restore.finish()

	if !strings.Contains(ownLog.String(), storeDir) {
		t.Fatalf("the failure was not reported: %q", ownLog.String())
	}
}

// A link the undo cannot remove is reported rather than left to look like it
// was dealt with.
func TestInjectReportsALinkItCannotRemove(t *testing.T) {
	skipIfRoot(t)
	useTempLog(t)
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	storeDir := filepath.Join(rootfs, "etc", "ssl", "certs")
	rebuildFromAnchor(t, storeDir)
	// Readable and traversable, so the strip gets that far, but nothing in it
	// can be unlinked.
	if err := os.Chmod(storeDir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(storeDir, 0o755) })

	restore.finish()

	if !strings.Contains(ownLog.String(), "buildcage.pem") {
		t.Fatalf("the failure was not reported: %q", ownLog.String())
	}
}

// A step that installs the distribution's own ca-certificates rebuilds the
// file this wrapper wrote into a real store. That store is the step's, and
// stays; only the certificate comes back out.
func TestInjectKeepsAWrittenStoreTheStepFilledIn(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	store := filepath.Join(rootfs, strings.TrimPrefix(systemCertFiles[0], "/"))
	mustWriteFile(t, store, "REAL-ROOTS\n"+string(testCA))

	restore.finish()

	got, err := os.ReadFile(store)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "REAL-ROOTS\n" {
		t.Fatalf("got %q, want the step's own roots with the CA taken out", got)
	}
}

// Candidate paths can name the same file: Debian and Alpine both ship
// /etc/ssl/cert.pem as a link to the bundle. Once one of them is written the
// others find it there, and the undo must not then take it away twice.
func TestInjectWritesAStoreOnceWhenCandidatesShareAFile(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	mustMkdirAll(t, filepath.Join(rootfs, "etc", "ssl"))
	mustSymlink(t, systemCertFiles[0], filepath.Join(rootfs, "etc", "ssl", "cert.pem"))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	store := filepath.Join(rootfs, strings.TrimPrefix(systemCertFiles[0], "/"))
	written, err := os.ReadFile(store)
	if err != nil {
		t.Fatal(err)
	}
	if string(written) != string(testCA) {
		t.Fatalf("%s = %q, want the CA once", systemCertFiles[0], written)
	}

	restore.finish()
	if _, err := os.Stat(store); !os.IsNotExist(err) {
		t.Fatalf("%s still present after restore: %v", systemCertFiles[0], err)
	}
}

// A step is free to swap what this wrapper wrote for something the undo has no
// business opening. It is left as the step left it.
func TestInjectLeavesAWrittenStoreTheStepSwappedOut(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}

	store := filepath.Join(rootfs, strings.TrimPrefix(systemCertFiles[0], "/"))
	if err := os.Remove(store); err != nil {
		t.Fatal(err)
	}
	mustSymlink(t, "/somewhere-else", store)

	restore.finish()

	target, err := os.Readlink(store)
	if err != nil {
		t.Fatal(err)
	}
	if target != "/somewhere-else" {
		t.Fatalf("got %q, want the step's own link", target)
	}
}

// A step can delete what this wrapper wrote outright, which leaves the undo
// nothing to do rather than something to fail over.
func TestInjectSurvivesTheStepDeletingAWrittenStore(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(rootfs, strings.TrimPrefix(systemCertFiles[0], "/"))); err != nil {
		t.Fatal(err)
	}

	restore.finish()
}

// A directory the injection created keeps whatever the step put in it, even
// though nothing of the injection's own is left there.
func TestInjectKeepsACreatedDirectoryTheStepUsed(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	kept := filepath.Join(rootfs, "etc", "ssl", "certs", "step-put-this-here")
	mustWriteFile(t, kept, "STEP\n")

	restore.finish()

	if _, err := os.Stat(kept); err != nil {
		t.Fatalf("the step's own file did not survive: %v", err)
	}
}

// Nowhere to write a store leaves the replacing variables with a file holding
// only the proxy's CA. That covers ordinary MITM'd traffic, since inspect
// re-signs it with this same CA, but not a passthrough connection's real
// certificate; see README.md#limitations.
func TestInjectFallsBackToOwnCAWhenNoStoreCanBeWritten(t *testing.T) {
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	// A regular file where each candidate's directory would have to go, so
	// every one of them fails to be created.
	mustWriteFile(t, filepath.Join(rootfs, "etc", "ssl"), "")
	mustWriteFile(t, filepath.Join(rootfs, "etc", "pki"), "")

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

// A file already at the wrapper's own path belongs to the image, not to this
// run: it is neither overwritten nor removed, and the variables that would
// have pointed at it stay unset.
func TestInjectLeavesAnExistingOwnCAPathAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})
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
