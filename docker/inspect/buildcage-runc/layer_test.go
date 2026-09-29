package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// mustHardLink gives one file two names, which is what an overlay's upper
// directory and its merged view are: the listing and the removal reach the
// same bytes by different paths.
func mustHardLink(t *testing.T, from, to string) {
	t.Helper()
	if err := os.Link(from, to); err != nil {
		t.Fatal(err)
	}
}

// mountLine is the shape /proc/self/mountinfo writes, taken from a real build:
//
//	339 508 0:114 / /var/lib/buildkit/.../rootfs rw,relatime - overlay overlay
//	rw,lowerdir=...,upperdir=.../snapshots/4/fs,workdir=...,uuid=on,nouserxattr
func mountLine(mountPoint, fstype, superOptions string) string {
	return fmt.Sprintf("339 508 0:114 / %s rw,relatime shared:1 - %s overlay %s",
		mountPoint, fstype, superOptions)
}

func overlayLine(mountPoint, upper string) string {
	return mountLine(mountPoint, "overlay", "rw,lowerdir=/l,upperdir="+upper+",workdir=/w,nouserxattr")
}

// useMountInfo hands upperDirOf these lines instead of the test process's own
// mount table, which holds no overlay over a temporary directory.
func useMountInfo(t *testing.T, lines ...string) {
	t.Helper()
	old := readMountInfo
	readMountInfo = func() ([]byte, error) { return []byte(strings.Join(lines, "\n") + "\n"), nil }
	t.Cleanup(func() { readMountInfo = old })
}

func TestUpperDirOfReadsTheStepsOwnLayer(t *testing.T) {
	root := t.TempDir()
	rootfs := filepath.Join(root, "rootfs")
	upper := filepath.Join(root, "snapshots", "4", "fs")
	mustMkdirAll(t, rootfs)
	mustMkdirAll(t, upper)

	useMountInfo(t, overlayLine(rootfs, upper))
	if got := upperDirOf(rootfs); got != upper {
		t.Fatalf("got %q, want %q", got, upper)
	}
}

// The kernel escapes the characters that would otherwise end a field, and the
// wrapper is handed whatever --bundle said, which may be relative. Neither can
// be compared as text, so the mount point is compared as a directory.
func TestUpperDirOfMatchesTheMountPointHoweverItIsWritten(t *testing.T) {
	root := t.TempDir()
	upper := filepath.Join(root, "fs")
	mustMkdirAll(t, upper)

	t.Run("an escaped mount point", func(t *testing.T) {
		rootfs := filepath.Join(root, "root fs")
		mustMkdirAll(t, rootfs)
		useMountInfo(t, overlayLine(strings.ReplaceAll(rootfs, " ", `\040`), upper))
		if got := upperDirOf(rootfs); got != upper {
			t.Fatalf("got %q, want %q", got, upper)
		}
	})

	t.Run("a rootfs named relatively", func(t *testing.T) {
		rootfs := filepath.Join(root, "relative")
		mustMkdirAll(t, rootfs)
		useMountInfo(t, overlayLine(rootfs, upper))
		t.Chdir(root)
		if got := upperDirOf("relative"); got != upper {
			t.Fatalf("got %q, want %q", got, upper)
		}
	})
}

// Without an upper directory there is no layer to read back, which is what a
// snapshotter other than overlayfs leaves and what a mount table this cannot
// read with certainty has to be treated as.
func TestUpperDirOfReportsNoLayerItCanBeSureOf(t *testing.T) {
	root := t.TempDir()
	rootfs := filepath.Join(root, "rootfs")
	upper := filepath.Join(root, "fs")
	mustMkdirAll(t, rootfs)
	mustMkdirAll(t, upper)
	mustWriteFile(t, filepath.Join(root, "file"), "not a directory\n")

	cases := map[string][]string{
		"no mount over the rootfs at all": {overlayLine(filepath.Join(root, "elsewhere"), upper)},
		"a rootfs that is not an overlay": {mountLine(rootfs, "ext4", "rw,upperdir="+upper)},
		"a mount point no longer there":   {overlayLine(filepath.Join(root, "gone"), upper)},
		"an overlay naming no upperdir":   {mountLine(rootfs, "overlay", "rw,lowerdir=/l,workdir=/w")},
		"a line cut short":                {"339 508 0:114 / " + rootfs + " rw,relatime"},
		// A comma inside the path ends the option early, and what comes out is
		// half a path rather than the layer.
		"a comma in the upper directory": {overlayLine(rootfs, upper+"/a,b")},
		"an upperdir that is a file":     {overlayLine(rootfs, filepath.Join(root, "file"))},
		// The later mount covers the earlier one, so the earlier one's upper
		// directory is not where this step's writes went.
		"a later mount naming no upperdir": {
			overlayLine(rootfs, upper),
			mountLine(rootfs, "overlay", "rw,lowerdir=/l,workdir=/w"),
		},
	}
	for name, lines := range cases {
		t.Run(name, func(t *testing.T) {
			useMountInfo(t, lines...)
			if got := upperDirOf(rootfs); got != "" {
				t.Fatalf("got %q, want no layer", got)
			}
		})
	}
}

