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
// ships it is not installed; owners are other directories that same package
// ships and nothing else does, one per release that renamed it, so finding one
// at the end says the anchor directory now belongs to the package rather than
// to this wrapper.
//
// removal lists, deepest first, what removing that package takes away but the
// injection can keep from going: the CA, and the other anchor directories it
// creates, keep the anchor directory and its parents from being empty, and a
// mirrored directory is a mount point.
var anchorDirs = []struct {
	dir     string
	owners  []string
	removal []string
}{
	// Debian, Ubuntu, Alpine
	{"/usr/local/share/ca-certificates", []string{"/usr/share/ca-certificates/mozilla"}, []string{
		"/usr/local/share/ca-certificates",
		"/etc/ca-certificates",
	}},
	// RHEL, Fedora; blacklist up to RHEL 8
	{"/etc/pki/ca-trust/source/anchors", []string{"/etc/pki/ca-trust/source/blocklist", "/etc/pki/ca-trust/source/blacklist"}, []string{
		"/etc/pki/ca-trust/source/anchors",
		"/etc/pki/ca-trust/source",
		"/etc/pki/ca-trust/extracted/pem",
		"/etc/pki/ca-trust/extracted/java",
		"/etc/pki/ca-trust/extracted",
		"/etc/pki/ca-trust",
	}},
	// SUSE, where p11-kit ships the anchor directory
	{"/etc/pki/trust/anchors", []string{"/var/lib/ca-certificates"}, nil},
	// Arch
	{"/etc/ca-certificates/trust-source/anchors", []string{"/etc/ca-certificates/trust-source/blocklist"}, []string{
		"/etc/ca-certificates/trust-source/anchors",
		"/etc/ca-certificates/trust-source",
	}},
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

// installedAnchorPackages reports, for each of anchorDirs, whether its package
// is installed.
func installedAnchorPackages(rootfs string) []bool {
	installed := make([]bool, len(anchorDirs))
	for i, anchor := range anchorDirs {
		for _, owner := range anchor.owners {
			// A path that will not resolve inside the rootfs is not there, the
			// same answer as not finding it.
			resolved, _ := resolveInRoot(rootfs, owner)
			if _, err := os.Stat(resolved); err == nil {
				installed[i] = true
			}
		}
	}
	return installed
}

// undoAnchors takes back what the anchors left once the step has ended.
// installedBefore is installedAnchorPackages as the step started. It runs
// after the layer sweep, so an anchor file is already gone and the directory
// that held it is empty unless the step put something there.
func undoAnchors(rootfs string, created createdDirs, installedBefore []bool) {
	installed := installedAnchorPackages(rootfs)
	// The directories placeAnchors and placeNSSDB made, deepest first, except
	// an anchor directory whose package is now installed: taking one away
	// would leave the image short a directory an unproxied build of the same
	// Dockerfile has.
	adopted := map[string]bool{}
	for i := range anchorDirs {
		if installed[i] {
			dir, _ := resolveInRoot(rootfs, anchorDirs[i].dir)
			adopted[dir] = true
		}
	}
	for _, dir := range created.removalOrder() {
		if !adopted[dir] {
			removeEmptyDir(rootfs, dir)
		}
	}
	// Then what removing a package the step removed would have taken.
	for i := range anchorDirs {
		if i < len(installedBefore) && installedBefore[i] && !installed[i] {
			for _, dir := range anchorDirs[i].removal {
				removeEmptyDir(rootfs, filepath.Join(rootfs, dir))
			}
		}
	}
}

// removeEmptyDir removes the directory at dir, a path under rootfs, when it is
// empty. The container path is re-resolved and only what still lands there is
// removed: a step that swapped an ancestor for an absolute symlink would
// otherwise have os.Remove follow it out of the rootfs, and resolveInRoot
// confines the target, so a mismatch reveals the swap. Whatever the step put
// in its place, or in it, is left.
func removeEmptyDir(rootfs, dir string) {
	resolved, err := resolveInRoot(rootfs, containerPathOf(rootfs, dir))
	if err != nil || resolved != dir {
		logf("not removing %s: it no longer resolves there (%v)", dir, err)
		return
	}
	if info, err := os.Lstat(dir); err != nil || !info.IsDir() {
		return
	}
	if err := os.Remove(dir); err != nil && !errors.Is(err, syscall.ENOTEMPTY) {
		logf("cannot remove %s: %v", dir, err)
	}
}
