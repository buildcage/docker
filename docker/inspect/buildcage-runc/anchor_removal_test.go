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

// emptyAnchors stands in for the layer sweep, which takes the anchor files out.
func emptyAnchors(rootfs string) {
	for _, anchor := range anchorDirs {
		_ = os.Remove(resolvedAnchor(rootfs, anchor.dir))
	}
}

// removeAll stands in for a package removal: rm -rf of each path, which under
// inspect gets only as far as the anchors allow, so it is done after them.
func removeAll(t *testing.T, rootfs string, paths ...string) {
	t.Helper()
	for _, path := range paths {
		if err := os.RemoveAll(filepath.Join(rootfs, path)); err != nil {
			t.Fatal(err)
		}
	}
}

// Removing a package takes its empty directories with it, but under inspect
// the anchor directories held the CA and extracted/pem was a mount point, so
// the removal could not. Once the package is gone and they are empty, they go.
func TestUndoAnchorsTakesWhatAPackageRemovalWould(t *testing.T) {
	t.Run("Debian", func(t *testing.T) {
		rootfs := t.TempDir()
		mustMkdirAll(t, filepath.Join(rootfs, "usr", "local", "share", "ca-certificates"))
		mustMkdirAll(t, filepath.Join(rootfs, "usr", "share", "ca-certificates", "mozilla"))
		mustMkdirAll(t, filepath.Join(rootfs, "etc", "ca-certificates", "update.d"))
		before := installedAnchorPackages(rootfs)
		// The Arch anchor lands in /etc/ca-certificates, which keeps dpkg from
		// removing that directory too.
		created := placeAnchors(rootfs, testCA)
		removeAll(t, rootfs, "usr/share/ca-certificates", "etc/ca-certificates/update.d")
		emptyAnchors(rootfs)

		undoAnchors(rootfs, created, before)

		for _, dir := range []string{"usr/local/share/ca-certificates", "etc/ca-certificates"} {
			if exists(filepath.Join(rootfs, dir)) {
				t.Errorf("/%s was left behind", dir)
			}
		}
		if !exists(filepath.Join(rootfs, "usr", "local", "share")) {
			t.Error("/usr/local/share, which the removal keeps, was taken away")
		}
	})
	for _, owner := range []string{"blocklist", "blacklist"} {
		t.Run("RHEL with "+owner, func(t *testing.T) {
			rootfs := t.TempDir()
			for _, dir := range []string{"source/anchors", "source/" + owner, "extracted/pem", "extracted/java", "extracted/edk2"} {
				mustMkdirAll(t, filepath.Join(rootfs, "etc", "pki", "ca-trust", dir))
			}
			before := installedAnchorPackages(rootfs)
			created := placeAnchors(rootfs, testCA)
			removeAll(t, rootfs, "etc/pki/ca-trust/source/"+owner)
			emptyAnchors(rootfs)

			undoAnchors(rootfs, created, before)

			for _, dir := range []string{"source", "extracted/pem", "extracted/java"} {
				if exists(filepath.Join(rootfs, "etc", "pki", "ca-trust", dir)) {
					t.Errorf("/etc/pki/ca-trust/%s was left behind", dir)
				}
			}
			// Another package's directory, and the parents it keeps.
			if !exists(filepath.Join(rootfs, "etc", "pki", "ca-trust", "extracted", "edk2")) {
				t.Error("/etc/pki/ca-trust/extracted/edk2 was taken away")
			}
		})
	}
	t.Run("Arch", func(t *testing.T) {
		rootfs := t.TempDir()
		for _, dir := range []string{"trust-source/anchors", "trust-source/blocklist", "extracted"} {
			mustMkdirAll(t, filepath.Join(rootfs, "etc", "ca-certificates", dir))
		}
		before := installedAnchorPackages(rootfs)
		created := placeAnchors(rootfs, testCA)
		removeAll(t, rootfs, "etc/ca-certificates/trust-source/blocklist")
		emptyAnchors(rootfs)

		undoAnchors(rootfs, created, before)

		if exists(filepath.Join(rootfs, "etc", "ca-certificates", "trust-source")) {
			t.Error("/etc/ca-certificates/trust-source was left behind")
		}
		if !exists(filepath.Join(rootfs, "etc", "ca-certificates", "extracted")) {
			t.Error("/etc/ca-certificates/extracted, which the removal keeps, was taken away")
		}
	})
}

// Only a removal the step made counts: a package still installed, or one that
// was not installed as the step started, leaves every directory alone, as does
// one the step put something in.
func TestUndoAnchorsLeavesWhatTheStepDidNotEmpty(t *testing.T) {
	t.Run("still installed", func(t *testing.T) {
		rootfs := t.TempDir()
		fedoraTrust(t, rootfs)
		undoAnchors(rootfs, createdDirs{}, installedAnchorPackages(rootfs))
		if !exists(filepath.Join(rootfs, "etc/pki/ca-trust/source/anchors")) {
			t.Fatal("removed the anchor directory of an installed package")
		}
	})
	t.Run("never installed", func(t *testing.T) {
		rootfs := t.TempDir()
		mustMkdirAll(t, filepath.Join(rootfs, "usr", "local", "share", "ca-certificates"))
		undoAnchors(rootfs, createdDirs{}, installedAnchorPackages(rootfs))
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
		undoAnchors(rootfs, createdDirs{}, before)
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

	for _, dir := range []string{"a/through/empty", "a/link", "a/file", "a/loop/x", "a/missing"} {
		removeEmptyDir(rootfs, filepath.Join(rootfs, dir))
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

	removeEmptyDir(rootfs, filepath.Join(rootfs, "a", "b"))

	if !exists(filepath.Join(rootfs, "a", "b")) {
		t.Fatal("the read-only case removed the directory")
	}
	if got := ownLog.String(); !strings.Contains(got, "cannot remove "+filepath.Join(rootfs, "a", "b")) {
		t.Fatalf("log = %q, want the failure named", got)
	}
}
