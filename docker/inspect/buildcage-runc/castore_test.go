package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
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

	cases := map[string]string{
		"symlink to an absolute host path": outside,
		"symlink climbing out with ..":     "../../../../../../etc/passwd",
	}
	for name, target := range cases {
		t.Run(name, func(t *testing.T) {
			link := filepath.Join(root, "etc", "ca.pem")
			mustSymlink(t, target, link)
			// The property that matters is that nothing outside the rootfs is
			// ever returned. Refusing outright and failing to find a path that
			// only exists on the host are both acceptable.
			resolved, err := resolveInRoot(root, "/etc/ca.pem")
			if err == nil && !strings.HasPrefix(resolved, root+string(os.PathSeparator)) {
				t.Fatalf("resolved outside the rootfs: %s", resolved)
			}
			if resolved == outside {
				t.Fatal("resolved to the host file")
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

// testCA is PEM-shaped rather than a real certificate: removal matches on the
// base64 between the two lines and never decodes it.
var testCA = []byte("-----BEGIN CERTIFICATE-----\nQlVJTERDQUdFLUNB\n-----END CERTIFICATE-----\n")

// otherCA stands for a certificate the bundle already carried, which removal
// has to walk past.
var otherCA = []byte("-----BEGIN CERTIFICATE-----\nU09NRU9ORS1FTFNF\n-----END CERTIFICATE-----\n")

// caOfSize is a PEM block of exactly n bytes, so a test can place a
// certificate at a chosen offset relative to a read window.
func caOfSize(t *testing.T, n int) []byte {
	t.Helper()
	body := n - len(beginCertificate) - len(endCertificate) - 3
	if body < 1 {
		t.Fatalf("%d bytes is too small for a PEM block", n)
	}
	return fmt.Appendf(nil, "%s\n%s\n%s\n", beginCertificate, strings.Repeat("Q", body), endCertificate)
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
	truncated := string(beginCertificate) + "\nVFJVTkNBVEVE\n"
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
		"an unterminated one":   string(beginCertificate) + "\nQlVJTERDQUdFLUNB\n",
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
		"opening line ending a window":      {scanChunk - len(beginCertificate), 64, scanChunk},
		"opening line starting a window":    {scanChunk, 64, scanChunk},
		"opening line over a read boundary": {scanChunk + len(beginCertificate)/2, 64, 2 * scanChunk},
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
	content := "ORIGINAL\n" + string(beginCertificate) + "\nQlVJTERDQUdFLUNB\n"
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
		"stat":                                    {failStat: true},
		"the scan for the opening line":           {failReadAt: 1},
		"the scan for the closing line":           {failReadAt: 2},
		"the read of the certificate itself":      {failReadAt: 3},
		"the newline check after the certificate": {failReadAt: 4},
		"the shift that closes the gap":           {failWriteAt: 1},
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

	at, err := findInFile(f, beginCertificate, 0, 0)
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
	if _, err := findInFile(broken, beginCertificate, 0, info.Size()); !errors.Is(err, errBrokenFile) {
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

// A path under something that is not a directory cannot be resolved, and is
// refused rather than guessed at: the rootfs comes from an image the build
// chose.
func TestResolveInRootRefusesAPathUnderARegularFile(t *testing.T) {
	root := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "etc"))
	mustWriteFile(t, filepath.Join(root, "etc", "ssl"), "not a directory")

	if _, err := resolveInRoot(root, "/etc/ssl/certs/ca-certificates.crt"); err == nil {
		t.Fatal("expected resolveInRoot to refuse the path")
	}
}
