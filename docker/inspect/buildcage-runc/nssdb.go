package main

// Chromium does not read the system CA store on Linux. It trusts the Chrome
// Root Store compiled into the binary, plus whatever the user added to the NSS
// shared database in their home directory, and nothing else: no bundle, no
// environment variable, and in chrome-headless-shell no enterprise policy
// either. So the only way to have it trust the proxy's CA is that database.
//
// The database is SQLite, which the step controls, so it is never opened here.
// Instead a database holding only the proxy's CA, made once by the proxy's own
// certutil when the CA was generated, is copied to a scratch directory and
// bound over wherever Chromium would look. Whatever the step's image kept there
// is covered, not merged into: see README.md#limitations for the one case that
// loses anything by it. Nothing reaches the rootfs, so there is nothing to take
// back out of the layer either, as long as the step left the copy alone. A step
// that did change it wrote to a file buildcage had replaced, and that change
// has nowhere true to be written back to, so the build fails instead.

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// nssTemplateDir is a var, not a const, so tests can point it at a database of
// their own instead of the real host path.
var nssTemplateDir = "/opt/buildcage/nssdb"

// Where Chromium looks for the database, relative to $HOME, in the order it
// looks: the legacy path wins whenever it exists, even empty, and the XDG one,
// the default since M146, is used otherwise.
// https://chromium.googlesource.com/chromium/src/+/main/docs/linux/cert_management.md
var nssDBPaths = []string{".pki/nssdb", ".local/share/pki/nssdb"}

// maxPasswdBytes bounds how much of the step's /etc/passwd is read to find its
// home directory. A real one is a few KB.
const maxPasswdBytes = 1 << 20

// nssBind is the scratch database bound over the step's own, kept to be
// compared against what it held when the step started.
type nssBind struct {
	containerDir string
	scratchDir   string
	baseline     []fileEntry
}

// placeNSSDB binds a copy of the template over the database Chromium would read
// for the step's user, returning it along with the directories created to have
// somewhere to bind it. It returns a nil bind, having logged why, when the step
// has no home to find it in or the template cannot be placed.
func placeNSSDB(s *spec, bundle string) (*nssBind, createdDirs) {
	var created createdDirs
	template, err := readNSSTemplate()
	if err != nil {
		logf("no NSS database template at %s (%v); not injecting into Chromium's", nssTemplateDir, err)
		return nil, created
	}

	uid, gid := s.processUser()
	home := homeOf(s, uid)
	if !filepath.IsAbs(home) || filepath.Clean(home) == "/" {
		logf("the step's home directory is %q; not injecting into Chromium's NSS database", home)
		return nil, created
	}
	resolvedHome, err := resolveInRoot(s.rootfs, home)
	if err != nil {
		logf("HOME=%s could not be resolved inside the rootfs (%v); not injecting into Chromium's NSS database", home, err)
		return nil, created
	}
	if info, err := os.Stat(resolvedHome); err != nil || !info.IsDir() {
		logf("HOME=%s is not a directory in the rootfs; not injecting into Chromium's NSS database", home)
		return nil, created
	}

	hostDir, exists, err := chooseNSSDB(s.rootfs, home)
	if err != nil {
		logf("cannot place Chromium's NSS database under %s: %v", home, err)
		return nil, created
	}
	containerDir := containerPathOf(s.rootfs, hostDir)
	if s.mountConflicts(containerDir) {
		logf("a mount already covers %s; not injecting into Chromium's NSS database", containerDir)
		return nil, created
	}

	scratch, err := newScratchDir(bundle)
	if err != nil {
		logf("cannot create a scratch directory for %s: %v", containerDir, err)
		return nil, created
	}
	b := &nssBind{containerDir: containerDir, scratchDir: scratch}
	if err := b.prepare(template, uid, gid); err != nil {
		logf("cannot prepare Chromium's NSS database for %s: %v", containerDir, err)
		b.cleanup()
		return nil, created
	}

	// Last, so a database that could not be prepared leaves nothing behind.
	if !exists {
		dirs, err := mkdirAllTracking(hostDir)
		created.add(dirs)
		if err == nil {
			err = ownDirs(dirs, uid, gid)
		}
		if err != nil {
			logf("cannot create %s to bind Chromium's NSS database over: %v", containerDir, err)
			b.cleanup()
			return nil, created
		}
	}
	s.addBindMount(containerDir, scratch)
	logf("bound a database trusting only the proxy CA over %s", containerDir)
	return b, created
}

