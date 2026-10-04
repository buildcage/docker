package main

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// resolvedAnchor is where an anchor lands inside a rootfs, for a test to read
// back what placeAnchors wrote.
func resolvedAnchor(rootfs, dir string) string {
	return filepath.Join(rootfs, dir, anchorName)
}

// An image with no CA store has none of the anchor directories, so the whole
// path has to be created. resolveInRoot has to reach a file several missing
// directories deep for that to work at all.
func TestPlaceAnchorsWritesEachOneCreatingItsPath(t *testing.T) {
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "etc"))

	placeAnchors(rootfs, testCA)

	for _, anchor := range anchorDirs {
		got, err := os.ReadFile(resolvedAnchor(rootfs, anchor.dir))
		if err != nil {
			t.Fatalf("%s: %v", anchor.dir, err)
		}
		if string(got) != string(testCA) {
			t.Fatalf("%s holds %q, want the CA", anchor.dir, got)
		}
	}
}

// The undo takes back exactly the directories it made, so mkdirAllTracking has
// to report them and no others.
func TestPlaceAnchorsTracksOnlyTheDirectoriesItCreated(t *testing.T) {
	rootfs := t.TempDir()
	// /usr/local already there, /usr/local/share and below not, so only the
	// part the injection creates is tracked.
	mustMkdirAll(t, filepath.Join(rootfs, "usr", "local"))

	created := placeAnchors(rootfs, testCA)

	made := filepath.Join(rootfs, "usr", "local", "share", "ca-certificates")
	parent := filepath.Join(rootfs, "usr", "local", "share")
	if !slices.Contains(created.dirs, made) || !slices.Contains(created.dirs, parent) {
		t.Fatalf("did not track the created directories: %v", created.dirs)
	}
	if slices.Contains(created.dirs, filepath.Join(rootfs, "usr", "local")) {
		t.Fatal("tracked a directory that was already there")
	}
}

// A path something already stands at is the image's, or the step's, not the
// injection's to overwrite.
func TestPlaceAnchorsLeavesAnExistingPathAlone(t *testing.T) {
	rootfs := t.TempDir()
	dir := filepath.Join(rootfs, "usr", "local", "share", "ca-certificates")
	mustMkdirAll(t, dir)
	mustWriteFile(t, filepath.Join(dir, anchorName), "SOMEONE ELSE\n")

	created := placeAnchors(rootfs, testCA)

	got, _ := os.ReadFile(filepath.Join(dir, anchorName))
	if string(got) != "SOMEONE ELSE\n" {
		t.Fatalf("overwrote an existing anchor: %q", got)
	}
	if slices.Contains(created.dirs, dir) {
		t.Fatal("tracked a directory it did not create")
	}
}

// removalOrder is deepest first, so a directory is only judged once what the
// injection put under it has gone.
func TestRemovalOrderIsDeepestFirst(t *testing.T) {
	c := createdDirs{dirs: []string{"/a", "/a/b/c", "/a/b", "/a/b"}}
	got := c.removalOrder()
	want := []string{"/a/b/c", "/a/b", "/a"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// The directories go once the step has ended, unless the step installed the
// package that owns one, which would have created it anyway.
func TestRemoveCreatedDirsTakesBackWhatIsNotAdopted(t *testing.T) {
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "etc"))
	created := placeAnchors(rootfs, testCA)

	// The step installed the Debian/Alpine package, whose owner directory now
	// exists, so that anchor directory is adopted and stays. The others are
	// the injection's and go. The sweep would have emptied the anchor files
	// first; here they are removed by hand to stand in for it.
	mustMkdirAll(t, filepath.Join(rootfs, "usr", "share", "ca-certificates"))
	for _, anchor := range anchorDirs {
		_ = os.Remove(resolvedAnchor(rootfs, anchor.dir))
	}

	removeCreatedDirs(rootfs, created)

	adopted := filepath.Join(rootfs, "usr", "local", "share", "ca-certificates")
	if _, err := os.Stat(adopted); err != nil {
		t.Fatalf("removed an adopted anchor directory: %v", err)
	}
	for _, anchor := range anchorDirs[1:] {
		if _, err := os.Stat(filepath.Join(rootfs, anchor.dir)); !os.IsNotExist(err) {
			t.Fatalf("%s was left behind", anchor.dir)
		}
	}
	// The intermediate directories the injection made go with them.
	if _, err := os.Stat(filepath.Join(rootfs, "etc", "pki")); !os.IsNotExist(err) {
		t.Fatal("/etc/pki was left behind")
	}
}

// A directory the step put something else in is not the injection's to take,
// so a non-empty one is left rather than reported as a failure.
func TestRemoveCreatedDirsLeavesOneTheStepFilled(t *testing.T) {
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "etc"))
	created := placeAnchors(rootfs, testCA)

	// The anchor file goes (the sweep's job), but the step left something else
	// in the same directory.
	dir := filepath.Join(rootfs, "usr", "local", "share", "ca-certificates")
	_ = os.Remove(filepath.Join(dir, anchorName))
	mustWriteFile(t, filepath.Join(dir, "theirs.crt"), "THEIRS\n")

	removeCreatedDirs(rootfs, created)

	if _, err := os.Stat(filepath.Join(dir, "theirs.crt")); err != nil {
		t.Fatalf("took away a directory the step had filled: %v", err)
	}
}

