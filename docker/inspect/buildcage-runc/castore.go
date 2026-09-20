package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
)

// What the removal looks for: the certificate's own PEM block. It is generated
// per build, so any copy of it in a bundle is one this wrapper put there,
// whatever rewrote the bundle in between.
var (
	beginCertificate = []byte("-----BEGIN CERTIFICATE-----")
	endCertificate   = []byte("-----END CERTIFICATE-----")
)

// How much of a bundle removeCA holds at once. The store directory is a bind
// mount of the scratch mirror while the step runs, so the file is whatever
// size the step left it at, not what the image shipped.
const scanChunk = 64 << 10

// Longest PEM block removeCA reads in to compare. A certificate is a few KB,
// so anything past this is something else and is skipped rather than held in
// memory.
const maxCertificateBytes = 64 << 10

// Where the system CA bundle is looked for, and where one is written when the
// image has none. The first five are buildkit's own executor.InjectProxyCA
// order; the last is OpenSSL's default on RHEL, where OPENSSLDIR is
// /etc/pki/tls, which that list leaves out.
var systemCertFiles = []string{
	"/etc/ssl/certs/ca-certificates.crt",
	"/etc/pki/tls/certs/ca-bundle.crt",
	"/etc/ssl/ca-bundle.pem",
	"/etc/pki/tls/cacert.pem",
	"/etc/ssl/cert.pem",
	"/etc/pki/tls/cert.pem",
}

var (
	errEscapesRoot     = errors.New("path escapes the rootfs")
	errTooManySymlinks = errors.New("too many symlinks")
)

// errNotRegular means appendCA/removeCA found something other than a plain
// file at the target. The wrapper runs unsandboxed on the host, so opening
// whatever a step swapped the path for (a symlink, a FIFO) would follow
// attacker-controlled input outside the directory it's meant to stay in.
var errNotRegular = errors.New("not a regular file")

// errNotACertificate means what appendCA was handed holds no PEM certificate.
// Removal matches on the certificate itself, so anything else would go in with
// no way back out.
var errNotACertificate = errors.New("not a certificate")

// resolveInRoot resolves path as the container would see it, so a symlink
// cannot be used to reach outside.
//
// The wrapper runs as root on the host while the rootfs comes from an image
// the build chose, so a link placed at one of the paths below would otherwise
// direct an append onto a host file. Absolute links are therefore followed
// from the rootfs rather than from the host's own root, and the result is
// checked to be inside it either way.
func resolveInRoot(rootfs, path string) (string, error) {
	rootfs, err := filepath.Abs(rootfs)
	// Untested by design: Abs only fails when Getwd does, which needs the
	// process's own working directory to have been removed.
	//coverage:ignore start
	if err != nil {
		return "", err
	}
	//coverage:ignore stop
	current := rootfs
	remaining := strings.Split(strings.TrimPrefix(filepath.Clean(path), "/"), "/")

	for hops := 0; len(remaining) > 0; {
		name := remaining[0]
		remaining = remaining[1:]
		if name == "" || name == "." {
			continue
		}
		next := filepath.Join(current, name)
		if !withinRoot(rootfs, next) {
			// ".." climbing above the rootfs lands here.
			return "", errEscapesRoot
		}

		info, err := os.Lstat(next)
		if err != nil {
			if os.IsNotExist(err) {
				// A component that is not there cannot be a symlink, so the
				// rest of the path resolves to itself. Whole directories can
				// be missing: a store path names several of them in an image
				// carrying none.
				current = next
				continue
			}
			return "", err
		}
		if info.Mode()&os.ModeSymlink == 0 {
			current = next
			continue
		}

		hops++
		if hops > 32 {
			return "", errTooManySymlinks
		}
		target, err := os.Readlink(next)
		// Untested by design: Lstat has already said this is a symlink, so getting
		// here means the step swapped it in between. Reading it back is what the
		// check is for, and failing to is the same refusal.
		//coverage:ignore start
		if err != nil {
			return "", err
		}
		//coverage:ignore stop
		if filepath.IsAbs(target) {
			// Absolute inside the container means absolute inside the rootfs.
			current = rootfs
		}
		remaining = append(strings.Split(strings.TrimPrefix(filepath.Clean(target), "/"), "/"), remaining...)
	}
	// Untested by design: current is only ever assigned a path the loop has
	// already put through withinRoot, or the rootfs itself. Kept so the
	// confinement is a property of this function rather than of its loop.
	//coverage:ignore start
	if !withinRoot(rootfs, current) {
		return "", errEscapesRoot
	}
	//coverage:ignore stop
	return current, nil
}

