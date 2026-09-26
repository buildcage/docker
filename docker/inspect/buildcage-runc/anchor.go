package main

// An anchor is the certificate left where the distribution's own
// ca-certificates tooling takes its input from. The bundle the CA is appended
// to is a generated file: `update-ca-certificates` rebuilds it from the anchor
// directories, so a step that installs ca-certificates part-way through would
// otherwise lose the CA for everything after it. A certificate in the anchor
// directory is picked up by that rebuild instead. On RHEL it is the primary
// route: p11-kit reads the directory itself, so GnuTLS trusts the certificate
// with no bundle involved.
//
// Anchors are placed only when the step's layer can be read back afterwards
// (see stripLayer): the copies a rebuild scatters are taken out by sweeping
// that layer, and without it there would be no way to show they had gone.

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"syscall"
)

// Where each distribution's ca-certificates tooling reads extra trusted
// certificates from. A directory is created here only because the package that
// ships it is not installed; owner is another directory that same package
// ships and nothing else does, so its presence at the end says the anchor
// directory now belongs to the package rather than to this wrapper.
var anchorDirs = []struct{ dir, owner string }{
	// Debian, Ubuntu, Alpine
	{"/usr/local/share/ca-certificates", "/usr/share/ca-certificates"},
	// RHEL, Fedora
	{"/etc/pki/ca-trust/source/anchors", "/etc/pki/ca-trust/extracted"},
	// SUSE
	{"/etc/pki/trust/anchors", "/var/lib/ca-certificates"},
}

// What the certificate is called in each of them. Debian's
// update-ca-certificates takes only a .crt; the others take any certificate in
// the directory.
const anchorName = "buildcage.crt"

// createdDirs is the directories the injection made to reach an anchor or to
// bind Chromium's NSS database over, so the undo takes back exactly what it
// added. The anchor files themselves are not tracked: they carry only the CA,
// so the layer sweep empties and removes them.
type createdDirs struct {
	dirs []string
}

func (c *createdDirs) add(dirs []string) {
	c.dirs = append(c.dirs, dirs...)
}

// removalOrder is the created directories deepest first, so one is only judged
// once everything the injection put under it has gone. Sorting in reverse does
// that: a directory sorts after its own parent.
func (c createdDirs) removalOrder() []string {
	dirs := slices.Clone(c.dirs)
	slices.Sort(dirs)
	dirs = slices.Compact(dirs)
	slices.Reverse(dirs)
	return dirs
}

// placeAnchors writes the certificate into every anchor directory, whether or
// not the image shipped a store, creating the directories an image without one
// lacks. A path something already stands at is left alone.
func placeAnchors(rootfs string, ca []byte) createdDirs {
	var created createdDirs
	for _, anchor := range anchorDirs {
		dirs, err := createCA(rootfs, filepath.Join(anchor.dir, anchorName), ca)
		created.add(dirs)
		if err != nil {
			logf("cannot write the anchor in %s: %v", anchor.dir, err)
		}
	}
	return created
}

// createCA writes the certificate at path inside the rootfs and returns the
// directories it had to create to get there.
func createCA(rootfs, path string, ca []byte) ([]string, error) {
	resolved, err := resolveInRoot(rootfs, path)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(resolved); err == nil {
		return nil, errors.New("already exists")
	}
	dirs, err := mkdirAllTracking(filepath.Dir(resolved))
	if err != nil {
		return dirs, err
	}
	return dirs, os.WriteFile(resolved, ca, 0o644)
}

// mkdirAllTracking is MkdirAll that reports which directories it created,
// deepest first. Walking up ends at a directory that is there, at worst the
// filesystem root.
func mkdirAllTracking(dir string) ([]string, error) {
	var created []string
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(d); !os.IsNotExist(err) {
			break
		}
		created = append(created, d)
	}
	return created, os.MkdirAll(dir, 0o755)
}

// adoptedAnchorDirs is the anchor directories whose own package is installed by
// the time the step ends. The undo leaves those: taking one away would leave
// the image short a directory an unproxied build of the same Dockerfile has.
func adoptedAnchorDirs(rootfs string) map[string]bool {
	adopted := map[string]bool{}
	for _, anchor := range anchorDirs {
		// A path that will not resolve inside the rootfs is not there, the same
		// answer as not finding it.
		owner, _ := resolveInRoot(rootfs, anchor.owner)
		if _, err := os.Stat(owner); err != nil {
			continue
		}
		dir, _ := resolveInRoot(rootfs, anchor.dir)
		adopted[dir] = true
	}
	return adopted
}

// removeCreatedDirs takes back the directories placeAnchors and placeNSSDB
// made, deepest first, leaving one the step has since put something in. It
// runs after the layer sweep, so an anchor file is already gone and the
// directory that held it is empty.
func removeCreatedDirs(rootfs string, created createdDirs) {
	adopted := adoptedAnchorDirs(rootfs)
	for _, dir := range created.removalOrder() {
		if adopted[dir] {
			continue
		}
		// Re-resolve the container path and remove only what still lands where
		// the injection created it. Otherwise a step that swapped an ancestor for
		// an absolute symlink would have os.Remove follow it out of the rootfs;
		// resolveInRoot confines the target, and a mismatch reveals the swap.
		resolved, err := resolveInRoot(rootfs, containerPathOf(rootfs, dir))
		if err != nil || resolved != dir {
			logf("not taking the created directory %s back out: it no longer resolves there (%v)", dir, err)
			continue
		}
		err = os.Remove(resolved)
		// Gone, or holding something the step put there: either way the
		// injection has nothing left of its own here.
		if os.IsNotExist(err) || errors.Is(err, syscall.ENOTEMPTY) {
			continue
		}
		if err != nil {
			logf("cannot take the created directory %s back out: %v", dir, err)
		}
	}
}
