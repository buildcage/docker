package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The fixtures below are the format written out: a keystore small enough to
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

// keyEntry is tag 1, whose certificates are a chain behind a wrapped private
// key rather than anything the trust store put there.
func keyEntry(version uint32, alias string, key []byte, chain ...[]byte) []byte {
	entry := binary.BigEndian.AppendUint32(nil, 1)
	entry = append(entry, javaUTF(alias)...)
	entry = binary.BigEndian.AppendUint64(entry, 1700000000000)
	entry = binary.BigEndian.AppendUint32(entry, uint32(len(key)))
	entry = append(entry, key...)
	entry = binary.BigEndian.AppendUint32(entry, uint32(len(chain)))
	for _, der := range chain {
		if version > 1 {
			entry = append(entry, javaUTF("X.509")...)
		}
		entry = binary.BigEndian.AppendUint32(entry, uint32(len(der)))
		entry = append(entry, der...)
	}
	return entry
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

// testDER is what testCA's base64 decodes to: what a container holds of a
// certificate, and what every shape of copy has in common.
var testDER = []byte("BUILDCAGE-CA")

var otherDER = []byte("SOMEONE-ELSE")

func mustWriteKeystore(t *testing.T, content []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "cacerts")
	mustWriteFile(t, path, string(content))
	return path
}

// The case the whole format is here for: a rebuild put the CA in the JVM's own
// keystore, where no PEM removal reaches it.
func TestRemoveFromKeystoreTakesOutTheTrustedEntry(t *testing.T) {
	for _, version := range []uint32{1, 2} {
		t.Run(map[uint32]string{1: "version 1", 2: "version 2"}[version], func(t *testing.T) {
			before := keystore(version,
				trustedEntry(version, "digicert", otherDER),
				trustedEntry(version, "buildcage", testDER),
			)
			path := mustWriteKeystore(t, before)

			rewritten, err := removeFromBinaryStore(path, [][]byte{testDER})
			if err != nil {
				t.Fatal(err)
			}
			if !rewritten {
				t.Fatal("the keystore was left as it was")
			}
			got, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if want := keystore(version, trustedEntry(version, "digicert", otherDER)); !bytes.Equal(got, want) {
				t.Fatalf("got %x, want the keystore without the entry", got)
			}
		})
	}
}

// The rewritten keystore has to be one the JVM will still open, which is the
// digest over the entries that are left.
func TestRemoveFromKeystoreResealsWhatItWrites(t *testing.T) {
	path := mustWriteKeystore(t, keystore(2,
		trustedEntry(2, "buildcage", testDER),
		trustedEntry(2, "digicert", otherDER),
	))

	if _, err := removeFromBinaryStore(path, [][]byte{testDER}); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	body := len(got) - sha1.Size
	if !bytes.Equal(got[body:], keystoreDigest(got[:body])) {
		t.Fatal("the rewritten keystore is not sealed")
	}
	version, entries, err := parseKeystore(got[:body])
	if err != nil {
		t.Fatal(err)
	}
	if version != 2 || len(entries) != 1 {
		t.Fatalf("got version %d with %d entries, want version 2 with 1", version, len(entries))
	}
}

// assertKeystoreLeft checks that removeFromBinaryStore left the keystore at
// path untouched for the caller to report, and logged why.
func assertKeystoreLeft(t *testing.T, path string, want []byte, reason string) {
	t.Helper()
	useTempLog(t)
	rewritten, err := removeFromBinaryStore(path, [][]byte{testDER})
	if err != nil || rewritten {
		t.Fatalf("got (%v, %v), want the keystore left for the caller", rewritten, err)
	}
	if got, _ := os.ReadFile(path); !bytes.Equal(got, want) {
		t.Error("the keystore was changed")
	}
	if !strings.Contains(ownLog.String(), reason) {
		t.Errorf("the log does not say why:\n%s", ownLog.String())
	}
}

// A keystore somebody sealed with a password of their own is not this
// wrapper's to reseal: guessing would leave it unreadable to whatever opens it.
func TestRemoveFromKeystoreLeavesOneSealedWithAnotherPassword(t *testing.T) {
	sealed := keystore(2, trustedEntry(2, "buildcage", testDER))
	sealed[len(sealed)-1] ^= 0xff
	assertKeystoreLeft(t, mustWriteKeystore(t, sealed), sealed, "system keystore password")
}

