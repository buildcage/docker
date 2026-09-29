package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/pem"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

// A PKCS#12 trust store holds parsed X.509 certificates, unlike the JKS tests
// whose "DER" is a stand-in string the parser never decodes. These build real
// certificates so go-pkcs12 accepts them the way a JDK's cacerts does.
func testCert(t *testing.T, cn string) *x509.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generating a key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             time.Unix(1700000000, 0),
		NotAfter:              time.Unix(1900000000, 0),
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("creating a certificate: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parsing the certificate: %v", err)
	}
	return cert
}

// passwordlessStore is a cacerts written the way the JDK ships one: no MAC, the
// certificate bags unencrypted, so it opens under the empty password.
func passwordlessStore(t *testing.T, certs ...*x509.Certificate) []byte {
	t.Helper()
	data, err := pkcs12.Passwordless.EncodeTrustStore(certs, "")
	if err != nil {
		t.Fatalf("encoding a trust store: %v", err)
	}
	return data
}

// keytoolStore is a trust store the way keytool creates one: sealed under
// changeit, its entry under an alias of its own. Re-encoding draws a fresh salt,
// so the round trip never reproduces these bytes, the churn
// restoreUntouchedKeystores prevents.
func keytoolStore(t *testing.T, alias string, cert *x509.Certificate) []byte {
	t.Helper()
	data, err := pkcs12.Modern.EncodeTrustStoreEntries(
		[]pkcs12.TrustStoreEntry{{Cert: cert, FriendlyName: alias}}, keystorePassword)
	if err != nil {
		t.Fatalf("encoding a named trust store: %v", err)
	}
	return data
}

// encryptedStore is a Modern trust store: its certificate bags are PBES2
// encrypted under a password of its own, so decodePKCS12 cannot open it. It
// stands in for a keystore a step replaced with one of its own that this cannot
// rewrite.
func encryptedStore(t *testing.T, certs ...*x509.Certificate) []byte {
	t.Helper()
	data, err := pkcs12.Modern.EncodeTrustStore(certs, "a-real-password")
	if err != nil {
		t.Fatalf("encoding an encrypted trust store: %v", err)
	}
	return data
}

func certPEM(cert *x509.Certificate) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})
}

func mustWritePKCS12(t *testing.T, content []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "cacerts")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("writing %s: %v", path, err)
	}
	return path
}

// A JDK's own cacerts carries no MAC, so it decodes under the empty password
// even though it is nominally "changeit"-sealed. This is the property the whole
// PKCS#12 path rests on.
func TestDecodePKCS12EmptyPassword(t *testing.T) {
	ca := testCert(t, "buildcage")
	root := testCert(t, "digicert")
	certs, _, err := decodePKCS12(passwordlessStore(t, root, ca))
	if err != nil {
		t.Fatalf("decoding under the empty password: %v", err)
	}
	if len(certs) != 2 {
		t.Fatalf("decoded %d certificates, want 2", len(certs))
	}
}

func TestPKCS12Without(t *testing.T) {
	ca := testCert(t, "buildcage")
	root := testCert(t, "digicert")
	out, removed, err := pkcs12Without(passwordlessStore(t, root, ca), [][]byte{ca.Raw})
	if err != nil || !removed {
		t.Fatalf("removing the CA: removed=%v err=%v", removed, err)
	}
	if bytes.Contains(out, ca.Raw) {
		t.Error("the CA's DER is still in the rewritten keystore")
	}
	certs, _, err := decodePKCS12(out)
	if err != nil {
		t.Fatalf("the rewritten keystore no longer decodes: %v", err)
	}
	if len(certs) != 1 || certs[0].Cert.Subject.CommonName != "digicert" {
		t.Errorf("the rewrite left %d certificates, want only digicert", len(certs))
	}
}

// The DER of the OIDs for 3DES-encrypted bags and for PBES2.
var (
	oid3DESBytes  = []byte{0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x0c, 0x01, 0x03}
	oidPBES2Bytes = []byte{0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0d}
)

