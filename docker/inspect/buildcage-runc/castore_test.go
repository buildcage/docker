package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The rootfs comes from an image the build chose, so a symlink placed at one of
// the CA paths is attacker-controlled input to a process running as root on the
// host.
func TestResolveInRootRefusesToEscape(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "host-secret")
	mustWriteFile(t, outside, "x")
	mustMkdirAll(t, filepath.Join(root, "etc"))
	mustSymlink(t, outside, filepath.Join(root, "etc", "ca.pem"))

	// The property that matters is that nothing outside the rootfs is ever
	// returned. Refusing outright and failing to find a path that only exists
	// on the host are both acceptable.
	resolved, err := resolveInRoot(root, "/etc/ca.pem")
	if err == nil && !strings.HasPrefix(resolved, root+string(os.PathSeparator)) {
		t.Fatalf("resolved outside the rootfs: %s", resolved)
	}
	if resolved == outside {
		t.Fatal("resolved to the host file")
	}
}

// ".." at the root of the rootfs stays there, as it does for the kernel inside
// the container, so a relative link with more ".." than it is deep still lands
// on the file the container sees.
func TestResolveInRootStopsDotDotAtTheRoot(t *testing.T) {
	for name, c := range map[string]struct{ link, target, path, want string }{
		"a file link":      {"etc/ssl/certs/ca-certificates.crt", "../../../../../real/ca.crt", "/etc/ssl/certs/ca-certificates.crt", "real/ca.crt"},
		"a directory link": {"etc/ssl/certs", "../../../../../real", "/etc/ssl/certs/ca.crt", "real/ca.crt"},
		"a host path":      {"etc/ca.pem", "../../../../../../etc/passwd", "/etc/ca.pem", "etc/passwd"},
	} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			mustMkdirAll(t, filepath.Join(root, filepath.Dir(c.link)))
			mustSymlink(t, c.target, filepath.Join(root, c.link))
			want := filepath.Join(root, c.want)
			mustMkdirAll(t, filepath.Dir(want))
			mustWriteFile(t, want, "x")

			resolved, err := resolveInRoot(root, c.path)
			if err != nil {
				t.Fatal(err)
			}
			if resolved != want {
				t.Fatalf("resolved to %s, want %s", resolved, want)
			}
		})
	}
}

// An absolute symlink inside a container points at the container's own root,
// not the host's, and must keep working.
func TestResolveInRootFollowsAbsoluteLinksInsideTheRootfs(t *testing.T) {
	root := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "etc", "ssl", "certs"))
	real := filepath.Join(root, "etc", "ssl", "certs", "ca-certificates.crt")
	mustWriteFile(t, real, "real")
	mustSymlink(t, "/etc/ssl/certs/ca-certificates.crt", filepath.Join(root, "etc", "ssl", "cert.pem"))
	resolved, err := resolveInRoot(root, "/etc/ssl/cert.pem")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != real {
		t.Fatalf("got %s, want %s", resolved, real)
	}
}

func TestResolveInRootAllowsAMissingFinalComponent(t *testing.T) {
	root := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "etc"))
	resolved, err := resolveInRoot(root, "/etc/not-there.pem")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != filepath.Join(root, "etc", "not-there.pem") {
		t.Fatalf("unexpected path %s", resolved)
	}
}

// A whole run of missing directories resolves to itself, which is what an
// anchor path needs in an image that ships no CA store.
func TestResolveInRootAllowsMissingIntermediateDirectories(t *testing.T) {
	root := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "etc"))
	resolved, err := resolveInRoot(root, "/etc/pki/ca-trust/source/anchors/buildcage.crt")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != filepath.Join(root, "etc", "pki", "ca-trust", "source", "anchors", "buildcage.crt") {
		t.Fatalf("unexpected path %s", resolved)
	}
}