func withinRoot(rootfs, path string) bool {
	return path == rootfs || strings.HasPrefix(path, rootfs+string(os.PathSeparator))
}

// asNotRegular folds the open() failures O_NOFOLLOW/O_NONBLOCK produce for a
// symlink or an unread FIFO into errNotRegular, so callers don't need to
// distinguish rejection at open() from rejection after Stat.
func asNotRegular(path string, err error) error {
	if errors.Is(err, syscall.ELOOP) || errors.Is(err, syscall.ENXIO) {
		return fmt.Errorf("%s: %w", path, errNotRegular)
	}
	return err
}

// bundleFile is the part of *os.File that adding and stripping the CA goes
// through. It is an interface so a test can stand in for it and fail one
// read or write partway, which no fixture on a real filesystem can arrange.
type bundleFile interface {
	io.ReaderAt
	io.WriterAt
	Stat() (fs.FileInfo, error)
	Truncate(size int64) error
	WriteString(s string) (int, error)
	Close() error
}

// openBundle is a var for the same reason.
var openBundle = func(path string, flag int, perm os.FileMode) (bundleFile, error) {
	f, err := os.OpenFile(path, flag, perm)
	if err != nil {
		// Returning f here would hand back a non-nil interface holding a nil
		// *os.File, which every caller's err check would then walk straight past.
		return nil, err
	}
	return f, nil
}

// appendCA adds the certificate to path, creating it when missing.
//
// O_NOFOLLOW/O_NONBLOCK keep the open from following a symlink or blocking on
// a FIFO the step may have left at path since injection.
func appendCA(path string, ca []byte) error {
	if len(certificateBodies(ca)) == 0 {
		return fmt.Errorf("%s: %w", path, errNotACertificate)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := openBundle(path, os.O_CREATE|os.O_RDWR|os.O_APPEND|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0o644)
	if err != nil {
		return asNotRegular(path, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s: %w", path, errNotRegular)
	}
	// A bundle that does not end in one needs a line break first, or the
	// opening line lands on the end of the last one and no reader sees a
	// certificate there. Removal takes back the line break that closes the
	// block, not this one, so an unterminated bundle keeps the one it gained.
	if info.Size() > 0 {
		nl, err := isNewlineAt(f, info.Size()-1)
		if err != nil {
			return err
		}
		if !nl {
			if _, err := f.WriteString("\n"); err != nil {
				return err
			}
		}
	}
	_, err = f.WriteString(strings.TrimRight(string(ca), "\n") + "\n")
	return err
}

// strippedBody is a PEM body with every space and line break taken out, so the
// same certificate matches however the tool that last wrote it wrapped the
// base64.
func strippedBody(body []byte) string {
	return string(bytes.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '\r' || r == '\n' {
			return -1
		}
		return r
	}, body))
}

// certificateBodies indexes every certificate in pem by its stripped body.
func certificateBodies(pem []byte) map[string]bool {
	bodies := map[string]bool{}
	for rest := pem; ; {
		begin := bytes.Index(rest, beginCertificate)
		if begin == -1 {
			return bodies
		}
		rest = rest[begin+len(beginCertificate):]
		end := bytes.Index(rest, endCertificate)
		if end == -1 {
			return bodies
		}
		bodies[strippedBody(rest[:end])] = true
		rest = rest[end+len(endCertificate):]
	}
}

// span is a half-open byte range of the bundle, one certificate to cut out.
type span struct{ start, end int64 }