// assertPKCS12Format checks that out is legacy (a SHA-1 MAC and 3DES bags) or
// modern (PBES2).
func assertPKCS12Format(t *testing.T, out []byte, legacy bool) {
	t.Helper()
	if pkcs12MACIsSHA1(out) != legacy {
		t.Errorf("SHA-1 MAC = %v, want %v", !legacy, legacy)
	}
	if legacy && (!bytes.Contains(out, oid3DESBytes) || bytes.Contains(out, oidPBES2Bytes)) {
		t.Error("a legacy store was not rewritten with 3DES bags")
	}
	if !legacy && !bytes.Contains(out, oidPBES2Bytes) {
		t.Error("a modern store was not rewritten with PBES2")
	}
}

// A trust store keytool creates is sealed under "changeit" with its bags
// encrypted; the CA found in it by detection is taken out the same way, and the
// store stays sealed under "changeit" in the format it came in.
func TestPKCS12WithoutChangeitSealed(t *testing.T) {
	ca := testCert(t, "buildcage")
	root := testCert(t, "digicert")
	for name, c := range map[string]struct {
		enc    *pkcs12.Encoder
		legacy bool
	}{
		"Modern (keytool on JDK 17 on)": {pkcs12.Modern, false},
		"LegacyRC2 (keytool on JDK 8)":  {pkcs12.LegacyRC2, true},
		"LegacyDES":                     {pkcs12.LegacyDES, true},
	} {
		t.Run(name, func(t *testing.T) {
			out, removed, err := pkcs12Without(mustEncodeTrustStore(t, c.enc, keystorePassword, root, ca), [][]byte{ca.Raw})
			if err != nil || !removed {
				t.Fatalf("removing the CA: removed=%v err=%v", removed, err)
			}
			assertPKCS12Format(t, out, c.legacy)
			if _, err := pkcs12.DecodeTrustStore(out, ""); err == nil {
				t.Fatal("the rewrite opens without the password")
			}
			certs, err := pkcs12.DecodeTrustStore(out, keystorePassword)
			if err != nil {
				t.Fatalf("the rewrite does not open under changeit: %v", err)
			}
			if len(certs) != 1 || certs[0].Subject.CommonName != "digicert" {
				t.Errorf("the rewrite left %d certificates, want only digicert", len(certs))
			}
		})
	}
}

// A store decodePKCS12 will not open is one this cannot rewrite: it removes
// nothing and leaves the caller to report it.
func TestPKCS12WithoutUndecodable(t *testing.T) {
	ca, caKey := testIssuer(t, "this run")
	leaf, leafKey := testLeaf(t, ca, caKey, "app.example")
	chain, err := pkcs12.Modern.Encode(leafKey, leaf, []*x509.Certificate{ca}, keystorePassword)
	if err != nil {
		t.Fatalf("encoding a keystore: %v", err)
	}
	for name, content := range map[string][]byte{
		"a Modern encrypted store":       encryptedStore(t, ca),
		"a key and chain under changeit": chain,
		"pkcs12-shaped garbage":          append([]byte{0x30, 0x82}, ca.Raw...),
	} {
		t.Run(name, func(t *testing.T) {
			out, removed, err := pkcs12Without(content, [][]byte{ca.Raw})
			if err != nil || removed || out != nil {
				t.Fatalf("want (nil,false,nil), got (%v,%v,%v)", out, removed, err)
			}
		})
	}
}

// The DER a scan matched is in the file's bytes but not as a decoded trusted
// certificate: nothing is removed and the caller is left to report it.
func TestPKCS12WithoutCertNotAmongEntries(t *testing.T) {
	root := testCert(t, "digicert")
	ca := testCert(t, "buildcage")
	out, removed, err := pkcs12Without(passwordlessStore(t, root), [][]byte{ca.Raw})
	if err != nil || removed || out != nil {
		t.Fatalf("want (nil,false,nil), got (%v,%v,%v)", out, removed, err)
	}
}

