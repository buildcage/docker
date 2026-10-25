package main

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The tests in this file are the only ones in the package that run the real
// rsync binary. Everything else replaces runRsync with a fake so `go test`
// never depends on rsync being installed; these instead skip when it isn't,
// or when it's a variant that doesn't support -aHAX (macOS ships openrsync,
// which doesn't; the production image installs GNU rsync via apk).
//
// The probe goes through runRsync rather than around it, so the default that
// spawns rsync is exercised wherever the tests run: on a machine without one
// it is the call whose failure decides to skip.
func requireRealRsync(t *testing.T) {
	t.Helper()
	if out, err := runRsync([]string{"--version"}); err != nil || strings.Contains(string(out), "openrsync") {
		t.Skip("no GNU-compatible rsync available")
	}
}

func TestRealRsyncMirrorsAndWritesBack(t *testing.T) {
	requireRealRsync(t)

	hostDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(hostDir, "bundle.pem"), []byte("ORIGINAL\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("bundle.pem", filepath.Join(hostDir, "alias.pem")); err != nil {
		t.Fatal(err)
	}

	scratchDir := t.TempDir()
	if err := mirrorDir(hostDir, scratchDir); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(filepath.Join(scratchDir, "bundle.pem")); err != nil || string(got) != "ORIGINAL\n" {
		t.Fatalf("mirror did not copy the bundle: %q, %v", got, err)
	}
	if target, err := os.Readlink(filepath.Join(scratchDir, "alias.pem")); err != nil || target != "bundle.pem" {
		t.Fatalf("mirror did not preserve the symlink: %q, %v", target, err)
	}

	if err := os.WriteFile(filepath.Join(scratchDir, "bundle.pem"), []byte("CHANGED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(scratchDir, "alias.pem")); err != nil {
		t.Fatal(err)
	}

	if err := writeBack(scratchDir, hostDir); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(filepath.Join(hostDir, "bundle.pem")); err != nil || string(got) != "CHANGED\n" {
		t.Fatalf("write-back did not apply the change: %q, %v", got, err)
	}
	if _, err := os.Lstat(filepath.Join(hostDir, "alias.pem")); !os.IsNotExist(err) {
		t.Fatalf("write-back did not delete alias.pem: %v", err)
	}
}

// A step can leave a FIFO or a device node in the store; the write-back must
// not recreate either on the rootfs.
func TestRealRsyncWriteBackLeavesSpecialFilesBehind(t *testing.T) {
	requireRealRsync(t)
	for name, mknod := range map[string]func(t *testing.T, path string){
		"a FIFO": func(t *testing.T, path string) {
			if err := syscall.Mkfifo(path, 0o644); err != nil {
				t.Fatal(err)
			}
		},
		"a device node": func(t *testing.T, path string) {
			if os.Geteuid() != 0 {
				t.Skip("creating a device node needs root")
			}
			if err := syscall.Mknod(path, syscall.S_IFCHR|0o644, 0x0103); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			hostDir, scratchDir := t.TempDir(), t.TempDir()
			mustWriteFile(t, filepath.Join(scratchDir, "bundle.pem"), "CHANGED\n")
			mknod(t, filepath.Join(scratchDir, "special"))

			if err := writeBack(scratchDir, hostDir); err != nil {
				t.Fatal(err)
			}
			if got, err := os.ReadFile(filepath.Join(hostDir, "bundle.pem")); err != nil || string(got) != "CHANGED\n" {
				t.Fatalf("write-back did not apply the regular file: %q, %v", got, err)
			}
			if _, err := os.Lstat(filepath.Join(hostDir, "special")); !os.IsNotExist(err) {
				t.Errorf("write-back recreated %s on the rootfs: %v", name, err)
			}
		})
	}
}

// Same content under a new mtime is not rewritten, but the mtime still
// crosses over, which is why restoreUnchangedMtimes puts the original back
// before the write-back compares anything.
func TestRealRsyncWriteBackCarriesAnMtimeOnlyChangeWithoutRewriting(t *testing.T) {
	requireRealRsync(t)
	hostDir := t.TempDir()
	hostFile := filepath.Join(hostDir, "bundle.pem")
	mustWriteFile(t, hostFile, "SAME\n")
	scratchDir := t.TempDir()
	if err := mirrorDir(hostDir, scratchDir); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(hostFile)
	if err != nil {
		t.Fatal(err)
	}
	touched := time.Now().Add(-time.Hour).Truncate(time.Second)
	if err := os.Chtimes(filepath.Join(scratchDir, "bundle.pem"), touched, touched); err != nil {
		t.Fatal(err)
	}

	if err := writeBack(scratchDir, hostDir); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(hostFile)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(before, after) {
		t.Error("write-back rewrote a file whose content did not change")
	}
	if got := mustStatMtime(t, hostFile); !got.Equal(touched) {
		t.Errorf("host mtime is %v, want the scratch copy's %v", got, touched)
	}
}
