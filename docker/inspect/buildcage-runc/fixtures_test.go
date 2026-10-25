package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"fmt"
	"math/big"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Fixtures shared across the package's test files: certificate data, bundles
// laid out the way BuildKit hands them over, and the mount table and log a
// test points the code at.

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

// useMountInfo hands upperDirOf these lines instead of the test process's own
// mount table, which holds no overlay over a temporary directory.
func useMountInfo(t *testing.T, lines ...string) {
	t.Helper()
	old := readMountInfo
	readMountInfo = func() ([]byte, error) { return []byte(strings.Join(lines, "\n") + "\n"), nil }
	t.Cleanup(func() { readMountInfo = old })
}

// useTempLog points logf and the dump at a file the test owns, since a test
// process usually can't write the real host path.
func useTempLog(t *testing.T) {
	t.Helper()
	oldFile, oldTag := logFile, logTag
	logFile = filepath.Join(t.TempDir(), "runc.log")
	logTag = "[this-step]"
	ownLog.Reset()
	t.Cleanup(func() {
		logFile, logTag = oldFile, oldTag
		ownLog.Reset()
	})
}
