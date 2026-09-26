package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestMain points the package's own log somewhere disposable for the whole
// run. logf writes to logFile and appends to ownLog, both package level, and
// the injection tests reach it without setting out to: six of them log while
// running. Left alone, a run with write access to /var/log appends those lines
// to the real builder log.
//
// Each test that reads the log back still takes a file of its own through
// useTempLog, since it counts the lines in it.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "buildcage-runc-test-")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	logFile = filepath.Join(dir, "runc.log")
	// Nor does an injection test find a real template on the machine running
	// it; the ones about the NSS database hand it one through useNSSTemplate.
	nssTemplateDir = filepath.Join(dir, "no-nssdb")
	// Whatever the machine running the tests has in its environment; a test
	// about the other setting takes it through useWarnOnCAResidue.
	failOnCAResidue = true
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

// skipIfRoot leaves out a test whose fixture is a permission bit. Root ignores
// those, so the failure the test is after never happens. CI runs as an ordinary
// user; this is for a developer who does not.
func skipIfRoot(t *testing.T) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("running as root: permission bits do not apply")
	}
}

// mustMakeReadOnly takes the write bit off a directory and puts it back
// afterwards, so t.TempDir can still clean up.
func mustMakeReadOnly(t *testing.T, dir string) {
	t.Helper()
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, info.Mode().Perm()) })
}

// brokenFile is a real bundle file with one operation made to fail. Embedding
// bundleFile means only the failing method has to be written out; everything
// else still happens for real, so the test observes what the code does with a
// half-finished file rather than with a stub.
type brokenFile struct {
	bundleFile
	failReadAt   int  // fail the nth ReadAt, counting from 1
	failWriteAt  int  // likewise for WriteAt
	failWrite    int  // likewise for WriteString
	failStat     bool // fail Stat outright
	failTruncate bool // likewise for Truncate
	notRegular   bool // succeed, but report something other than a regular file
	reads        int
	writes       int
	writeStrings int
}

var errBrokenFile = errors.New("simulated I/O failure")

func (b *brokenFile) ReadAt(p []byte, off int64) (int, error) {
	b.reads++
	if b.reads == b.failReadAt {
		return 0, errBrokenFile
	}
	return b.bundleFile.ReadAt(p, off)
}

func (b *brokenFile) WriteAt(p []byte, off int64) (int, error) {
	b.writes++
	if b.writes == b.failWriteAt {
		return 0, errBrokenFile
	}
	return b.bundleFile.WriteAt(p, off)
}

func (b *brokenFile) WriteString(str string) (int, error) {
	b.writeStrings++
	if b.writeStrings == b.failWrite {
		return 0, errBrokenFile
	}
	return b.bundleFile.WriteString(str)
}

func (b *brokenFile) Truncate(size int64) error {
	if b.failTruncate {
		return errBrokenFile
	}
	return b.bundleFile.Truncate(size)
}

func (b *brokenFile) Stat() (fs.FileInfo, error) {
	if b.failStat {
		return nil, errBrokenFile
	}
	info, err := b.bundleFile.Stat()
	if err != nil || !b.notRegular {
		return info, err
	}
	return notRegularInfo{info}, nil
}

// notRegularInfo is a real FileInfo reporting a mode appendCA and removeCA
// refuse, which on a real filesystem only a device file would have.
type notRegularInfo struct{ fs.FileInfo }

func (n notRegularInfo) Mode() fs.FileMode { return n.FileInfo.Mode() | fs.ModeDevice }

// useBrokenBundleFile makes the next bundle opened fail the way broken says.
// The file itself is opened for real, so the failure lands partway through
// whatever the caller was doing with it.
func useBrokenBundleFile(t *testing.T, broken *brokenFile) {
	t.Helper()
	old := openBundle
	openBundle = func(path string, flag int, perm os.FileMode) (bundleFile, error) {
		f, err := old(path, flag, perm)
		if err != nil {
			return nil, err
		}
		broken.bundleFile = f
		return broken, nil
	}
	t.Cleanup(func() { openBundle = old })
}

var errBrokenWalk = errors.New("simulated directory read failure")

// walkStep is one call a stubbed walk makes to the manifest's callback, in
// place of something it would have found on disk.
type walkStep struct {
	path string
	d    fs.DirEntry
	err  error
}

// useStubWalk makes the nth walk of dir hand the manifest these steps instead
// of reading the directory. Walks of anywhere else, and later walks of the same
// place, still run for real, so a test breaks only the one it means to.
func useStubWalk(t *testing.T, dir string, nth int, steps ...walkStep) {
	t.Helper()
	seen := 0
	old := walkDir
	walkDir = func(root string, fn fs.WalkDirFunc) error {
		if root != dir {
			return old(root, fn)
		}
		if seen++; seen != nth {
			return old(root, fn)
		}
		for _, step := range steps {
			if err := fn(step.path, step.d, step.err); err != nil {
				return err
			}
		}
		return nil
	}
	t.Cleanup(func() { walkDir = old })
}

// failWalkOn makes the nth walk of dir fail before it reports anything.
func failWalkOn(t *testing.T, dir string, nth int) {
	t.Helper()
	useStubWalk(t, dir, nth, walkStep{path: dir, err: errBrokenWalk})
}

