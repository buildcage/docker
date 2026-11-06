package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// apk records a SHA-1 of each file it installs, and an upgrade keeps a file
// under /etc that no longer matches its record, writing the new version beside
// it as <file>.apk-new. A bundle carrying the CA never matches, so while the
// step runs the database records each such bundle with the CA in it, and apk
// replaces the bundle whenever it would have without the CA.
const apkDBPath = "/lib/apk/db/installed"

// apkChecksum is one file's record that the mirrored database carries with the
// CA in it: the Z: value it had and the one it has for the step.
type apkChecksum struct {
	path               string // relative to the root, as the database names it
	original, injected string
}

// apkChecksumOf is the Z: value apk writes for content: "Q1" and the SHA-1 in
// base64.
func apkChecksumOf(content []byte) string {
	sum := sha1.Sum(content)
	return "Q1" + base64.StdEncoding.EncodeToString(sum[:])
}

// apkChecksumOfFile is apkChecksumOf for a file, read in pieces since a bundle
// is as large as the image made it.
func apkChecksumOfFile(path string) (string, error) {
	f, info, err := openGuarded(path, os.O_RDONLY)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha1.New()
	if _, err := io.Copy(h, io.NewSectionReader(f, 0, info.Size())); err != nil {
		return "", err
	}
	return "Q1" + base64.StdEncoding.EncodeToString(h.Sum(nil)), nil
}

// rewriteAPKChecksums replaces the Z: value of each file named in swap whose
// value is swap's key, and reports whether it replaced any. A file's record is
// the R: line under its F: directory and the Z: line after it.
func rewriteAPKChecksums(db []byte, swap map[string]map[string]string) ([]byte, bool) {
	lines := bytes.SplitAfter(db, []byte("\n"))
	var dir, file string
	changed := false
	for i, line := range lines {
		text := strings.TrimSuffix(string(line), "\n")
		switch {
		case text == "":
			dir, file = "", ""
		case strings.HasPrefix(text, "F:"):
			dir, file = text[2:], ""
		case strings.HasPrefix(text, "R:"):
			file = text[2:]
		case strings.HasPrefix(text, "Z:") && file != "":
			if to, ok := swap[dir+"/"+file][text[2:]]; ok {
				lines[i] = []byte("Z:" + to + strings.TrimPrefix(string(line), text))
				changed = true
			}
			file = ""
		}
	}
	return bytes.Join(lines, nil), changed
}

