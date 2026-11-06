package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fedoraTrust lays out the directories Fedora's ca-certificates ships, plus
// edk2/, which another package ships under extracted/.
func fedoraTrust(t *testing.T, rootfs string) {
	t.Helper()
	for _, dir := range []string{"source/anchors", "source/blocklist", "extracted/pem", "extracted/edk2"} {
		mustMkdirAll(t, filepath.Join(rootfs, "etc", "pki", "ca-trust", dir))
	}
}

// Removing a package takes its empty directories with it, but under inspect
// the anchor directory held the CA and extracted/pem was a mount point, so the
// removal could not. Once the package is gone and they are empty, they go.
func TestRemoveWhatPackageRemovalLeftTakesTheDirectoriesTheRemovalWould(t *testing.T) {
	rootfs := t.TempDir()
	fedoraTrust(t, rootfs)
	mustMkdirAll(t, filepath.Join(rootfs, "usr", "local", "share", "ca-certificates"))
	mustMkdirAll(t, filepath.Join(rootfs, "etc", "ca-certificates", "update.d"))
	before := installedAnchorPackages(rootfs)

	// rpm -e and apt-get remove, as far as each got with the CA in place.
	for _, dir := range []string{"pki/ca-trust/source/blocklist", "ca-certificates"} {
		if err := os.RemoveAll(filepath.Join(rootfs, "etc", dir)); err != nil {
			t.Fatal(err)
		}
	}

	removeWhatPackageRemovalLeft(rootfs, before)

	for _, dir := range []string{
		"usr/local/share/ca-certificates",
		"etc/pki/ca-trust/source",
		"etc/pki/ca-trust/extracted/pem",
	} {
		if exists(filepath.Join(rootfs, dir)) {
			t.Errorf("/%s was left behind", dir)
		}
	}
	// What the removal leaves too: another package's directory and the parents
	// it keeps.
	for _, dir := range []string{"etc/pki/ca-trust/extracted/edk2", "usr/local/share"} {
		if !exists(filepath.Join(rootfs, dir)) {
			t.Errorf("/%s was taken away", dir)
		}
	}
}

// Only a removal the step made counts: a package still installed, or one that
// was not installed as the step started, leaves every directory alone, as does
// one the step put something in.
func TestRemoveWhatPackageRemovalLeftLeavesWhatTheStepDidNotEmpty(t *testing.T) {
	t.Run("still installed", func(t *testing.T) {
		rootfs := t.TempDir()
		fedoraTrust(t, rootfs)
		removeWhatPackageRemovalLeft(rootfs, installedAnchorPackages(rootfs))
		if !exists(filepath.Join(rootfs, "etc/pki/ca-trust/source/anchors")) {
			t.Fatal("removed the anchor directory of an installed package")
		}
	})
	t.Run("never installed", func(t *testing.T) {
		rootfs := t.TempDir()
		mustMkdirAll(t, filepath.Join(rootfs, "usr", "local", "share", "ca-certificates"))
		removeWhatPackageRemovalLeft(rootfs, installedAnchorPackages(rootfs))
		if !exists(filepath.Join(rootfs, "usr/local/share/ca-certificates")) {
			t.Fatal("removed a directory no package removal touched")
		}
	})
	t.Run("not empty", func(t *testing.T) {
		rootfs := t.TempDir()
		fedoraTrust(t, rootfs)
		before := installedAnchorPackages(rootfs)
		mustWriteFile(t, filepath.Join(rootfs, "etc/pki/ca-trust/source/anchors/company.crt"), "COMPANY\n")
		if err := os.Remove(filepath.Join(rootfs, "etc/pki/ca-trust/source/blocklist")); err != nil {
			t.Fatal(err)
		}
		removeWhatPackageRemovalLeft(rootfs, before)
		if !exists(filepath.Join(rootfs, "etc/pki/ca-trust/source/anchors/company.crt")) {
			t.Fatal("removed a directory the step put a file in")
		}
		if exists(filepath.Join(rootfs, "etc/pki/ca-trust/extracted/pem")) {
			t.Fatal("kept extracted/pem, which is empty")
		}
	})
}

// Something the step swapped in for a directory, a file or a symlink, is not
// followed or removed, and neither is a path that will not resolve.
func TestRemoveEmptyDirLeavesWhatIsNotAPlainDirectory(t *testing.T) {
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "elsewhere", "empty"))
	mustMkdirAll(t, filepath.Join(rootfs, "a"))
	mustSymlink(t, "/elsewhere", filepath.Join(rootfs, "a", "through"))
	mustSymlink(t, "/elsewhere/empty", filepath.Join(rootfs, "a", "link"))
	mustWriteFile(t, filepath.Join(rootfs, "a", "file"), "")
	mustSymlink(t, "loop", filepath.Join(rootfs, "a", "loop"))

	for _, dir := range []string{"/a/through/empty", "/a/link", "/a/file", "/a/loop/x"} {
		removeEmptyDir(rootfs, dir)
	}
	for _, path := range []string{"elsewhere/empty", "a/link", "a/file", "a/loop"} {
		if !exists(filepath.Join(rootfs, path)) {
			t.Errorf("/%s was removed", path)
		}
	}
}

// A directory that cannot be removed for a reason of its own is logged and
// left.
func TestRemoveEmptyDirReportsAFailureOfItsOwn(t *testing.T) {
	skipIfRoot(t)
	useTempLog(t)
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "a", "b"))
	mustMakeReadOnly(t, filepath.Join(rootfs, "a"))

	removeEmptyDir(rootfs, "/a/b")

	if !exists(filepath.Join(rootfs, "a", "b")) {
		t.Fatal("the read-only case removed the directory")
	}
	if got := ownLog.String(); !strings.Contains(got, "cannot remove /a/b") {
		t.Fatalf("log = %q, want the failure named", got)
	}
}
