package main

// On Linux, Chromium trusts only its compiled-in root store and the NSS
// database in $HOME. The step's own database is SQLite it controls, so it is
// never opened: a copy of a template holding only the proxy CA is bound over
// it instead, and a step that changes that copy fails the build.

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

// A var so tests can point it elsewhere.
var nssTemplateDir = "/opt/buildcage/nssdb"

// The legacy path, relative to $HOME: Chromium before M146 reads only this one,
// and later versions still prefer it to the XDG path whenever it exists.
// https://chromium.googlesource.com/chromium/src/+/main/docs/linux/cert_management.md
const nssDBPath = ".pki/nssdb"

var errNSSDBChanged = errors.New("the step changed the NSS database")

// A real /etc/passwd is a few KB.
const maxPasswdBytes = 1 << 20

type nssBind struct {
	containerDir string
	scratchDir   string
	baseline     []fileEntry
}

// placeNSSDB returns a nil bind, having logged why, when the database cannot be
// placed. created holds the directories made to bind it over.
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

	// Last, so a failure above leaves nothing behind.
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

func chooseNSSDB(rootfs, home string) (hostDir string, exists bool, err error) {
	resolved, err := resolveInRoot(rootfs, filepath.Join(home, nssDBPath))
	if err != nil {
		return "", false, err
	}
	// resolveInRoot has read every component, so this can only fail on a
	// missing one.
	info, err := os.Stat(resolved)
	if err != nil {
		return resolved, false, nil
	}
	if !info.IsDir() {
		return "", false, fmt.Errorf("%s is not a directory", containerPathOf(rootfs, resolved))
	}
	return resolved, true, nil
}

// ownDirs makes the directories the step user's, 0700 as Chromium makes them.
func ownDirs(dirs []string, uid, gid int) error {
	for _, dir := range dirs {
		if err := os.Chown(dir, uid, gid); err != nil {
			return err
		}
		// Cannot fail once the chown has succeeded.
		_ = os.Chmod(dir, 0o700)
	}
	return nil
}

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

// prepare hands the copy to the step's user: Chromium ignores a database it
// cannot open read-write.
func (b *nssBind) prepare(template map[string][]byte, uid, gid int) error {
	paths := []string{b.scratchDir}
	for name, content := range template {
		path := filepath.Join(b.scratchDir, name)
		// Untested by design: a new file in a directory this process just made.
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

// finish fails when the step changed the database's content. Chromium reading
// it leaves every file as it was. Ownership and mode are not compared, so a
// chown -R or chmod -R over $HOME does not count as a change.
func (b *nssBind) finish() error {
	current, err := captureManifest(b.scratchDir)
	if err != nil {
		return err
	}
	if !slices.EqualFunc(current, b.baseline, sameNSSContent) {
		return fmt.Errorf("%w at %s, which the inspect engine replaces for the step with one trusting only its proxy CA; "+
			"the write is discarded (see README.md#limitations)", errNSSDBChanged, b.containerDir)
	}
	return nil
}

func sameNSSContent(a, b fileEntry) bool {
	return a.path == b.path && a.mode.Type() == b.mode.Type() && a.symlinkTo == b.symlinkTo && a.sha256 == b.sha256
}

func (b *nssBind) cleanup() {
	removeScratchDir(b.scratchDir)
}

// homeOf follows runc: an empty HOME comes from /etc/passwd, falling back to /.
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
