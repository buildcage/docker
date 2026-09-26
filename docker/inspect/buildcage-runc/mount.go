package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"
)

// scratchRoot is a var, not a const, so tests can point it at a temp
// directory instead of the real host path.
var scratchRoot = "/run/buildcage/ca"

const (
	// A real CA bundle directory is a few hundred KB across a handful of
	// files. These bound how far a Dockerfile-chosen custom path (an
	// already-set env var pointing somewhere of its own) can drag this
	// mechanism before injection is skipped for it instead of mirroring
	// something like an application directory wholesale.
	maxCustomDirBytes = 20 << 20
	maxCustomDirFiles = 512

	// Looser, since a distribution's store runs to a few hundred hash links.
	// Bounded at all because the image decides where it is: a store symlinked
	// to /usr/ca.crt makes it /usr.
	maxStoreDirBytes = 64 << 20
	maxStoreDirFiles = 4096
)

var errTooLargeToMirror = errors.New("too large to mirror")

// runRsync is the only place this file spawns a process, so tests can
// replace it to exercise the decision logic without rsync installed.
var runRsync = func(args []string) ([]byte, error) {
	return exec.Command("rsync", args...).CombinedOutput()
}

// writeMirrorFile is a var so a test can fail the pristine-keystore restore,
// which a real filesystem only does part-way through on an I/O error.
var writeMirrorFile = os.WriteFile

// dirBind mounts a scratch mirror of one directory over the step's view of
// it, so the CA can be added without ever opening the real rootfs file for
// writing. Grouped by directory rather than by file: two variables can
// resolve to different files in the same store directory, and mounting two
// separate sources over the same destination would let the second shadow
// the first.
type dirBind struct {
	rootfs       string // so finish can re-resolve containerDir
	hostDir      string
	containerDir string
	scratchDir   string
	bundleFiles  []string
	custom       bool
	keystore     bool   // bundleFiles are JVM keystores, not PEM bundles
	ca           []byte // kept so finish can find it again by content

	original []fileEntry // hostDir's state before mirroring
	baseline []fileEntry // scratchDir's state right after the CA was appended

	// keystoreOriginals holds each injected keystore's pre-injection bytes, keyed
	// by its path relative to scratchDir. The inject/strip round trip re-encodes
	// a keystore, so one the step never changed is restored from these instead.
	keystoreOriginals map[string][]byte
}

// groupTargetsByBind groups the CA targets by the directory whose mirror carries
// them, as names relative to that directory. A target under the store directory
// is folded into the store's group: the store bind already mirrors that whole
// directory, and a separate bind nested under the store mount would be shadowed
// by it, leaving the target without the CA.
func groupTargetsByBind(targets map[string]bool, store systemStore) map[string][]string {
	groups := make(map[string][]string)
	for target := range targets {
		if store.found && withinDir(target, store.dir()) {
			groups[store.dir()] = append(groups[store.dir()], strings.TrimPrefix(target, store.dir()+"/"))
			continue
		}
		dir := filepath.Dir(target)
		groups[dir] = append(groups[dir], filepath.Base(target))
	}
	return groups
}

// bindDirsInOrder prepares the store first, then the rest sorted, so which of
// two nesting directories wins the bind is fixed rather than left to map order.
// The store goes first so a nesting target never displaces it.
func bindDirsInOrder(groups map[string][]string, store systemStore) []string {
	dirs := make([]string, 0, len(groups))
	for dir := range groups {
		if store.found && dir == store.dir() {
			continue
		}
		dirs = append(dirs, dir)
	}
	slices.Sort(dirs)
	if store.found {
		if _, ok := groups[store.dir()]; ok {
			dirs = append([]string{store.dir()}, dirs...)
		}
	}
	return dirs
}

// withinDir reports whether path is dir or something under it.
func withinDir(path, dir string) bool {
	return path == dir || strings.HasPrefix(path, dir+"/")
}

func newScratchDir(bundle string) (string, error) {
	if err := os.MkdirAll(scratchRoot, 0o700); err != nil {
		return "", err
	}
	return os.MkdirTemp(scratchRoot, filepath.Base(bundle)+"-")
}

func mirrorDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	_, err := runRsync([]string{"-aHAX", "--numeric-ids", "--", src + "/", dst + "/"})
	return err
}

// writeBack mirrors scratchDir onto hostDir. The dry run is logged so a
// write-back is auditable after the fact; the real failure signal is the
// second rsync's own exit code; a partial transfer already makes rsync exit
// non-zero, so this doesn't also diff the two runs' output against each other.
func writeBack(scratchDir, hostDir string) error {
	args := []string{"-aHAX", "--checksum", "--delete", "--numeric-ids", "--no-specials", "--no-devices", "--itemize-changes"}
	src, dst := scratchDir+"/", hostDir+"/"

	planned, err := runRsync(slices.Concat(args, []string{"-n", "--", src, dst}))
	if err != nil {
		return fmt.Errorf("rsync dry run for %s: %w: %s", hostDir, err, planned)
	}
	logf("CA store write-back for %s:\n%s", hostDir, planned)

	if out, err := runRsync(slices.Concat(args, []string{"--", src, dst})); err != nil {
		return fmt.Errorf("rsync write-back to %s: %w: %s", hostDir, err, out)
	}
	return nil
}

