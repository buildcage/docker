package main

// The step's layer, rather than a list of paths, is what the undo is measured
// against.
//
// The certificate is an input to the distribution's own trust machinery, and
// every rebuild of it spreads copies in a shape of its own: a bundle, a copy
// under the store directory, hash links, and on a system carrying a JRE the
// JVM's own keystore, whose path holds the vendor and version of whatever JDK
// the step installed. Those cannot be listed ahead of time.
//
// What can be read back is the layer. BuildKit runs each step on an overlay
// whose upper directory holds exactly what that step created or changed, and
// commits that directory as the step's layer. So "the injection leaves no
// trace" is "no file in the upper directory carries the certificate", which is
// a question that can be asked of the layer itself.

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// errUnstrippableCA means a copy of the certificate is in a container this
// cannot rewrite. Detection covers every format; removal does not, and the
// difference fails the build rather than passing silently.
var errUnstrippableCA = errors.New("the certificate is in a format this cannot strip")

// errCALeftInLayer means the reading back found a copy the sweep did not take
// out.
var errCALeftInLayer = errors.New("the certificate is still in the step's layer")

// readMountInfo is a var so tests can hand the parser lines captured from a
// real build rather than the test process's own mount table.
var readMountInfo = func() ([]byte, error) { return os.ReadFile("/proc/self/mountinfo") }

// upperDirOf returns where the step's own writes land: the upper layer of the
// overlay mounted at rootfs, which is what BuildKit commits.
//
// Empty when there is no such layer to read, which is what a snapshotter other
// than overlayfs leaves, and when the mount table does not name one with
// certainty.
func upperDirOf(rootfs string) string {
	want, err := os.Stat(rootfs)
	if err != nil {
		logf("cannot read %s to find the step's layer: %v", rootfs, err)
		return ""
	}
	table, err := readMountInfo()
	if err != nil {
		logf("cannot read the mount table to find the step's layer: %v", err)
		return ""
	}

	upper := ""
	for _, line := range strings.Split(string(table), "\n") {
		// A line is `id parent major:minor root mountpoint options
		// [optional]... - fstype source superoptions`. The optional fields
		// make the tail's position vary, so it is found from the separator
		// rather than counted from the front.
		fields := strings.Fields(line)
		separator := slices.Index(fields, "-")
		if separator < 6 || len(fields) < separator+4 {
			continue
		}
		if fields[separator+1] != "overlay" {
			continue
		}
		// Compared as a directory rather than as text: the mount point is
		// written with the kernel's own escaping, and the rootfs arrives as
		// whatever --bundle happened to say, which may be relative.
		at, err := os.Stat(unescapeMountInfo(fields[4]))
		if err != nil || !os.SameFile(want, at) {
			continue
		}
		// A later mount over the same point covers an earlier one, so it is
		// the last line that says where the step's writes went.
		upper = ""
		for _, option := range strings.Split(fields[separator+3], ",") {
			if value, ok := strings.CutPrefix(option, "upperdir="); ok {
				upper = unescapeMountInfo(value)
			}
		}
	}
	if upper == "" {
		return ""
	}
	if info, err := os.Stat(upper); err != nil || !info.IsDir() {
		// A comma in the path ends the option early and leaves half of it
		// here. The layer is not guessed at from that.
		logf("the overlay at %s names an upper directory that cannot be read", rootfs)
		return ""
	}
	return filepath.Clean(upper)
}

