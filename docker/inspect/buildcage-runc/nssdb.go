package main

// On Linux, Chromium trusts only its compiled-in root store and the NSS
// database in $HOME. The step's own database is SQLite it controls, so it is
// never opened. Instead the directory is mirrored like a CA store, and a second
// softoken slot is appended to the mirror's pkcs11.txt: a read-only one on a
// database holding only the proxy CA, bound where the step cannot write. NSS
// loads every module pkcs11.txt names, so Chromium trusts the CA through that
// slot while the step's own certificates, keys and writes stay in its own.
// Taking the slot back out of pkcs11.txt is the whole undo.
//
// A database that cannot take the slot, such as one the step's user cannot
// write, is left alone: Chromium opens nothing it cannot open read-write, the
// slot included, so it does not trust the CA there.

import (
	"bufio"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
)

// A var so tests can point it elsewhere.
var nssTemplateDir = "/opt/buildcage/nssdb"

// A var so a test can fail handing a new pkcs11.txt to the step's user, which
// root on a real filesystem never does.
var lchown = os.Lchown

// The legacy path, relative to $HOME: Chromium before M146 reads only this one,
// and later versions still prefer it to the XDG path whenever it exists.
// https://chromium.googlesource.com/chromium/src/+/main/docs/linux/cert_management.md
const nssDBPath = ".pki/nssdb"

// Where Chromium M146 and later create a database when there is no legacy one.
const nssXDGDBPath = ".local/share/pki/nssdb"

// Where the database holding only the proxy CA is bound in the step: under the
// /dev tmpfs runc gives every container, so its mount point never reaches a
// layer.
const nssCADBDir = "/dev/buildcage-nssdb"

// The files Chromium opens read-write in a database it uses.
var nssDBFiles = []string{"cert9.db", "key4.db"}

// A real /etc/passwd is a few KB.
const maxPasswdBytes = 1 << 20

// placeNSSDB makes Chromium trust the CA through the step's own database. It
// returns nil, having logged why, when that database cannot take the slot.
// created holds the directories made to bind over.
func placeNSSDB(s *spec, bundle string, ca []byte) (*dirBind, createdDirs) {
	var created createdDirs
	template, err := readNSSTemplate()
	if err != nil {
		logf("no NSS database template at %s (%v); not injecting into Chromium's", nssTemplateDir, err)
		return nil, created
	}

	uid, _ := s.processUser()
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
	homeInfo, err := os.Stat(resolvedHome)
	if err != nil || !homeInfo.IsDir() {
		logf("HOME=%s is not a directory in the rootfs; not injecting into Chromium's NSS database", home)
		return nil, created
	}

	hostDir, exists, err := chooseStepNSSDB(s.rootfs, home)
	if err == nil {
		var b *dirBind
		b, created, err = slotNSSDB(s, bundle, ca, template, hostDir, exists, homeInfo)
		if err == nil {
			return b, created
		}
	}
	// err names builder-side paths.
	reason := strings.ReplaceAll(err.Error(), s.rootfs+"/", "/")
	msg := fmt.Sprintf("cannot add the proxy CA to Chromium's NSS database under %s (%s), "+
		"so Chromium in this step will not trust the proxy; use proxy_engine: universal for it", home, reason)
	logf("%s", msg)
	// Also to stderr, which is the step's output in the build log.
	fmt.Fprintf(os.Stderr, "buildcage: warning: %s\n", msg)
	return nil, created
}

// chooseStepNSSDB picks the database Chromium would read: the legacy one when
// it is there, else the XDG one, else a legacy one the step does not have yet,
// which every Chromium reads.
func chooseStepNSSDB(rootfs, home string) (hostDir string, exists bool, err error) {
	legacy, legacyExists, err := chooseNSSDB(rootfs, filepath.Join(home, nssDBPath))
	if err != nil || legacyExists {
		return legacy, legacyExists, err
	}
	xdg, xdgExists, err := chooseNSSDB(rootfs, filepath.Join(home, nssXDGDBPath))
	if err != nil || xdgExists {
		return xdg, xdgExists, err
	}
	return legacy, false, nil
}

// slotNSSDB mirrors the step's database directory, appends the slot to the
// mirror's pkcs11.txt and binds both it and the CA-only database. It changes
// neither the spec nor the rootfs unless it succeeds. A database it creates
// belongs to the home's owner, as the rest of the home does.
func slotNSSDB(s *spec, bundle string, ca []byte, template map[string][]byte, hostDir string, exists bool, home fs.FileInfo) (*dirBind, createdDirs, error) {
	var created createdDirs
	uid, gid := s.processUser()
	containerDir := containerPathOf(s.rootfs, hostDir)
	if s.mountConflicts(containerDir) {
		return nil, created, fmt.Errorf("a mount already covers %s", containerDir)
	}
	if s.mountedWithin(nssCADBDir) {
		return nil, created, fmt.Errorf("a mount already covers %s", nssCADBDir)
	}
	if exists {
		if err := checkNSSDBWritable(hostDir, uid, gid, s.processGroups()); err != nil {
			return nil, created, err
		}
		if err := checkMirrorable(hostDir, maxCustomDirBytes, maxCustomDirFiles); err != nil {
			return nil, created, err
		}
	} else {
		uid, gid = ownerOf(home)
	}

	base, err := newScratchDir(bundle)
	if err != nil {
		return nil, created, err
	}
	b := &dirBind{
		rootfs:       s.rootfs,
		hostDir:      hostDir,
		containerDir: containerDir,
		scratchDir:   filepath.Join(base, "db"),
		limit:        customDirLimit,
		ca:           ca,
		nssBase:      base,
	}
	caDB := filepath.Join(base, "ca")
	// Untested by design: see writeCADB.
	//coverage:ignore start
	if err := writeCADB(caDB, template); err != nil {
		b.cleanup()
		return nil, created, err
	}
	//coverage:ignore stop
	if err := b.prepareNSS(exists, uid, gid); err != nil {
		b.cleanup()
		return nil, created, err
	}

	// Last, so a failure above leaves nothing behind.
	if !exists {
		dirs, err := mkdirAllTracking(hostDir)
		created.add(dirs)
		if err == nil {
			err = ownDirs(append(dirs, b.scratchDir), uid, gid)
		}
		if err != nil {
			b.cleanup()
			return nil, created, fmt.Errorf("cannot create %s: %w", containerDir, err)
		}
	}
	s.addBindMount(containerDir, b.scratchDir)
	s.addReadOnlyBindMount(nssCADBDir, caDB)
	logf("added a read-only slot trusting the proxy CA to the NSS database at %s", containerDir)
	return b, created, nil
}