// openGuarded opens path without following a symlink or blocking on a FIFO the
// step may have left there.
func openGuarded(path string, flag int) (bundleFile, fs.FileInfo, error) {
	f, err := openBundle(path, flag|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
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

// errDatabaseTooLarge keeps a database the step grew from being read into
// memory whole. A real one is a few MiB at most.
var errDatabaseTooLarge = errors.New("larger than " + fmt.Sprint(maxCustomDirBytes>>20) + " MiB")

// readDatabase reads apk's database, opened the guarded way.
func readDatabase(path string) ([]byte, error) {
	f, info, err := openGuarded(path, os.O_RDONLY)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if info.Size() > maxCustomDirBytes {
		return nil, fmt.Errorf("%s: %w", path, errDatabaseTooLarge)
	}
	return io.ReadAll(io.NewSectionReader(f, 0, info.Size()))
}

// writeDatabase replaces the database's content, opened the guarded way,
// keeping its mode, owner and mtime: the write-back tells what apk rewrote by
// the mtime, and swapping a record is not apk rewriting the file.
func writeDatabase(path string, content []byte) error {
	f, info, err := openGuarded(path, os.O_RDWR)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := f.Truncate(0); err != nil {
		return err
	}
	if _, err := f.WriteAt(content, 0); err != nil {
		return err
	}
	return changeTimes(path, info.ModTime(), info.ModTime())
}

// changeTimes is a var so a test can fail it, which a file this process just
// wrote never does.
var changeTimes = os.Chtimes

// apkChecksumsFor lists the bundles in binds whose content before the CA went
// in matches apk's record of them, with the record each has once the CA is in.
// A bundle the image already changed keeps its record, so apk leaves it alone
// as it would without the CA.
func apkChecksumsFor(db []byte, binds []*dirBind) ([]apkChecksum, error) {
	var sums []apkChecksum
	for _, b := range binds {
		if b.keystore || b.nssBase != "" {
			continue
		}
		for _, name := range b.bundleFiles {
			original, err := apkChecksumOfFile(filepath.Join(b.hostDir, name))
			if err != nil {
				// No bundle before the step means no record to match.
				if os.IsNotExist(err) {
					continue
				}
				return nil, err
			}
			injected, err := apkChecksumOfFile(filepath.Join(b.scratchDir, name))
			if err != nil {
				return nil, err
			}
			sum := apkChecksum{
				path:     strings.TrimPrefix(filepath.Join(b.containerDir, name), "/"),
				original: original,
				injected: injected,
			}
			if _, found := rewriteAPKChecksums(db, sum.swap()); found {
				sums = append(sums, sum)
			}
		}
	}
	return sums, nil
}

func (c apkChecksum) swap() map[string]map[string]string {
	return map[string]map[string]string{c.path: {c.original: c.injected}}
}

func (c apkChecksum) unswap() map[string]map[string]string {
	return map[string]map[string]string{c.path: {c.injected: c.original}}
}

// apkRecords is apk's database as the injection left it: the records it set
// to the bundles with the CA in them, to set back once the step has exited.
type apkRecords struct {
	rootfs string
	sums   []apkChecksum
}

// placeAPKRecords sets apk's record of each bundle in binds to the bundle with
// the CA in it, or returns nil, having logged why, when there is nothing to
// set. The database is changed where it is rather than mirrored: a mount point
// at its directory would make removing apk's files fail. Its mtime is kept, and
// restore puts the content back, so a step that leaves the database alone
// commits no copy of it.
func placeAPKRecords(s *spec, binds []*dirBind) (*apkRecords, error) {
	path, err := resolveInRoot(s.rootfs, apkDBPath)
	if err != nil {
		logf("cannot resolve %s: %v; leaving apk's records alone", apkDBPath, err)
		return nil, nil
	}
	db, err := readDatabase(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logf("cannot read apk's database: %v; leaving it alone", err)
		}
		return nil, nil
	}
	sums, err := apkChecksumsFor(db, binds)
	if err != nil {
		logf("cannot compare the CA bundles with apk's records: %v; leaving them alone", err)
		return nil, nil
	}
	if len(sums) == 0 {
		return nil, nil
	}
	if containerPath := containerPathOf(s.rootfs, path); s.mountConflicts(containerPath) {
		logf("a mount already covers %s; leaving apk's records alone", containerPath)
		return nil, nil
	}
	r := &apkRecords{rootfs: s.rootfs, sums: sums}
	rewritten, _ := rewriteAPKChecksums(db, r.swap(apkChecksum.swap))
	if err := writeDatabase(path, rewritten); err != nil {
		// The write may have stopped partway, so the step does not run on it.
		return nil, fmt.Errorf("setting apk's records of the CA bundles: %w", err)
	}
	logf("set apk's records of %d CA bundle(s) to the bundle with the CA in it", len(sums))
	return r, nil
}

func (r *apkRecords) swap(of func(apkChecksum) map[string]map[string]string) map[string]map[string]string {
	swap := map[string]map[string]string{}
	for _, sum := range r.sums {
		maps.Copy(swap, of(sum))
	}
	return swap
}

// restore sets back each record apk did not replace, so the layer holds what
// apk would have written without the CA.
func (r *apkRecords) restore() error {
	path, err := resolveInRoot(r.rootfs, apkDBPath)
	if err != nil {
		return fmt.Errorf("re-resolving %s: %w", apkDBPath, err)
	}
	db, err := readDatabase(path)
	if err != nil {
		// The step removed the database; there is no record left to set back.
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	rewritten, changed := rewriteAPKChecksums(db, r.swap(apkChecksum.unswap))
	if !changed {
		return nil
	}
	return writeDatabase(path, rewritten)
}

// removeFile is a var so a test can fail the removal of a file the step could
// otherwise always remove.
var removeFile = os.Remove

// dropRedundantAPKNew removes each <bundle>.apk-new the step left that holds
// what the bundle holds once the CA is out. apk writes one on a reinstall,
// which compares the bundle with the package rather than with its record, and
// without the CA it would have rewritten the bundle with that same content.
func (b *dirBind) dropRedundantAPKNew() error {
	for _, name := range b.bundleFiles {
		apkNew := name + ".apk-new"
		if _, existed := entryFor(b.original, apkNew); existed {
			continue
		}
		same, err := sameRegularContent(filepath.Join(b.scratchDir, name), filepath.Join(b.scratchDir, apkNew))
		if err != nil {
			return err
		}
		if !same {
			continue
		}
		if err := removeFile(filepath.Join(b.scratchDir, apkNew)); err != nil {
			return err
		}
		logf("removed %s, which holds what %s does without the CA", filepath.Join(b.containerDir, apkNew), filepath.Join(b.containerDir, name))
	}
	return nil
}

// sameRegularContent reports whether both paths are regular files with the same
// content. Either missing, or not a regular file, is not the same.
func sameRegularContent(a, b string) (bool, error) {
	for _, path := range []string{a, b} {
		info, err := os.Lstat(path)
		if os.IsNotExist(err) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if !info.Mode().IsRegular() {
			return false, nil
		}
	}
	sumA, err := hashFile(a)
	if err != nil {
		return false, err
	}
	sumB, err := hashFile(b)
	if err != nil {
		return false, err
	}
	return sumA == sumB, nil
}
