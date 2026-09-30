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
// A database the step's user cannot write is covered instead, by a copy of a
// template holding only the proxy CA, and a step that changes that copy fails
// the build: Chromium opens nothing it cannot open read-write, the slot
// included.

import (
	"bufio"
	"bytes"
	"errors"
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

// nssSlot is what pkcs11.txt gains. library= must name the softoken: left
// empty, the entry gives Chromium no second slot. The trailing blank line ends
// the entry, so a module the step adds after it with modutil stays an entry of
// its own.
var nssSlot = []byte("library=libsoftokn3.so\n" +
	"name=\"buildcage proxy CA\"\n" +
	"parameters=\"configdir='sql:" + nssCADBDir + "' flags=readOnly\"\n" +
	"NSS=\"\"\n\n")

// nssSlotConfigDir identifies the slot even after the rest of its entry is
// edited.
var nssSlotConfigDir = []byte("configdir='sql:" + nssCADBDir + "'")

// A real pkcs11.txt is a few hundred bytes per module.
const maxPKCS11TxtBytes = 1 << 20

// The files Chromium opens read-write in a database it uses.
var nssDBFiles = []string{"cert9.db", "key4.db"}

var errNSSDBChanged = errors.New("the step changed the NSS database")

// A real /etc/passwd is a few KB.
const maxPasswdBytes = 1 << 20

type nssBind struct {
	containerDir string
	scratchDir   string
	baseline     []fileEntry
}

// placeNSSDB makes Chromium trust the CA through the step's own database when
// the step's user can write it, and through a covering one otherwise. It
// returns neither, having logged why, when there is nowhere to place either.
// created holds the directories made to bind over.
func placeNSSDB(s *spec, bundle string, ca []byte) (*dirBind, *nssBind, createdDirs) {
	var created createdDirs
	template, err := readNSSTemplate()
	if err != nil {
		logf("no NSS database template at %s (%v); not injecting into Chromium's", nssTemplateDir, err)
		return nil, nil, created
	}

	uid, gid := s.processUser()
	home := homeOf(s, uid)
	if !filepath.IsAbs(home) || filepath.Clean(home) == "/" {
		logf("the step's home directory is %q; not injecting into Chromium's NSS database", home)
		return nil, nil, created
	}
	resolvedHome, err := resolveInRoot(s.rootfs, home)
	if err != nil {
		logf("HOME=%s could not be resolved inside the rootfs (%v); not injecting into Chromium's NSS database", home, err)
		return nil, nil, created
	}
	homeInfo, err := os.Stat(resolvedHome)
	if err != nil || !homeInfo.IsDir() {
		logf("HOME=%s is not a directory in the rootfs; not injecting into Chromium's NSS database", home)
		return nil, nil, created
	}

	hostDir, exists, err := chooseStepNSSDB(s.rootfs, home)
	if err == nil {
		var b *dirBind
		b, created, err = slotNSSDB(s, bundle, ca, template, hostDir, exists, homeInfo)
		if err == nil {
			return b, nil, created
		}
	}
	logf("cannot add the proxy CA to the step's own NSS database under %s (%v); covering it with one trusting only the proxy CA", home, err)
	cover, coverCreated := coverNSSDB(s, bundle, template, home, uid, gid)
	created.add(coverCreated.dirs)
	return nil, cover, created
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
	original, err := captureManifest(b.scratchDir)
	if err != nil {
		return err
	}
	b.original = original
	appended, err := appendNSSSlot(filepath.Join(b.scratchDir, "pkcs11.txt"), uid, gid)
	if err != nil {
		return err
	}
	b.nssAppended = appended
	_, b.nssHadTxt = entryFor(original, "pkcs11.txt")
	baseline, err := captureManifest(b.scratchDir)
	if err != nil {
		return err
	}
	b.baseline = baseline
	return nil
}

// appendNSSSlot adds the slot to pkcs11.txt, creating it for the step's user
// when missing, and returns the bytes it appended. Entries are separated by a
// blank line, which the file gains first when it does not already end in one.
func appendNSSSlot(path string, uid, gid int) ([]byte, error) {
	_, statErr := os.Lstat(path)
	f, err := openBundle(path, os.O_CREATE|os.O_RDWR|os.O_APPEND|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0o600)
	if err != nil {
		return nil, asNotRegular(path, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%s: %w", path, errNotRegular)
	}
	var appended []byte
	if size := info.Size(); size > 0 {
		tail := make([]byte, min(size, 2))
		if _, err := f.ReadAt(tail, size-int64(len(tail))); err != nil {
			return nil, err
		}
		switch {
		case bytes.HasSuffix(tail, []byte("\n\n")) || string(tail) == "\n":
		case bytes.HasSuffix(tail, []byte("\n")):
			appended = []byte("\n")
		default:
			appended = []byte("\n\n")
		}
	}
	appended = append(appended, nssSlot...)
	if _, err := f.WriteString(string(appended)); err != nil {
		return nil, err
	}
	if os.IsNotExist(statErr) {
		if err := lchown(path, uid, gid); err != nil {
			return nil, err
		}
	}
	return appended, nil
}

// removeNSSSlot takes back what appendNSSSlot added. NSS rewrites pkcs11.txt
// only by copying the entries it keeps byte for byte, so the slot is found
// where it was left unless the step itself took it out, in which case the file
// is written back as the step left it. The separator goes too only when nothing
// follows the slot: an entry after it would otherwise run into the one before.
// A pkcs11.txt the step replaced with something other than a file carries no
// slot. One the injection created is removed once it holds nothing else.
func removeNSSSlot(path string, appended []byte, created bool) error {
	f, err := openBundle(path, os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		if os.IsNotExist(err) || errors.Is(err, syscall.EISDIR) || errors.Is(asNotRegular(path, err), errNotRegular) {
			return nil
		}
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return nil
	}
	if info.Size() > maxPKCS11TxtBytes {
		return fmt.Errorf("%s is %d bytes, too large to take the proxy CA's slot back out of", path, info.Size())
	}
	content := make([]byte, info.Size())
	if _, err := f.ReadAt(content, 0); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	cut, i := appended, bytes.LastIndex(content, appended)
	if i < 0 || i+len(cut) < len(content) {
		cut, i = nssSlot, bytes.LastIndex(content, nssSlot)
	}
	if i < 0 {
		logf("%s no longer holds the proxy CA's slot; writing it back as the step left it", path)
		return nil
	}
	kept := slices.Concat(content[:i], content[i+len(cut):])
	if created && len(kept) == 0 {
		return os.Remove(path)
	}
	if _, err := f.WriteAt(kept, 0); err != nil {
		return err
	}
	return f.Truncate(int64(len(kept)))
}

// stripNSSSlotCopy cuts every copy of the slot out of the pkcs11.txt at path.
// When the file still ends in appended, the separator and slot appendNSSSlot
// added, the separator goes too. A file left empty is removed. It returns why
// the file still counts as residue, or "" when it does not.
func stripNSSSlotCopy(path string, appended []byte) (string, error) {
	f, err := openBundle(path, os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return "", asNotRegular(path, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	// Too large to be one NSS wrote.
	if info.Size() > maxPKCS11TxtBytes {
		return "over 1 MiB, not read", nil
	}
	content := make([]byte, info.Size())
	if _, err := f.ReadAt(content, 0); err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	kept := content
	if len(appended) > 0 && bytes.HasSuffix(kept, appended) {
		kept = kept[:len(kept)-len(appended)]
	}
	for bytes.Contains(kept, nssSlot) {
		kept = bytes.ReplaceAll(kept, nssSlot, nil)
	}
	if len(kept) < len(content) {
		if len(kept) == 0 {
			return "", os.Remove(path)
		}
		if _, err := f.WriteAt(kept, 0); err != nil {
			return "", err
		}
		if err := f.Truncate(int64(len(kept))); err != nil {
			return "", err
		}
	}
	if bytes.Contains(kept, nssSlotConfigDir) {
		return "still names " + nssCADBDir, nil
	}
	return "", nil
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

// coverNSSDB binds a copy of the template over the legacy path, returning nil,
// having logged why, when it cannot be placed.
func coverNSSDB(s *spec, bundle string, template map[string][]byte, home string, uid, gid int) (*nssBind, createdDirs) {
	var created createdDirs
	hostDir, exists, err := chooseNSSDB(s.rootfs, filepath.Join(home, nssDBPath))
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
	// Only the step can have made its own copy unreadable.
	if err != nil {
		return fmt.Errorf("%w at %s: it can no longer be read back: %v", errNSSDBChanged, b.containerDir, err)
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