// The encode-error branch: valid certificates under the empty password never
// make Passwordless.EncodeTrustStore fail, so the seam is stubbed to prove the
// error is handed back rather than a truncated keystore being written.
func TestPKCS12WithoutEncodeFails(t *testing.T) {
	ca := testCert(t, "buildcage")
	root := testCert(t, "digicert")
	old := encodePKCS12
	encodePKCS12 = func([]pkcs12.TrustStoreEntry, string, bool) ([]byte, error) { return nil, errBrokenFile }
	t.Cleanup(func() { encodePKCS12 = old })
	if _, _, err := pkcs12Without(passwordlessStore(t, root, ca), [][]byte{ca.Raw}); !errors.Is(err, errBrokenFile) {
		t.Fatalf("want the encode failure, got %v", err)
	}
}

// Removing the last certificate is not an error: the empty store re-encodes and
// decodes cleanly and carries no DER, so the sweep passes rather than leaving an
// unreadable keystore behind.
func TestPKCS12WithoutRemovesLastCert(t *testing.T) {
	ca := testCert(t, "buildcage")
	out, removed, err := pkcs12Without(passwordlessStore(t, ca), [][]byte{ca.Raw})
	if err != nil || !removed {
		t.Fatalf("removing the only cert: removed=%v err=%v", removed, err)
	}
	certs, _, err := decodePKCS12(out)
	if err != nil {
		t.Fatalf("the emptied keystore no longer decodes: %v", err)
	}
	if len(certs) != 0 {
		t.Errorf("the emptied keystore still holds %d certificates", len(certs))
	}
}