// An error that is not "not there" is the wrapper's to report: a component the
// image left as a file, so the path cannot continue through it.
func TestResolveInRootReportsANonMissingError(t *testing.T) {
	root := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "etc"))
	mustWriteFile(t, filepath.Join(root, "etc", "notdir"), "x")
	if _, err := resolveInRoot(root, "/etc/notdir/child"); err == nil {
		t.Fatal("expected a component that is a file to be reported")
	}
}

// The lines a certificate is armoured between, spelled out here because the
// code itself only knows the shape of them and not the label.
const (
	beginTestBlock = "-----BEGIN CERTIFICATE-----"
	endTestBlock   = "-----END CERTIFICATE-----"
)

// testCA is PEM-shaped rather than a real certificate: removal matches on what
// the base64 between the two lines decodes to, not on its meaning.
var testCA = []byte(beginTestBlock + "\nQlVJTERDQUdFLUNB\n" + endTestBlock + "\n")

// otherCA stands for a certificate the bundle already carried, which removal
// has to walk past.
var otherCA = []byte(beginTestBlock + "\nU09NRU9ORS1FTFNF\n" + endTestBlock + "\n")

// caOfSize is a PEM block of exactly n bytes, so a test can place a
// certificate at a chosen offset relative to a read window. The body has to
// decode, so the bytes that do not make up a whole base64 quantum are line
// breaks, which a decoder skips.
func caOfSize(t *testing.T, n int) []byte {
	t.Helper()
	body := n - len(beginTestBlock) - len(endTestBlock) - 3
	if body < 4 {
		t.Fatalf("%d bytes is too small for a PEM block", n)
	}
	blob := strings.Repeat("\n", body%4) + strings.Repeat("Q", body-body%4)
	return fmt.Appendf(nil, "%s\n%s\n%s\n", beginTestBlock, blob, endTestBlock)
}

// Removal has to be exact rather than length-based: a step may append its own
// certificates, and cutting back to a remembered size would take them with it.
func TestRemoveCALeavesLaterAdditionsIntact(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	original := "ORIGINAL\n"
	mustWriteFile(t, path, original)
	if err := appendCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	mustAppendFile(t, path, string(otherCA))

	if err := removeCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != original+string(otherCA) {
		t.Fatalf("got %q", got)
	}
}

func TestRemoveCARestoresTheFileExactly(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	original := "ORIGINAL CONTENT\nSECOND LINE\n"
	mustWriteFile(t, path, original)
	if err := appendCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	if err := removeCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != original {
		t.Fatalf("got %q, want %q", got, original)
	}
}

// The distribution's own tooling rebuilds the bundle as a plain concatenation,
// keeping the certificate but none of the text around it, and can leave it
// there more than once. Every copy has to come out.
func TestRemoveCAStripsEveryCopy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle.pem")
	mustWriteFile(t, path, string(testCA)+string(otherCA)+string(testCA))

	if err := removeCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(otherCA) {
		t.Fatalf("got %q, want %q", got, otherCA)
	}
}

// Re-encoding wraps the base64 differently and can put the certificate's
// subject above it. Neither changes which certificate it is.
func TestRemoveCAMatchesAReEncodedCertificate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle.pem")
	rewrapped := "subject=CN = buildcage proxy CA\n" +
		"-----BEGIN CERTIFICATE-----\nQlVJ\nTERD\nQUdF\nLUNB\n-----END CERTIFICATE-----\n"
	mustWriteFile(t, path, string(otherCA)+rewrapped)

	if err := removeCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// The subject line is the step's own text, not something this wrapper
	// wrote, so it stays.
	if string(got) != string(otherCA)+"subject=CN = buildcage proxy CA\n" {
		t.Fatalf("got %q", got)
	}
}