type fileEntry struct {
	path      string
	mode      fs.FileMode
	uid, gid  uint32
	mtime     time.Time
	symlinkTo string
	sha256    [32]byte
}

// walkDir is a var so a test can hand the manifest an entry whose own metadata
// cannot be read, or a directory read that fails halfway. Both happen when a
// step deletes something between the listing and the stat of it, and neither is
// arrangeable from a fixture on a real filesystem.
var walkDir = filepath.WalkDir

func captureManifest(root string) ([]fileEntry, error) {
	var entries []fileEntry
	err := walkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || path == root {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		fe := fileEntry{path: rel, mode: info.Mode(), mtime: info.ModTime()}
		if st, ok := info.Sys().(*syscall.Stat_t); ok {
			fe.uid, fe.gid = st.Uid, st.Gid
		}
		switch {
		case info.Mode()&os.ModeSymlink != 0:
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			fe.symlinkTo = target
		case info.Mode().IsRegular():
			sum, err := hashFile(path)
			if err != nil {
				return err
			}
			fe.sha256 = sum
		}
		entries = append(entries, fe)
		return nil
	})
	if err != nil {
		return nil, err
	}
	slices.SortFunc(entries, func(a, b fileEntry) int { return strings.Compare(a.path, b.path) })
	return entries, nil
}

func hashFile(path string) ([32]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return [32]byte{}, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return [32]byte{}, err
	}
	var sum [32]byte
	copy(sum[:], h.Sum(nil))
	return sum, nil
}

// sameExceptMtime is what "unchanged" means to both callers below: everything
// a step could have altered, apart from the mtime. The append/strip round
// trip, and mirroring itself, move mtime on their own, so comparing it would
// report a change where none was made.
func (e fileEntry) sameExceptMtime(other fileEntry) bool {
	return e.path == other.path && e.mode == other.mode &&
		e.uid == other.uid && e.gid == other.gid &&
		e.symlinkTo == other.symlinkTo && e.sha256 == other.sha256
}

func manifestsEqual(a, b []fileEntry) bool {
	return slices.EqualFunc(a, b, fileEntry.sameExceptMtime)
}

// checkMirrorable fails when root holds more than maxFiles files or maxBytes
// bytes. It stops counting there, since root can be as large as the image
// makes it.
func checkMirrorable(root string, maxBytes int64, maxFiles int) error {
	var bytes int64
	files := 0
	err := walkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		files++
		bytes += info.Size()
		if bytes > maxBytes || files > maxFiles {
			return fmt.Errorf("%s is %w (more than %d bytes or %d files)", root, errTooLargeToMirror, maxBytes, maxFiles)
		}
		return nil
	})
	return err
}

// restoreUnchangedMtimes resets an untouched entry's mtime to what it was
// before mirroring. Without this, rsync's own mtime-preserving write-back
// would see a real difference (same content, different mtime) and copy the
// file up even though the step never touched it.
func restoreUnchangedMtimes(original, current []fileEntry, scratchDir string) error {
	byPath := make(map[string]fileEntry, len(original))
	for _, e := range original {
		byPath[e.path] = e
	}
	for _, c := range current {
		if c.mode&os.ModeSymlink != 0 {
			continue // no portable Lutimes in the standard library; harmless to skip
		}
		o, ok := byPath[c.path]
		if !ok || !o.sameExceptMtime(c) {
			continue
		}
		if err := os.Chtimes(filepath.Join(scratchDir, c.path), o.mtime, o.mtime); err != nil {
			return err
		}
	}
	return nil
}