// removeFromBinaryStore reads the file once and dispatches on its magic: a
// PKCS#12 keystore holding the CA is rewritten in place, the gap that used to
// fail the build.
func TestRemoveFromKeystoreStripsPKCS12(t *testing.T) {
	ca := testCert(t, "buildcage")
	root := testCert(t, "digicert")
	path := mustWritePKCS12(t, passwordlessStore(t, root, ca))
	rewritten, err := removeFromBinaryStore(path, [][]byte{ca.Raw})
	if err != nil || !rewritten {
		t.Fatalf("rewriting the PKCS#12 keystore: rewritten=%v err=%v", rewritten, err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(content, ca.Raw) {
		t.Error("the CA's DER is still in the file on disk")
	}
}

// A PKCS#12 keystore that does not hold the CA is left untouched, reported as no
// rewrite the same way a non-keystore file is.
func TestRemoveFromKeystorePKCS12NotHolding(t *testing.T) {
	root := testCert(t, "digicert")
	ca := testCert(t, "buildcage")
	path := mustWritePKCS12(t, passwordlessStore(t, root))
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

// removeFromBinaryStore hands a PKCS#12 rewrite error back rather than
// reporting no rewrite, so the caller does not read a failed strip as a clean
// one.
func TestRemoveFromKeystorePKCS12Error(t *testing.T) {
	ca := testCert(t, "buildcage")
	root := testCert(t, "digicert")
	path := mustWritePKCS12(t, passwordlessStore(t, root, ca))
	old := encodePKCS12
	encodePKCS12 = func([]pkcs12.TrustStoreEntry, string, bool) ([]byte, error) { return nil, errBrokenFile }
	t.Cleanup(func() { encodePKCS12 = old })
	if _, err := removeFromBinaryStore(path, [][]byte{ca.Raw}); !errors.Is(err, errBrokenFile) {
		t.Fatalf("want the encode failure, got %v", err)
	}
}

// The sweep reaches the PKCS#12 rewrite through stripCA: a PKCS#12 cacerts
// holding the CA is stripped rather than failing the build as it did before.
func TestStripCARewritesPKCS12(t *testing.T) {
	ca := testCert(t, "buildcage")
	root := testCert(t, "digicert")
	caPEM := certPEM(ca)
	path := mustWritePKCS12(t, passwordlessStore(t, root, ca))
	left, err := stripCA(path, caPEM, caMarksOf(caPEM))
	if err != nil {
		t.Fatalf("stripCA: %v", err)
	}
	if left {
		t.Error("stripCA left the CA in a PKCS#12 keystore it can rewrite")
	}
}

// A file shaped like a PKCS#12 that carries the CA's DER in the clear but will
// not decode: the DER is found, the keystore rewrite cannot reach it, and
// stripCA reports it left rather than passing the build. It fails closed only
// because the DER is actually present; an encrypted store hides the DER instead,
// so it is never a strip candidate.
func TestStripCAUnstrippableWhenUndecodable(t *testing.T) {
	ca := testCert(t, "buildcage")
	caPEM := certPEM(ca)
	path := mustWritePKCS12(t, append([]byte{0x30, 0x82}, ca.Raw...))
	left, err := stripCA(path, caPEM, caMarksOf(caPEM))
	if err != nil {
		t.Fatalf("stripCA: %v", err)
	}
	if !left {
		t.Error("stripCA cleared a keystore it cannot decode though the DER is present")
	}
}

// stripCA hands a rewrite error back rather than swallowing it: a write that
// fails mid-rewrite leaves the layer possibly still carrying the CA, so the
// build must not proceed.
func TestStripCAPropagatesPKCS12Error(t *testing.T) {
	ca := testCert(t, "buildcage")
	root := testCert(t, "digicert")
	caPEM := certPEM(ca)
	path := mustWritePKCS12(t, passwordlessStore(t, root, ca))
	useBrokenBundleFile(t, &brokenFile{failWriteAt: 1})
	if _, err := stripCA(path, caPEM, caMarksOf(caPEM)); !errors.Is(err, errBrokenFile) {
		t.Fatalf("want the write failure propagated, got %v", err)
	}
}

// pkcs12With adds a trusted certificate to a passwordless store, leaving it
// decodable and holding the added cert alongside the ones it had.
func TestPKCS12With(t *testing.T) {
	root := testCert(t, "digicert")
	ca := testCert(t, "buildcage")
	out, err := pkcs12With(passwordlessStore(t, root), [][]byte{ca.Raw})
	if err != nil {
		t.Fatalf("pkcs12With: %v", err)
	}
	certs, _, err := decodePKCS12(out)
	if err != nil {
		t.Fatalf("the injected store no longer decodes: %v", err)
	}
	names := map[string]bool{}
	for _, c := range certs {
		names[c.Cert.Subject.CommonName] = true
	}
	if !names["digicert"] || !names["buildcage"] {
		t.Errorf("injected store holds %v, want both digicert and buildcage", names)
	}
}

// A store keytool created under "changeit" is injected into like the JDK's own
// and stays sealed under "changeit" in the format it came in.
func TestPKCS12WithChangeitSealed(t *testing.T) {
	root := testCert(t, "digicert")
	ca := testCert(t, "buildcage")
	legacy, err := pkcs12With(mustEncodeTrustStore(t, pkcs12.LegacyRC2, keystorePassword, root), [][]byte{ca.Raw})
	if err != nil {
		t.Fatalf("pkcs12With: %v", err)
	}
	assertPKCS12Format(t, legacy, true)
	out, err := pkcs12With(mustEncodeTrustStore(t, pkcs12.Modern, keystorePassword, root), [][]byte{ca.Raw})
	if err != nil {
		t.Fatalf("pkcs12With: %v", err)
	}
	assertPKCS12Format(t, out, false)
	certs, password, err := decodePKCS12(out)
	if err != nil || password != keystorePassword {
		t.Fatalf("the injected store opens under %q (err %v), want changeit", password, err)
	}
	if len(certs) != 2 {
		t.Errorf("injected store holds %d certificates, want 2", len(certs))
	}
}

// A store decodePKCS12 will not open cannot be injected into.
func TestPKCS12WithUndecodable(t *testing.T) {
	ca := testCert(t, "buildcage")
	if _, err := pkcs12With(encryptedStore(t, ca), [][]byte{ca.Raw}); err == nil {
		t.Fatal("want a decode error for an encrypted store")
	}
}

// The DER handed in has to be a certificate; anything else is reported rather
// than written into the store.
func TestPKCS12WithRejectsBadDER(t *testing.T) {
	root := testCert(t, "digicert")
	if _, err := pkcs12With(passwordlessStore(t, root), [][]byte{[]byte("not a certificate")}); err == nil {
		t.Fatal("want a parse error for a non-certificate DER")
	}
}

func mustEncodeEntries(t *testing.T, password string, entries ...pkcs12.TrustStoreEntry) []byte {
	t.Helper()
	enc := pkcs12.Passwordless
	if password != "" {
		enc = pkcs12.Modern
	}
	data, err := enc.EncodeTrustStoreEntries(entries, password)
	if err != nil {
		t.Fatalf("encoding a trust store: %v", err)
	}
	return data
}

func aliasesOf(t *testing.T, content []byte) []string {
	t.Helper()
	entries, _, err := decodePKCS12(content)
	if err != nil {
		t.Fatalf("decoding the rewritten store: %v", err)
	}
	var aliases []string
	for _, entry := range entries {
		aliases = append(aliases, entry.FriendlyName)
	}
	return aliases
}

// Taking the CA out keeps every other entry under its own alias, including two
// that share a subject.
func TestPKCS12WithoutKeepsAliases(t *testing.T) {
	ca := testCert(t, "buildcage")
	oldRoot := testCert(t, "Corp Root")
	newRoot := testCert(t, "Corp Root")
	for _, password := range sealedKeystorePasswords {
		t.Run("password "+password, func(t *testing.T) {
			content := mustEncodeEntries(t, password,
				pkcs12.TrustStoreEntry{Cert: oldRoot, FriendlyName: "corp-2025"},
				pkcs12.TrustStoreEntry{Cert: ca, FriendlyName: injectedAlias},
				pkcs12.TrustStoreEntry{Cert: newRoot, FriendlyName: "corp-2026"})
			out, removed, err := pkcs12Without(content, [][]byte{ca.Raw})
			if err != nil || !removed {
				t.Fatalf("removing the CA: removed=%v err=%v", removed, err)
			}
			if got := aliasesOf(t, out); !slices.Equal(got, []string{"corp-2025", "corp-2026"}) {
				t.Errorf("aliases after the strip = %q, want [corp-2025 corp-2026]", got)
			}
		})
	}
}

// Injection keeps the store's aliases and names each injected certificate the
// way a JKS injection does.
func TestPKCS12WithNamesInjectedEntries(t *testing.T) {
	root := testCert(t, "digicert")
	ca1, ca2 := testCert(t, "buildcage"), testCert(t, "buildcage cross-signed")
	content := mustEncodeEntries(t, "", pkcs12.TrustStoreEntry{Cert: root, FriendlyName: "digicertglobalrootca [jdk]"})
	out, err := pkcs12With(content, [][]byte{ca1.Raw, ca2.Raw})
	if err != nil {
		t.Fatalf("pkcs12With: %v", err)
	}
	want := []string{"digicertglobalrootca [jdk]", injectedAlias, injectedAlias + "-1"}
	if got := aliasesOf(t, out); !slices.Equal(got, want) {
		t.Errorf("aliases after injection = %q, want %q", got, want)
	}
}

// A store with a malformed alias still has the CA taken out, its entries
// renamed after their subjects.
func TestPKCS12WithoutAMalformedAlias(t *testing.T) {
	ca := testCert(t, "buildcage")
	root := testCert(t, "digicert")
	alias := "malformed-alias"
	content := mustEncodeEntries(t, "",
		pkcs12.TrustStoreEntry{Cert: root, FriendlyName: alias},
		pkcs12.TrustStoreEntry{Cert: ca, FriendlyName: injectedAlias})
	// Retag the alias's BMPString (0x1e) as a UTF8String (0x0c). The store is
	// passwordless, so the bag is in the clear and carries no MAC to break.
	bmp := []byte{0x1e, byte(2 * len(alias))}
	for _, r := range alias {
		bmp = append(bmp, 0, byte(r))
	}
	at := bytes.Index(content, bmp)
	if at < 0 {
		t.Fatal("the alias's BMPString is not in the store")
	}
	content[at] = 0x0c
	if _, err := pkcs12.DecodeTrustStoreEntries(content, ""); err == nil {
		t.Fatal("the retagged alias still decodes, so this tests nothing")
	}

	out, removed, err := pkcs12Without(content, [][]byte{ca.Raw})
	if err != nil || !removed {
		t.Fatalf("removing the CA: removed=%v err=%v", removed, err)
	}
	if got := aliasesOf(t, out); !slices.Equal(got, []string{"CN=digicert"}) {
		t.Errorf("aliases after the strip = %q, want [CN=digicert]", got)
	}
}

// An entry without an alias is written under its subject.
func TestEncodePKCS12NamesAnEntryWithoutAnAlias(t *testing.T) {
	a, b := testCert(t, "first"), testCert(t, "second")
	out, err := encodePKCS12([]pkcs12.TrustStoreEntry{{Cert: a}, {Cert: b, FriendlyName: "kept"}}, "", false)
	if err != nil {
		t.Fatalf("encodePKCS12: %v", err)
	}
	if got := aliasesOf(t, out); !slices.Equal(got, []string{"CN=first", "kept"}) {
		t.Errorf("aliases = %q, want [CN=first kept]", got)
	}
}

// nonce stands in for the random serialNumber in the proxy CA's subject.
func testIssuer(t *testing.T, nonce string) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generating a key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(7),
		Subject:               pkix.Name{CommonName: "buildcage proxy CA", SerialNumber: nonce},
		NotBefore:             time.Unix(1700000000, 0),
		NotAfter:              time.Unix(1900000000, 0),
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("creating the CA: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parsing the CA: %v", err)
	}
	return cert, key
}

func testLeaf(t *testing.T, ca *x509.Certificate, caKey *ecdsa.PrivateKey, host string) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generating a key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(8),
		Subject:      pkix.Name{CommonName: host},
		DNSNames:     []string{host},
		NotBefore:    time.Unix(1700000000, 0),
		NotAfter:     time.Unix(1900000000, 0),
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca, &key.PublicKey, caKey)
	if err != nil {
		t.Fatalf("creating the leaf: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parsing the leaf: %v", err)
	}
	return cert, key
}

