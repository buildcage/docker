package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGroupTargetsByDir(t *testing.T) {
	targets := map[string]bool{
		"/rootfs/etc/ssl/certs/ca-certificates.crt": true,
		"/rootfs/etc/ssl/certs/extra.pem":           true,
		"/rootfs/custom/roots.pem":                  true,
	}
	groups := groupTargetsByDir(targets)
	if len(groups["/rootfs/etc/ssl/certs"]) != 2 {
		t.Errorf("expected 2 files grouped under /rootfs/etc/ssl/certs, got %v", groups["/rootfs/etc/ssl/certs"])
	}
	if len(groups["/rootfs/custom"]) != 1 {
		t.Errorf("expected 1 file grouped under /rootfs/custom, got %v", groups["/rootfs/custom"])
	}
}

func TestContainerPathOfResolvesThroughSymlinks(t *testing.T) {
	// RHEL: the candidate file is a symlink into extracted/pem, sitting in a
	// different directory than the real store.
	t.Run("RHEL", func(t *testing.T) {
		root := t.TempDir()
		mustMkdirAll(t, filepath.Join(root, "etc/pki/ca-trust/extracted/pem"))
		mustMkdirAll(t, filepath.Join(root, "etc/pki/tls/certs"))
		mustWriteFile(t, filepath.Join(root, "etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"), "ROOTS")
		mustSymlink(t, "../../ca-trust/extracted/pem/tls-ca-bundle.pem", filepath.Join(root, "etc/pki/tls/certs/ca-bundle.crt"))

		store, err := findSystemStore(root)
		if err != nil {
			t.Fatal(err)
		}
		got := containerPathOf(root, store.dir())
		if want := "/etc/pki/ca-trust/extracted/pem"; got != want {
			t.Errorf("containerPathOf = %q, want %q", got, want)
		}
	})

	// openSUSE: the candidate is a symlink to a different top-level tree
	// entirely (/var/lib/ca-certificates), not a sibling directory.
	t.Run("openSUSE", func(t *testing.T) {
		root := t.TempDir()
		mustMkdirAll(t, filepath.Join(root, "var/lib/ca-certificates"))
		mustMkdirAll(t, filepath.Join(root, "etc/ssl"))
		mustWriteFile(t, filepath.Join(root, "var/lib/ca-certificates/ca-bundle.pem"), "ROOTS")
		mustSymlink(t, "../../var/lib/ca-certificates/ca-bundle.pem", filepath.Join(root, "etc/ssl/ca-bundle.pem"))

		store, err := findSystemStore(root)
		if err != nil {
			t.Fatal(err)
		}
		got := containerPathOf(root, store.dir())
		if want := "/var/lib/ca-certificates"; got != want {
			t.Errorf("containerPathOf = %q, want %q", got, want)
		}
	})
}

func TestContainerPathOfRefusesAnythingButAPathInsideTheRootfs(t *testing.T) {
	const rootfs = "/run/bundle/rootfs"
	cases := map[string]string{
		"the rootfs itself":       rootfs,
		"somewhere else entirely": "/somewhere/else",
		// Sharing a prefix with the rootfs is not being inside it; a bare
		// HasPrefix would hand back "-old/etc/ssl/certs" as a container path.
		"a sibling the rootfs name is a prefix of": rootfs + "-old/etc/ssl/certs",
	}
	for name, resolved := range cases {
		t.Run(name, func(t *testing.T) {
			if got := containerPathOf(rootfs, resolved); got != "/" {
				t.Errorf("containerPathOf(%q, %q) = %q, want %q", rootfs, resolved, got, "/")
			}
		})
	}
}

func TestManifestsEqualIgnoresMtimeButNotContent(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "a"), "same")
	a, err := captureManifest(dir)
	if err != nil {
		t.Fatal(err)
	}

	// A later write with identical content still bumps mtime; that alone
	// must not register as a change.
	mustWriteFile(t, filepath.Join(dir, "a"), "same")
	b, err := captureManifest(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !manifestsEqual(a, b) {
		t.Error("identical content with a different mtime should compare equal")
	}

	mustWriteFile(t, filepath.Join(dir, "a"), "different")
	c, err := captureManifest(dir)
	if err != nil {
		t.Fatal(err)
	}
	if manifestsEqual(a, c) {
		t.Error("different content should not compare equal")
	}
}

