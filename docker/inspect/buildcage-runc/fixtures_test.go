package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

// Data builders shared across the package's test files: certificates, trust
// stores and keystores, bundles laid out the way BuildKit hands them over, and
// mountinfo lines. Fakes and toggles live in helpers_test.go.

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

// testDER is what testCA's base64 decodes to: what a container holds of a
// certificate, and what every shape of copy has in common.
var testDER = []byte("BUILDCAGE-CA")

var otherDER = []byte("SOMEONE-ELSE")

// selfSignedCA builds a real P-256 CA certificate. A PKCS#12 trust store
// holds parsed X.509 certificates, unlike the JKS tests whose "DER" is a
// stand-in string the parser never decodes, so go-pkcs12 accepts these the way
// a JDK's cacerts does.
func selfSignedCA(t *testing.T, serial int64, subject pkix.Name) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generating a key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(serial),
		Subject:               subject,
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
	return cert, key
}

func testCert(t *testing.T, cn string) *x509.Certificate {
	t.Helper()
	cert, _ := selfSignedCA(t, 1, pkix.Name{CommonName: cn})
	return cert
}

// nonce stands in for the random serialNumber in the proxy CA's subject.
func testIssuer(t *testing.T, nonce string) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	return selfSignedCA(t, 7, pkix.Name{CommonName: "buildcage proxy CA", SerialNumber: nonce})
}

func certPEM(cert *x509.Certificate) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})
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

func mustEncodeTrustStore(t *testing.T, enc *pkcs12.Encoder, password string, certs ...*x509.Certificate) []byte {
	t.Helper()
	data, err := enc.EncodeTrustStore(certs, password)
	if err != nil {
		t.Fatalf("encoding a trust store: %v", err)
	}
	return data
}

func mustWritePKCS12(t *testing.T, content []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "cacerts")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("writing %s: %v", path, err)
	}
	return path
}

// The JKS fixtures are the format written out: a keystore small enough to
// read at a glance, rather than the 160 KB one a distribution ships. Building
// them here is also what says what each field is.
func javaUTF(s string) []byte {
	return append(binary.BigEndian.AppendUint16(nil, uint16(len(s))), s...)
}

// trustedEntry is tag 2: the one a trust store rebuild adds the CA as.
func trustedEntry(version uint32, alias string, der []byte) []byte {
	entry := binary.BigEndian.AppendUint32(nil, 2)
	entry = append(entry, javaUTF(alias)...)
	entry = binary.BigEndian.AppendUint64(entry, 1700000000000)
	if version > 1 {
		entry = append(entry, javaUTF("X.509")...)
	}
	entry = binary.BigEndian.AppendUint32(entry, uint32(len(der)))
	return append(entry, der...)
}

// keystore seals the entries the way the JDK does, so the parser meets a file
// it would accept.
func keystore(version uint32, entries ...[]byte) []byte {
	out := append([]byte{}, keystoreMagic...)
	out = binary.BigEndian.AppendUint32(out, version)
	out = binary.BigEndian.AppendUint32(out, uint32(len(entries)))
	for _, entry := range entries {
		out = append(out, entry...)
	}
	return append(out, keystoreDigest(out)...)
}

func mustWriteKeystore(t *testing.T, content []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "cacerts")
	mustWriteFile(t, path, string(content))
	return path
}

// writeRootfsKeystore places raw keystore bytes at a container path inside
// rootfs, creating the directories on the way.
func writeRootfsKeystore(t *testing.T, rootfs, containerPath string, content []byte) {
	t.Helper()
	abs := filepath.Join(rootfs, strings.TrimPrefix(containerPath, "/"))
	mustMkdirAll(t, filepath.Dir(abs))
	mustWriteFile(t, abs, string(content))
}

// writeJava places an executable java at path, creating its directory.
func writeJava(t *testing.T, path string) {
	t.Helper()
	mustMkdirAll(t, filepath.Dir(path))
	if err := os.WriteFile(path, []byte("java"), 0o755); err != nil {
		t.Fatal(err)
	}
}

// filler is content removeCA has to leave alone, sized to the byte so a
// certificate lands at an exact offset.
func filler(n int) string {
	const line = "FILLER-LINE\n"
	return strings.Repeat(line, n/len(line)+1)[:n]
}

// newBundleNoStore lays out a bundle with no CA store at all under
// rootfs/etc/ssl/certs, the node:*-slim shape: no OS trust store, only
// Node's own bundled roots, which findSystemStore cannot find.
func newBundleNoStore(t *testing.T, env []string) (bundle, rootfs string) {
	t.Helper()
	bundle = t.TempDir()
	rootfs = filepath.Join(bundle, "rootfs")
	// /etc exists, as it does in any real base image (passwd, hostname, ...);
	// only etc/ssl/certs and its siblings are absent, which is what actually
	// makes findSystemStore fail.
	mustMkdirAll(t, filepath.Join(rootfs, "etc"))

	config := map[string]any{
		"root":    map[string]any{"path": "rootfs"},
		"process": map[string]any{"env": toAny(env)},
	}
	raw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(bundle, "config.json"), string(raw))
	// inject refuses a step whose layer it cannot read back.
	useMountInfo(t, overlayLine(rootfs, rootfs))
	return bundle, rootfs
}

// newBundle is the same bundle with one system CA candidate in the rootfs,
// which is what the store-present half of the decision table needs.
func newBundle(t *testing.T, env []string) (bundle, rootfs string) {
	t.Helper()
	bundle, rootfs = newBundleNoStore(t, env)
	mustMkdirAll(t, filepath.Join(rootfs, "etc", "ssl", "certs"))
	mustWriteFile(t, filepath.Join(rootfs, "etc", "ssl", "certs", "ca-certificates.crt"), "ORIGINAL-ROOTS\n")
	return bundle, rootfs
}

func toAny(env []string) []any {
	out := make([]any, len(env))
	for i, e := range env {
		out[i] = e
	}
	return out
}

func loadMounts(t *testing.T, bundle string) []map[string]any {
	t.Helper()
	s, err := loadSpec(bundle)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := s.raw["mounts"].([]any)
	mounts := make([]map[string]any, 0, len(raw))
	for _, m := range raw {
		if entry, ok := m.(map[string]any); ok {
			mounts = append(mounts, entry)
		}
	}
	return mounts
}

func findMount(t *testing.T, mounts []map[string]any, dest string) map[string]any {
	t.Helper()
	for _, m := range mounts {
		if m["destination"] == dest {
			return m
		}
	}
	t.Fatalf("no mount for %s", dest)
	return nil
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