func mustEncodeTrustStore(t *testing.T, enc *pkcs12.Encoder, password string, certs ...*x509.Certificate) []byte {
	t.Helper()
	data, err := enc.EncodeTrustStore(certs, password)
	if err != nil {
		t.Fatalf("encoding a trust store: %v", err)
	}
	return data
}

func TestFileHoldsCAReadsAnEncryptedPKCS12ItCanOpen(t *testing.T) {
	ca, caKey := testIssuer(t, "this run")
	root := testCert(t, "digicert")
	leaf, _ := testLeaf(t, ca, caKey, "app.example")
	marks := caMarksOf(certPEM(ca))

	for name, content := range map[string][]byte{
		"a trust store under changeit":        mustEncodeTrustStore(t, pkcs12.Modern, keystorePassword, root, ca),
		"a trust store under no password":     mustEncodeTrustStore(t, pkcs12.Modern, "", root, ca),
		"a trust store holding a forged leaf": mustEncodeTrustStore(t, pkcs12.Modern, keystorePassword, root, leaf),
	} {
		t.Run(name, func(t *testing.T) {
			if bytes.Contains(content, ca.Raw) {
				t.Fatal("the fixture holds the DER in the clear, so it would not test the decryption")
			}
			found, err := fileHoldsCA(mustWritePKCS12(t, content), marks.needles)
			if err != nil {
				t.Fatalf("fileHoldsCA: %v", err)
			}
			if !found {
				t.Error("an encrypted keystore holding the CA passed")
			}
		})
	}
}

