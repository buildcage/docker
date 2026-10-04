package main

import (
	"bytes"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
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

// Where a PEM block starts, under any label. The label is not fixed because a
// trust store rebuild re-armours the certificate under one of its own: RHEL's
// ca-bundle.trust.crt carries it as a TRUSTED CERTIFICATE, whose body is the
// certificate followed by the trust settings that format adds.
var beginPEM = []byte("-----BEGIN ")

// How much of a file a search holds at once. A store directory is a bind mount
// of the scratch mirror while the step runs, so a file there is whatever size
// the step left it at, not what the image shipped.
const scanChunk = 64 << 10

// Longest PEM block read in to compare. A certificate is a few KB, so anything
// past this is something else and is skipped rather than held in memory.
const maxCertificateBytes = 64 << 10

// Same candidate order as buildkit's executor.InjectProxyCA.
var systemCertFiles = []string{
	"/etc/ssl/certs/ca-certificates.crt",
	"/etc/pki/tls/certs/ca-bundle.crt",
	"/etc/ssl/ca-bundle.pem",
	"/etc/pki/tls/cacert.pem",
	"/etc/ssl/cert.pem",
}

// SUSE's GnuTLS reads this directory (/etc/ssl/certs links to it), not the
// store. It reads every file there, so the CA needs no hash link.
const (
	suseCertDir  = "/var/lib/ca-certificates/pem"
	suseCertName = "buildcage.pem"
)

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
			// ".." at the root stays there, as the kernel resolves it.
			current = rootfs
			continue
		}

		info, err := os.Lstat(next)
		if err != nil {
			if os.IsNotExist(err) {
				// A component that is not there cannot be a symlink, so the
				// rest of the path resolves to itself. Whole directories can be
				// missing at once: an anchor path names several of them in an
				// image that ships no CA store.
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
	if len(certificateDERs(ca)) == 0 {
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

// certificateDERs decodes every certificate in armoured to the DER that
// identifies it. The DER, rather than the base64 it arrived wrapped in, is
// what a copy of the certificate has in common with the original: a binary
// trust store holds the DER itself, and a re-armoured PEM block holds it
// followed by whatever else that format carries.
func certificateDERs(armoured []byte) [][]byte {
	var ders [][]byte
	for rest := armoured; ; {
		block, remaining := pem.Decode(rest)
		if block == nil {
			return ders
		}
		if strings.HasSuffix(block.Type, "CERTIFICATE") {
			ders = append(ders, block.Bytes)
		}
		rest = remaining
	}
}

// caMarks identifies copies of the CA in a file.
type caMarks struct {
	// What removal takes out.
	ders [][]byte
	// What detection searches for: ders, plus traces removal cannot take out,
	// which fail the build. The subject is the issuer of every certificate
	// the proxy forged. The base64 prefix includes the random serial and
	// survives re-wrapping (JSON's escaped \n, YAML indentation, no breaks,
	// lines of any width from base64PrefixLength up).
	needles [][]byte
}

// The first 48 base64 characters encode the first 36 DER bytes, which end
// past the 20-byte serial openssl req -x509 gives the CA.
const base64PrefixLength = 48

func caMarksOf(ca []byte) caMarks {
	marks := caMarks{ders: certificateDERs(ca)}
	marks.needles = slices.Clone(marks.ders)
	for _, der := range marks.ders {
		if cert, err := x509.ParseCertificate(der); err == nil {
			marks.needles = append(marks.needles, cert.RawSubject)
		}
		line := base64.StdEncoding.EncodeToString(der)
		marks.needles = append(marks.needles, []byte(line[:min(len(line), base64PrefixLength)]))
	}
	return marks
}

// holdsAnyDER reports whether b carries one of the certificates whole.
// Containment rather than equality: a TRUSTED CERTIFICATE's body is the
// certificate with the trust settings appended, and a binary container puts
// the same bytes among its own.
func holdsAnyDER(b []byte, ders [][]byte) bool {
	for _, der := range ders {
		if bytes.Contains(b, der) {
			return true
		}
	}
	return false
}

// span is a half-open byte range of the bundle, one certificate to cut out.
type span struct{ start, end int64 }

// removeCA deletes every copy of the certificate, leaving anything else in
// place.
//
// Returns without error when there is none, since the step may have rewritten
// the file itself, or when the file is binary. The find and the strip share one
// handle, opened the same guarded way as appendCA, so they can't land on
// different files.
func removeCA(path string, ca []byte) error {
	ders := certificateDERs(ca)
	if len(ders) == 0 {
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
	w := newFileWindow(f, size)
	cuts, err := findCertificates(w, ders)
	if err != nil || len(cuts) == 0 {
		return err
	}
	// Closing the gap shifts every later byte, which breaks a binary's offsets
	// and checksums. Binaries hold a NUL and PEM bundles never do, so a binary is
	// left for the caller to refuse.
	nul, err := findInFile(w, []byte{0}, 0)
	if err != nil || nul != -1 {
		return err
	}
	kept, err := closeGaps(f, cuts, size)
	if err != nil {
		return err
	}
	return f.Truncate(kept)
}

// findCertificates returns, in order, the range each armoured copy of the
// certificate occupies, including the line break that closes it.
func findCertificates(w *fileWindow, ders [][]byte) ([]span, error) {
	var cuts []span
	for off := int64(0); off < w.size; {
		begin, err := findInFile(w, beginPEM, off)
		if err != nil {
			return nil, err
		}
		if begin == -1 {
			return cuts, nil
		}
		block, end, err := readPEMBlock(w, begin)
		if err != nil {
			return nil, err
		}
		if block == nil {
			// Nothing here to resume past: an opening line the step left
			// without an end pairs with the next block's closing line, and
			// resuming past that would skip the block it belongs to. So the
			// search starts again just after this opening line.
			off = begin + int64(len(beginPEM))
			continue
		}
		// A block that was read has no opening line inside it, so resuming at
		// its end skips nothing and saves reading it all again.
		off = end
		if !holdsAnyDER(block.Bytes, ders) {
			continue
		}
		cuts = append(cuts, span{begin, end})
	}
	return cuts, nil
}

// readPEMBlock decodes the block beginning at begin and returns it with the
// offset just past its closing line break. A nil block means there is nothing
// there to cut: the opening line is unterminated, the block runs past
// maxCertificateBytes, or the step truncated its end away.
//
// The extent is settled here rather than left to pem.Decode, which walks on
// past a block it cannot read and returns a later one instead. The span would
// then reach across both, and cutting it would take a bundle's own
// certificate with it.
func readPEMBlock(w *fileWindow, begin int64) (*pem.Block, int64, error) {
	buf, err := w.at(begin, maxCertificateBytes)
	if err != nil {
		return nil, 0, err
	}
	// A closing line past the next opening line belongs to that block, so
	// nothing is looked for past it. That also keeps a failed read this cheap.
	next := len(buf)
	if len(buf) >= len(beginPEM) {
		if at := bytes.Index(buf[len(beginPEM):], beginPEM); at != -1 {
			next = len(beginPEM) + at
		}
	}
	newline := bytes.IndexByte(buf[:next], '\n')
	if newline < len(beginPEM) {
		return nil, 0, nil
	}
	label, ok := bytes.CutSuffix(bytes.TrimSuffix(buf[len(beginPEM):newline], []byte("\r")), []byte("-----"))
	if !ok || len(label) == 0 {
		return nil, 0, nil
	}
	closing := []byte("\n-----END " + string(label) + "-----")
	end := bytes.Index(buf[:min(len(buf), next+len(closing)-1)], closing)
	if end == -1 {
		return nil, 0, nil
	}
	end += len(closing)
	// The line break that closes the block goes with it, so what is left
	// behind does not gain a blank line where the block was.
	for _, b := range []byte{'\r', '\n'} {
		if end < len(buf) && buf[end] == b {
			end++
		}
	}
	block, _ := pem.Decode(buf[:end])
	return block, begin + int64(end), nil
}

// fileWindow reads a file through one buffer, refilled only when a read runs
// past what it holds, so a search restarting just past an opening line reads
// nothing again.
type fileWindow struct {
	f    io.ReaderAt
	size int64
	buf  []byte
	off  int64 // where buf starts in the file
}

func newFileWindow(f io.ReaderAt, size int64) *fileWindow {
	return &fileWindow{f: f, size: size}
}

// at returns n bytes of the file from off, or up to where it ends. The bytes
// are the window's own and valid until the next call. Fewer come back only
// when the file ended early, which means it changed under the wrapper.
func (w *fileWindow) at(off int64, n int) ([]byte, error) {
	end := min(off+int64(n), w.size)
	if off >= w.off && end <= w.off+int64(len(w.buf)) {
		return w.buf[off-w.off : end-w.off], nil
	}
	// Twice what was asked, so reads moving forward a little at a time are
	// served from memory until they have moved on by a whole read.
	if cap(w.buf) < 2*n {
		w.buf = make([]byte, 2*n)
	}
	read, err := w.f.ReadAt(w.buf[:cap(w.buf)], off)
	if err != nil && err != io.EOF {
		w.buf = w.buf[:0]
		return nil, err
	}
	w.buf, w.off = w.buf[:read], off
	return w.buf[:min(int64(read), end-off)], nil
}

// findInFile returns the offset of needle at or after from, or -1.
func findInFile(w *fileWindow, needle []byte, from int64) (int64, error) {
	at, _, err := findAnyInFile(w, [][]byte{needle}, from)
	return at, err
}

// findAnyInFile returns the offset of the earliest of needles at or after
// from, and which one was found, or -1 for both. Each read carries the longest
// needle's length over, so one lying on a chunk boundary still matches.
//
// Once one needle is found, the rest are looked for only where they would
// start before it, so the needle likeliest to come first belongs first.
func findAnyInFile(w *fileWindow, needles [][]byte, from int64) (int64, int, error) {
	longest := 0
	for _, needle := range needles {
		longest = max(longest, len(needle))
	}
	for off := from; off < w.size; {
		buf, err := w.at(off, scanChunk+longest-1)
		if err != nil {
			return -1, -1, err
		}
		at, which := -1, -1
		for i, needle := range needles {
			haystack := buf
			if at != -1 {
				haystack = buf[:min(len(buf), at+len(needle)-1)]
			}
			if found := bytes.Index(haystack, needle); found != -1 {
				at, which = found, i
			}
		}
		if at != -1 {
			return off + int64(at), which, nil
		}
		// A read shorter than the longest needle is the tail of the file, and
		// every needle that could still fit has just been looked for.
		if len(buf) < longest {
			return -1, -1, nil
		}
		off += int64(len(buf) - longest + 1)
	}
	return -1, -1, nil
}

// scanForCA reports whether f holds one of needles in its raw bytes or inside
// a PEM block.
//
// One pass, because the sweep reads every byte a step wrote and then reads
// them all again to check itself.
func scanForCA(f bundleFile, size int64, needles [][]byte) (bool, error) {
	w := newFileWindow(f, size)
	// The opening line first, since a file full of PEM has one every few lines
	// and the needles are then looked for only up to it.
	search := append([][]byte{beginPEM}, needles...)
	for off := int64(0); off < size; {
		at, which, err := findAnyInFile(w, search, off)
		if err != nil {
			return false, err
		}
		if at == -1 {
			return false, nil
		}
		if which > 0 {
			return true, nil
		}
		block, end, err := readPEMBlock(w, at)
		if err != nil {
			return false, err
		}
		// Same resume as findCertificates: past the block when there was one
		// to read, otherwise only past the opening line.
		if block == nil {
			off = at + int64(len(beginPEM))
			continue
		}
		off = end
		if holdsAnyDER(block.Bytes, needles) {
			return true, nil
		}
	}
	return false, nil
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

// systemStore is the container's own CA bundle: where the wrapper reaches it
// from the host, and the path the container refers to it by. found stays false
// when the image ships no store at all, which is not fatal: it only changes
// what the otherwise-unset variables fall back to.
type systemStore struct {
	hostPath      string
	containerPath string
	found         bool
}

// dir is the directory a dirBind mirrors to reach the store.
func (s systemStore) dir() string {
	return filepath.Dir(s.hostPath)
}

// A candidate whose directory cannot be mirrored is passed over: the variables
// planned around a store would point at a copy without the CA.
func findSystemStore(rootfs string) (systemStore, error) {
	for _, candidate := range systemCertFiles {
		resolved, err := resolveInRoot(rootfs, candidate)
		if err != nil {
			continue
		}
		if _, err := os.Stat(resolved); err != nil {
			continue
		}
		store := systemStore{hostPath: resolved, containerPath: candidate, found: true}
		if containerPathOf(rootfs, store.dir()) == "/" {
			logf("not using %s as the CA store: it is in the container root, which cannot be bound", candidate)
			continue
		}
		if err := checkMirrorable(store.dir(), maxStoreDirBytes, maxStoreDirFiles); err != nil {
			logf("not using %s as the CA store: %v", candidate, err)
			continue
		}
		return store, nil
	}
	return systemStore{}, errors.New("no CA bundle found in the rootfs")
}