// A step can leave an opening line whose end it truncated away. That line
// pairs with the next certificate's closing one, and resuming past it would
// leave that certificate in the image.
func TestRemoveCAStripsACertificateBehindAnUnterminatedBlock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle.pem")
	truncated := beginTestBlock + "\nVFJVTkNBVEVE\n"
	mustWriteFile(t, path, truncated+string(testCA))

	if err := removeCA(path, testCA); err != nil {
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

// A block too long to be a certificate is walked past rather than read into
// memory to compare.
func TestRemoveCALeavesAnOversizedBlockAlone(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle.pem")
	oversized := string(caOfSize(t, maxCertificateBytes+2))
	mustWriteFile(t, path, oversized+string(testCA))

	if err := removeCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != oversized {
		t.Fatalf("got %d bytes, want the oversized block alone", len(got))
	}
}

// Nothing to match against means nothing to cut, whatever the bundle holds.
func TestRemoveCAIsANoOpWithoutACertificateToMatch(t *testing.T) {
	cases := map[string]string{
		"no certificate at all": "not a certificate",
		"an unterminated one":   beginTestBlock + "\nQlVJTERDQUdFLUNB\n",
	}
	for name, ca := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "bundle.pem")
			mustWriteFile(t, path, string(testCA))

			if err := removeCA(path, []byte(ca)); err != nil {
				t.Fatal(err)
			}
			got, _ := os.ReadFile(path)
			if string(got) != string(testCA) {
				t.Fatalf("got %q, want it unchanged", got)
			}
		})
	}
}

// A step that rewrote the file entirely leaves no certificate to find.
func TestRemoveCAIsANoOpWhenTheCertificateIsGone(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	mustWriteFile(t, path, "REWRITTEN\n")
	if err := removeCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "REWRITTEN\n" {
		t.Fatalf("got %q", got)
	}
}

// A bundle that does not end in a newline would otherwise have the opening
// line land on the end of its last one, where no reader looks for it.
func TestAppendCASeparatesACertificateFromAnUnterminatedBundle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle.pem")
	mustWriteFile(t, path, "NO TRAILING NEWLINE")

	if err := appendCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "NO TRAILING NEWLINE\n"+string(testCA) {
		t.Fatalf("got %q", got)
	}
}

// filler is content removeCA has to leave alone, sized to the byte so a
// certificate lands at an exact offset.
func filler(n int) string {
	const line = "FILLER-LINE\n"
	return strings.Repeat(line, n/len(line)+1)[:n]
}

// A step can leave the bundle far larger than one window, so the certificate
// has to come out exactly wherever it falls relative to a boundary.
func TestRemoveCAStripsACertificateAcrossWindowBoundaries(t *testing.T) {
	cases := map[string]struct{ beginAt, caSize, after int }{
		"well inside one window":            {17, 64, 0},
		"opening line ending a window":      {scanChunk - len(beginTestBlock), 64, scanChunk},
		"opening line starting a window":    {scanChunk, 64, scanChunk},
		"opening line over a read boundary": {scanChunk + len(beginTestBlock)/2, 64, 2 * scanChunk},
		"straddling a window boundary":      {scanChunk - 100, 4096, scanChunk},
		"spanning several windows":          {3 * scanChunk, 64, 3 * scanChunk},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "bundle.pem")
			ca := caOfSize(t, c.caSize)
			before, after := filler(c.beginAt), filler(c.after)
			mustWriteFile(t, path, before+string(ca)+after)

			if err := removeCA(path, ca); err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != before+after {
				t.Fatalf("got %d bytes, want %d", len(got), len(before)+len(after))
			}
		})
	}
}

// A step that rewrites the bundle can leave the certificate without the line
// break that closed it, or as the whole file.
func TestRemoveCAStripsACertificateWithoutItsClosingNewline(t *testing.T) {
	block := strings.TrimRight(string(testCA), "\n")
	cases := map[string]struct{ content, want string }{
		"no newline on either side": {"HEAD\n" + block + "TAIL\n", "HEAD\nTAIL\n"},
		"the whole file":            {block, ""},
		"at the end of the file":    {"HEAD\n" + block, "HEAD\n"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "bundle.pem")
			mustWriteFile(t, path, c.content)
			if err := removeCA(path, testCA); err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestRemoveCARefusesASymlink(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "host-secret")
	mustWriteFile(t, outside, "SECRET")
	path := filepath.Join(dir, "bundle.pem")
	mustSymlink(t, outside, path)

	if err := removeCA(path, testCA); !errors.Is(err, errNotRegular) {
		t.Fatalf("got %v, want errNotRegular", err)
	}
	got, err := os.ReadFile(outside)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "SECRET" {
		t.Fatalf("the symlink target was modified: %q", got)
	}
}

func TestAppendCARefusesASymlink(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "host-secret")
	mustWriteFile(t, outside, "SECRET")
	path := filepath.Join(dir, "bundle.pem")
	mustSymlink(t, outside, path)

	if err := appendCA(path, testCA); !errors.Is(err, errNotRegular) {
		t.Fatalf("got %v, want errNotRegular", err)
	}
	got, err := os.ReadFile(outside)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "SECRET" {
		t.Fatalf("the symlink target was modified: %q", got)
	}
}