func TestSizeAndCount(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll(t, filepath.Join(dir, "sub"))
	mustWriteFile(t, filepath.Join(dir, "a"), "1234567890")
	mustWriteFile(t, filepath.Join(dir, "sub", "b"), "12345")

	bytes, files, err := sizeAndCount(dir)
	if err != nil {
		t.Fatal(err)
	}
	if bytes != 15 || files != 2 {
		t.Errorf("got bytes=%d files=%d, want bytes=15 files=2", bytes, files)
	}
}

func TestRestoreUnchangedMtimesLeavesChangedFilesAlone(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "untouched"), "same")
	mustWriteFile(t, filepath.Join(dir, "changed"), "before")

	// Chtimes to a fixed past time instead of relying on real write timing,
	// since two writes in quick succession can land in the same mtime tick.
	past := time.Now().Add(-time.Hour).Truncate(time.Second)
	for _, name := range []string{"untouched", "changed"} {
		if err := os.Chtimes(filepath.Join(dir, name), past, past); err != nil {
			t.Fatal(err)
		}
	}
	original, err := captureManifest(dir)
	if err != nil {
		t.Fatal(err)
	}

	// A fresh mirror gives every file a new mtime regardless of whether the
	// step actually changed its content.
	mustWriteFile(t, filepath.Join(dir, "untouched"), "same")
	mustWriteFile(t, filepath.Join(dir, "changed"), "after")
	current, err := captureManifest(dir)
	if err != nil {
		t.Fatal(err)
	}

	if err := restoreUnchangedMtimes(original, current, dir); err != nil {
		t.Fatal(err)
	}

	if got := mustStatMtime(t, filepath.Join(dir, "untouched")); !got.Equal(past) {
		t.Errorf("untouched file's mtime = %v, want restored to %v", got, past)
	}
	if got := mustStatMtime(t, filepath.Join(dir, "changed")); got.Equal(past) {
		t.Error("changed file's mtime should not have been reset")
	}
}

// newCAStoreBind lays out a rootfs holding one CA bundle and prepares a
// dirBind over its directory, the way inject does.
func newCAStoreBind(t *testing.T) (*dirBind, string) {
	t.Helper()
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "etc/ssl/certs"))
	mustWriteFile(t, filepath.Join(rootfs, "etc/ssl/certs/ca-certificates.crt"), "ORIGINAL-ROOTS\n")

	store, err := findSystemStore(rootfs)
	if err != nil {
		t.Fatal(err)
	}
	hostDir := store.dir()
	scratch, err := newScratchDir("bundle")
	if err != nil {
		t.Fatal(err)
	}
	b := &dirBind{
		rootfs:       rootfs,
		hostDir:      hostDir,
		containerDir: containerPathOf(rootfs, hostDir),
		scratchDir:   scratch,
		bundleFiles:  []string{filepath.Base(store.hostPath)},
	}
	if err := b.prepare(testCA); err != nil {
		t.Fatal(err)
	}
	return b, rootfs
}

// redirectStoreDir repoints /etc/ssl, so containerDir no longer resolves to
// where injection left it.
func redirectStoreDir(t *testing.T, rootfs string) {
	t.Helper()
	elsewhere := filepath.Join(rootfs, "elsewhere")
	mustMkdirAll(t, filepath.Join(elsewhere, "certs"))
	if err := os.RemoveAll(filepath.Join(rootfs, "etc/ssl")); err != nil {
		t.Fatal(err)
	}
	mustSymlink(t, "/elsewhere", filepath.Join(rootfs, "etc/ssl"))
}

// A destination that no longer resolves where injection left it fails the
// step rather than being written to.
func TestFinishRefusesARedirectedWriteBackTarget(t *testing.T) {
	useFakeRsync(t)
	b, rootfs := newCAStoreBind(t)
	mustWriteFile(t, filepath.Join(b.scratchDir, "ca-certificates.crt"), "REGENERATED\n")
	redirectStoreDir(t, rootfs)

	calls := countRsync(t)
	if err := b.finish(map[string]bool{}); err == nil {
		t.Fatal("expected finish to refuse the redirected target")
	}
	if *calls != 0 {
		t.Errorf("got %d rsync invocations, want none before the target is verified", *calls)
	}
}

