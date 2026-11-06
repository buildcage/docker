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

// Each package is told by paths only it ships, one per release that renamed
// the path: finding any says it is installed.
var (
	debianCACertificates = []string{"/usr/share/ca-certificates/mozilla"} // and Ubuntu's, Alpine's
	rhelCACertificates   = []string{"/etc/pki/ca-trust/source/blocklist", "/etc/pki/ca-trust/source/blacklist"}
	suseCACertificates   = []string{"/usr/lib/ca-certificates/update.d"}
	archCACertificates   = []string{"/etc/ca-certificates/trust-source/blocklist", "/etc/ca-certificates/trust-source/blacklist"}
	openssl              = []string{"/usr/bin/openssl"}
)

// Where each distribution's ca-certificates tooling reads extra trusted
// certificates from. A directory is created here only because the package that
// ships it is not installed, so finding owners at the end says the anchor
// directory now belongs to the package rather than to this wrapper.
var anchorDirs = []struct {
	dir    string
	owners []string
}{
	{"/usr/local/share/ca-certificates", debianCACertificates},
	{"/etc/pki/ca-trust/source/anchors", rhelCACertificates},
	// p11-kit ships it too
	{"/etc/pki/trust/anchors", suseCACertificates},
	{"/etc/ca-certificates/trust-source/anchors", archCACertificates},
}

// packageRemovals lists, deepest first, what removing packages takes away but
// the injection can keep from going: the CA, and the other anchor directories
// it creates, keep an anchor directory and its parents from being empty, and a
// mirrored directory is a mount point. The directories go once a step has
// removed every one of the packages, all installed as it started.
var packageRemovals = []struct {
	packages [][]string
	dirs     []string
}{
	{[][]string{debianCACertificates}, []string{
		"/usr/local/share/ca-certificates",
		"/etc/ca-certificates",
	}},
	// The CA store's directory, which openssl ships too
	{[][]string{debianCACertificates, openssl}, []string{
		"/etc/ssl/certs",
		"/etc/ssl",
	}},
	{[][]string{rhelCACertificates}, []string{
		"/etc/pki/ca-trust/source/anchors",
		"/etc/pki/ca-trust/source",
		"/etc/pki/ca-trust/extracted/pem",
		"/etc/pki/ca-trust/extracted/java",
		"/etc/pki/ca-trust/extracted",
		"/etc/pki/ca-trust",
	}},
	{[][]string{suseCACertificates}, []string{
		"/etc/ca-certificates",
	}},
	{[][]string{archCACertificates}, []string{
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

// installed reports whether a package is installed, by any of the paths only
// it ships.
func installed(rootfs string, owners []string) bool {
	for _, owner := range owners {
		// A path that will not resolve inside the rootfs is not there, the same
		// answer as not finding it.
		resolved, _ := resolveInRoot(rootfs, owner)
		if _, err := os.Stat(resolved); err == nil {
			return true
		}
	}
	return false
}

// packagesInstalled reports whether every one of packages is installed, and
// whether any is.
func packagesInstalled(rootfs string, packages [][]string) (all, any bool) {
	all = true
	for _, owners := range packages {
		if installed(rootfs, owners) {
			any = true
		} else {
			all = false
		}
	}
	return all, any
}

// anchorsAtStart is the state of the anchors' packages as the step started,
// for undoAnchors to compare the end of the step with.
type anchorsAtStart struct {
	// For each of packageRemovals, whether all its packages were installed,
	// and its directories with their parents resolved, so the links the image
	// ships are followed and a link the step puts in a path later shows as a
	// mismatch: a removal does not reach through one.
	installed []bool
	removal   [][]string
}

func recordAnchors(rootfs string) anchorsAtStart {
	var at anchorsAtStart
	for _, removal := range packageRemovals {
		all, _ := packagesInstalled(rootfs, removal.packages)
		at.installed = append(at.installed, all)
		at.removal = append(at.removal, resolveRemoval(rootfs, removal.dirs))
	}
	return at
}

// resolveRemoval resolves the parent of each directory, leaving out one whose
// parent will not resolve.
func resolveRemoval(rootfs string, dirs []string) []string {
	var resolved []string
	for _, dir := range dirs {
		parent, err := resolveInRoot(rootfs, filepath.Dir(dir))
		if err != nil {
			logf("not removing %s after the step: %v", dir, err)
			continue
		}
		resolved = append(resolved, filepath.Join(parent, filepath.Base(dir)))
	}
	return resolved
}

// undoAnchors takes back what the anchors left once the step has ended. It
// runs after the layer sweep, so an anchor file is already gone and the
// directory that held it is empty unless the step put something there.
func undoAnchors(rootfs string, created createdDirs, before anchorsAtStart) {
	// The directories placeAnchors and placeNSSDB made, deepest first, except
	// an anchor directory whose package is now installed: taking one away
	// would leave the image short a directory an unproxied build of the same
	// Dockerfile has.
	adopted := map[string]bool{}
	for _, anchor := range anchorDirs {
		if installed(rootfs, anchor.owners) {
			dir, _ := resolveInRoot(rootfs, anchor.dir)
			adopted[dir] = true
		}
	}
	var dirs createdDirs
	for _, dir := range created.dirs {
		if !adopted[dir] {
			dirs.add([]string{dir})
		}
	}
	// And what removing packages the step removed would have taken, in the
	// same order, so a parent another list names goes after its children.
	for i, removal := range packageRemovals {
		_, any := packagesInstalled(rootfs, removal.packages)
		if i < len(before.installed) && before.installed[i] && !any {
			dirs.add(before.removal[i])
		}
	}
	for _, dir := range dirs.removalOrder() {
		removeEmptyDir(rootfs, dir)
	}
}

// removeEmptyDir removes the directory at dir, a path under rootfs, when it is
// empty. The parent's container path is re-resolved and only what still lands
// there is removed: a step that swapped an ancestor for an absolute symlink
// would otherwise have os.Remove follow it out of the rootfs, and resolveInRoot
// confines the target, so a mismatch reveals the swap. The directory itself is
// not followed either: rmdir on a link fails. Whatever the step put in its
// place, or in it, is left.
func removeEmptyDir(rootfs, dir string) {
	parent, err := resolveInRoot(rootfs, containerPathOf(rootfs, filepath.Dir(dir)))
	if err != nil {
		logf("not removing %s: %v", dir, err)
		return
	}
	if parent != filepath.Dir(dir) {
		logf("not removing %s: its parent now leads to %s", dir, parent)
		return
	}
	if info, err := os.Lstat(dir); err != nil || !info.IsDir() {
		if !os.IsNotExist(err) {
			logf("not removing %s: it is no longer a directory", dir)
		}
		return
	}
	if err := os.Remove(dir); err != nil && !errors.Is(err, syscall.ENOTEMPTY) {
		logf("cannot remove %s: %v", dir, err)
	}
}