func TestRemoveCARefusesAFIFOWithoutBlocking(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	if err := syscall.Mkfifo(path, 0o644); err != nil {
		t.Skipf("mkfifo unavailable: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- removeCA(path, testCA) }()

	select {
	case err := <-done:
		if !errors.Is(err, errNotRegular) {
			t.Fatalf("got %v, want errNotRegular", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("removeCA blocked opening a FIFO")
	}
}

func TestAppendCARefusesAFIFOWithoutBlocking(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	if err := syscall.Mkfifo(path, 0o644); err != nil {
		t.Skipf("mkfifo unavailable: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- appendCA(path, testCA) }()

	select {
	case err := <-done:
		if !errors.Is(err, errNotRegular) {
			t.Fatalf("got %v, want errNotRegular", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("appendCA blocked opening a FIFO")
	}
}

func TestRemoveCARefusesADirectory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	mustMkdirAll(t, path)
	if err := removeCA(path, testCA); err == nil {
		t.Fatal("removeCA succeeded on a directory")
	}
}

// "/" survives filepath.Clean as a path with nothing in it. A variable set to
// it resolves to the rootfs itself, which containerPathOf then refuses to bind
// over, rather than to some path made from an empty component.
func TestResolveInRootResolvesTheRootItself(t *testing.T) {
	root := t.TempDir()

	resolved, err := resolveInRoot(root, "/")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != root {
		t.Errorf("resolveInRoot(%q, \"/\") = %q, want the rootfs itself", root, resolved)
	}
}

func TestWithinRoot(t *testing.T) {
	for _, c := range []struct {
		rootfs, path string
		want         bool
	}{
		{"/bundle/rootfs", "/bundle/rootfs", true},
		{"/bundle/rootfs", "/bundle/rootfs/etc", true},
		{"/bundle/rootfs", "/bundle/rootfs2/etc", false},
		{"/bundle/rootfs", "/bundle", false},
		{"/", "/", true},
		{"/", "/etc", true},
	} {
		if got := withinRoot(c.rootfs, c.path); got != c.want {
			t.Errorf("withinRoot(%q, %q) = %v, want %v", c.rootfs, c.path, got, c.want)
		}
	}
}

// A chain long enough to be a loop is refused rather than followed: the rootfs
// comes from an image the build chose, and following it is work done as root on
// the host.
func TestResolveInRootRefusesALongSymlinkChain(t *testing.T) {
	root := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "etc"))
	// hops is allowed up to 32, so 33 links is one past the limit. The last
	// one points at a real file, so only the length can be what refuses it.
	const links = 33
	for i := range links {
		mustSymlink(t,
			fmt.Sprintf("/etc/link%d", i+1),
			filepath.Join(root, "etc", fmt.Sprintf("link%d", i)))
	}
	mustWriteFile(t, filepath.Join(root, "etc", fmt.Sprintf("link%d", links)), "ROOTS")

	if _, err := resolveInRoot(root, "/etc/link0"); !errors.Is(err, errTooManySymlinks) {
		t.Fatalf("got %v, want errTooManySymlinks", err)
	}

	// One shorter, and the same chain resolves, so it is the count that decides.
	if _, err := resolveInRoot(root, "/etc/link1"); err != nil {
		t.Fatalf("a chain of %d should still resolve: %v", links-1, err)
	}
}

// The CA path can name a directory the image does not have. Creating it is
// fine; being unable to is not something to write through.
func TestAppendCARefusesAPathItCannotCreateADirectoryFor(t *testing.T) {
	dir := t.TempDir()
	mustWriteFile(t, filepath.Join(dir, "blocked"), "")
	// A regular file stands where the directory would have to go.
	if err := appendCA(filepath.Join(dir, "blocked", "bundle.pem"), testCA); err == nil {
		t.Fatal("expected appendCA to refuse the path")
	}
}

// Appending something removeCA could not match on would leave it in the image
// with nothing able to take it back out.
func TestAppendCARefusesSomethingThatIsNotACertificate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle.pem")
	mustWriteFile(t, path, "ORIGINAL\n")

	if err := appendCA(path, []byte("not a certificate")); !errors.Is(err, errNotACertificate) {
		t.Fatalf("got %v, want errNotACertificate", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "ORIGINAL\n" {
		t.Fatalf("got %q, want the bundle untouched", got)
	}
}

// A step is free to delete the bundle outright. There is then no block to
// strip, and no reason to fail the build over it.
func TestRemoveCAIsANoOpWhenTheFileIsGone(t *testing.T) {
	if err := removeCA(filepath.Join(t.TempDir(), "gone.pem"), testCA); err != nil {
		t.Fatalf("got %v, want nil", err)
	}
}

// Cutting a PEM block out of a binary would shift everything after it.
func TestRemoveCALeavesABinaryUntouched(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server")
	content := "\x7fELF\x02\x01\x01\x00" + string(testCA) + "\x00TRAILER"
	mustWriteFile(t, path, content)

	if err := removeCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != content {
		t.Fatalf("got %q, want it unchanged", got)
	}
}

// An empty bundle has no bytes to scan. The scan has to end on its own rather
// than read past the end of the file.
func TestRemoveCAIsANoOpOnAnEmptyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle.pem")
	mustWriteFile(t, path, "")

	if err := removeCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %q, want it left empty", got)
	}
}

// A step that truncated the bundle mid-certificate leaves an opening line with
// no end. Cutting from there to the end of the file would take whatever the
// step wrote with it, so nothing is removed.
func TestRemoveCALeavesAnUnterminatedBlockAlone(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle.pem")
	content := "ORIGINAL\n" + beginTestBlock + "\nQlVJTERDQUdFLUNB\n"
	mustWriteFile(t, path, content)

	if err := removeCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != content {
		t.Fatalf("got %q, want it unchanged", got)
	}
}

// withCA is a bundle already carrying the certificate, which is what removeCA
// is handed at the end of a step.
func withCA(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "bundle.pem")
	mustWriteFile(t, path, "ORIGINAL\n")
	if err := appendCA(path, testCA); err != nil {
		t.Fatal(err)
	}
	mustAppendFile(t, path, string(otherCA))
	return path
}

// The wrapper runs as root on the host and the bundle is the step's to
// rewrite, so an I/O failure partway through reading or writing it has to stop
// the strip rather than leave the file half-shifted and call it done.
func TestRemoveCAReportsAFailurePartwayThrough(t *testing.T) {
	cases := map[string]*brokenFile{
		"stat": {failStat: true},
		// A bundle this small is read once, and every search is served from that.
		"the read the searches go through": {failReadAt: 1},
		"the read that closes the gap":     {failReadAt: 2},
		"the write that closes the gap":    {failWriteAt: 1},
	}
	for name, broken := range cases {
		t.Run(name, func(t *testing.T) {
			path := withCA(t)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			useBrokenBundleFile(t, broken)

			if err := removeCA(path, testCA); !errors.Is(err, errBrokenFile) {
				t.Fatalf("got %v, want it to name the I/O failure", err)
			}
			after, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if broken.failWriteAt == 0 && string(after) != string(before) {
				t.Errorf("the bundle was changed before the failure:\n got %q\nwant %q", after, before)
			}
		})
	}
}

// A step can swap the bundle for something that is not a plain file between
// injection and the strip. Both ends refuse it rather than write through it.
func TestAppendAndRemoveCARefuseSomethingThatIsNotARegularFile(t *testing.T) {
	t.Run("appendCA cannot stat it", func(t *testing.T) {
		useBrokenBundleFile(t, &brokenFile{failStat: true})
		path := filepath.Join(t.TempDir(), "bundle.pem")
		if err := appendCA(path, testCA); !errors.Is(err, errBrokenFile) {
			t.Fatalf("got %v, want it to name the I/O failure", err)
		}
	})
	t.Run("appendCA finds it is not regular", func(t *testing.T) {
		useBrokenBundleFile(t, &brokenFile{notRegular: true})
		path := filepath.Join(t.TempDir(), "bundle.pem")
		if err := appendCA(path, testCA); !errors.Is(err, errNotRegular) {
			t.Fatalf("got %v, want errNotRegular", err)
		}
	})
	t.Run("appendCA cannot read the end of the bundle", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "bundle.pem")
		mustWriteFile(t, path, "ORIGINAL\n")
		useBrokenBundleFile(t, &brokenFile{failReadAt: 1})
		if err := appendCA(path, testCA); !errors.Is(err, errBrokenFile) {
			t.Fatalf("got %v, want it to name the I/O failure", err)
		}
	})
	t.Run("appendCA cannot write the separating newline", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "bundle.pem")
		mustWriteFile(t, path, "NO TRAILING NEWLINE")
		useBrokenBundleFile(t, &brokenFile{failWrite: 1})
		if err := appendCA(path, testCA); !errors.Is(err, errBrokenFile) {
			t.Fatalf("got %v, want it to name the I/O failure", err)
		}
	})
	t.Run("removeCA cannot stat it", func(t *testing.T) {
		path := withCA(t)
		useBrokenBundleFile(t, &brokenFile{failStat: true})
		if err := removeCA(path, testCA); !errors.Is(err, errBrokenFile) {
			t.Fatalf("got %v, want it to name the I/O failure", err)
		}
	})
}