// chooseNSSDB returns the database directory Chromium would read under home,
// and whether it is already there. A path that exists but is not a directory
// is Chromium's choice too, and there is no binding a directory over it.
func chooseNSSDB(rootfs, home string) (hostDir string, exists bool, err error) {
	for _, rel := range nssDBPaths {
		resolved, err := resolveInRoot(rootfs, filepath.Join(home, rel))
		if err != nil {
			return "", false, err
		}
		// resolveInRoot has already read every component but a missing one,
		// and resolved every symlink among them, so all this can still find
		// out is that the path is not there.
		info, err := os.Stat(resolved)
		if err != nil {
			continue
		}
		if !info.IsDir() {
			return "", false, fmt.Errorf("%s is not a directory", containerPathOf(rootfs, resolved))
		}
		return resolved, true, nil
	}
	// Neither is there: Chromium would create the XDG one, so that is where
	// the template goes.
	resolved, err := resolveInRoot(rootfs, filepath.Join(home, nssDBPaths[len(nssDBPaths)-1]))
	return resolved, false, err
}

// ownDirs gives the directories created on the step's behalf to the step's
// user, 0700 as Chromium makes them, since the step would have made them
// itself had it run without the proxy.
func ownDirs(dirs []string, uid, gid int) error {
	for _, dir := range dirs {
		if err := os.Chown(dir, uid, gid); err != nil {
			return err
		}
		// Cannot fail once the chown has not: whoever may give a file away owns
		// it, and so may change its mode.
		_ = os.Chmod(dir, 0o700)
	}
	return nil
}

// readNSSTemplate reads every file of the template database, by name.
func readNSSTemplate() (map[string][]byte, error) {
	entries, err := os.ReadDir(nssTemplateDir)
	if err != nil {
		return nil, err
	}
	files := map[string][]byte{}
	for _, e := range entries {
		if !e.Type().IsRegular() {
			continue
		}
		content, err := os.ReadFile(filepath.Join(nssTemplateDir, e.Name()))
		if err != nil {
			return nil, err
		}
		files[e.Name()] = content
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("%s holds no database", nssTemplateDir)
	}
	return files, nil
}

// prepare writes the template into the scratch directory, owned by the step's
// user and writable by it: NSS opens the database read-write, and Chromium,
// failing that, does not fall back to reading it but ignores it altogether.
// MkdirTemp has already made the directory 0700 and WriteFile makes each file
// 0600, so the owner is all that is left to change.
func (b *nssBind) prepare(template map[string][]byte, uid, gid int) error {
	paths := []string{b.scratchDir}
	for name, content := range template {
		path := filepath.Join(b.scratchDir, name)
		// Untested by design: a new file in a directory this process has just
		// made for itself, under a name ReadDir returned once.
		//coverage:ignore start
		if err := os.WriteFile(path, content, 0o600); err != nil {
			return err
		}
		//coverage:ignore stop
		paths = append(paths, path)
	}
	for _, path := range paths {
		if err := os.Chown(path, uid, gid); err != nil {
			return err
		}
	}
	baseline, err := captureManifest(b.scratchDir)
	if err != nil {
		return err
	}
	b.baseline = baseline
	return nil
}

// finish fails when the step changed the database. Reading it does not: NSS
// leaves every file byte for byte as it found it, journal included.
func (b *nssBind) finish() error {
	current, err := captureManifest(b.scratchDir)
	if err != nil {
		return err
	}
	if !manifestsEqual(current, b.baseline) {
		return fmt.Errorf("the step changed the NSS database at %s, which the inspect engine replaces for the step with one trusting only its proxy CA; "+
			"a step that writes to it is not supported (see README.md#limitations)", b.containerDir)
	}
	return nil
}

func (b *nssBind) cleanup() {
	removeScratchDir(b.scratchDir)
}

// homeOf is the HOME the step's process will run with. runc fills it in from
// the image's /etc/passwd when the spec leaves it empty, falling back to /, and
// this follows the same lookup.
func homeOf(s *spec, uid int) string {
	if home := s.env["HOME"]; home != "" {
		return home
	}
	path, err := resolveInRoot(s.rootfs, "/etc/passwd")
	if err != nil {
		return "/"
	}
	f, err := os.Open(path)
	if err != nil {
		return "/"
	}
	defer f.Close()
	scanner := bufio.NewScanner(io.LimitReader(f, maxPasswdBytes))
	for scanner.Scan() {
		fields := strings.Split(scanner.Text(), ":")
		if len(fields) != 7 {
			continue
		}
		if id, err := strconv.Atoi(fields[2]); err == nil && id == uid {
			if fields[5] == "" {
				return "/"
			}
			return fields[5]
		}
	}
	return "/"
}
