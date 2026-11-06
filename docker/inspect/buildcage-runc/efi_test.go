package main

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// EFI_CERT_SHA256_GUID, a signature type whose data is a hash.
var efiCertSHA256 = []byte{0x26, 0x16, 0xc4, 0xc1, 0x4c, 0x50, 0x92, 0x40, 0xac, 0xa9, 0x41, 0xf9, 0x36, 0x93, 0x43, 0x28}

var efiOwner = []byte{0x50, 0x3b, 0xdd, 0xdc, 0x05, 0xf4, 0xfd, 0x43, 0x96, 0xbe, 0xbd, 0x33, 0xb1, 0x73, 0x47, 0x76}

// signatureList builds one list; every signature must be the same length.
func signatureList(typ, header []byte, data ...[]byte) []byte {
	size := efiOwnerSize
	if len(data) > 0 {
		size += len(data[0])
	}
	list := append([]byte{}, typ...)
	list = binary.LittleEndian.AppendUint32(list, uint32(efiListHeaderSize+len(header)+len(data)*size))
	list = binary.LittleEndian.AppendUint32(list, uint32(len(header)))
	list = binary.LittleEndian.AppendUint32(list, uint32(size))
	list = append(list, header...)
	for _, d := range data {
		list = append(list, efiOwner...)
		list = append(list, d...)
	}
	return list
}

// x509List is what p11-kit writes: one certificate per list.
func x509List(der []byte) []byte {
	return signatureList(efiCertX509, nil, der)
}

func concat(parts ...[]byte) []byte {
	return bytes.Join(parts, nil)
}

var thirdDER = []byte("A-THIRD-ROOT")

func TestSignatureListsWithoutRemovesTheCertificatesList(t *testing.T) {
	content := concat(x509List(otherDER), x509List(testDER), x509List(thirdDER))

	got, removed := signatureListsWithout(content, [][]byte{testDER})
	if !removed {
		t.Fatal("reported nothing removed")
	}
	if want := concat(x509List(otherDER), x509List(thirdDER)); !bytes.Equal(got, want) {
		t.Fatalf("got %x, want %x", got, want)
	}
}

func TestSignatureListsWithoutCutsOneSignatureOutOfAList(t *testing.T) {
	content := signatureList(efiCertX509, nil, otherDER, testDER, thirdDER)

	got, removed := signatureListsWithout(content, [][]byte{testDER})
	if !removed {
		t.Fatal("reported nothing removed")
	}
	if want := signatureList(efiCertX509, nil, otherDER, thirdDER); !bytes.Equal(got, want) {
		t.Fatalf("got %x, want %x", got, want)
	}
}

func TestSignatureListsWithoutKeepsAListsHeader(t *testing.T) {
	content := signatureList(efiCertX509, []byte("HDR"), otherDER, testDER)

	got, removed := signatureListsWithout(content, [][]byte{testDER})
	if !removed {
		t.Fatal("reported nothing removed")
	}
	if want := signatureList(efiCertX509, []byte("HDR"), otherDER); !bytes.Equal(got, want) {
		t.Fatalf("got %x, want %x", got, want)
	}
}

// The sweep removes the emptied file.
func TestSignatureListsWithoutEmptiesADatabaseOfOnlyTheCertificate(t *testing.T) {
	got, removed := signatureListsWithout(x509List(testDER), [][]byte{testDER})
	if !removed || len(got) != 0 {
		t.Fatalf("got %x (removed %v), want nothing left", got, removed)
	}
}

// The format allows a list with no signatures.
func TestSignatureListsWithoutKeepsAnEmptyList(t *testing.T) {
	empty := signatureList(efiCertX509, nil)
	binary.LittleEndian.PutUint32(empty[24:], efiOwnerSize+uint32(len(testDER)))
	content := concat(empty, x509List(testDER))

	got, removed := signatureListsWithout(content, [][]byte{testDER})
	if !removed || !bytes.Equal(got, empty) {
		t.Fatalf("got %x (removed %v), want the empty list kept", got, removed)
	}
}

func TestSignatureListsWithoutRemovesEveryCertificate(t *testing.T) {
	content := concat(x509List(testDER), x509List(otherDER), x509List(thirdDER))

	got, removed := signatureListsWithout(content, [][]byte{testDER, thirdDER})
	if !removed || !bytes.Equal(got, x509List(otherDER)) {
		t.Fatalf("got %x (removed %v), want only the other list left", got, removed)
	}
}

// The read-back finds these copies and fails the build.
func TestSignatureListsWithoutLeavesACopyItCannotCut(t *testing.T) {
	for name, content := range map[string][]byte{
		"another signature type": signatureList(efiCertSHA256, nil, testDER),
		"in a list's header":     signatureList(efiCertX509, testDER, otherDER),
		"inside a signature":     x509List(append([]byte("PREFIX"), testDER...)),
		"not there at all":       x509List(otherDER),
	} {
		t.Run(name, func(t *testing.T) {
			if got, removed := signatureListsWithout(content, [][]byte{testDER}); removed {
				t.Fatalf("got %x, want nothing removed", got)
			}
		})
	}
}

func TestSignatureListsWithoutRefusesWhatDoesNotParse(t *testing.T) {
	valid := x509List(testDER)
	withSizes := func(list, header, signature uint32) []byte {
		b := bytes.Clone(valid)
		binary.LittleEndian.PutUint32(b[16:], list)
		binary.LittleEndian.PutUint32(b[20:], header)
		binary.LittleEndian.PutUint32(b[24:], signature)
		return b
	}
	n := uint32(len(valid))
	for name, content := range map[string][]byte{
		"shorter than a list header":     valid[:efiListHeaderSize-1],
		"trailing bytes after the lists": concat(valid, []byte("X")),
		"list larger than the file":      withSizes(n+1, 0, n-efiListHeaderSize),
		"list smaller than its header":   withSizes(efiListHeaderSize-1, 0, n-efiListHeaderSize),
		"header past the list's end":     withSizes(n, 0xffffffff, n-efiListHeaderSize),
		"signature smaller than a GUID":  withSizes(n, 0, efiOwnerSize-1),
		"signatures not tiling the list": withSizes(n, 0, n-efiListHeaderSize-1),
		"an EFI_VARIABLE wrapped around": concat([]byte("EFI-VAR\x00"), valid),
	} {
		t.Run(name, func(t *testing.T) {
			if got, removed := signatureListsWithout(content, [][]byte{testDER}); removed || got != nil {
				t.Fatalf("got %x (removed %v), want it refused", got, removed)
			}
		})
	}
}

func TestSweepDirRewritesAnEFISignatureDatabase(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "cacerts.bin")
	mustWriteFile(t, path, string(concat(x509List(otherDER), x509List(testDER))))

	if _, _, err := sweepDir(dir, dir, caMarksOf(testCA), nil); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if want := x509List(otherDER); !bytes.Equal(got, want) {
		t.Fatalf("got %x, want %x", got, want)
	}
}