// A scan with nothing left to read ends on its own rather than reading past
// the end of the file.
func TestFindInFileIsANoOpOnAnEmptyRange(t *testing.T) {
	f, err := os.Open(withCA(t))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	at, err := findInFile(newFileWindow(f, 0), beginPEM, 0)
	if err != nil {
		t.Fatal(err)
	}
	if at != -1 {
		t.Fatalf("got %d, want -1", at)
	}
}

// The scan carries len(needle)-1 bytes between reads, so a failure in any read
// but the first still has to come back rather than be taken for "not found".
func TestFindInFileReportsAFailedRead(t *testing.T) {
	path := withCA(t)
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		t.Fatal(err)
	}

	broken := &brokenFile{bundleFile: f, failReadAt: 1}
	if _, err := findInFile(newFileWindow(broken, info.Size()), beginPEM, 0); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want it to name the I/O failure", err)
	}
	broken = &brokenFile{bundleFile: f, failReadAt: 1}
	if _, err := isNewlineAt(broken, 0); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want it to name the I/O failure", err)
	}
}

// closeGaps copies forwards, so a read failure leaves bytes behind that the
// truncate would then cut off. It stops instead.
func TestCloseGapsReportsAFailedReadOrWrite(t *testing.T) {
	cases := map[string]*brokenFile{
		"the read":  {failReadAt: 2},
		"the write": {failWriteAt: 1},
	}
	for name, broken := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "bundle.pem")
			mustWriteFile(t, path, filler(4*scanChunk))
			f, err := os.OpenFile(path, os.O_RDWR, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			broken.bundleFile = f

			cuts := []span{{0, scanChunk}, {2 * scanChunk, 3 * scanChunk}}
			if _, err := closeGaps(broken, cuts, 4*scanChunk); !errors.Is(err, errBrokenFile) {
				t.Fatalf("got %v, want it to name the I/O failure", err)
			}
		})
	}
}