func TestFinishWritesBackWhenTheTargetStillResolves(t *testing.T) {
	useFakeRsync(t)
	b, rootfs := newCAStoreBind(t)
	mustWriteFile(t, filepath.Join(b.scratchDir, "ca-certificates.crt"), "REGENERATED\n")

	calls := countRsync(t)
	if err := b.finish(map[string]bool{}); err != nil {
		t.Fatal(err)
	}
	if *calls != 2 {
		t.Errorf("got %d rsync invocations, want 2 (dry run, then apply)", *calls)
	}
	got, err := os.ReadFile(filepath.Join(rootfs, "etc/ssl/certs/ca-certificates.crt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "REGENERATED\n" {
		t.Errorf("write-back did not reach the real store: %q", got)
	}
}

// An untouched store returns before the check, so a build that never writes
// to the store cannot start failing on it.
func TestFinishSkipsTheCheckWhenTheStoreIsUnchanged(t *testing.T) {
	useFakeRsync(t)
	b, rootfs := newCAStoreBind(t)
	redirectStoreDir(t, rootfs)

	calls := countRsync(t)
	if err := b.finish(map[string]bool{}); err != nil {
		t.Fatalf("an unchanged store must not fail: %v", err)
	}
	if *calls != 0 {
		t.Errorf("got %d rsync invocations, want none for an unchanged store", *calls)
	}
}

// A custom path comes from the Dockerfile, so it can name anything; mirroring
// it wholesale is bounded rather than trusted. Over either limit, injection is
// refused for that directory instead.
func TestPrepareRefusesACustomDirOverTheLimits(t *testing.T) {
	cases := map[string]func(t *testing.T, dir string){
		"too many files": func(t *testing.T, dir string) {
			for i := range maxCustomDirFiles + 1 {
				mustWriteFile(t, filepath.Join(dir, fmt.Sprintf("f%d", i)), "x")
			}
		},
		"too many bytes": func(t *testing.T, dir string) {
			mustSparseFile(t, filepath.Join(dir, "huge.pem"), maxCustomDirBytes+1)
		},
	}
	for name, fill := range cases {
		t.Run(name, func(t *testing.T) {
			useFakeRsync(t)
			rootfs := t.TempDir()
			hostDir := filepath.Join(rootfs, "custom")
			mustMkdirAll(t, hostDir)
			fill(t, hostDir)

			scratch, err := newScratchDir("bundle")
			if err != nil {
				t.Fatal(err)
			}
			b := &dirBind{
				rootfs:       rootfs,
				hostDir:      hostDir,
				containerDir: "/custom",
				scratchDir:   scratch,
				bundleFiles:  []string{"roots.pem"},
				custom:       true,
			}
			if err := b.prepare(testCA); err == nil {
				t.Fatal("expected prepare to refuse the directory")
			}
			if entries, err := os.ReadDir(scratch); err != nil || len(entries) != 0 {
				t.Errorf("nothing should have been mirrored: %v, %v", entries, err)
			}
		})
	}
}

// The store directory is not a custom path, so the limits do not apply to it:
// a distribution that ships a large trust store still gets the CA.
func TestPrepareDoesNotBoundTheSystemStoreDir(t *testing.T) {
	useFakeRsync(t)
	rootfs := t.TempDir()
	hostDir := filepath.Join(rootfs, "etc/ssl/certs")
	mustMkdirAll(t, hostDir)
	mustSparseFile(t, filepath.Join(hostDir, "ca-certificates.crt"), maxCustomDirBytes+1)

	scratch, err := newScratchDir("bundle")
	if err != nil {
		t.Fatal(err)
	}
	b := &dirBind{
		rootfs:       rootfs,
		hostDir:      hostDir,
		containerDir: "/etc/ssl/certs",
		scratchDir:   scratch,
		bundleFiles:  []string{"ca-certificates.crt"},
	}
	if err := b.prepare(testCA); err != nil {
		t.Fatalf("the store directory must not be bounded: %v", err)
	}
}

// The scratch root is a real host path in production. A wrapper that cannot
// make it has to say so rather than mirror into nowhere.
func TestNewScratchDirReportsARootItCannotMake(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "blocked"), "")
	old := scratchRoot
	scratchRoot = filepath.Join(dir, "blocked", "ca")
	t.Cleanup(func() { scratchRoot = old })

	if _, err := newScratchDir("bundle"); err == nil {
		t.Fatal("expected newScratchDir to fail")
	}
}

