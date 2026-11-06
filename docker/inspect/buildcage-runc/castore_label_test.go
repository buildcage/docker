package main

import (
	"bytes"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// labelledCA is a real CA, since p11-kit's label line comes from its common
// name, armoured the way p11-kit writes it.
func labelledCA(t *testing.T, name string) []byte {
	t.Helper()
	cert, _ := selfSignedCA(t, 1, pkix.Name{CommonName: name})
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})
}

// p11KitBundle lays entries out as p11-kit's trust extract does: each
// certificate under a line naming it, with a blank line between entries.
func p11KitBundle(entries ...string) string {
	return strings.Join(entries, "\n")
}

func p11KitEntry(label string, pemBlock []byte) string {
	return "# " + label + "\n" + string(pemBlock)
}

// Taking the CA out of a bundle p11-kit rebuilt leaves it as p11-kit writes it
// without the CA, wherever the CA's entry sits.
func TestRemoveCATakesP11KitsLabelLineWithIt(t *testing.T) {
	ca := labelledCA(t, "buildcage proxy CA")
	first := p11KitEntry("ACCVRAIZ1", otherCA)
	second := p11KitEntry("AC RAIZ FNMT-RCM", []byte(beginTestBlock+"\nVEhJUkQ=\n"+endTestBlock+"\n"))
	own := p11KitEntry("buildcage proxy CA", ca)

	for _, tc := range []struct {
		name      string
		with, out string
	}{
		{"first", p11KitBundle(own, first, second), p11KitBundle(first, second)},
		{"middle", p11KitBundle(first, own, second), p11KitBundle(first, second)},
		{"last", p11KitBundle(first, second, own), p11KitBundle(first, second)},
		{"alone", own, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "tls-ca-bundle.pem")
			mustWriteFile(t, path, tc.with)
			if _, err := removeCA(path, caMarksOf(ca)); err != nil {
				t.Fatal(err)
			}
			if got := mustReadFile(t, path); got != tc.out {
				t.Errorf("got %q, want %q", got, tc.out)
			}
		})
	}
}

// Two copies of the CA side by side each take their own label and one blank
// line, whether they end the bundle or start it.
func TestRemoveCATakesTheLabelOfEachAdjacentCopy(t *testing.T) {
	ca := labelledCA(t, "buildcage proxy CA")
	first := p11KitEntry("ACCVRAIZ1", otherCA)
	own := p11KitEntry("buildcage proxy CA", ca)
	for name, with := range map[string]string{
		"at the end":   p11KitBundle(first, own, own),
		"at the start": p11KitBundle(own, own, first),
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "tls-ca-bundle.pem")
			mustWriteFile(t, path, with)
			if _, err := removeCA(path, caMarksOf(ca)); err != nil {
				t.Fatal(err)
			}
			if got := mustReadFile(t, path); got != first {
				t.Errorf("got %q, want %q", got, first)
			}
		})
	}
}

// Only the CA's own label at the start of a line goes. A comment of the
// bundle's own above it, or the label's text ending another line, stays.
func TestRemoveCAKeepsLinesThatAreNotItsLabel(t *testing.T) {
	ca := labelledCA(t, "buildcage proxy CA")
	for _, tc := range []struct {
		name, before string
	}{
		{"another comment", "# Company root\n"},
		{"mid-line", "see # buildcage proxy CA\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "bundle.pem")
			mustWriteFile(t, path, string(otherCA)+tc.before+string(ca))
			if _, err := removeCA(path, caMarksOf(ca)); err != nil {
				t.Fatal(err)
			}
			if got, want := mustReadFile(t, path), string(otherCA)+tc.before; got != want {
				t.Errorf("got %q, want %q", got, want)
			}
		})
	}
}

// A certificate with no common name, or one that does not parse, gets no
// label to look for.
func TestCAMarksHaveNoLabelWithoutACommonName(t *testing.T) {
	for name, ca := range map[string][]byte{
		"no common name":    labelledCA(t, ""),
		"not a certificate": testCA,
	} {
		if labels := caMarksOf(ca).labels; len(labels) != 0 {
			t.Errorf("%s: got %q, want none", name, labels)
		}
	}
}

// The label is read back from before the block, which can be past what the
// window still holds, so a read failing there is reported, and one the file
// has shrunk under leaves the cut as it was.
func TestWithLabelLineReadsBackBeforeTheBlock(t *testing.T) {
	labels := [][]byte{[]byte("# buildcage proxy CA\n")}
	content := []byte("# buildcage proxy CA\n" + string(otherCA))
	cut := span{int64(len(labels[0])), int64(len(content))}

	t.Run("read failure", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "bundle.pem")
		mustWriteFile(t, path, string(content))
		f := &brokenFile{bundleFile: openForRead(t, path), failReadAt: 1}
		if _, err := withLabelLine(newFileWindow(f, int64(len(content))), cut, labels, 0); !errors.Is(err, errBrokenFile) {
			t.Fatalf("got %v, want the I/O failure", err)
		}
	})
	t.Run("shrunk", func(t *testing.T) {
		short := bytes.NewReader(content[:cut.end-4])
		got, err := withLabelLine(newFileWindow(short, int64(len(content))), cut, labels, 0)
		if err != nil || got != cut {
			t.Fatalf("got %v, %v, want the cut unchanged", got, err)
		}
	})
}

// findCertificates passes on a failure to read the label back.
func TestFindCertificatesReportsAFailedLabelRead(t *testing.T) {
	ca := labelledCA(t, "buildcage proxy CA")
	// Far enough in that the window has moved past the label by the time the
	// block is read, so the label needs a read of its own.
	padding := strings.Repeat("#\n", (4*scanChunk)/2)
	content := padding + p11KitEntry("buildcage proxy CA", ca)
	path := filepath.Join(t.TempDir(), "bundle.pem")
	mustWriteFile(t, path, content)

	counted := &brokenFile{bundleFile: openForRead(t, path)}
	if _, _, err := findCertificates(newFileWindow(counted, int64(len(content))), caMarksOf(ca)); err != nil {
		t.Fatal(err)
	}
	f := &brokenFile{bundleFile: openForRead(t, path), failReadAt: counted.reads}
	if _, _, err := findCertificates(newFileWindow(f, int64(len(content))), caMarksOf(ca)); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want the I/O failure", err)
	}
}

func openForRead(t *testing.T, path string) *os.File {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return f
}

func mustReadFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