// prepareNSS fills the mirror: the step's database when it has one, and the
// slot appended to its pkcs11.txt.
func (b *dirBind) prepareNSS(exists bool, uid, gid int) error {
	// Untested by design: a new directory under one this process just made.
	//coverage:ignore start
	if err := os.Mkdir(b.scratchDir, 0o700); err != nil {
		return err
	}
	//coverage:ignore stop
	if exists {
		if err := mirrorDir(b.hostDir, b.scratchDir); err != nil {
			return fmt.Errorf("mirroring %s: %w", b.hostDir, err)
		}
	}
	return b.injectIntoMirror(func() error {
		appended, err := appendNSSSlot(filepath.Join(b.scratchDir, "pkcs11.txt"), uid, gid)
		if err != nil {
			return err
		}
		b.nssAppended = appended
		_, b.nssHadTxt = entryFor(b.original, "pkcs11.txt")
		return nil
	})
}

// checkNSSDBWritable fails when the step's user could not open the database
// read-write, as Chromium must to use it, slot and all. Judged from the modes
// alone, so nothing in the directory is opened. A file that is a symlink is
// refused, as it could point anywhere an earlier step chose.
func checkNSSDBWritable(dir string, uid, gid int, groups []int) error {
	info, err := os.Stat(dir)
	// Untested by design: chooseStepNSSDB has just found dir a directory.
	//coverage:ignore start
	if err != nil {
		return err
	}
	//coverage:ignore stop
	if !writableBy(info, uid, gid, groups) {
		return fmt.Errorf("%s is not writable by uid %d", dir, uid)
	}
	for _, name := range nssDBFiles {
		path := filepath.Join(dir, name)
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("%s: %w", path, errNotRegular)
		}
		if !writableBy(info, uid, gid, groups) {
			return fmt.Errorf("%s is not writable by uid %d", path, uid)
		}
	}
	return nil
}

// writableBy applies the permission bits the way the kernel would for uid,
// which as root may write anything.
func writableBy(info fs.FileInfo, uid, gid int, groups []int) bool {
	if uid == 0 {
		return true
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	// Untested by design: os.Stat on Linux always yields a *syscall.Stat_t.
	//coverage:ignore start
	if !ok {
		return false
	}
	//coverage:ignore stop
	perm := info.Mode().Perm()
	switch {
	case int(st.Uid) == uid:
		return perm&0o200 != 0
	case int(st.Gid) == gid || slices.Contains(groups, int(st.Gid)):
		return perm&0o020 != 0
	default:
		return perm&0o002 != 0
	}
}

// writeCADB copies the template into dir, readable by any step user: it holds
// the CA's certificate and an empty key database, and is bound read-only.
func writeCADB(dir string, template map[string][]byte) error {
	// Untested by design: a new directory, and files in it, under one this
	// process just made. The chmods get past the umask.
	//coverage:ignore start
	if err := os.Mkdir(dir, 0o755); err != nil {
		return err
	}
	if err := os.Chmod(dir, 0o755); err != nil {
		return err
	}
	for name, content := range template {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, content, 0o644); err != nil {
			return err
		}
		if err := os.Chmod(path, 0o644); err != nil {
			return err
		}
	}
	//coverage:ignore stop
	return nil
}

func chooseNSSDB(rootfs, path string) (hostDir string, exists bool, err error) {
	resolved, err := resolveInRoot(rootfs, path)
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

func ownerOf(info fs.FileInfo) (uid, gid int) {
	var st syscall.Stat_t
	if p, ok := info.Sys().(*syscall.Stat_t); ok {
		st = *p
	}
	return int(st.Uid), int(st.Gid)
}

// ownDirs gives the directories to uid and gid, 0700 as Chromium makes them.
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

// homeOf follows runc: an empty HOME comes from /etc/passwd, falling back to /.
// The file is opened the way appendCA opens a bundle, so a FIFO an earlier step
// left there cannot block the wrapper before the step starts.
func homeOf(s *spec, uid int) string {
	if home := s.env["HOME"]; home != "" {
		return home
	}
	path, err := resolveInRoot(s.rootfs, "/etc/passwd")
	if err != nil {
		return "/"
	}
	f, err := openBundle(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return "/"
	}
	defer f.Close()
	if info, err := f.Stat(); err != nil || !info.Mode().IsRegular() {
		return "/"
	}
	scanner := bufio.NewScanner(io.NewSectionReader(f, 0, maxPasswdBytes))
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
