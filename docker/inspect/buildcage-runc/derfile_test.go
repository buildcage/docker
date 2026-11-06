package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// A bare DER of the injected CA is what Mono's cert-sync leaves, and only that:
// a certificate with anything after it, a re-armoured PEM, or a keystore that
// merely opens the same way is not one of these and is left for another decoder.
func TestHoldsOnlyInjectedCert(t *testing.T) {
	ca := testCert(t, "buildcage")
	other := testCert(t, "digicert")
	ders := [][]byte{ca.Raw}

	cases := map[string]struct {
		content []byte
		want    bool
	}{
		"the CA as a bare DER":              {ca.Raw, true},
		"another certificate as a DER":      {other.Raw, false},
		"the CA's DER with a trailing byte": {append(bytes.Clone(ca.Raw), 0), false},
		"the CA as PEM":                     {certPEM(ca), false},
		"a PKCS#12 keystore of the CA":      {passwordlessStore(t, ca), false},
		"empty":                             {nil, false},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if got := holdsOnlyInjectedCert(c.content, ders); got != c.want {
				t.Errorf("holdsOnlyInjectedCert = %v, want %v", got, c.want)
			}
		})
	}
}

// removeFromBinaryStore empties a file that is one bare DER of the injected CA,
// rather than rewriting it, since nothing but the certificate is in it. The sweep
// then drops the emptied file.
func TestRemoveFromBinaryStoreEmptiesABareDERCert(t *testing.T) {
	ca := testCert(t, "buildcage")
	path := filepath.Join(t.TempDir(), "ski-DEADBEEF.cer")
	mustWriteFile(t, path, string(ca.Raw))
	rewritten, err := removeFromBinaryStore(path, [][]byte{ca.Raw})
	if err != nil || !rewritten {
		t.Fatalf("stripping the bare DER: rewritten=%v err=%v", rewritten, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() != 0 {
		t.Fatalf("the file was left holding %d bytes, want it emptied", info.Size())
	}
}

// A bare DER of a certificate that is not the injected CA is left untouched,
// reported as no rewrite the same way a keystore that does not hold it is.
func TestRemoveFromBinaryStoreLeavesABareDERThatIsNotTheCA(t *testing.T) {
	ca := testCert(t, "buildcage")
	other := testCert(t, "digicert")
	path := filepath.Join(t.TempDir(), "ski-CAFE.cer")
	mustWriteFile(t, path, string(other.Raw))
	before, _ := os.ReadFile(path)
	rewritten, err := removeFromBinaryStore(path, [][]byte{ca.Raw})
	if err != nil || rewritten {
		t.Fatalf("want no rewrite, got rewritten=%v err=%v", rewritten, err)
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Error("the file was changed")
	}
}

// Mono's cert-sync writes one bare DER per certificate under its trust
// directory. The sweep empties the injected CA's file and then drops it.
func TestSweepDirRemovesAMonoBareDERFile(t *testing.T) {
	ca := testCert(t, "buildcage")
	caPEM := certPEM(ca)
	dir := t.TempDir()
	cer := filepath.Join(dir, "ski-DEADBEEF.cer")
	mustWriteFile(t, cer, string(ca.Raw))

	if _, err := sweepDir(dir, dir, caPEM, caMarksOf(caPEM), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cer); !os.IsNotExist(err) {
		t.Fatalf("the bare DER file was left behind: %v", err)
	}
	left, err := verifyLayer(dir, caMarksOf(caPEM).needles)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Fatalf("the certificate is still in %v", left)
	}
}