func TestMirrorDirReportsADestinationItCannotMake(t *testing.T) {
	useFakeRsync(t)
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "blocked"), "")

	if err := mirrorDir(t.TempDir(), filepath.Join(dir, "blocked", "scratch")); err == nil {
		t.Fatal("expected mirrorDir to fail")
	}
}

// The dry run is what makes a write-back auditable, so a failure in it stops
// the real one rather than going ahead unlogged.
func TestWriteBackReportsAFailedDryRun(t *testing.T) {
	useFakeRsync(t)
	scratch, hostDir := t.TempDir(), t.TempDir()
	mustWriteFile(t, filepath.Join(scratch, "ca-certificates.crt"), "REGENERATED\n")
	// failRsyncOn first, so the counter wraps it and sees every call.
	failRsyncOn(t, 1)
	calls := countRsync(t)

	if err := writeBack(scratch, hostDir); err == nil {
		t.Fatal("expected the dry run's failure to propagate")
	}
	if *calls != 1 {
		t.Errorf("got %d rsync invocations, want 1: the apply must not follow a failed dry run", *calls)
	}
}

// A walk that cannot start at all is the error the callback is handed, and
// both of these return it rather than reporting an empty tree.
func TestWalkingSomethingThatIsNotThere(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "not-there")

	if _, err := captureManifest(missing); err == nil {
		t.Error("captureManifest reported no error for a missing root")
	}
	if _, _, err := sizeAndCount(missing); err == nil {
		t.Error("sizeAndCount reported no error for a missing root")
	}
}

func TestHashFileReportsAFileItCannotOpen(t *testing.T) {
	skipIfRoot(t)
	path := filepath.Join(t.TempDir(), "bundle.pem")
	mustWriteFile(t, path, "ROOTS")
	if err := os.Chmod(path, 0o000); err != nil {
		t.Fatal(err)
	}

	if _, err := hashFile(path); err == nil {
		t.Fatal("expected hashFile to fail")
	}
}

// The mtime reset walks the manifest, not the directory, so an entry naming
// something no longer there is a real possibility rather than a guard.
func TestRestoreUnchangedMtimesReportsAFileItCannotTouch(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "a"), "same")
	manifest, err := captureManifest(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "a")); err != nil {
		t.Fatal(err)
	}

	if err := restoreUnchangedMtimes(manifest, manifest, dir); err == nil {
		t.Fatal("expected the missing file to be reported")
	}
}

// prepare measures a custom directory before mirroring it. A directory it
// cannot measure is refused, the same as one over the limits.
func TestPrepareReportsADirectoryItCannotMeasure(t *testing.T) {
	useFakeRsync(t)
	rootfs := t.TempDir()
	scratch, err := newScratchDir("bundle")
	if err != nil {
		t.Fatal(err)
	}
	b := &dirBind{
		rootfs:       rootfs,
		hostDir:      filepath.Join(rootfs, "not-there"),
		containerDir: "/not-there",
		scratchDir:   scratch,
		bundleFiles:  []string{"roots.pem"},
		custom:       true,
	}

	if err := b.prepare(testCA); err == nil {
		t.Fatal("expected prepare to refuse the directory")
	}
}

func TestPrepareReportsAMirrorThatFailed(t *testing.T) {
	useFakeRsync(t)
	b, _ := newCAStoreBind(t)
	// prepare already ran once in the fixture; run it again with rsync failing.
	failRsyncOn(t, 1)

	if err := b.prepare(testCA); err == nil {
		t.Fatal("expected the mirror's failure to propagate")
	}
}