// A step that empties an anchor directory and swaps an ancestor for a symlink
// to an absolute path of its own must not have the undo follow it: os.Remove on
// the inject-time path would otherwise reach out of the rootfs. Re-resolving the
// path disagrees with where the injection put it, so the directory is left.
func TestRemoveCreatedDirsRefusesAPathASymlinkNowLeadsOutOf(t *testing.T) {
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "etc"))
	created := placeAnchors(rootfs, testCA)

	// Something outside the rootfs the old undo would have unlinked by following
	// an absolute symlink out of it.
	outside := t.TempDir()
	mustMkdirAll(t, filepath.Join(outside, "anchors"))

	// The step points the RHEL anchor's parent at that outside path.
	source := filepath.Join(rootfs, "etc", "pki", "ca-trust", "source")
	if err := os.RemoveAll(source); err != nil {
		t.Fatal(err)
	}
	mustSymlink(t, outside, source)

	removeCreatedDirs(rootfs, created)

	if _, err := os.Stat(filepath.Join(outside, "anchors")); err != nil {
		t.Fatalf("the undo followed a symlink out of the rootfs: %v", err)
	}
}

// A path that resolves to a symlink or is otherwise not writable is left for
// the step; createCA reports it rather than following it.
func TestCreateCARefusesAnExistingPath(t *testing.T) {
	rootfs := t.TempDir()
	dir := filepath.Join(rootfs, "etc", "pki", "trust", "anchors")
	mustMkdirAll(t, dir)
	mustWriteFile(t, filepath.Join(dir, anchorName), "ALREADY\n")

	if _, err := createCA(rootfs, filepath.Join("/etc/pki/trust/anchors", anchorName), testCA); err == nil {
		t.Fatal("expected an existing anchor to be refused")
	}
}

// createCA resolves inside the rootfs like every other write, so a symlink in
// the path that climbs past the root stops there instead of reaching the host.
func TestCreateCAKeepsAClimbingLinkInsideTheRoot(t *testing.T) {
	parent := t.TempDir()
	rootfs := filepath.Join(parent, "rootfs")
	mustMkdirAll(t, filepath.Join(rootfs, "usr", "local"))
	mustSymlink(t, "../../../../../../outside", filepath.Join(rootfs, "usr", "local", "share"))

	if _, err := createCA(rootfs, filepath.Join("/usr/local/share/ca-certificates", anchorName), testCA); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(rootfs, "outside", "ca-certificates", anchorName)); err != nil {
		t.Errorf("the anchor is not at the root's /outside: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(parent, "outside")); !os.IsNotExist(err) {
		t.Errorf("something was created outside the rootfs: %v", err)
	}
}

func TestCreateCAReportsAPathThatDoesNotResolve(t *testing.T) {
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "usr", "local"))
	mustSymlink(t, "share", filepath.Join(rootfs, "usr", "local", "share"))

	if _, err := createCA(rootfs, filepath.Join("/usr/local/share/ca-certificates", anchorName), testCA); !errors.Is(err, errTooManySymlinks) {
		t.Fatalf("got %v, want the symlink loop reported", err)
	}
}

// The anchor path resolves, but a directory in it cannot be made: the parent
// is read-only. createCA reports that rather than pretending the anchor is
// there.
func TestCreateCAReportsAPathItCannotBuild(t *testing.T) {
	skipIfRoot(t)
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "etc"))
	mustMakeReadOnly(t, filepath.Join(rootfs, "etc"))

	if _, err := createCA(rootfs, filepath.Join("/etc/pki/ca-trust/source/anchors", anchorName), testCA); err == nil {
		t.Fatal("expected the un-buildable path to be reported")
	}
}

// A created directory the undo cannot take away for a reason of its own is
// logged, not swallowed and not fatal.
func TestRemoveCreatedDirsReportsAFailureOfItsOwn(t *testing.T) {
	skipIfRoot(t)
	rootfs := t.TempDir()
	mustMkdirAll(t, filepath.Join(rootfs, "etc"))
	created := placeAnchors(rootfs, testCA)
	for _, anchor := range anchorDirs {
		_ = os.Remove(resolvedAnchor(rootfs, anchor.dir))
	}
	// The parent of a created directory is made read-only, so removing the
	// directory itself is refused with something other than "not empty".
	parent := filepath.Join(rootfs, "usr", "local", "share")
	mustMakeReadOnly(t, parent)

	removeCreatedDirs(rootfs, created) // must neither panic nor fail the process

	if _, err := os.Stat(filepath.Join(parent, "ca-certificates")); err != nil {
		t.Fatalf("the read-only case did not leave the directory: %v", err)
	}
}