// removeCA deletes every copy of the certificate, leaving anything else in
// place.
//
// Returns without error when there is none, since the step may have rewritten
// the file itself. The find and the strip share one handle, opened the same
// guarded way as appendCA, so they can't land on different files.
func removeCA(path string, ca []byte) error {
	bodies := certificateBodies(ca)
	if len(bodies) == 0 {
		return nil
	}

	f, err := openBundle(path, os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return asNotRegular(path, err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s: %w", path, errNotRegular)
	}

	size := info.Size()
	cuts, err := findCertificates(f, bodies, size)
	if err != nil || len(cuts) == 0 {
		return err
	}
	kept, err := closeGaps(f, cuts, size)
	if err != nil {
		return err
	}
	return f.Truncate(kept)
}

// findCertificates returns, in order, the range each copy of the certificate
// occupies, including the line break that closes it.
func findCertificates(f bundleFile, bodies map[string]bool, size int64) ([]span, error) {
	var cuts []span
	for off := int64(0); off < size; {
		begin, err := findInFile(f, beginCertificate, off, size)
		if err != nil {
			return nil, err
		}
		if begin == -1 {
			return cuts, nil
		}
		end, err := findInFile(f, endCertificate, begin, size)
		if err != nil {
			return nil, err
		}
		// A block the step truncated mid-certificate has no end to cut to.
		if end == -1 {
			return cuts, nil
		}
		end += int64(len(endCertificate))
		// A candidate that is not it resumes after its own opening line: one
		// the step left without an end pairs with the next certificate's
		// closing line, and resuming past that would skip that certificate.
		off = begin + int64(len(beginCertificate))

		if end-begin > maxCertificateBytes {
			continue
		}
		block := make([]byte, end-begin)
		if _, err := f.ReadAt(block, begin); err != nil && err != io.EOF {
			return nil, err
		}
		body := block[len(beginCertificate) : len(block)-len(endCertificate)]
		if !bodies[strippedBody(body)] {
			continue
		}
		off = end
		if end < size {
			nl, err := isNewlineAt(f, end)
			if err != nil {
				return nil, err
			}
			if nl {
				end++
				off = end
			}
		}
		cuts = append(cuts, span{begin, end})
	}
	return cuts, nil
}

// findInFile returns the offset of needle at or after from, or -1. Each read
// carries len(needle)-1 bytes over, so a line on a chunk boundary still
// matches.
func findInFile(f io.ReaderAt, needle []byte, from, size int64) (int64, error) {
	buf := make([]byte, scanChunk+len(needle)-1)
	for off := from; off < size; {
		n, err := f.ReadAt(buf, off)
		if err != nil && err != io.EOF {
			return -1, err
		}
		if n < len(needle) {
			return -1, nil
		}
		if i := bytes.Index(buf[:n], needle); i != -1 {
			return off + int64(i), nil
		}
		off += int64(n - len(needle) + 1)
	}
	return -1, nil
}

func isNewlineAt(f io.ReaderAt, off int64) (bool, error) {
	var b [1]byte
	if _, err := f.ReadAt(b[:], off); err != nil {
		return false, err
	}
	return b[0] == '\n', nil
}

// closeGaps moves what the cuts left behind down over them, returning the size
// the caller then truncates to. Each run is copied over the gap the cuts before
// it opened, so the destination always trails the source and copying forwards
// never overwrites bytes still to be read.
func closeGaps(f bundleFile, cuts []span, size int64) (int64, error) {
	buf := make([]byte, scanChunk)
	var dst, src int64
	for _, cut := range cuts {
		moved, err := shiftDown(f, buf, src, cut.start, dst)
		dst += moved
		if err != nil {
			return 0, err
		}
		src = cut.end
	}
	moved, err := shiftDown(f, buf, src, size, dst)
	return dst + moved, err
}

// shiftDown copies from..to down to dst, returning how much it moved. The run
// before the first cut is already where it belongs and is left alone.
func shiftDown(f bundleFile, buf []byte, from, to, dst int64) (int64, error) {
	if dst == from {
		return to - from, nil
	}
	var moved int64
	for from < to {
		window := buf
		if left := to - from; left < int64(len(window)) {
			window = window[:left]
		}
		// The window is cut to what is left, so a short read means the file
		// changed under the wrapper rather than a run ending.
		n, err := f.ReadAt(window, from)
		if n > 0 {
			if _, werr := f.WriteAt(window[:n], dst); werr != nil {
				return moved, werr
			}
			from += int64(n)
			dst += int64(n)
			moved += int64(n)
		}
		if err != nil {
			return moved, err
		}
	}
	return moved, nil
}

// stripCADir takes the certificate back out of everything in dir, not only the
// file it was written to. A step that reruns the distribution's own
// ca-certificates tooling rebuilds the bundle from the anchors and leaves a
// copy of each one beside it, under a name this wrapper never chose.
//
// What the strip leaves empty held nothing but the certificate, so it goes
// too, and its path joins removed for dropLinksTo to work from.
func stripCADir(dir string, ca []byte, removed map[string]bool) error {
	return walkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// The step is free to have taken the directory away.
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if !d.Type().IsRegular() {
			return nil
		}
		gone, err := stripCAFile(path, ca)
		if err != nil {
			return err
		}
		if gone {
			removed[path] = true
		}
		return nil
	})
}