// A step is free to leave a symlink where the bundle was. The CA is not
// written through it, and the rest of the directory is still mirrored, so
// injection carries on without that one file.
func TestPrepareLeavesABundleFileItCannotOpen(t *testing.T) {
	useFakeRsync(t)
	rootfs := t.TempDir()
	hostDir := filepath.Join(rootfs, "etc/ssl/certs")
	mustMkdirAll(t, hostDir)
	mustSymlink(t, "/somewhere/else", filepath.Join(hostDir, "ca-certificates.crt"))
	mustWriteFile(t, filepath.Join(hostDir, "other.pem"), "OTHER\n")

	scratch, err := newScratchDir("bundle")
	if err != nil {
		t.Fatal(err)
	}
	b := &dirBind{
		rootfs:       rootfs,
		hostDir:      hostDir,
		containerDir: "/etc/ssl/certs",
		scratchDir:   scratch,
		bundleFiles:  []string{"ca-certificates.crt"},
	}

	if err := b.prepare(testCA); err != nil {
		t.Fatalf("an unwritable bundle file must not fail the step: %v", err)
	}
	if target, err := os.Readlink(filepath.Join(scratch, "ca-certificates.crt")); err != nil || target != "/somewhere/else" {
		t.Errorf("the symlink was not mirrored as one: %q, %v", target, err)
	}
	if got, err := os.ReadFile(filepath.Join(scratch, "other.pem")); err != nil || string(got) != "OTHER\n" {
		t.Errorf("the rest of the directory was not mirrored: %q, %v", got, err)
	}
}

// The write-back target is re-resolved before anything is written. A
// destination that now points outside the rootfs fails the step rather than
// being followed, since the wrapper runs as root on the host.
func TestFinishRefusesATargetThatNowEscapesTheRootfs(t *testing.T) {
	useFakeRsync(t)
	b, rootfs := newCAStoreBind(t)
	mustWriteFile(t, filepath.Join(b.scratchDir, "ca-certificates.crt"), "REGENERATED\n")
	if err := os.RemoveAll(filepath.Join(rootfs, "etc/ssl")); err != nil {
		t.Fatal(err)
	}
	mustSymlink(t, "../../../../../../etc", filepath.Join(rootfs, "etc/ssl"))

	calls := countRsync(t)
	err := b.finish(map[string]bool{})
	if !errors.Is(err, errEscapesRoot) {
		t.Fatalf("got %v, want it to name errEscapesRoot", err)
	}
	if *calls != 0 {
		t.Errorf("got %d rsync invocations, want none before the target is verified", *calls)
	}
}

// Failing to remove the scratch mirror leaves a directory behind on the
// builder, which is worth a log line but not worth failing a step that
// otherwise succeeded.
func TestCleanupReportsAScratchDirItCannotRemove(t *testing.T) {
	skipIfRoot(t)
	useTempLog(t)
	parent := t.TempDir()
	scratch := filepath.Join(parent, "scratch")
	mustMkdirAll(t, scratch)
	mustMakeReadOnly(t, parent)

	b := &dirBind{scratchDir: scratch, containerDir: "/etc/ssl/certs"}
	b.cleanup()

	var out strings.Builder
	dumpOwnLog(&out)
	if !strings.Contains(out.String(), "cannot remove") {
		t.Errorf("the failure is not in the log:\n%s", out.String())
	}
}

// A strip that fails partway leaves the scratch mirror inconsistent: the tail
// is half shifted down, and the truncate that would have made it the right
// length never runs. None of that reaches the build. The error returns before
// writeBack, so the real store keeps what the step left it, the scratch copy is
// thrown away with the bind, and the step itself fails, which is what makes
// BuildKit release the snapshot rather than commit it.
//
// This is the containment the in-place shift relies on. removeCA is not atomic
// on purpose: the scan and the strip share one handle so they cannot land on
// different files, and writing to a temp file and renaming would give that up.
func TestFinishWritesNothingBackWhenTheStripFails(t *testing.T) {
	useFakeRsync(t)
	b, rootfs := newCAStoreBind(t)
	store := filepath.Join(b.scratchDir, "ca-certificates.crt")
	// A tail wider than one shift window, so failing the second write leaves
	// the first window already moved: the file is then genuinely inconsistent
	// rather than merely unfinished.
	mustAppendFile(t, store, filler(2*scanChunk))
	before, err := os.ReadFile(store)
	if err != nil {
		t.Fatal(err)
	}

	useBrokenBundleFile(t, &brokenFile{failWriteAt: 2})
	calls := countRsync(t)

	if err := b.finish(map[string]bool{}); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want the strip's failure to fail the step", err)
	}
	if *calls != 0 {
		t.Errorf("got %d rsync invocations, want none: nothing may be written back", *calls)
	}
	got, err := os.ReadFile(filepath.Join(rootfs, "etc/ssl/certs/ca-certificates.crt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "ORIGINAL-ROOTS\n" {
		t.Errorf("the real store was written to: %q", got)
	}
	// And the scratch copy really is the inconsistent one, so the test is
	// about containment rather than about nothing having happened.
	after, err := os.ReadFile(store)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) == string(before) {
		t.Error("the scratch mirror was left untouched; this proves nothing about containment")
	}
}