// An opening line the step cut short is not a block: the closing line the scan
// would otherwise pair it with belongs to whatever came after it.
func TestRemoveCALeavesAnUnfinishedOpeningLineAlone(t *testing.T) {
	cases := map[string]struct{ content, want string }{
		"nothing after it": {string(beginPEM), string(beginPEM)},
		"no label to close it": {
			"-----BEGIN CERTIFICATE\n" + string(testCA),
			"-----BEGIN CERTIFICATE\n",
		},
		"a label of no length": {
			"-----BEGIN -----\nQlVJTERDQUdFLUNB\n-----END -----\n",
			"-----BEGIN -----\nQlVJTERDQUdFLUNB\n-----END -----\n",
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "bundle.pem")
			mustWriteFile(t, path, c.content)

			if err := removeCA(path, testCA); err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func wrapped(s string, width int) string {
	var out strings.Builder
	for len(s) > width {
		out.WriteString(s[:width] + "\n")
		s = s[width:]
	}
	out.WriteString(s + "\n")
	return out.String()
}

func TestFileHoldsCAFindsTracesRemovalLeaves(t *testing.T) {
	ca, caKey := testIssuer(t, "this run")
	leaf, _ := testLeaf(t, ca, caKey, "allowed.example")
	caPEM := string(certPEM(ca))
	marks := caMarksOf([]byte(caPEM))

	indented := ""
	for _, line := range strings.SplitAfter(caPEM, "\n") {
		indented += "    " + line
	}
	body := base64.StdEncoding.EncodeToString(ca.Raw)
	pemAt60 := "-----BEGIN CERTIFICATE-----\n" + wrapped(body, 60) + "-----END CERTIFICATE-----\n"
	for name, content := range map[string]string{
		"PEM escaped into JSON":        `{"ca":"` + strings.ReplaceAll(caPEM, "\n", `\n`) + `"}`,
		"PEM indented into YAML":       "tls:\n  ca: |\n" + indented,
		"PEM at 60 escaped into JSON":  `{"ca":"` + strings.ReplaceAll(pemAt60, "\n", `\n`) + `"}`,
		"PEM at 60 indented into YAML": "ca: |\n  " + strings.ReplaceAll(pemAt60, "\n", "\n  "),
		"base64 with no breaks":        body,
		"base64 at 48 with no armour":  wrapped(body, 48),
		"base64 at 76 with no armour":  wrapped(body, 76),
		"a forged leaf as PEM":         string(certPEM(leaf)),
		"a forged leaf as DER":         string(leaf.Raw),
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "copy")
			mustWriteFile(t, path, content)
			found, err := fileHoldsCA(path, marks.needles)
			if err != nil {
				t.Fatalf("fileHoldsCA: %v", err)
			}
			if !found {
				t.Error("the copy was not found")
			}
		})
	}
}