// Only a trusted certificate can be dropped on its own. One in a key's chain
// would take the key with it.
func TestRemoveFromKeystoreLeavesACertificateInAKeyChain(t *testing.T) {
	content := keystore(2, keyEntry(2, "server", []byte("KEY"), otherDER, testDER))
	assertKeystoreLeft(t, mustWriteKeystore(t, content), content, "private key's own chain")
}

// The scan found the certificate somewhere in the file, so a rewrite that
// takes nothing out has not understood where.
func TestRemoveFromKeystoreLeavesOneHoldingTheCertificateOutsideAnEntry(t *testing.T) {
	content := keystore(2, trustedEntry(2, string(testDER), otherDER))
	assertKeystoreLeft(t, mustWriteKeystore(t, content), content, "outside any entry")
}

// Anything this has not been shown the shape of is left for the caller to
// report rather than guessed at.
func TestRemoveFromKeystoreLeavesWhatIsNotOne(t *testing.T) {
	cases := map[string]string{
		"another container entirely": "EFI\x00" + string(testDER),
		"shorter than the magic":     "\xfe\xed",
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			path := mustWriteKeystore(t, []byte(content))

			rewritten, err := removeFromBinaryStore(path, [][]byte{testDER})
			if err != nil || rewritten {
				t.Fatalf("got rewritten=%v err=%v, want it left alone", rewritten, err)
			}
			got, _ := os.ReadFile(path)
			if string(got) != content {
				t.Fatalf("got %q, want it unchanged", got)
			}
		})
	}
}

// A file far larger than any keystore is not read into memory because it opens
// with the same four bytes.
func TestRemoveFromKeystoreLeavesOneTooLargeToRead(t *testing.T) {
	maxKeystoreBytes = 8
	t.Cleanup(func() { maxKeystoreBytes = 16 << 20 })
	path := mustWriteKeystore(t, keystore(2, trustedEntry(2, "buildcage", testDER)))

	rewritten, err := removeFromBinaryStore(path, [][]byte{testDER})
	if err != nil || rewritten {
		t.Fatalf("got rewritten=%v err=%v, want it left alone", rewritten, err)
	}
}

// Everything the parser can refuse, each from a keystore built to be wrong in
// one way. A refusal fails the build, which is the point: the certificate is
// in there and this cannot get it out.
func TestKeystoreWithoutRefusesWhatItCannotRead(t *testing.T) {
	sealed := keystore(2, trustedEntry(2, "buildcage", testDER))
	cases := map[string]struct {
		content []byte
		want    string
	}{
		"too short for a header": {
			content: append(append([]byte{}, keystoreMagic...), make([]byte, sha1.Size)...),
			want:    "too short",
		},
		"a version this has not been shown": {
			content: keystore(3, trustedEntry(2, "buildcage", testDER)),
			want:    "keystore version 3",
		},
		"an entry tag this has not been shown": {
			content: keystore(2, append(append(
				binary.BigEndian.AppendUint32(nil, 7), javaUTF("odd")...), make([]byte, 8)...)),
			want: "keystore entry tag 7",
		},
		"an entry that runs off the end": {
			content: keystore(2, trustedEntry(2, "buildcage", testDER)[:20]),
			want:    "ends inside an entry",
		},
		"bytes after the last entry": {
			content: keystore(2, append(trustedEntry(2, "buildcage", testDER), 0x00)),
			want:    "trailing bytes",
		},
		"a count larger than the entries": {
			content: func() []byte {
				b := append([]byte{}, sealed[:len(sealed)-sha1.Size]...)
				binary.BigEndian.PutUint32(b[8:], 9)
				return append(b, keystoreDigest(b)...)
			}(),
			want: "ends inside an entry",
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := keystoreWithout(c.content, [][]byte{testDER})
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("got %v, want it to mention %q", err, c.want)
			}
		})
	}
}