// unreadableEntry is a directory entry whose own metadata cannot be read,
// which is what a listing returns for a file deleted since it was made.
type unreadableEntry struct{ fs.DirEntry }

func (unreadableEntry) Info() (fs.FileInfo, error) { return nil, errBrokenWalk }

// realEntry reads a directory entry the operating system actually made, so a
// stubbed walk can hand out one whose Info is genuine while pointing the
// callback at a different path.
func realEntry(t *testing.T, dir, name string) fs.DirEntry {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() == name {
			return e
		}
	}
	t.Fatalf("no entry named %s in %s", name, dir)
	return nil
}

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

func mustWriteFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// mustAppendFile stands in for whatever writes to a file the wrapper already
// owns: a step adding its own certificates, or a neighbouring step's line
// landing in the shared log.
func mustAppendFile(t *testing.T, path, content string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(content); err != nil {
		t.Fatal(err)
	}
}

// mustSparseFile makes a file that reports size bytes without writing them;
// sizeAndCount reads the reported size, which is what the limits bound.
func mustSparseFile(t *testing.T, path string, size int64) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := f.Truncate(size); err != nil {
		t.Fatal(err)
	}
}

func mustSymlink(t *testing.T, target, link string) {
	t.Helper()
	_ = os.Remove(link)
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
}

func mustStatMtime(t *testing.T, path string) time.Time {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.ModTime()
}

// useFakeRsync makes dirBind's filesystem operations hermetic: a fake copy
// instead of a real rsync process, and a scratch root under the test's own
// temp directory instead of the real host path (which a test process
// usually can't create or write to). The one test that needs the real
// rsync binary and the real scratch root lives in mount_rsync_smoke_test.go.
func useFakeRsync(t *testing.T) {
	t.Helper()
	oldRsync, oldScratchRoot := runRsync, scratchRoot
	runRsync = fakeRsyncCopy
	scratchRoot = t.TempDir()
	t.Cleanup(func() {
		runRsync = oldRsync
		scratchRoot = oldScratchRoot
	})
}

// fakeRsyncCopy stands in for `rsync -a[HAX] [--checksum] [--delete] ... src/ dst/`:
// it only looks at the last two arguments and replaces dst wholesale with
// src's tree, which is close enough to mirror/writeBack's actual usage for
// unit tests to observe the resulting on-disk state.
func fakeRsyncCopy(args []string) ([]byte, error) {
	if len(args) < 2 {
		return nil, fmt.Errorf("not enough args: %v", args)
	}
	src := strings.TrimSuffix(args[len(args)-2], "/")
	dst := strings.TrimSuffix(args[len(args)-1], "/")
	if err := os.RemoveAll(dst); err != nil {
		return nil, err
	}
	return nil, copyTree(src, dst)
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(target, 0o755)
		case info.Mode()&os.ModeSymlink != 0:
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			return os.Symlink(link, target)
		default:
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			return os.WriteFile(target, data, info.Mode())
		}
	})
}

// countRsync counts from the call it is installed on, leaving out a bind's
// own mirroring during prepare.
func countRsync(t *testing.T) *int {
	t.Helper()
	var calls int
	orig := runRsync
	runRsync = func(args []string) ([]byte, error) {
		calls++
		return orig(args)
	}
	t.Cleanup(func() { runRsync = orig })
	return &calls
}

// failRsyncOn makes the nth rsync call from here fail, so a test can pick
// which half of a write-back breaks. Every other call still runs.
func failRsyncOn(t *testing.T, n int) {
	t.Helper()
	calls := 0
	orig := runRsync
	runRsync = func(args []string) ([]byte, error) {
		calls++
		if calls == n {
			return []byte("boom"), fmt.Errorf("simulated rsync failure")
		}
		return orig(args)
	}
	t.Cleanup(func() { runRsync = orig })
}

// useFakeRunc puts a shell script where run looks for buildkit-runc, so a test
// can choose what the wrapped process does and what it exits with. The script
// is handed runc's own arguments and is free to ignore them.
func useFakeRunc(t *testing.T, script string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "runc")
	mustWriteFile(t, path, "#!/bin/sh\n"+script+"\n")
	if err := os.Chmod(path, 0o755); err != nil {
		t.Fatal(err)
	}
	old := realRunc
	realRunc = path
	t.Cleanup(func() { realRunc = old })
}

// useTempCAFile gives setupInjection a CA to find, so a test can reach the
// injection half of run.
func useTempCAFile(t *testing.T, ca string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ca.pem")
	mustWriteFile(t, path, ca)
	old := caFile
	caFile = path
	t.Cleanup(func() { caFile = old })
}

// captureStderr redirects os.Stderr, which is both what dumpOwnLog writes to
// and what run hands the wrapped process. The returned function restores it
// and reads back what was written.
func captureStderr(t *testing.T) func() string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	old := os.Stderr
	os.Stderr = w
	t.Cleanup(func() { os.Stderr = old })
	return func() string {
		os.Stderr = old
		w.Close()
		out, _ := io.ReadAll(r)
		r.Close()
		return string(out)
	}
}