// The manifest is what decides whether the real store is written to at all, so
// an entry it cannot read is a refusal rather than an entry left out. Leaving
// one out would make an unchanged store look changed, or a changed one look
// untouched.
func TestCaptureManifestRefusesAnEntryItCannotRead(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, dir+"/regular.pem", "ROOTS")
	mustSymlink(t, "regular.pem", dir+"/alias.pem")
	gone := filepath.Join(t.TempDir(), "gone.pem")

	cases := map[string]walkStep{
		"a path outside the root it was given": {
			path: "relative/not/under/the/root",
			d:    realEntry(t, dir, "regular.pem"),
		},
		"an entry whose metadata cannot be read": {
			path: filepath.Join(dir, "regular.pem"),
			d:    unreadableEntry{realEntry(t, dir, "regular.pem")},
		},
		"a symlink whose target cannot be read": {
			path: gone,
			d:    realEntry(t, dir, "alias.pem"),
		},
		"a file whose contents cannot be hashed": {
			path: gone,
			d:    realEntry(t, dir, "regular.pem"),
		},
	}
	for name, step := range cases {
		t.Run(name, func(t *testing.T) {
			useStubWalk(t, dir, 1, step)
			if _, err := captureManifest(dir); err == nil {
				t.Fatal("expected captureManifest to refuse the entry")
			}
		})
	}
}

// The size check is the bound on how far a Dockerfile-chosen path can drag the
// mirror, so an entry it cannot measure has to stop it rather than count as
// nothing.
func TestSizeAndCountRefusesAnEntryItCannotRead(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, dir+"/regular.pem", "ROOTS")
	useStubWalk(t, dir, 1, walkStep{
		path: filepath.Join(dir, "regular.pem"),
		d:    unreadableEntry{realEntry(t, dir, "regular.pem")},
	})

	if _, _, err := sizeAndCount(dir); err == nil {
		t.Fatal("expected sizeAndCount to refuse the entry")
	}
}

// A path that opens but cannot be read is a directory, which a step can leave
// where the bundle was.
func TestHashFileReportsAReadThatFails(t *testing.T) {
	if _, err := hashFile(t.TempDir()); err == nil {
		t.Fatal("expected hashFile to fail on a directory")
	}
}

// prepare records the directory twice: once before the CA goes in, once after.
// Either failing means there is no baseline to compare the step's work against,
// so the bind is refused rather than set up without one.
func TestPrepareRefusesADirectoryItCannotRecord(t *testing.T) {
	for _, nth := range []int{1, 2} {
		t.Run(fmt.Sprintf("the %s manifest", map[int]string{1: "first", 2: "second"}[nth]), func(t *testing.T) {
			useFakeRsync(t)
			rootfs := t.TempDir()
			hostDir := filepath.Join(rootfs, "etc/ssl/certs")
			mustMkdirAll(t, hostDir)
			mustWriteFile(t, filepath.Join(hostDir, "ca-certificates.crt"), "ORIGINAL-ROOTS\n")
			scratch, err := newScratchDir("bundle")
			if err != nil {
				t.Fatal(err)
			}
			b := &dirBind{
				rootfs:       rootfs,
				hostDir:      hostDir,
				containerDir: "/etc/ssl/certs",
				scratchDir:   scratch,
				bundleFiles:  []string{"ca-certificates.crt"},
			}
			failWalkOn(t, scratch, nth)

			if err := b.prepare(testCA); !errors.Is(err, errBrokenWalk) {
				t.Fatalf("got %v, want the failed manifest to refuse the bind", err)
			}
		})
	}
}