// Only trust stores are decoded, so a key with its chain passes too.
func TestFileHoldsCAPassesAnEncryptedPKCS12WithoutTheCA(t *testing.T) {
	ca, caKey := testIssuer(t, "this run")
	caLeaf, caLeafKey := testLeaf(t, ca, caKey, "app.example")
	chainWithCA, err := pkcs12.Modern.Encode(caLeafKey, caLeaf, []*x509.Certificate{ca}, keystorePassword)
	if err != nil {
		t.Fatalf("encoding a keystore: %v", err)
	}
	other, otherKey := testIssuer(t, "another run")
	leaf, leafKey := testLeaf(t, other, otherKey, "app.example")
	withKey, err := pkcs12.Modern.Encode(leafKey, leaf, []*x509.Certificate{other}, keystorePassword)
	if err != nil {
		t.Fatalf("encoding a keystore: %v", err)
	}
	marks := caMarksOf(certPEM(ca))

	for name, content := range map[string][]byte{
		"the CA under a password of its own": mustEncodeTrustStore(t, pkcs12.Modern, "a-real-password", ca),
		"another CA under changeit":          mustEncodeTrustStore(t, pkcs12.Modern, keystorePassword, other),
		"a key and chain of another CA":      withKey,
		"a key and chain holding the CA":     chainWithCA,
	} {
		t.Run(name, func(t *testing.T) {
			found, err := fileHoldsCA(mustWritePKCS12(t, content), marks.needles)
			if err != nil {
				t.Fatalf("fileHoldsCA: %v", err)
			}
			if found {
				t.Error("an encrypted keystore without a readable copy of the CA failed")
			}
		})
	}
}

