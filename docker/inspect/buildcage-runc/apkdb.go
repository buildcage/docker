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

// apkRecord is a file's Z: value in apk's database. truncatedSHA256 is set for
// a package whose record carries the S flag (f:S): its values are the first
// 20 bytes of a SHA-256 rather than a SHA-1, written the same way.
type apkRecord struct {
	value           string
	truncatedSHA256 bool
}

// parseAPKRecords maps each file the database records, relative to the root,
// to its Z: value. A file's record is the R: line under its F: directory and
// the Z: line after it, inside a package record that ends at a blank line.
func parseAPKRecords(db []byte) map[string]apkRecord {
	records := map[string]apkRecord{}
	var dir, file string
	truncated := false
	for line := range strings.SplitSeq(string(db), "\n") {
		switch {
		case line == "":
			dir, file, truncated = "", "", false
		case strings.HasPrefix(line, "f:"):
			truncated = strings.Contains(line[2:], "S")
		case strings.HasPrefix(line, "F:"):
			dir, file = line[2:], ""
		case strings.HasPrefix(line, "R:"):
			file = line[2:]
		case strings.HasPrefix(line, "Z:") && file != "":
			records[dir+"/"+file] = apkRecord{value: line[2:], truncatedSHA256: truncated}
			file = ""
		}
	}
	return records
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

// noteAPKRecords marks, in each bundle bind, the bundles whose content before
// the CA went in matches apk's record of them: the ones an upgrade would have
// replaced without the CA. Read before the step, which may change both.
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
	records := parseAPKRecords(db)
	for _, b := range binds {
		if b.keystore || b.nssBase != "" {
			continue
		}
		for _, name := range b.bundleFiles {
			record, ok := records[strings.TrimPrefix(filepath.Join(b.containerDir, name), "/")]
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
}

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