// An unopenable bundle file is skipped, but a failure that is not about the
// file's kind is the wrapper's own and stops the bind.
func TestPrepareRefusesABundleFileItCannotStat(t *testing.T) {
	useFakeRsync(t)
	rootfs := t.TempDir()
	hostDir := filepath.Join(rootfs, "etc/ssl/certs")
	mustMkdirAll(t, hostDir)
	mustWriteFile(t, filepath.Join(hostDir, "ca-certificates.crt"), "ORIGINAL-ROOTS\n")
	scratch, err := newScratchDir("bundle")
	if err != nil {
		t.Fatal(err)
	}
	b := &dirBind{
		rootfs:       rootfs,
		hostDir:      hostDir,
		containerDir: "/etc/ssl/certs",
		scratchDir:   scratch,
		bundleFiles:  []string{"ca-certificates.crt"},
	}
	useBrokenBundleFile(t, &brokenFile{failStat: true})

	if err := b.prepare(testCA); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want the stat failure to refuse the bind", err)
	}
}

// finish reads the directory several times over, and a failure in any of them
// stops the step: without both manifests there is no way to tell what the step
// changed, and without the strip and the link sweep the certificate would be
// written back with everything else.
func TestFinishWritesNothingBackWhenAWalkFails(t *testing.T) {
	walks := map[string]int{
		"the first manifest":  1,
		"the strip":           2,
		"the link sweep":      3,
		"the second manifest": 4,
	}
	for name, nth := range walks {
		t.Run(name, func(t *testing.T) {
			useFakeRsync(t)
			b, rootfs := newCAStoreBind(t)
			mustWriteFile(t, filepath.Join(b.scratchDir, "ca-certificates.crt"), "REGENERATED\n")
			failWalkOn(t, b.scratchDir, nth)
			calls := countRsync(t)

			if err := b.finish(map[string]bool{}); !errors.Is(err, errBrokenWalk) {
				t.Fatalf("got %v, want the failed manifest to fail the step", err)
			}
			if *calls != 0 {
				t.Errorf("got %d rsync invocations, want none", *calls)
			}
			got, err := os.ReadFile(filepath.Join(rootfs, "etc/ssl/certs/ca-certificates.crt"))
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != "ORIGINAL-ROOTS\n" {
				t.Errorf("the real store was written to: %q", got)
			}
		})
	}
}

// The mtime reset walks the manifest rather than the directory, so it can be
// handed an entry for something that is no longer there. Like the manifests
// themselves, a failure there stops the write-back: the store is only left
// alone when the wrapper can show it has put every untouched file back as it
// found it.
func TestFinishWritesNothingBackWhenItCannotResetAnMtime(t *testing.T) {
	useFakeRsync(t)
	b, rootfs := newCAStoreBind(t)
	// A directory is in the manifest but is neither hashed nor read as a link,
	// so a stubbed walk can report one that has since been removed. It goes in
	// the store itself, since prepare replaces the mirror wholesale.
	mustMkdirAll(t, filepath.Join(b.hostDir, "sub"))
	if err := b.prepare(testCA); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(b.scratchDir, "sub")); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(b.scratchDir, "ca-certificates.crt"), "REGENERATED\n")

	// Same permissions and owner, so the entry matches the one prepare
	// recorded and the reset is attempted rather than skipped.
	elsewhere := t.TempDir()
	mustMkdirAll(t, filepath.Join(elsewhere, "sub"))
	useStubWalk(t, b.scratchDir, 4, walkStep{
		path: filepath.Join(b.scratchDir, "sub"),
		d:    realEntry(t, elsewhere, "sub"),
	})
	calls := countRsync(t)

	if err := b.finish(map[string]bool{}); err == nil {
		t.Fatal("expected the failed mtime reset to fail the step")
	}
	if *calls != 0 {
		t.Errorf("got %d rsync invocations, want none", *calls)
	}
	got, err := os.ReadFile(filepath.Join(rootfs, "etc/ssl/certs/ca-certificates.crt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "ORIGINAL-ROOTS\n" {
		t.Errorf("the real store was written to: %q", got)
	}
}