func TestSealedPKCS12HoldsSkipsAnOversizedFile(t *testing.T) {
	ca, _ := testIssuer(t, "this run")
	content := mustEncodeTrustStore(t, pkcs12.Modern, keystorePassword, ca)
	old := maxKeystoreBytes
	maxKeystoreBytes = int64(len(content)) - 1
	t.Cleanup(func() { maxKeystoreBytes = old })
	found, err := sealedPKCS12Holds(bytes.NewReader(content), int64(len(content)), caMarksOf(certPEM(ca)).needles)
	if err != nil || found {
		t.Fatalf("got found=%v err=%v, want the file left unread", found, err)
	}
}

func TestSealedPKCS12HoldsReportsAFailedRead(t *testing.T) {
	ca, _ := testIssuer(t, "this run")
	content := mustEncodeTrustStore(t, pkcs12.Modern, keystorePassword, ca)
	path := mustWritePKCS12(t, content)
	for _, nth := range []int{1, 2} {
		f, err := os.Open(path)
		if err != nil {
			t.Fatalf("opening %s: %v", path, err)
		}
		broken := &brokenFile{bundleFile: f, failReadAt: nth}
		if _, err := sealedPKCS12Holds(broken, int64(len(content)), caMarksOf(certPEM(ca)).needles); !errors.Is(err, errBrokenFile) {
			t.Errorf("read %d: want the read failure, got %v", nth, err)
		}
		f.Close()
	}
}

func TestSealedPKCS12HoldsReadsOnlyTheMagicOfOtherFiles(t *testing.T) {
	for name, tc := range map[string]struct {
		content string
		reads   int
	}{
		"a text file": {"not a keystore, and long enough to be worth not reading", 1},
		"a tiny file": {"0", 0},
	} {
		t.Run(name, func(t *testing.T) {
			content := tc.content
			path := filepath.Join(t.TempDir(), "file")
			mustWriteFile(t, path, content)
			f, err := os.Open(path)
			if err != nil {
				t.Fatalf("opening %s: %v", path, err)
			}
			defer f.Close()
			counted := &brokenFile{bundleFile: f}
			found, err := sealedPKCS12Holds(counted, int64(len(content)), [][]byte{[]byte("x")})
			if err != nil || found {
				t.Fatalf("got found=%v err=%v", found, err)
			}
			if counted.reads != tc.reads {
				t.Errorf("read %d times, want %d", counted.reads, tc.reads)
			}
		})
	}
}

// What detection opens under changeit, stripCA takes the CA back out of.
func TestStripCAStripsAChangeitSealedPKCS12(t *testing.T) {
	ca, _ := testIssuer(t, "this run")
	root := testCert(t, "digicert")
	caPEM := certPEM(ca)
	path := mustWritePKCS12(t, mustEncodeTrustStore(t, pkcs12.Modern, keystorePassword, root, ca))
	left, err := stripCA(path, caPEM, caMarksOf(caPEM))
	if err != nil {
		t.Fatalf("stripCA: %v", err)
	}
	if left {
		t.Error("stripCA left the CA in a changeit-sealed trust store")
	}
	if found, err := fileHoldsCA(path, caMarksOf(caPEM).needles); err != nil || found {
		t.Errorf("after the strip: found=%v err=%v", found, err)
	}
}