// Two mounts over one point are stacked, and it is the last one the step wrote
// through.
func TestUpperDirOfTakesTheLastMountOverThePoint(t *testing.T) {
	root := t.TempDir()
	rootfs := filepath.Join(root, "rootfs")
	first, second := filepath.Join(root, "first"), filepath.Join(root, "second")
	for _, dir := range []string{rootfs, first, second} {
		mustMkdirAll(t, dir)
	}

	useMountInfo(t, overlayLine(rootfs, first), overlayLine(rootfs, second))
	if got := upperDirOf(rootfs); got != second {
		t.Fatalf("got %q, want %q", got, second)
	}
}

func TestUpperDirOfReportsWhatItCannotRead(t *testing.T) {
	t.Run("a rootfs that is not there", func(t *testing.T) {
		useMountInfo(t)
		if got := upperDirOf(filepath.Join(t.TempDir(), "gone")); got != "" {
			t.Fatalf("got %q, want no layer", got)
		}
	})

	t.Run("a mount table that cannot be read", func(t *testing.T) {
		old := readMountInfo
		readMountInfo = func() ([]byte, error) { return nil, errBrokenFile }
		t.Cleanup(func() { readMountInfo = old })
		if got := upperDirOf(t.TempDir()); got != "" {
			t.Fatalf("got %q, want no layer", got)
		}
	})
}

