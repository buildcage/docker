package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// useFakeRsync makes dirBind's filesystem operations hermetic: a fake copy
// instead of a real rsync process, and a scratch root under the test's own
// temp directory instead of the real host path (which a test process
// usually can't create or write to). The one test that needs the real
// rsync binary and the real scratch root lives in mount_rsync_smoke_test.go.
func useFakeRsync(t *testing.T) {
	t.Helper()
	oldRsync, oldScratchRoot := runRsync, scratchRoot
	runRsync = fakeRsyncCopy
	scratchRoot = t.TempDir()
	t.Cleanup(func() {
		runRsync = oldRsync
		scratchRoot = oldScratchRoot
	})
}

// fakeRsyncCopy stands in for `rsync -a[HAX] [--checksum] [--delete] ... src/ dst/`:
// it only looks at the last two arguments and replaces dst wholesale with
// src's tree, which is close enough to mirror/writeBack's actual usage for
// unit tests to observe the resulting on-disk state.
func fakeRsyncCopy(args []string) ([]byte, error) {
	if len(args) < 2 {
		return nil, fmt.Errorf("not enough args: %v", args)
	}
	src := strings.TrimSuffix(args[len(args)-2], "/")
	dst := strings.TrimSuffix(args[len(args)-1], "/")
	if err := os.RemoveAll(dst); err != nil {
		return nil, err
	}
	return nil, copyTree(src, dst)
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(target, 0o755)
		case info.Mode()&os.ModeSymlink != 0:
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		default:
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			return os.WriteFile(target, data, info.Mode())
		}
	})
}

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

func TestMountConflicts(t *testing.T) {
	cases := []struct {
		name      string
		mounts    []any
		dest      string
		conflicts bool
	}{
		{"no mounts", nil, "/etc/ssl/certs", false},
		{"exact match", []any{map[string]any{"destination": "/etc/ssl/certs"}}, "/etc/ssl/certs", true},
		{"existing is an ancestor", []any{map[string]any{"destination": "/etc"}}, "/etc/ssl/certs", true},
		{"existing is a descendant", []any{map[string]any{"destination": "/etc/ssl/certs/sub"}}, "/etc/ssl/certs", true},
		{"unrelated sibling", []any{map[string]any{"destination": "/etc/ssl/other"}}, "/etc/ssl/certs", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			raw := map[string]any{"mounts": c.mounts}
			if got := mountConflicts(raw, c.dest); got != c.conflicts {
				t.Errorf("mountConflicts(%v, %q) = %v, want %v", c.mounts, c.dest, got, c.conflicts)
			}
		})
	}
}

func TestAddBindMount(t *testing.T) {
	raw := map[string]any{}
	addBindMount(raw, "/etc/ssl/certs", "/run/buildcage/ca/x")
	mounts, _ := raw["mounts"].([]any)
	if len(mounts) != 1 {
		t.Fatalf("got %d mounts, want 1", len(mounts))
	}
	entry := mounts[0].(map[string]any)
	if entry["destination"] != "/etc/ssl/certs" || entry["source"] != "/run/buildcage/ca/x" || entry["type"] != "bind" {
		t.Errorf("unexpected mount entry: %v", entry)
	}

	// Appending to an existing mounts array must not drop what was there.
	raw = map[string]any{"mounts": []any{map[string]any{"destination": "/proc"}}}
	addBindMount(raw, "/etc/ssl/certs", "/run/buildcage/ca/x")
	mounts, _ = raw["mounts"].([]any)
	if len(mounts) != 2 {
		t.Fatalf("got %d mounts, want 2", len(mounts))
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

		resolved, _, err := findSystemStore(root)
		if err != nil {
			t.Fatal(err)
		}
		got := containerPathOf(root, filepath.Dir(resolved))
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

		resolved, _, err := findSystemStore(root)
		if err != nil {
			t.Fatal(err)
		}
		got := containerPathOf(root, filepath.Dir(resolved))
		if want := "/var/lib/ca-certificates"; got != want {
			t.Errorf("containerPathOf = %q, want %q", got, want)
		}
	})
}

func TestContainerPathOfRefusesTheRoot(t *testing.T) {
	if got := containerPathOf("/rootfs", "/rootfs"); got != "/" {
		t.Errorf("containerPathOf at the rootfs itself = %q, want %q", got, "/")
	}
	if got := containerPathOf("/rootfs", "/somewhere/else"); got != "/" {
		t.Errorf("containerPathOf outside the rootfs = %q, want %q", got, "/")
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

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustSymlink(t *testing.T, target, link string) {
	t.Helper()
	_ = os.Remove(link)
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
}

func mustStatMtime(t *testing.T, path string) time.Time {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.ModTime()
}

// newCAStoreBind lays out a rootfs holding one CA bundle and prepares a
// dirBind over its directory, the way inject does.
func newCAStoreBind(t *testing.T) (*dirBind, string) {
	t.Helper()
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "etc/ssl/certs"))
	mustWriteFile(t, filepath.Join(rootfs, "etc/ssl/certs/ca-certificates.crt"), "ORIGINAL-ROOTS\n")

	store, _, err := findSystemStore(rootfs)
	if err != nil {
		t.Fatal(err)
	}
	hostDir := filepath.Dir(store)
	scratch, err := newScratchDir("bundle")
	if err != nil {
		t.Fatal(err)
	}
	b := &dirBind{
		rootfs:       rootfs,
		hostDir:      hostDir,
		containerDir: containerPathOf(rootfs, hostDir),
		scratchDir:   scratch,
		bundleFiles:  []string{filepath.Base(store)},
	}
	if err := b.prepare([]byte("BUILDCAGE-CA")); err != nil {
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

// countRsync counts from the call it is installed on, leaving out a bind's
// own mirroring during prepare.
func countRsync(t *testing.T) *int {
	t.Helper()
	var calls int
	orig := runRsync
	runRsync = func(args []string) ([]byte, error) {
		calls++
		return orig(args)
	}
	t.Cleanup(func() { runRsync = orig })
	return &calls
}

// A destination that no longer resolves where injection left it fails the
// step rather than being written to.
func TestFinishRefusesARedirectedWriteBackTarget(t *testing.T) {
	useFakeRsync(t)
	b, rootfs := newCAStoreBind(t)
	mustWriteFile(t, filepath.Join(b.scratchDir, "ca-certificates.crt"), "REGENERATED\n")
	redirectStoreDir(t, rootfs)

	calls := countRsync(t)
	if err := b.finish(); err == nil {
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
	if err := b.finish(); err != nil {
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
	if err := b.finish(); err != nil {
		t.Fatalf("an unchanged store must not fail: %v", err)
	}
	if *calls != 0 {
		t.Errorf("got %d rsync invocations, want none for an unchanged store", *calls)
	}
}