// A certificate the proxy issued is found by the CA's name but is not the CA,
// so there is nothing to take out and it is reported.
func TestStripCAReportsAnEncryptedPKCS12ItCannotRewrite(t *testing.T) {
	ca, caKey := testIssuer(t, "this run")
	leaf, _ := testLeaf(t, ca, caKey, "app.example")
	root := testCert(t, "digicert")
	caPEM := certPEM(ca)
	store := mustEncodeTrustStore(t, pkcs12.Modern, keystorePassword, root, leaf)
	left, err := stripCA(mustWritePKCS12(t, store), caPEM, caMarksOf(caPEM))
	if err != nil {
		t.Fatalf("stripCA: %v", err)
	}
	if !left {
		t.Error("stripCA cleared a keystore it cannot rewrite")
	}
}

// The cap applies to encoding too, so it is lifted while the store is written.
func storePastTheIterationLimit(t *testing.T, ca *x509.Certificate) []byte {
	t.Helper()
	pkcs12.MaxIterations = 0
	defer func() { pkcs12.MaxIterations = maxPKCS12Iterations }()
	return mustEncodeTrustStore(t, pkcs12.Modern.WithIterations(maxPKCS12Iterations+1), "", ca)
}

// Sealed under the empty password, so every PKCS#12 path would otherwise open it.
func TestPKCS12PastTheIterationLimitIsNotDecoded(t *testing.T) {
	ca, _ := testIssuer(t, "this run")
	content := storePastTheIterationLimit(t, ca)

	if _, _, err := decodePKCS12(content); !errors.Is(err, pkcs12.ErrTooManyIterations) {
		t.Errorf("decodePKCS12: got %v, want ErrTooManyIterations", err)
	}
	found, err := fileHoldsCA(mustWritePKCS12(t, content), caMarksOf(certPEM(ca)).needles)
	if err != nil || found {
		t.Errorf("fileHoldsCA: got found=%v err=%v, want the keystore left unread", found, err)
	}
}

// go-pkcs12 accepts a salt of any class, which must not hide the count after it.
func TestPKCS12PastTheIterationLimitBehindAContextSpecificSalt(t *testing.T) {
	ca, _ := testIssuer(t, "this run")
	content := storePastTheIterationLimit(t, ca)

	// With no MAC, the retag below breaks nothing and only the bags' count is read.
	var pfx asn1.RawValue
	if _, err := asn1.Unmarshal(content, &pfx); err != nil {
		t.Fatal(err)
	}
	var version, authSafe asn1.RawValue
	rest, err := asn1.Unmarshal(pfx.Bytes, &version)
	if err == nil {
		_, err = asn1.Unmarshal(rest, &authSafe)
	}
	if err != nil {
		t.Fatal(err)
	}
	content = mustMarshal(t, asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSequence, IsCompound: true, Bytes: append(version.FullBytes, authSafe.FullBytes...)})

	// The PBKDF2 salt: a 16-byte OCTET STRING, then the count.
	count := mustMarshal(t, maxPKCS12Iterations+1)
	i := bytes.Index(content, count) - 18
	if i < 0 || content[i] != 0x04 || content[i+1] != 0x10 {
		t.Fatal("PBKDF2 salt not found")
	}
	content[i] = 0x84

	if _, _, err := decodePKCS12(content); !errors.Is(err, pkcs12.ErrTooManyIterations) {
		t.Errorf("decodePKCS12: got %v, want ErrTooManyIterations", err)
	}
}

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	der, err := asn1.Marshal(v)
	if err != nil {
		t.Fatalf("marshalling %v: %v", v, err)
	}
	return der
}

func TestPKCS12MACIsSHA1(t *testing.T) {
	root := testCert(t, "digicert")
	for name, c := range map[string]struct {
		content []byte
		want    bool
	}{
		"a SHA-1 MAC":    {mustEncodeTrustStore(t, pkcs12.LegacyDES, keystorePassword, root), true},
		"a SHA-256 MAC":  {mustEncodeTrustStore(t, pkcs12.Modern, keystorePassword, root), false},
		"no MAC":         {mustEncodeTrustStore(t, pkcs12.Passwordless, "", root), false},
		"not DER at all": {[]byte("not a keystore"), false},
	} {
		t.Run(name, func(t *testing.T) {
			if got := pkcs12MACIsSHA1(c.content); got != c.want {
				t.Errorf("got %v, want %v", got, c.want)
			}
		})
	}
}