func TestFileHoldsCALeavesAnotherCAAlone(t *testing.T) {
	ca, _ := testIssuer(t, "this run")
	other, otherKey := testIssuer(t, "another run")
	leaf, _ := testLeaf(t, other, otherKey, "allowed.example")
	marks := caMarksOf(certPEM(ca))
	path := filepath.Join(t.TempDir(), "bundle")
	mustWriteFile(t, path, string(certPEM(other))+string(certPEM(leaf))+
		base64.StdEncoding.EncodeToString(other.Raw)+string(leaf.Raw))
	found, err := fileHoldsCA(path, marks.needles)
	if err != nil {
		t.Fatalf("fileHoldsCA: %v", err)
	}
	if found {
		t.Error("another CA's certificates were taken for this one's")
	}
}

// testCA's DER is a placeholder that does not parse, so it has no subject.
func TestCAMarksOfACertificateThatDoesNotParse(t *testing.T) {
	marks := caMarksOf(testCA)
	if len(marks.ders) != 1 || len(marks.needles) != 2 {
		t.Fatalf("got %d ders and %d needles, want 1 and 2", len(marks.ders), len(marks.needles))
	}
	if string(marks.needles[1]) != "QlVJTERDQUdFLUNB" {
		t.Errorf("the base64 needle is %q", marks.needles[1])
	}
}