// unescapeMountInfo decodes the octal escapes the kernel writes for the
// characters that would otherwise end a field: space, tab, newline, backslash.
func unescapeMountInfo(field string) string {
	if !strings.Contains(field, `\`) {
		return field
	}
	var out strings.Builder
	for i := 0; i < len(field); {
		if field[i] == '\\' && i+3 < len(field) {
			if value, err := strconv.ParseUint(field[i+1:i+4], 8, 8); err == nil {
				out.WriteByte(byte(value))
				i += 4
				continue
			}
		}
		out.WriteByte(field[i])
		i++
	}
	return out.String()
}

// eachFileHoldingCA reads every file listed under dir and calls hit with the
// path of each one carrying the certificate, relative to dir. It returns how
// many files it read.
//
// Only regular files are read. A whiteout is a character device, an opaque
// directory is a directory, and a symlink carries a path rather than bytes:
// none of them can hold a certificate, and the file a link points at is
// listed in its own right if it is here at all.
func eachFileHoldingCA(dir string, needles [][]byte, hit func(rel string) error) (int, error) {
	dir = filepath.Clean(dir)
	files := 0
	err := walkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.Type().IsRegular() {
			return nil
		}
		files++
		found, err := fileHoldsCA(path, needles)
		if err != nil || !found {
			return err
		}
		return hit(path[len(dir):])
	})
	return files, err
}

// fileHoldsCA reports whether the file at path carries one of needles, in its
// raw bytes or inside an encrypted PKCS#12 it can open. It is opened
// read-only: on an overlay, opening a file for writing copies it up into the
// layer, which would put a file the image shipped there for nothing.
//
// A path that is not there holds nothing, the same way removeCA treats one.
func fileHoldsCA(path string, needles [][]byte) (bool, error) {
	f, err := openBundle(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, asNotRegular(path, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return false, err
	}
	found, err := scanForCA(f, info.Size(), needles)
	if err != nil || found {
		return found, err
	}
	return sealedPKCS12Holds(f, info.Size(), needles)
}

// sweepDir takes the certificate out of every file under listing that holds
// one, and returns how many files it read.
//
// The two directories differ for the layer: what to look at comes from the
// overlay's upper directory, but each removal goes through the rootfs, because
// writing into the upper directory would step around the whiteouts overlay
// keeps there. For a mirror they are the same directory.
func sweepDir(listing, root string, ca []byte, marks caMarks) (int, error) {
	var unstrippable []string
	// The paths the sweep took away, so a link left pointing at one can go too.
	removed := map[string]bool{}
	files, err := eachFileHoldingCA(listing, marks.needles, func(rel string) error {
		target, err := resolveInRoot(root, rel)
		if err != nil {
			return err
		}
		left, err := stripCA(target, ca, marks)
		if err != nil {
			return err
		}
		if left {
			unstrippable = append(unstrippable, rel)
			return nil
		}
		// A file the strip emptied held nothing but the certificate, which is
		// generated per build, so the file is one the injection put there: it
		// goes, rather than staying behind as an empty trace.
		if info, err := os.Stat(target); err == nil && info.Size() == 0 {
			if err := os.Remove(target); err != nil {
				return err
			}
			removed[target] = true
		}
		return nil
	})
	if err != nil {
		return files, err
	}
	// Before the unstrippable copies are reported, so a build that carries on
	// past them (fail_on_ca_residue: false) still loses the links it removed.
	if err := dropRemovedLinks(listing, root, removed); err != nil {
		return files, err
	}
	if len(unstrippable) > 0 {
		return files, fmt.Errorf("%w: %s", errUnstrippableCA, strings.Join(unstrippable, " "))
	}
	return files, nil
}

// dropRemovedLinks takes out the symlinks left pointing at something the sweep
// removed. A rebuild leaves two per anchor, one named after the file and one
// after its hash, and the second points at the first, so this runs to a
// fixpoint. A link the image itself shipped broken points at nothing removed
// and is left alone.
func dropRemovedLinks(listing, root string, removed map[string]bool) error {
	// Nothing was taken away, so no link can be pointing at anything gone, and
	// the tree does not have to be walked for symlinks at all.
	if len(removed) == 0 {
		return nil
	}
	type link struct{ at, target string }
	var links []link
	clean := filepath.Clean(listing)
	err := walkDir(clean, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.Type()&os.ModeSymlink == 0 {
			return err
		}
		raw, err := os.Readlink(path)
		if err != nil {
			// Gone between the listing and here; nothing to take out.
			return nil
		}
		// The link's own directory in the rootfs, resolving the path down to
		// but not through the link itself, which resolveInRoot would follow.
		containerDir := filepath.Dir(path[len(clean):])
		dir, err := resolveInRoot(root, containerDir)
		if err != nil {
			return err
		}
		// The target, resolved the same way the removed set's keys were, so a
		// symlinked component in the path cannot make an equal path compare
		// unequal. Absolute inside the container is absolute inside the rootfs.
		container := filepath.Join(containerDir, raw)
		if filepath.IsAbs(raw) {
			container = raw
		}
		target, err := resolveInRoot(root, container)
		if err != nil {
			// It points somewhere that will not resolve inside the rootfs, so
			// it is not pointing at anything the sweep removed. Left alone.
			return nil
		}
		links = append(links, link{at: filepath.Join(dir, filepath.Base(path)), target: target})
		return nil
	})
	if err != nil {
		return err
	}
	for changed := true; changed; {
		changed = false
		for i := range links {
			if links[i].at == "" || !removed[links[i].target] {
				continue
			}
			if err := os.Remove(links[i].at); err != nil && !os.IsNotExist(err) {
				return err
			}
			removed[links[i].at] = true
			links[i].at = ""
			changed = true
		}
	}
	return nil
}

// stripCA takes the certificate out of one file, in whichever shape it is in
// there, and reports whether a copy is still in it afterwards.
func stripCA(path string, ca []byte, marks caMarks) (bool, error) {
	// Read-only first, even though the listing already said this file carries
	// the certificate: the listing named it under a different directory, and on
	// an overlay, opening a file for writing copies it up into the layer. Only
	// a file that carries the certificate is ever opened for writing.
	carries, err := fileHoldsCA(path, marks.needles)
	if err != nil || !carries {
		return false, err
	}
	if err := removeCA(path, ca); err != nil {
		return false, err
	}
	left, err := fileHoldsCA(path, marks.needles)
	if err != nil || !left {
		return false, err
	}
	// What is left is a binary holding the certificate as DER or as PEM that
	// removeCA would not cut, or a trace nothing removes. Only a Java keystore
	// or an EFI signature database can be rewritten; anything else is reported.
	rewritten, err := removeFromBinaryStore(path, marks.ders)
	if err != nil {
		return false, err
	}
	if !rewritten {
		return true, nil
	}
	return fileHoldsCA(path, marks.needles)
}

// stripLayer takes the certificate out of the step's own layer, then reads the
// layer back to say whether any of it is left.
//
// Reading it back is the check that matters: the guarantee is about what
// BuildKit commits, not about what the removals above believed they did.
//
// upper is the layer found when the injection began, not one located afresh: a
// mount table that read cleanly at inject but fails to now would otherwise
// report no layer and let the anchors' scattered copies through unswept.
func stripLayer(rootfs, upper string, ca []byte) error {
	if upper == "" {
		// Nothing to read the removal back from. The mirrors' own undo is
		// unaffected, so this is the behaviour the engine had before.
		logf("the step's layer is not an overlay upper directory; leaving it unswept")
		// Also to stderr, which is the step's output in the build log.
		fmt.Fprintln(os.Stderr, "buildcage: this step's layer is not an overlay upper directory that can be read back, so it is not checked for copies of the proxy CA")
		return nil
	}

	marks := caMarksOf(ca)
	started := time.Now()
	files, err := sweepDir(upper, rootfs, ca, marks)
	if err != nil {
		return err
	}
	left, err := verifyLayer(upper, marks.needles)
	// Paths only, never what is in them: the sweep reads every byte the step
	// wrote, tokens and credentials among them.
	logf("swept the step's layer at %s: %d files in %s", upper, files, time.Since(started).Round(time.Millisecond))
	if err != nil {
		return err
	}
	if len(left) > 0 {
		return fmt.Errorf("%w: %s", errCALeftInLayer, strings.Join(left, " "))
	}
	return nil
}

// verifyLayer lists what still carries the certificate after a sweep.
func verifyLayer(upper string, needles [][]byte) ([]string, error) {
	var left []string
	_, err := eachFileHoldingCA(upper, needles, func(rel string) error {
		left = append(left, rel)
		return nil
	})
	return left, err
}