func (b *dirBind) prepare(ca []byte) error {
	b.ca = ca
	// The store directory was checked against its own limits when it was found.
	if b.custom {
		if err := checkMirrorable(b.hostDir, maxCustomDirBytes, maxCustomDirFiles); err != nil {
			return err
		}
	}

	if err := mirrorDir(b.hostDir, b.scratchDir); err != nil {
		return fmt.Errorf("mirroring %s: %w", b.hostDir, err)
	}

	original, err := captureManifest(b.scratchDir)
	if err != nil {
		return err
	}
	b.original = original

	for _, name := range b.bundleFiles {
		target := filepath.Join(b.scratchDir, name)
		if b.keystore {
			// A keystore that cannot be injected into (an unusual format, or a
			// PKCS#12 under a password of its own) leaves the step's JVM not
			// trusting the CA rather than failing the build.
			original, err := insertIntoKeystore(target, ca)
			if err != nil {
				logf("cannot inject the CA into keystore %s: %v; leaving it untouched", name, err)
				continue
			}
			b.rememberKeystore(target, original)
			continue
		}
		if err := appendCA(target, ca); err != nil {
			if errors.Is(err, errNotRegular) {
				logf("cannot inject the CA into %s: %v; leaving it untouched", name, err)
				continue
			}
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

// finish diffs the scratch mirror against its post-injection baseline and
// only touches the real rootfs directory when the step actually changed it.
//
// The write-back is not atomic, so a failure leaves hostDir half-written.
// That is only safe because the error fails the step, and BuildKit then
// releases the mutable snapshot instead of committing it.
func (b *dirBind) finish() error {
	current, err := captureManifest(b.scratchDir)
	if err != nil {
		return err
	}
	if manifestsEqual(current, b.baseline) {
		return nil
	}

	// Before the sweep, so an untouched keystore restored to its pristine bytes
	// carries no CA for the sweep to strip and re-encode (or fail on).
	if err := b.restoreUntouchedKeystores(current); err != nil {
		return err
	}

	// The whole mirror, not only the files the CA was added to. With a store,
	// the step's writes land here rather than in the overlay's upper
	// directory, so a copy the step left beside the bundle is not in the layer
	// for stripLayer to find: it only gets there when the write-back below
	// copies it up.
	if _, err := sweepDir(b.scratchDir, b.scratchDir, b.ca, caMarksOf(b.ca)); tolerateResidue(err) != nil {
		return err
	}

	stripped, err := captureManifest(b.scratchDir)
	if err != nil {
		return err
	}
	if err := restoreUnchangedMtimes(b.original, stripped, b.scratchDir); err != nil {
		return err
	}

	// The step cannot remove the mounted directory, but it can rename an
	// ancestor and leave a symlink in its place, which must not redirect the
	// write-back.
	resolved, err := resolveInRoot(b.rootfs, b.containerDir)
	if err != nil {
		return fmt.Errorf("re-resolving the write-back target %s: %w", b.containerDir, err)
	}
	if resolved != b.hostDir {
		return fmt.Errorf("write-back target %s now resolves to %s, not %s", b.containerDir, resolved, b.hostDir)
	}
	if _, err := os.Stat(b.hostDir); err != nil {
		return fmt.Errorf("the step changed the CA store in %s and moved that directory away, leaving nowhere to write it back: %w", b.containerDir, err)
	}

	return writeBack(b.scratchDir, b.hostDir)
}

// coverKeystore adds the CA to a keystore at rel inside this bind's already-
// mirrored directory (a Debian JDK's cacerts symlinked into the CA store),
// rather than binding it separately, which the store mount would shadow. The
// baseline is re-captured so the gatekeeper counts the injection as part of the
// mirror's post-injection state; the sweep at finish takes the CA back out of
// this keystore the same as any other file the mirror carries.
func (b *dirBind) coverKeystore(rel string, ca []byte) {
	target := filepath.Join(b.scratchDir, rel)
	original, err := insertIntoKeystore(target, ca)
	if err != nil {
		logf("cannot inject the CA into keystore %s: %v; leaving it untouched", rel, err)
		return
	}
	b.rememberKeystore(target, original)
	baseline, err := captureManifest(b.scratchDir)
	if err != nil {
		logf("cannot re-capture the baseline after keystore injection in %s: %v", b.containerDir, err)
		return
	}
	b.baseline = baseline
}

// rememberKeystore records a keystore's pre-injection bytes, keyed the way the
// manifest names it, so restoreUntouchedKeystores can put them back.
func (b *dirBind) rememberKeystore(target string, original []byte) {
	rel, _ := filepath.Rel(b.scratchDir, target)
	if b.keystoreOriginals == nil {
		b.keystoreOriginals = map[string][]byte{}
	}
	b.keystoreOriginals[rel] = original
}

// restoreUntouchedKeystores restores the pristine bytes of every injected
// keystore the step left matching the post-injection baseline, so an unchanged
// keystore is committed as an unproxied build would have it rather than in the
// churned form the round trip produces. current is the mirror before the sweep;
// a keystore the step did change is left for the sweep to take the CA out of.
func (b *dirBind) restoreUntouchedKeystores(current []fileEntry) error {
	for rel, original := range b.keystoreOriginals {
		cur, ok := entryFor(current, rel)
		base, okBase := entryFor(b.baseline, rel)
		if !ok || !okBase || !cur.sameExceptMtime(base) {
			continue
		}
		if err := writeMirrorFile(filepath.Join(b.scratchDir, rel), original, base.mode.Perm()); err != nil {
			return err
		}
	}
	return nil
}

func entryFor(entries []fileEntry, rel string) (fileEntry, bool) {
	for _, e := range entries {
		if e.path == rel {
			return e, true
		}
	}
	return fileEntry{}, false
}

func (b *dirBind) cleanup() {
	removeScratchDir(b.scratchDir)
}

// removeScratchDir removes a mirror once the step is done with it. A failure
// leaves a directory behind on the builder, which is worth a log line but not
// worth failing a step that otherwise succeeded.
func removeScratchDir(dir string) {
	if err := os.RemoveAll(dir); err != nil {
		logf("cannot remove %s: %v", dir, err)
	}
}