func TestCAMarksOfTakesABase64Prefix(t *testing.T) {
	ca, _ := testIssuer(t, "this run")
	marks := caMarksOf(certPEM(ca))
	if len(marks.needles) != 3 {
		t.Fatalf("got %d needles, want the DER, the subject and a base64 line", len(marks.needles))
	}
	if !bytes.Equal(marks.needles[1], ca.RawSubject) {
		t.Error("the second needle is not the CA's subject")
	}
	if got := string(marks.needles[2]); got != base64.StdEncoding.EncodeToString(ca.Raw)[:base64PrefixLength] {
		t.Errorf("the base64 needle is %q", got)
	}
}

// lateOpeningLines is a file whose second opening line sits where the search
// that finds it is still served from the window, but the block read after it
// runs past the window's end, so that read is the file's second.
func lateOpeningLines(t *testing.T, needles [][]byte) (string, int64) {
	t.Helper()
	longest := len(beginPEM)
	for _, needle := range needles {
		longest = max(longest, len(needle))
	}
	n := scanChunk + longest - 1
	first, second := n-200, 2*n-200
	content := strings.Repeat("a", first) + string(beginPEM) +
		strings.Repeat("a", second-first-len(beginPEM)) + string(beginPEM) +
		strings.Repeat("a", n)
	path := filepath.Join(t.TempDir(), "late.pem")
	mustWriteFile(t, path, content)
	return path, int64(len(content))
}

func TestBlockReadPastTheWindowReportsAFailedRead(t *testing.T) {
	marks := caMarksOf(testCA)
	open := func(t *testing.T, path string) *brokenFile {
		t.Helper()
		f, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { f.Close() })
		return &brokenFile{bundleFile: f, failReadAt: 2}
	}

	t.Run("scanForCA", func(t *testing.T) {
		path, size := lateOpeningLines(t, append([][]byte{beginPEM}, marks.needles...))
		if _, err := scanForCA(open(t, path), size, marks.needles); !errors.Is(err, errBrokenFile) {
			t.Fatalf("got %v, want it to name the I/O failure", err)
		}
	})
	t.Run("findCertificates", func(t *testing.T) {
		path, size := lateOpeningLines(t, [][]byte{beginPEM})
		if _, err := findCertificates(newFileWindow(open(t, path), size), marks.ders); !errors.Is(err, errBrokenFile) {
			t.Fatalf("got %v, want it to name the I/O failure", err)
		}
	})
}

// Each opening line without a block restarts the search just past it.
func TestUnterminatedOpeningLinesAreReadOnce(t *testing.T) {
	flood := strings.Repeat("-----BEGIN X-----\n", (1<<20)/18)
	content := flood + string(testCA)
	path := filepath.Join(t.TempDir(), "flood.pem")
	mustWriteFile(t, path, content)
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	size := int64(len(content))
	maxReads := int(size/scanChunk) + 1

	counted := &brokenFile{bundleFile: f}
	found, err := scanForCA(counted, size, caMarksOf(testCA).needles)
	if err != nil || !found {
		t.Fatalf("scanForCA: found=%v err=%v, want the certificate found", found, err)
	}
	if counted.reads > maxReads {
		t.Errorf("scanForCA read %d times, want at most %d", counted.reads, maxReads)
	}

	counted = &brokenFile{bundleFile: f}
	cuts, err := findCertificates(newFileWindow(counted, size), caMarksOf(testCA).ders)
	if err != nil {
		t.Fatal(err)
	}
	if want := []span{{int64(len(flood)), size}}; !slices.Equal(cuts, want) {
		t.Errorf("cuts = %v, want %v", cuts, want)
	}
	if counted.reads > maxReads {
		t.Errorf("findCertificates read %d times, want at most %d", counted.reads, maxReads)
	}
}