func TestUnescapeMountInfoDecodesTheCharactersTheKernelEscapes(t *testing.T) {
	cases := map[string]string{
		`/var/lib/buildkit`:  "/var/lib/buildkit",
		`/a\040b/c\011d`:     "/a b/c\td",
		`/a\134b`:            `/a\b`,
		`/trailing\`:         `/trailing\`,
		`/not\9zz/an/escape`: `/not\9zz/an/escape`,
	}
	for field, want := range cases {
		if got := unescapeMountInfo(field); got != want {
			t.Errorf("unescapeMountInfo(%q) = %q, want %q", field, got, want)
		}
	}
}

// trustedCopy is the certificate re-armoured the way a RHEL rebuild leaves it
// in ca-bundle.trust.crt: the DER with the trust settings appended, under a
// label of its own. Neither the raw DER nor the whole base64 of the original
// matches it, which is why detection decodes the block.
func trustedCopy(der []byte) string {
	body := base64.StdEncoding.EncodeToString(append(append([]byte{}, der...), "TRUST-SETTINGS"...))
	return "-----BEGIN TRUSTED CERTIFICATE-----\n" + body + "\n-----END TRUSTED CERTIFICATE-----\n"
}

// Every shape the four distributions were measured leaving a copy in.
func TestSweepDirTakesOutEveryShapeOfCopy(t *testing.T) {
	cases := map[string]string{
		"a plain PEM copy":         string(testCA),
		"a re-armoured PEM copy":   trustedCopy(testDER),
		"a Java keystore":          string(keystore(2, trustedEntry(2, "buildcage", testDER))),
		"a copy beside other work": "NOTES\n" + string(otherCA) + string(testCA),
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			mustWriteFile(t, filepath.Join(dir, "copy"), content)

			if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); err != nil {
				t.Fatal(err)
			}
			left, err := verifyLayer(dir, caMarksOf(testCA).needles)
			if err != nil {
				t.Fatal(err)
			}
			if len(left) != 0 {
				t.Fatalf("the certificate is still in %v", left)
			}
		})
	}
}

// A block the step cut short is not one to resume past, so the scan starts
// again just after its opening line. Resuming at the end it appears to have
// would swallow the copy that block's closing line belongs to.
func TestSweepDirFindsACopyBehindAnUnfinishedBlock(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	truncated := beginTestBlock + "\nVFJVTkNBVEVE\n"
	mustWriteFile(t, path, truncated+string(testCA))

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != truncated {
		t.Fatalf("got %q, want the truncated block alone", got)
	}
}

// What the sweep is worth without any injection of its own: a step that copies
// the store puts the certificate somewhere no list of paths would name.
func TestSweepDirLeavesTheRestOfACopyIntact(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	mustWriteFile(t, path, string(otherCA)+string(testCA))

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(otherCA) {
		t.Fatalf("got %q, want the bundle's own certificate alone", got)
	}
}

// A file the strip empties held nothing but the certificate, so it is one the
// injection put there and goes, rather than staying as an empty trace. A
// rebuild leaves such a copy under the store directory beside the bundle.
func TestSweepDirRemovesAFileTheStripEmpties(t *testing.T) {
	dir := t.TempDir()
	anchor := filepath.Join(dir, "buildcage.pem")
	bundle := filepath.Join(dir, "ca-certificates.crt")
	mustWriteFile(t, anchor, string(testCA))
	mustWriteFile(t, bundle, string(otherCA)+string(testCA))

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(anchor); !os.IsNotExist(err) {
		t.Fatalf("the emptied file was left behind: %v", err)
	}
	// The bundle carried a real certificate too, so it is emptied of nothing
	// and stays.
	if got, _ := os.ReadFile(bundle); string(got) != string(otherCA) {
		t.Fatalf("the bundle was disturbed: %q", got)
	}
}

// A rebuild links to each copy it makes, one after the file and one after its
// hash, and the hash link points at the first. Both go once what they point at
// is gone.
func TestSweepDirDropsLinksLeftDangling(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "buildcage.pem"), string(testCA))
	mustSymlink(t, "buildcage.pem", filepath.Join(dir, "buildcage.0"))
	// The hash link points at the named link, not the file, so it only goes on
	// a second pass once the named link has.
	mustSymlink(t, "buildcage.0", filepath.Join(dir, "deadbeef.0"))

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"buildcage.pem", "buildcage.0", "deadbeef.0"} {
		if _, err := os.Lstat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatalf("%s was left behind", name)
		}
	}
}

// Only a link to something the sweep removed goes. One the image shipped
// pointing at a file that was never ours is the image's own, dangling or not.
func TestSweepDirKeepsLinksToWhatItDidNotRemove(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "buildcage.pem"), string(testCA))
	mustSymlink(t, "buildcage.pem", filepath.Join(dir, "ours.0"))
	// A link the image shipped, pointing at its own roots and at a file that
	// never existed. Neither target is anything the sweep took away.
	mustWriteFile(t, filepath.Join(dir, "theirs.pem"), string(otherCA))
	mustSymlink(t, "theirs.pem", filepath.Join(dir, "theirs.0"))
	mustSymlink(t, "gone.pem", filepath.Join(dir, "broken.0"))

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(dir, "ours.0")); !os.IsNotExist(err) {
		t.Fatal("the link to a removed file was left behind")
	}
	for _, name := range []string{"theirs.0", "broken.0"} {
		if _, err := os.Lstat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("%s, none of the sweep's business, was taken away", name)
		}
	}
}

// The layer's listing and the rootfs its links resolve against are two
// directories, and an absolute link inside the container is absolute inside the
// rootfs. A hash link written that way still goes with what it points at.
func TestSweepDirDropsAnAbsoluteLinkThroughTheRoot(t *testing.T) {
	root := t.TempDir()
	upper := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "etc", "ssl", "certs"))
	mustMkdirAll(t, filepath.Join(upper, "etc", "ssl", "certs"))
	// The same file under both names, which is what an overlay's upper
	// directory and its merged view are.
	pem := filepath.Join("etc", "ssl", "certs", "buildcage.pem")
	mustWriteFile(t, filepath.Join(upper, pem), string(testCA))
	mustHardLink(t, filepath.Join(upper, pem), filepath.Join(root, pem))
	// The link is read from the layer's listing and removed through the rootfs,
	// so it stands at both, pointing at the same place.
	link := filepath.Join("etc", "ssl", "certs", "hash.0")
	mustSymlink(t, "/etc/ssl/certs/buildcage.pem", filepath.Join(upper, link))
	mustSymlink(t, "/etc/ssl/certs/buildcage.pem", filepath.Join(root, link))

	if _, err := sweepDir(upper, root, testCA, caMarksOf(testCA)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(root, link)); !os.IsNotExist(err) {
		t.Fatal("the absolute link was left pointing at a removed file")
	}
}

// Detection covers every container; removal does not. A format this cannot
// rewrite is named and fails the build rather than being left in the layer.
func TestSweepDirFailsOnAContainerItCannotRewrite(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "store.db"), "SQLite format 3\x00"+string(testDER)+"\x00")

	_, err := sweepDir(dir, dir, testCA, caMarksOf(testCA))
	if !errors.Is(err, errUnstrippableCA) {
		t.Fatalf("got %v, want the container to be reported", err)
	}
	if !strings.Contains(err.Error(), "store.db") {
		t.Fatalf("got %v, want it to name the file", err)
	}
}

// A binary embedding the bundle fails the build instead of being committed
// corrupted.
func TestSweepDirFailsOnABinaryEmbeddingTheBundle(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server")
	content := "\x7fELF\x02\x01\x01\x00" + string(otherCA) + string(testCA) + "\x00TRAILER"
	mustWriteFile(t, path, content)

	_, err := sweepDir(dir, dir, testCA, caMarksOf(testCA))
	if !errors.Is(err, errUnstrippableCA) {
		t.Fatalf("got %v, want the binary to be reported", err)
	}
	if !strings.Contains(err.Error(), "server") {
		t.Fatalf("got %v, want it to name the file", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != content {
		t.Fatalf("got %q, want it unchanged", got)
	}
}

// The sweep reads every byte a step wrote, so anything it is not here for has
// to come out the other side untouched. On an overlay, even opening one for
// writing would copy it into the layer.
func TestSweepDirLeavesWhatDoesNotHoldTheCertificate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "roots.pem")
	mustWriteFile(t, path, string(otherCA))
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}

	files, err := sweepDir(dir, dir, testCA, caMarksOf(testCA))
	if err != nil {
		t.Fatal(err)
	}
	if files != 1 {
		t.Fatalf("read %d files, want 1", files)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !after.ModTime().Equal(before.ModTime()) {
		t.Error("an untouched file was written to")
	}
}

// Nothing but a regular file can hold a certificate, and a whiteout is a
// character device the wrapper must not read as one.
func TestSweepDirReadsOnlyRegularFiles(t *testing.T) {
	dir := t.TempDir()
	mustMkdirAll(t, filepath.Join(dir, "opaque"))
	if err := os.Symlink("copy", filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(filepath.Join(dir, "fifo"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(dir, "copy"), string(testCA))

	files, err := sweepDir(dir, dir, testCA, caMarksOf(testCA))
	if err != nil {
		t.Fatal(err)
	}
	if files != 1 {
		t.Fatalf("read %d files, want only the regular one", files)
	}
}

// The listing and the removal are two different directories for a layer: what
// to look at comes from the overlay's upper directory, and the removal goes
// through the rootfs, where a path the listing named may not resolve.
func TestSweepDirReportsAPathItCannotResolveUnderTheRoot(t *testing.T) {
	upper, root := t.TempDir(), t.TempDir()
	mustMkdirAll(t, filepath.Join(upper, "etc"))
	mustWriteFile(t, filepath.Join(upper, "etc", "copy.pem"), string(testCA))
	if err := os.Symlink("etc", filepath.Join(root, "etc")); err != nil {
		t.Fatal(err)
	}

	if _, err := sweepDir(upper, root, testCA, caMarksOf(testCA)); !errors.Is(err, errTooManySymlinks) {
		t.Fatalf("got %v, want the unresolvable path to be reported", err)
	}
}

func TestSweepDirReportsADirectoryItCannotRead(t *testing.T) {
	dir := t.TempDir()
	failWalkOn(t, dir, 1)

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); !errors.Is(err, errBrokenWalk) {
		t.Fatalf("got %v, want the failed listing to be reported", err)
	}
}

func TestSweepDirReportsAFileItCannotRead(t *testing.T) {
	skipIfRoot(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "copy")
	mustWriteFile(t, path, string(testCA))
	if err := os.Chmod(path, 0o000); err != nil {
		t.Fatal(err)
	}

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); err == nil {
		t.Fatal("expected the unreadable file to be reported")
	}
}

func TestSweepDirReportsAFileItCannotStat(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "copy"), string(testCA))
	useBrokenBundleFile(t, &brokenFile{failStat: true})

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want the stat failure to be reported", err)
	}
}

// A file the strip emptied but that cannot then be removed is the wrapper's
// own failure, not the step's to keep.
func TestSweepDirReportsAFileItCannotRemove(t *testing.T) {
	skipIfRoot(t)
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "buildcage.pem"), string(testCA))
	mustMakeReadOnly(t, dir)

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); err == nil {
		t.Fatal("expected the failed removal to be reported")
	}
}

// The link pass reads the tree once, and a directory it cannot read there is
// reported the same as anywhere else. It only runs once the file pass has
// removed something, so a copy is emptied first to reach it.
func TestSweepDirReportsADirectoryTheLinkPassCannotRead(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "buildcage.pem"), string(testCA))
	// Walk 1 is the file pass, walk 2 the link pass; fail the second.
	failWalkOn(t, dir, 2)

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); !errors.Is(err, errBrokenWalk) {
		t.Fatalf("got %v, want the failed link listing to be reported", err)
	}
}

// A link whose removal fails for a reason other than being gone already is the
// wrapper's failure. The link is put in a read-only directory of its own, away
// from the emptied file that made the sweep reach it.
func TestSweepDirReportsALinkItCannotRemove(t *testing.T) {
	skipIfRoot(t)
	root := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "a"))
	mustMkdirAll(t, filepath.Join(root, "b"))
	mustWriteFile(t, filepath.Join(root, "a", "buildcage.pem"), string(testCA))
	mustSymlink(t, "/a/buildcage.pem", filepath.Join(root, "b", "hash.0"))
	mustMakeReadOnly(t, filepath.Join(root, "b"))

	if _, err := sweepDir(root, root, testCA, caMarksOf(testCA)); err == nil {
		t.Fatal("expected the failed link removal to be reported")
	}
}

// The link's own directory is resolved inside the rootfs, and a rootfs where
// that directory is a symlink climbing out is refused rather than followed.
func TestSweepDirReportsALinkWhoseDirectoryEscapes(t *testing.T) {
	root, upper := t.TempDir(), t.TempDir()
	// A copy the file pass empties and removes, so the link pass is reached.
	mustWriteFile(t, filepath.Join(upper, "buildcage.pem"), string(testCA))
	mustHardLink(t, filepath.Join(upper, "buildcage.pem"), filepath.Join(root, "buildcage.pem"))
	// The listing has a real subdirectory with a link in it, so the walk
	// reaches the link and its readlink succeeds.
	mustMkdirAll(t, filepath.Join(upper, "sub"))
	mustSymlink(t, "x", filepath.Join(upper, "sub", "hash.0"))
	// The rootfs resolves that subdirectory to a symlink climbing out of it.
	mustSymlink(t, "../../../../../../outside", filepath.Join(root, "sub"))

	if _, err := sweepDir(upper, root, testCA, caMarksOf(testCA)); !errors.Is(err, errEscapesRoot) {
		t.Fatalf("got %v, want the escaping link directory to be refused", err)
	}
}

// A link pointing out of the rootfs resolves to nothing inside it, so it is
// not pointing at anything the sweep removed and is left alone rather than
// failing the build.
func TestSweepDirLeavesALinkPointingOutOfTheRoot(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "buildcage.pem"), string(testCA))
	// A directory in the target's path is itself a symlink climbing out of the
	// root, so resolving the target escapes. The link's own directory still
	// resolves, so only its target is out of bounds.
	mustSymlink(t, "../../../../../../outside", filepath.Join(dir, "out"))
	mustSymlink(t, "out/bundle.pem", filepath.Join(dir, "escape.0"))

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); err != nil {
		t.Fatalf("an out-of-root link should be left alone, got %v", err)
	}
	if _, err := os.Lstat(filepath.Join(dir, "escape.0")); err != nil {
		t.Fatalf("the out-of-root link was taken away: %v", err)
	}
}

// A link that went away between the listing and the readlink reads as empty,
// matches nothing removed, and is left alone rather than failing the sweep.
func TestSweepDirSkipsALinkThatVanished(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "buildcage.pem"), string(testCA))
	mustSymlink(t, "elsewhere", filepath.Join(dir, "real.0"))
	// A stubbed second walk hands a symlink entry at a path that is not there,
	// so the readlink fails and it is skipped. The first walk (the file pass)
	// runs for real, emptying buildcage.pem so the link pass is reached.
	useStubWalk(t, filepath.Clean(dir), 2, walkStep{
		path: filepath.Join(dir, "gone.0"),
		d:    realEntry(t, dir, "real.0"),
	})

	if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); err != nil {
		t.Fatalf("a vanished link should be skipped, got %v", err)
	}
}

// stripLayer is what finish calls, and it reads the layer back rather than
// trusting the removals it just made.
func TestStripLayerSweepsAndThenChecksItself(t *testing.T) {
	root := t.TempDir()
	rootfs, upper := filepath.Join(root, "rootfs"), filepath.Join(root, "fs")
	mustMkdirAll(t, rootfs)
	mustMkdirAll(t, upper)
	// The same file under both names, which is what an overlay's upper
	// directory and its merged view are.
	mustWriteFile(t, filepath.Join(upper, "bundle.pem"), string(testCA))
	mustHardLink(t, filepath.Join(upper, "bundle.pem"), filepath.Join(rootfs, "bundle.pem"))
	// A second file, so the sweep reads more than the one it has to change.
	mustWriteFile(t, filepath.Join(upper, "roots.pem"), string(otherCA))
	mustHardLink(t, filepath.Join(upper, "roots.pem"), filepath.Join(rootfs, "roots.pem"))
	useMountInfo(t, overlayLine(rootfs, upper))

	if err := stripLayer(rootfs, upperDirOf(rootfs), testCA, nssSlotCopy{}); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(upper, "bundle.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %q, want the certificate gone from the layer", got)
	}
}

// Without a layer to read back there is nothing to check a removal against, so
// the sweep is skipped and the layer is reported as unchecked.
func TestStripLayerReportsWhatIsNotAnOverlay(t *testing.T) {
	rootfs := t.TempDir()
	mustWriteFile(t, filepath.Join(rootfs, "bundle.pem"), string(testCA))
	useMountInfo(t, mountLine(rootfs, "ext4", "rw"))

	if err := stripLayer(rootfs, upperDirOf(rootfs), testCA, nssSlotCopy{}); !errors.Is(err, errLayerUnread) {
		t.Fatalf("got %v, want the layer reported as unread", err)
	}
	got, err := os.ReadFile(filepath.Join(rootfs, "bundle.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(testCA) {
		t.Fatalf("got %q, want the file left alone", got)
	}
}

// The check after the sweep is the guarantee: a copy the removal could not
// reach fails the build rather than reaching the image.
func TestStripLayerFailsOnACopyItCouldNotRemove(t *testing.T) {
	root := t.TempDir()
	rootfs, upper := filepath.Join(root, "rootfs"), filepath.Join(root, "fs")
	mustMkdirAll(t, rootfs)
	mustMkdirAll(t, upper)
	mustWriteFile(t, filepath.Join(upper, "store.db"), "SQLite format 3\x00"+string(testDER))
	mustHardLink(t, filepath.Join(upper, "store.db"), filepath.Join(rootfs, "store.db"))
	useMountInfo(t, overlayLine(rootfs, upper))

	if err := stripLayer(rootfs, upperDirOf(rootfs), testCA, nssSlotCopy{}); !errors.Is(err, errUnstrippableCA) {
		t.Fatalf("got %v, want the build to be failed", err)
	}
}

// The bundle beside the traces is still cleaned.
func TestStripLayerFailsOnATraceItCannotRemove(t *testing.T) {
	ca, caKey := testIssuer(t, "this run")
	leaf, _ := testLeaf(t, ca, caKey, "allowed.example")
	caPEM := certPEM(ca)
	root := t.TempDir()
	rootfs, upper := filepath.Join(root, "rootfs"), filepath.Join(root, "fs")
	mustMkdirAll(t, rootfs)
	mustMkdirAll(t, upper)
	for name, content := range map[string]string{
		"host.crt":    string(certPEM(leaf)),
		"bundle.crt":  string(otherCA) + string(caPEM),
		"config.json": `{"ca":"` + strings.ReplaceAll(string(caPEM), "\n", `\n`) + `"}`,
	} {
		mustWriteFile(t, filepath.Join(upper, name), content)
		mustHardLink(t, filepath.Join(upper, name), filepath.Join(rootfs, name))
	}
	useMountInfo(t, overlayLine(rootfs, upper))

	err := stripLayer(rootfs, upperDirOf(rootfs), caPEM, nssSlotCopy{})
	if !errors.Is(err, errUnstrippableCA) {
		t.Fatalf("got %v, want the build to be failed", err)
	}
	for _, name := range []string{"/host.crt", "/config.json"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("the failure does not name %s: %v", name, err)
		}
	}
	if got, _ := os.ReadFile(filepath.Join(upper, "bundle.crt")); string(got) != string(otherCA) {
		t.Errorf("the bundle holds %q, want only its own certificate", got)
	}
}

// A walk that fails after the sweep, in the slot pass or the read-back, is
// reported.
func TestStripLayerReportsADirectoryItCannotReadBack(t *testing.T) {
	for name, nth := range map[string]int{"slot pass": 2, "read-back": 3} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			rootfs, upper := filepath.Join(root, "rootfs"), filepath.Join(root, "fs")
			mustMkdirAll(t, rootfs)
			mustMkdirAll(t, upper)
			useMountInfo(t, overlayLine(rootfs, upper))
			failWalkOn(t, upper, nth)

			if err := stripLayer(rootfs, upperDirOf(rootfs), testCA, nssSlotCopy{}); !errors.Is(err, errBrokenWalk) {
				t.Fatalf("got %v, want the failed listing to be reported", err)
			}
		})
	}
}

// A copy the sweep believes it removed but has not is still in the layer, and
// the reading back is what says so.
func TestStripLayerFailsOnWhatTheSweepMissed(t *testing.T) {
	root := t.TempDir()
	rootfs, upper := filepath.Join(root, "rootfs"), filepath.Join(root, "fs")
	mustMkdirAll(t, rootfs)
	mustMkdirAll(t, upper)
	mustWriteFile(t, filepath.Join(upper, "bundle.pem"), string(testCA))
	// The removal goes through the rootfs, where this test leaves nothing, so
	// the layer keeps its copy and only the reading back notices.
	useMountInfo(t, overlayLine(rootfs, upper))

	err := stripLayer(rootfs, upperDirOf(rootfs), testCA, nssSlotCopy{})
	if err == nil || !strings.Contains(err.Error(), "still in the step's layer") {
		t.Fatalf("got %v, want the leftover copy to fail the build", err)
	}
	if !strings.Contains(err.Error(), "bundle.pem") {
		t.Fatalf("got %v, want it to name the file", err)
	}
}

// The scan looks for the certificate and then reads a block back to decode it,
// and a read failing at either point is the wrapper's own.
func TestSweepDirReportsAFailedRead(t *testing.T) {
	for name, broken := range map[string]*brokenFile{
		"looking for the certificate": {failReadAt: 1},
		"reading a block back":        {failReadAt: 2},
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			mustWriteFile(t, filepath.Join(dir, "copy"), string(testCA))
			useBrokenBundleFile(t, broken)

			if _, err := sweepDir(dir, dir, testCA, caMarksOf(testCA)); !errors.Is(err, errBrokenFile) {
				t.Fatalf("got %v, want the read failure to be reported", err)
			}
		})
	}
}

// A keystore this cannot reseal is reported as a copy it cannot strip rather
// than rewritten into one the JVM that owns it can no longer open, and the
// sweep carries on to the files after it.
func TestSweepDirReportsAKeystoreItCannotReseal(t *testing.T) {
	useTempLog(t)
	dir := t.TempDir()
	sealed := keystore(2, trustedEntry(2, "buildcage", testDER))
	sealed[len(sealed)-1] ^= 0xff
	mustWriteFile(t, filepath.Join(dir, "cacerts"), string(sealed))
	mustWriteFile(t, filepath.Join(dir, "zz-bundle.pem"), string(testCA))

	_, err := sweepDir(dir, dir, testCA, caMarksOf(testCA))
	if !errors.Is(err, errUnstrippableCA) || !strings.Contains(err.Error(), "cacerts") {
		t.Fatalf("got %v, want the keystore reported as a copy it cannot strip", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "zz-bundle.pem")); !os.IsNotExist(err) {
		t.Error("the sweep stopped before the copy after the keystore")
	}
}