// A chain length the file exaggerates is caught by the same overrun, without
// first walking the number it claims.
func TestKeystoreWithoutRefusesAnExaggeratedChain(t *testing.T) {
	entry := keyEntry(2, "server", []byte("KEY"), testDER)
	binary.BigEndian.PutUint32(entry[len(entry)-len(testDER)-4-len(javaUTF("X.509"))-4:], 1<<30)

	_, err := keystoreWithout(keystore(2, entry), [][]byte{testDER})
	if err == nil || !strings.Contains(err.Error(), "ends inside an entry") {
		t.Fatalf("got %v, want the chain to run out", err)
	}
}

// The rewrite is a write and a truncate, and either failing leaves a keystore
// the JVM cannot open, so neither is allowed to pass for success.
func TestRemoveFromKeystoreReportsAFailedWrite(t *testing.T) {
	for name, broken := range map[string]*brokenFile{
		"the write":    {failWriteAt: 1},
		"the truncate": {failTruncate: true},
	} {
		t.Run(name, func(t *testing.T) {
			path := mustWriteKeystore(t, keystore(2,
				trustedEntry(2, "buildcage", testDER),
				trustedEntry(2, "digicert", otherDER),
			))
			useBrokenBundleFile(t, broken)

			if _, err := removeFromBinaryStore(path, [][]byte{testDER}); !errors.Is(err, errBrokenFile) {
				t.Fatalf("got %v, want the failure to be reported", err)
			}
		})
	}
}

func TestRemoveFromKeystoreReportsAFailedStat(t *testing.T) {
	path := mustWriteKeystore(t, keystore(2, trustedEntry(2, "buildcage", testDER)))
	useBrokenBundleFile(t, &brokenFile{failStat: true})

	if _, err := removeFromBinaryStore(path, [][]byte{testDER}); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want the stat failure to be reported", err)
	}
}

func TestRemoveFromKeystoreReportsAFailedRead(t *testing.T) {
	path := mustWriteKeystore(t, keystore(2, trustedEntry(2, "buildcage", testDER)))
	useBrokenBundleFile(t, &brokenFile{failReadAt: 1})

	if _, err := removeFromBinaryStore(path, [][]byte{testDER}); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v, want the read failure to be reported", err)
	}
}

func TestRemoveFromKeystoreRefusesAPathThatIsNotThere(t *testing.T) {
	if _, err := removeFromBinaryStore(filepath.Join(t.TempDir(), "gone"), [][]byte{testDER}); err == nil {
		t.Fatal("expected a missing keystore to be reported")
	}
}

// keystoreWith adds a trusted-certificate entry and reseals. Inject then remove
// round-trips to the original: the added entry is well-formed and sealed the
// way removal (which checks the digest and parses) expects.
func TestKeystoreWith(t *testing.T) {
	for _, version := range []uint32{1, 2} {
		t.Run("version "+string(rune('0'+version)), func(t *testing.T) {
			orig := keystore(version, trustedEntry(version, "digicert", otherDER))
			out, err := keystoreWith(orig, [][]byte{testDER})
			if err != nil {
				t.Fatalf("keystoreWith: %v", err)
			}
			if !bytes.Contains(out, []byte(injectedAlias)) || !bytes.Contains(out, testDER) {
				t.Error("the injected entry is not in the keystore")
			}
			back, err := keystoreWithout(out, [][]byte{testDER})
			if err != nil {
				t.Fatalf("keystoreWith produced a keystore removal rejects: %v", err)
			}
			if !bytes.Equal(back, orig) {
				t.Error("inject then remove did not round-trip to the original")
			}
		})
	}
}

func TestKeystoreWithRejectsForeignPassword(t *testing.T) {
	bad := keystore(2, trustedEntry(2, "digicert", otherDER))
	bad[len(bad)-1] ^= 0xff // break the seal
	if _, err := keystoreWith(bad, [][]byte{testDER}); err == nil {
		t.Fatal("want a foreign-password rejection")
	}
}

func TestKeystoreWithRejectsTooShort(t *testing.T) {
	if _, err := keystoreWith(keystoreMagic, [][]byte{testDER}); err == nil {
		t.Fatal("want a too-short rejection")
	}
}

func TestKeystoreWithReportsAParseError(t *testing.T) {
	// A sealed keystore whose version the parser does not accept.
	if _, err := keystoreWith(keystore(3, trustedEntry(3, "digicert", otherDER)), [][]byte{testDER}); err == nil {
		t.Fatal("want the parse error to be reported")
	}
}
