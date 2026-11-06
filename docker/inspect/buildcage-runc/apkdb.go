package main

import (
	"bytes"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// apk keeps a file under /etc that differs from its record of it and installs
// the package's version beside it as <file>.apk-new. A bundle carrying the CA
// never matches, so after the step the wrapper moves each such .apk-new into
// place where apk would have replaced the bundle without the CA.
const apkDBPath = "/lib/apk/db/installed"

// apkRecord is a file's Z: value in apk's database and the package that owns
// it. truncatedSHA256 is set for a package whose record carries the S flag
// (f:S): its values are the first 20 bytes of a SHA-256 rather than a SHA-1,
// written the same way.
type apkRecord struct {
	value           string
	truncatedSHA256 bool
	pkg             string
}

// apkDatabase is what the wrapper keeps of apk's database: each file's record,
// each package's files, and the packages that list each directory, all
// relative to the root.
type apkDatabase struct {
	records   map[string]apkRecord
	packages  map[string][]string
	dirOwners map[string][]string
}

// parseAPKDatabase reads the database's package records, each ending at a
// blank line. A file's record is the R: line under its F: directory and the Z:
// line after it.
func parseAPKDatabase(db []byte) *apkDatabase {
	parsed := &apkDatabase{records: map[string]apkRecord{}, packages: map[string][]string{}, dirOwners: map[string][]string{}}
	var pkg, dir, file string
	truncated := false
	for line := range strings.SplitSeq(string(db), "\n") {
		switch {
		case line == "":
			pkg, dir, file, truncated = "", "", "", false
		case strings.HasPrefix(line, "P:"):
			pkg = line[2:]
			parsed.packages[pkg] = parsed.packages[pkg]
		case strings.HasPrefix(line, "f:"):
			truncated = strings.Contains(line[2:], "S")
		case strings.HasPrefix(line, "F:"):
			dir, file = line[2:], ""
			parsed.dirOwners[dir] = append(parsed.dirOwners[dir], pkg)
		case strings.HasPrefix(line, "R:"):
			file = dir + "/" + line[2:]
			parsed.packages[pkg] = append(parsed.packages[pkg], file)
		case strings.HasPrefix(line, "Z:") && file != "":
			parsed.records[file] = apkRecord{value: line[2:], truncatedSHA256: truncated, pkg: pkg}
			file = ""
		}
	}
	return parsed
}

// apkChecksumOfFile is the Z: value apk records for the file at path, read in
// pieces since a bundle is as large as the image made it.
func apkChecksumOfFile(path string, truncatedSHA256 bool) (string, error) {
	f, info, err := openGuarded(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	var h hash.Hash = sha1.New()
	if truncatedSHA256 {
		h = sha256.New()
	}
	if _, err := io.Copy(h, io.NewSectionReader(f, 0, info.Size())); err != nil {
		return "", err
	}
	return "Q1" + base64.StdEncoding.EncodeToString(h.Sum(nil)[:sha1.Size]), nil
}

// openGuarded opens path read-only without following a symlink or blocking on
// a FIFO. Anything but a regular file is refused before the open, since the
// wrapper runs as root on the host and opening a device node reaches the
// host's device.
func openGuarded(path string) (bundleFile, os.FileInfo, error) {
	if info, err := os.Lstat(path); err != nil {
		return nil, nil, err
	} else if !info.Mode().IsRegular() {
		return nil, nil, fmt.Errorf("%s: %w", path, errNotRegular)
	}
	f, err := openBundle(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, nil, asNotRegular(path, err)
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		f.Close()
		return nil, nil, fmt.Errorf("%s: %w", path, errNotRegular)
	}
	return f, info, nil
}

// errDatabaseTooLarge keeps a database larger than any a real image carries
// from being read into memory whole.
var errDatabaseTooLarge = errors.New("larger than " + fmt.Sprint(maxCustomDirBytes>>20) + " MiB")

func readDatabase(path string) ([]byte, os.FileInfo, error) {
	f, info, err := openGuarded(path)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	if info.Size() > maxCustomDirBytes {
		return nil, nil, fmt.Errorf("%s: %w", path, errDatabaseTooLarge)
	}
	db, err := io.ReadAll(io.NewSectionReader(f, 0, info.Size()))
	return db, info, err
}

// sameFileAndVersion reports whether a and b are the same file with the same
// size and mtime: apk replaces its database by renaming a new file over it,
// so one it rewrote is a different file.
func sameFileAndVersion(a, b os.FileInfo) bool {
	return os.SameFile(a, b) && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
}

// apkState is apk's database as it was before the step, shared by the bundle
// binds, and as the step left it, read once the first time it is needed.
type apkState struct {
	rootfs  string
	before  *apkDatabase
	bundles map[string]bool // every CA bundle, relative to the root
	// For each bundle's package, the files it listed that were there before
	// the step, apart from the CA bundles.
	presentBefore map[string][]string
	// The database file as it was before the step, so one the step left alone
	// is not read again.
	beforeInfo os.FileInfo

	afterRead bool
	present   bool         // the step left a database listing packages
	afterRaw  []byte       // that database, until something needs it parsed
	after     *apkDatabase // that database parsed, by afterDB
	removed   bool         // the step removed the database
}

// noteAPKRecords marks, in each bundle bind, the bundles whose content before
// the CA went in matches apk's record of them: the ones apk would have
// replaced or removed without the CA. Read before the step, which may change
// both.
func noteAPKRecords(rootfs string, binds []*dirBind) {
	path, err := resolveInRoot(rootfs, apkDBPath)
	if err != nil {
		logf("cannot resolve %s: %v; leaving any .apk-new beside a CA bundle", apkDBPath, err)
		return
	}
	db, info, err := readDatabase(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logf("cannot read apk's database: %v; leaving any .apk-new beside a CA bundle", err)
		}
		return
	}
	state := &apkState{rootfs: rootfs, before: parseAPKDatabase(db), bundles: map[string]bool{}, presentBefore: map[string][]string{}, beforeInfo: info}
	for _, b := range binds {
		if b.keystore || b.nssBase != "" {
			continue
		}
		b.apk = state
		for _, name := range b.bundleFiles {
			rel := b.bundleRel(name)
			state.bundles[rel] = true
			record, ok := state.before.records[rel]
			if !ok {
				continue
			}
			sum, err := apkChecksumOfFile(filepath.Join(b.hostDir, name), record.truncatedSHA256)
			if err != nil {
				if !errors.Is(err, os.ErrNotExist) {
					logf("cannot compare %s with apk's record: %v", filepath.Join(b.containerDir, name), err)
				}
				continue
			}
			if sum == record.value {
				if b.apkRecorded == nil {
					b.apkRecorded = map[string]bool{}
				}
				b.apkRecorded[name] = true
			}
		}
	}
	for _, b := range binds {
		for name := range b.apkRecorded {
			state.notePresent(b.bundlePackage(name))
		}
	}
}

// bundleRel is a bundle's path as apk's database names it.
func (b *dirBind) bundleRel(name string) string {
	return strings.TrimPrefix(filepath.Join(b.containerDir, name), "/")
}

// bundlePackage is the package apk's database said owned a bundle before the
// step.
func (b *dirBind) bundlePackage(name string) string {
	return b.apk.before.records[b.bundleRel(name)].pkg
}

// notePresent keeps the files pkg listed that are there before the step,
// apart from the CA bundles.
func (s *apkState) notePresent(pkg string) {
	if _, done := s.presentBefore[pkg]; done {
		return
	}
	present := []string{}
	for _, rel := range s.before.packages[pkg] {
		if s.bundles[rel] {
			continue
		}
		if path, ok := s.inRootfs(rel); ok {
			if _, err := os.Lstat(path); err == nil {
				present = append(present, rel)
			}
		}
	}
	s.presentBefore[pkg] = present
}

// readAfter reads apk's database as the step left it. A file still the one
// read before the step is not read again, and one listing no package at all
// is not taken to say every package went.
func (s *apkState) readAfter() {
	if s.afterRead {
		return
	}
	s.afterRead = true
	path, err := resolveInRoot(s.rootfs, apkDBPath)
	if err == nil {
		if info, statErr := os.Lstat(path); statErr == nil && sameFileAndVersion(info, s.beforeInfo) {
			s.present, s.after = true, s.before
			return
		}
		var db []byte
		if db, _, err = readDatabase(path); err == nil {
			if bytes.HasPrefix(db, []byte("P:")) || bytes.Contains(db, []byte("\nP:")) {
				s.present, s.afterRaw = true, db
			} else {
				logf("apk's database lists no package after the step; leaving the CA bundles apk may have removed")
			}
			return
		}
	}
	if errors.Is(err, os.ErrNotExist) {
		s.removed = true
		return
	}
	logf("cannot read apk's database after the step: %v; leaving the CA bundles apk may have removed", err)
}

// afterDB is the database the step left, parsed the first time it is needed:
// most steps only need to know whether a package is still listed.
func (s *apkState) afterDB() *apkDatabase {
	if s.after == nil {
		s.after, s.afterRaw = parseAPKDatabase(s.afterRaw), nil
	}
	return s.after
}

// listedAfter reports whether the database the step left lists pkg.
func (s *apkState) listedAfter(pkg string) bool {
	if s.after != nil {
		_, listed := s.after.packages[pkg]
		return listed
	}
	line := []byte("P:" + pkg + "\n")
	return bytes.HasPrefix(s.afterRaw, line) || bytes.Contains(s.afterRaw, append([]byte("\n"), line...))
}

// packageRemoved reports whether the step removed pkg: it is gone from the
// database, or, when the step removed the database too, every file the
// package listed that was there before the step, apart from the CA bundles,
// is gone. A package with no such file cannot be told apart from one still
// installed, so it counts as kept. at gives where a file the database names
// is now, or false when that cannot be told.
func (s *apkState) packageRemoved(pkg string, at func(rel string) (string, bool)) bool {
	s.readAfter()
	if s.present {
		return !s.listedAfter(pkg)
	}
	if !s.removed {
		return false
	}
	present, noted := s.presentBefore[pkg]
	if !noted {
		// A directory's owner: the directory being empty already says its
		// files went, so what it listed is taken as there before.
		for _, rel := range s.before.packages[pkg] {
			if !s.bundles[rel] {
				present = append(present, rel)
			}
		}
	}
	for _, rel := range present {
		path, ok := at(rel)
		if !ok {
			return false
		}
		if _, err := os.Lstat(path); !os.IsNotExist(err) {
			return false
		}
	}
	return len(present) > 0
}

// inRootfs is where a file the database names is in the rootfs.
func (s *apkState) inRootfs(rel string) (string, bool) {
	path, err := resolveInRoot(s.rootfs, "/"+rel)
	return path, err == nil
}

// apkSees is where a file the database names is as the step left it: in this
// bind's mirror when it is under the mirrored directory, else in the rootfs.
// Cleaning first keeps a ".." in the database from leading out of the mirror.
func (b *dirBind) apkSees(rel string) (string, bool) {
	if inside, ok := strings.CutPrefix(filepath.Clean("/"+rel), b.containerDir+"/"); ok {
		return filepath.Join(b.scratchDir, inside), true
	}
	return b.apk.inRootfs(rel)
}

// bundleRemoved reports whether the step removed a bundle's package and no
// package the step left installed records the bundle in its place.
func (b *dirBind) bundleRemoved(name string) bool {
	if !b.apk.packageRemoved(b.bundlePackage(name), b.apkSees) {
		return false
	}
	if b.apk.present {
		_, recorded := b.apk.afterDB().records[b.bundleRel(name)]
		return !recorded
	}
	return true
}

// bundlePackageRemoved reports whether the step removed the package of a
// bundle that matched apk's record before the step.
func (b *dirBind) bundlePackageRemoved() bool {
	for name := range b.apkRecorded {
		if b.bundleRemoved(name) {
			return true
		}
	}
	return false
}

// dropRemovedBundles takes out of the mirror each bundle whose package the
// step removed, where apk would have removed the bundle without the CA: apk
// removes a file under /etc only when it matches its record, which the CA
// kept it from doing. A bundle the step wrote, even with the same content, is
// not one apk left. current is the mirror as the step left it. It returns the
// directories that held the bundles it took out.
func (b *dirBind) dropRemovedBundles(current []fileEntry) ([]string, error) {
	var dropped []string
	for _, name := range b.bundleFiles {
		if !b.apkRecorded[name] {
			continue
		}
		now, _ := entryFor(current, name)
		injected, _ := entryFor(b.baseline, name)
		if !now.sameExceptMtime(injected) || !now.mtime.Equal(injected.mtime) {
			continue
		}
		before, _ := entryFor(b.original, name)
		sum, ok, err := regularFileSum(filepath.Join(b.scratchDir, name))
		if err != nil {
			return dropped, err
		}
		if !ok || sum != before.sha256 {
			continue
		}
		if !b.bundleRemoved(name) {
			continue
		}
		if err := removeFile(filepath.Join(b.scratchDir, name)); err != nil {
			return dropped, err
		}
		logf("removed /%s, as apk would have without the CA when it removed %s", b.bundleRel(name), b.bundlePackage(name))
		dropped = append(dropped, filepath.Dir(filepath.Join(b.containerDir, name)))
	}
	return dropped, nil
}

// removeEmptiedDirs removes dir and then each parent that is empty and that
// only packages the step removed listed, as apk removes a directory no
// installed package lists once it is empty. Run after the write-back, on the
// rootfs. A directory it cannot remove is left, as apk leaves one.
func (s *apkState) removeEmptiedDirs(dir string) {
	for rel := strings.TrimPrefix(dir, "/"); rel != "." && rel != ""; rel = filepath.Dir(rel) {
		owners := s.before.dirOwners[rel]
		if len(owners) == 0 || s.present && len(s.afterDB().dirOwners[rel]) > 0 {
			return
		}
		for _, pkg := range owners {
			if !s.packageRemoved(pkg, s.inRootfs) {
				return
			}
		}
		path, ok := s.inRootfs(rel)
		if !ok {
			return
		}
		entries, err := os.ReadDir(path)
		if err != nil || len(entries) > 0 {
			return
		}
		if err := removeFile(path); err != nil {
			logf("cannot remove the emptied /%s: %v", rel, err)
			return
		}
		logf("removed /%s, which apk would have removed once it was empty", rel)
	}
}

// removeFile is a var so a test can fail a removal a real filesystem allows.
var removeFile = os.Remove

// renameFile is a var so a test can fail a rename a real filesystem allows.
var renameFile = os.Rename

// promoteAPKNew moves each <bundle>.apk-new the step left over its bundle where
// apk would have replaced the bundle without the CA. apk keeps a bundle that
// differs from what it compares it with: on an upgrade, its record of the
// bundle, and on a reinstall of the same version, the package's file, which is
// what the .apk-new holds. So the .apk-new goes into place when the bundle,
// with the CA out, is as it was before the step and either matched apk's
// record or holds what the .apk-new holds. When the bundle already holds what
// the .apk-new holds, as when the step rebuilt the bundle after the upgrade,
// the .apk-new goes and the bundle stays, since apk writes no .apk-new for a
// file that matches the package's. A bundle the image or the step changed
// otherwise stays, as apk keeps it under any engine.
func (b *dirBind) promoteAPKNew() error {
	for _, name := range b.bundleFiles {
		apkNew := name + ".apk-new"
		if _, existed := entryFor(b.original, apkNew); existed {
			continue
		}
		before, existed := entryFor(b.original, name)
		if !existed || !before.mode.IsRegular() {
			continue
		}
		bundleSum, bundleOK, err := regularFileSum(filepath.Join(b.scratchDir, name))
		if err != nil {
			return err
		}
		apkNewSum, apkNewOK, err := regularFileSum(filepath.Join(b.scratchDir, apkNew))
		if err != nil {
			return err
		}
		if !bundleOK || !apkNewOK {
			continue
		}
		unchanged := bundleSum == before.sha256 && (b.apkRecorded[name] || apkNewSum == before.sha256)
		if !unchanged {
			if bundleSum == apkNewSum {
				if err := removeFile(filepath.Join(b.scratchDir, apkNew)); err != nil {
					return err
				}
				logf("removed %s, which holds what %s does, as apk writes none then", filepath.Join(b.containerDir, apkNew), filepath.Join(b.containerDir, name))
			}
			continue
		}
		if err := renameFile(filepath.Join(b.scratchDir, apkNew), filepath.Join(b.scratchDir, name)); err != nil {
			return err
		}
		logf("moved %s over %s, as apk would have without the CA", filepath.Join(b.containerDir, apkNew), filepath.Join(b.containerDir, name))
		if b.apkReplaced == nil {
			b.apkReplaced = map[string]bool{}
		}
		b.apkReplaced[name] = true
	}
	return nil
}

// regularFileSum is path's SHA-256, or false when path is missing or not a
// regular file.
func regularFileSum(path string) ([32]byte, bool, error) {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return [32]byte{}, false, nil
	}
	if err != nil {
		return [32]byte{}, false, err
	}
	if !info.Mode().IsRegular() {
		return [32]byte{}, false, nil
	}
	sum, err := hashFile(path)
	return sum, err == nil, err
}
