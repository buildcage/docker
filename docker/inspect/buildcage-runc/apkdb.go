package main

import (
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
// a FIFO.
func openGuarded(path string) (bundleFile, os.FileInfo, error) {
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

func readDatabase(path string) ([]byte, error) {
	f, info, err := openGuarded(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if info.Size() > maxCustomDirBytes {
		return nil, fmt.Errorf("%s: %w", path, errDatabaseTooLarge)
	}
	return io.ReadAll(io.NewSectionReader(f, 0, info.Size()))
}

// apkState is apk's database as it was before the step, shared by the bundle
// binds, and as the step left it, read once the first time it is needed.
type apkState struct {
	rootfs  string
	before  *apkDatabase
	bundles map[string]bool // every CA bundle, relative to the root
	// For each package a removal may need judging, the files it listed that
	// were there before the step, apart from the CA bundles.
	presentBefore map[string][]string

	afterRead bool
	after     *apkDatabase // nil when the step removed the database or it could not be read
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
	db, err := readDatabase(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logf("cannot read apk's database: %v; leaving any .apk-new beside a CA bundle", err)
		}
		return
	}
	state := &apkState{rootfs: rootfs, before: parseAPKDatabase(db), bundles: map[string]bool{}, presentBefore: map[string][]string{}}
	for _, b := range binds {
		if b.keystore || b.nssBase != "" {
			continue
		}
		b.apk = state
		for _, name := range b.bundleFiles {
			rel := strings.TrimPrefix(filepath.Join(b.containerDir, name), "/")
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
	// The bundles' packages, and those listing a directory a removal may empty.
	for _, b := range binds {
		for name := range b.apkRecorded {
			state.notePresent(state.before.records[strings.TrimPrefix(filepath.Join(b.containerDir, name), "/")].pkg)
		}
		if len(b.apkRecorded) == 0 {
			continue
		}
		for rel := strings.TrimPrefix(b.containerDir, "/"); rel != "." && rel != ""; rel = filepath.Dir(rel) {
			for _, pkg := range state.before.dirOwners[rel] {
				state.notePresent(pkg)
			}
		}
	}
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

// readAfter reads apk's database as the step left it.
func (s *apkState) readAfter() {
	if s.afterRead {
		return
	}
	s.afterRead = true
	path, err := resolveInRoot(s.rootfs, apkDBPath)
	if err == nil {
		var db []byte
		if db, err = readDatabase(path); err == nil {
			s.after = parseAPKDatabase(db)
			return
		}
	}
	if errors.Is(err, os.ErrNotExist) {
		s.removed = true
		return
	}
	logf("cannot read apk's database after the step: %v; leaving the CA bundles apk may have removed", err)
}

// packageRemoved reports whether the step removed pkg: it is gone from the
// database, or, when the step removed the database too, every file the
// package listed that was there before the step, apart from the CA bundles,
// is gone. A package with no such file cannot be told apart from one still
// installed, so it counts as kept. at gives where a file the database names
// is now, or false when that cannot be told.
func (s *apkState) packageRemoved(pkg string, at func(rel string) (string, bool)) bool {
	s.readAfter()
	if s.after != nil {
		_, installed := s.after.packages[pkg]
		return !installed
	}
	if !s.removed {
		return false
	}
	present := s.presentBefore[pkg]
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
func (b *dirBind) apkSees(rel string) (string, bool) {
	if inside, ok := strings.CutPrefix("/"+rel, b.containerDir+"/"); ok {
		return filepath.Join(b.scratchDir, inside), true
	}
	return b.apk.inRootfs(rel)
}

// bundlePackageRemoved reports whether the step removed the package of a
// bundle that matched apk's record before the step.
func (b *dirBind) bundlePackageRemoved() bool {
	for name := range b.apkRecorded {
		rel := strings.TrimPrefix(filepath.Join(b.containerDir, name), "/")
		if b.apk.packageRemoved(b.apk.before.records[rel].pkg, b.apkSees) {
			return true
		}
	}
	return false
}

// dropRemovedBundles takes out of the mirror each bundle whose package the
// step removed, where apk would have removed the bundle without the CA: apk
// removes a file under /etc only when it matches its record, which the CA
// kept it from doing. It reports whether it took any out.
func (b *dirBind) dropRemovedBundles() (bool, error) {
	dropped := false
	for _, name := range b.bundleFiles {
		if !b.apkRecorded[name] {
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
		rel := strings.TrimPrefix(filepath.Join(b.containerDir, name), "/")
		if !b.apk.packageRemoved(b.apk.before.records[rel].pkg, b.apkSees) {
			continue
		}
		if err := removeFile(filepath.Join(b.scratchDir, name)); err != nil {
			return dropped, err
		}
		logf("removed %s, as apk would have without the CA when it removed %s", "/"+rel, b.apk.before.records[rel].pkg)
		dropped = true
	}
	return dropped, nil
}

// removeEmptiedDirs removes dir and then each parent that is empty and that
// only packages the step removed listed, as apk removes a directory no
// installed package lists once it is empty. Run after the write-back, on the
// rootfs.
func (s *apkState) removeEmptiedDirs(dir string) error {
	for rel := strings.TrimPrefix(dir, "/"); rel != "." && rel != ""; rel = filepath.Dir(rel) {
		owners := s.before.dirOwners[rel]
		if len(owners) == 0 {
			return nil
		}
		for _, pkg := range owners {
			if !s.packageRemoved(pkg, s.inRootfs) {
				return nil
			}
		}
		path, ok := s.inRootfs(rel)
		if !ok {
			return nil
		}
		entries, err := os.ReadDir(path)
		if err != nil || len(entries) > 0 {
			return nil
		}
		if err := removeFile(path); err != nil {
			return err
		}
		logf("removed /%s, which apk would have removed once it was empty", rel)
	}
	return nil
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
// record or holds what the .apk-new holds. A bundle the image or the step
// changed stays, as apk keeps it under any engine.
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
		bundleSum, ok, err := regularFileSum(filepath.Join(b.scratchDir, name))
		if err != nil {
			return err
		}
		if !ok || bundleSum != before.sha256 {
			continue
		}
		apkNewSum, ok, err := regularFileSum(filepath.Join(b.scratchDir, apkNew))
		if err != nil {
			return err
		}
		if !ok || !b.apkRecorded[name] && apkNewSum != before.sha256 {
			continue
		}
		if err := renameFile(filepath.Join(b.scratchDir, apkNew), filepath.Join(b.scratchDir, name)); err != nil {
			return err
		}
		logf("moved %s over %s, as apk would have without the CA", filepath.Join(b.containerDir, apkNew), filepath.Join(b.containerDir, name))
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