// stripCAFile takes the certificate out of one file, and says whether that
// left nothing for the file to hold.
func stripCAFile(path string, ca []byte) (bool, error) {
	if err := removeCA(path, ca); err != nil {
		// Swapped for something else since the listing: not the wrapper's to
		// open, and the step's to keep.
		if errors.Is(err, errNotRegular) {
			logf("cannot take the CA back out of %s: %v", path, err)
			return false, nil
		}
		return false, err
	}
	info, err := os.Stat(path)
	if err != nil || info.Size() > 0 {
		return false, nil
	}
	return true, os.Remove(path)
}

// dropLinksTo removes the links in dir left pointing at something the undo has
// taken away. update-ca-certificates leaves two per anchor, one named after
// the file and one after its hash, and the second points at the first, so this
// runs until a pass finds nothing.
//
// Only a link to a path the undo removed goes: a link the image shipped broken
// is the image's own.
func dropLinksTo(rootfs, dir string, removed map[string]bool) error {
	for changed := true; changed; {
		changed = false
		err := walkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				if os.IsNotExist(err) {
					return nil
				}
				return err
			}
			if d.Type()&os.ModeSymlink == 0 {
				return nil
			}
			// A link that went away between the listing and this reads as
			// empty, which matches nothing removed and is left alone.
			target, _ := os.Readlink(path)
			resolved := filepath.Join(dir, target)
			if filepath.IsAbs(target) {
				// Absolute inside the container means absolute inside the rootfs.
				resolved = filepath.Join(rootfs, target)
			}
			if !removed[resolved] {
				return nil
			}
			if err := os.Remove(path); err != nil {
				return err
			}
			removed[path] = true
			changed = true
			return nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// containerPathOf converts a path already resolved inside rootfs back to how
// the container itself sees it. The mount destination for a dirBind has to be
// this, not the candidate path's own directory: on RHEL the candidate is a
// symlink (/etc/pki/tls/certs/ca-bundle.crt) whose real file lives elsewhere
// (/etc/pki/ca-trust/extracted/pem/), and binding over the symlink's
// directory would shadow the wrong place.
func containerPathOf(rootfs, resolved string) string {
	if !withinRoot(rootfs, resolved) {
		return "/"
	}
	if rel := strings.TrimPrefix(resolved, rootfs); rel != "" {
		return rel
	}
	return "/"
}

// systemStore is the bundle the step's tools read by default: where the
// wrapper reaches it from the host, and the path the container refers to it
// by. shipped separates one the image already had, which has to be mirrored
// and appended to, from one this wrapper wrote, which holds the certificate
// and nothing else.
type systemStore struct {
	hostPath      string
	containerPath string
	shipped       bool
}

// available says whether there is a store for a variable to be pointed at.
func (s systemStore) available() bool {
	return s.containerPath != ""
}

// dir is the directory a dirBind mirrors to reach the store.
func (s systemStore) dir() string {
	return filepath.Dir(s.hostPath)
}

func findSystemStore(rootfs string) (systemStore, error) {
	for _, candidate := range systemCertFiles {
		resolved, err := resolveInRoot(rootfs, candidate)
		if err != nil {
			continue
		}
		if _, err := os.Stat(resolved); err == nil {
			return systemStore{hostPath: resolved, containerPath: candidate, shipped: true}, nil
		}
	}
	return systemStore{}, errors.New("no CA bundle found in the rootfs")
}

// Where the distributions' own ca-certificates tooling takes extra trusted
// certificates from. One left in an anchor directory is picked up whenever the
// step rebuilds the bundle, which is what keeps an `apt-get install
// ca-certificates` halfway through a step from undoing the injection for
// everything after it. On RHEL it is the primary route: p11-kit reads the
// directory itself, so GnuTLS trusts the certificate with no bundle involved.
var anchorDirs = []string{
	"/usr/local/share/ca-certificates", // Debian, Ubuntu, Alpine
	"/etc/pki/ca-trust/source/anchors", // RHEL, Fedora
	"/etc/pki/trust/anchors",           // SUSE
}

// What the certificate is called in each of them. Debian's
// update-ca-certificates takes only a .crt; the others take any certificate in
// the directory.
const anchorName = "buildcage.crt"

// createdPaths is what the injection added to the rootfs and takes away again
// once the step has exited.
type createdPaths struct {
	files []string
	dirs  []string // deepest first, so removing them in order empties inwards
}

func (c *createdPaths) add(resolved string, dirs []string) {
	if resolved != "" {
		c.files = append(c.files, resolved)
	}
	c.dirs = append(c.dirs, dirs...)
}

// removalOrder is the created directories deepest first, so one is only
// judged once everything the injection put under it has gone. Sorting in
// reverse does that on its own: a directory sorts after its own parent.
func (c createdPaths) removalOrder() []string {
	dirs := slices.Clone(c.dirs)
	slices.Sort(dirs)
	dirs = slices.Compact(dirs)
	slices.Reverse(dirs)
	return dirs
}

// fileDirs is the directories the certificate was written into, each once,
// for the undo to scan.
func (c createdPaths) fileDirs() []string {
	var dirs []string
	seen := map[string]bool{}
	for _, f := range c.files {
		if dir := filepath.Dir(f); !seen[dir] {
			seen[dir] = true
			dirs = append(dirs, dir)
		}
	}
	return dirs
}

// placeAnchors writes the certificate into every anchor directory, whether or
// not the image shipped a store: the bundle it was appended to is the step's
// to rebuild, and the anchor is what survives that.
func placeAnchors(rootfs string, ca []byte) createdPaths {
	var created createdPaths
	for _, dir := range anchorDirs {
		resolved, dirs, err := createCA(rootfs, filepath.Join(dir, anchorName), ca)
		created.add(resolved, dirs)
		if err != nil {
			logf("cannot write the anchor in %s: %v", dir, err)
		}
	}
	return created
}

// ensureSystemStore returns the bundle the step's tools already read, or
// writes one at every candidate path when the image ships none.
//
// Writing all of them is what keeps this free of distribution detection: which
// path a tool reads was decided when it was compiled, and with no store none of
// them is taken, so none is anyone else's to overwrite.
//
// The files go straight into the rootfs rather than through a scratch mirror,
// which is only needed to keep an existing file from being opened for writing.
// One created and removed inside the step leaves the layer diff alone.
func ensureSystemStore(rootfs string, ca []byte) (systemStore, createdPaths) {
	store, err := findSystemStore(rootfs)
	if err == nil {
		return store, createdPaths{}
	}
	logf("no system CA store in %s (%v); writing one", rootfs, err)

	var created createdPaths
	for _, candidate := range systemCertFiles {
		resolved, dirs, err := createCA(rootfs, candidate, ca)
		created.add(resolved, dirs)
		if err != nil {
			logf("cannot write %s: %v", candidate, err)
			continue
		}
		if !store.available() {
			store = systemStore{hostPath: resolved, containerPath: candidate}
		}
	}
	return store, created
}

// createCA writes the certificate at path inside the rootfs, and returns where
// it landed along with the directories it had to create to get there. A path
// something already stands at is left alone.
func createCA(rootfs, path string, ca []byte) (string, []string, error) {
	resolved, err := resolveInRoot(rootfs, path)
	if err != nil {
		return "", nil, err
	}
	if _, err := os.Lstat(resolved); err == nil {
		return "", nil, errors.New("already exists")
	}
	dirs, err := mkdirAllTracking(filepath.Dir(resolved))
	if err != nil {
		return "", dirs, err
	}
	return resolved, dirs, os.WriteFile(resolved, ca, 0o644)
}

// mkdirAllTracking is MkdirAll that reports which directories it created,
// deepest first, so the undo takes back exactly what the injection added.
// Walking up ends at the filesystem root, which is always there.
func mkdirAllTracking(dir string) ([]string, error) {
	var created []string
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(d); !os.IsNotExist(err) {
			break
		}
		created = append(created, d)
	}
	return created, os.MkdirAll(dir, 0o755)
}
