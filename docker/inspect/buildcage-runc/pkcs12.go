package main

// PKCS#12 is the other shape a JVM keystore comes in: newer JDKs ship
// $JAVA_HOME/lib/security/cacerts as a PKCS#12 trust store rather than the JKS
// older ones use, and keystore.type defaults to pkcs12 from JDK 9 on. The DER
// sits among the container's own bytes the same way it does in a JKS, so no PEM
// removal reaches it, and until this the sweep could detect a copy there but not
// take it out, which failed the build (errUnstrippableCA).
//
// The JDK's own cacerts carries no MAC (the password guards only the MAC, and
// the certificate bags are never encrypted), so it decodes under the empty
// password even though it is nominally sealed with "changeit". A trust store
// keytool creates, rather than edits, is sealed under the password it was
// given, so "changeit" is tried as well. A store is written back under the
// password it opened with. The empty one means Passwordless, whose bags are
// unencrypted and carry no MAC, the one shape the JVM's default loader trusts
// as a cacerts: the Modern encoders encrypt the bags with PBES2, which that
// loader does not decrypt. A "changeit" store keeps its format: one with a
// SHA-1 MAC, which a JDK before 8u301 or 11.0.12 writes, is resealed
// LegacyDES, which those JDKs and every OpenSSL read; any other is resealed
// Modern. Entries keep their aliases: the JVM loads one entry per alias, so
// naming them after their subjects would merge any that share one.
// removeFromBinaryStore reads the file and dispatches on its magic.

import (
	"crypto/x509"
	"encoding/asn1"
	"errors"
	"io"
	"slices"

	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

// go-pkcs12 runs whatever count a file names, and 2^40 takes days. Real
// encoders write 2048 to 100,000.
const maxPKCS12Iterations = 1_000_000

func init() {
	pkcs12.MaxIterations = maxPKCS12Iterations
}

// looksLikePKCS12 reports whether content opens the way a PKCS#12 keystore
// does: the DER SEQUENCE tag 0x30 followed by a long-form length, the 0x80 bit
// set. Keystores are far larger than the 127 bytes a short-form length reaches,
// so they always use long form; how many length bytes follow varies with size
// (0x82 for two, 0x83 for three, which a JDK cacerts is large enough to need).
// This only steers which decoder is tried; the decode confirms the bytes really
// are a trust store.
func looksLikePKCS12(content []byte) bool {
	return len(content) >= 2 && content[0] == 0x30 && content[1]&0x80 != 0
}

// decodePKCS12 reads the trusted certificates and their aliases out of a trust
// store under the passwords the sweep's detection tries, so a copy it finds can
// also be removed, and returns the password that opened it.
func decodePKCS12(content []byte) (entries []pkcs12.TrustStoreEntry, password string, err error) {
	for _, password = range sealedKeystorePasswords {
		if entries, err = pkcs12.DecodeTrustStoreEntries(content, password); err == nil {
			return entries, password, nil
		}
		if errors.Is(err, pkcs12.ErrTooManyIterations) {
			return nil, "", err
		}
		// A malformed alias fails only the entry decode. The certificates are
		// still read so a copy of the CA in the store is found.
		if certs, certErr := pkcs12.DecodeTrustStore(content, password); certErr == nil {
			entries = make([]pkcs12.TrustStoreEntry, 0, len(certs))
			for _, cert := range certs {
				entries = append(entries, pkcs12.TrustStoreEntry{Cert: cert})
			}
			return entries, password, nil
		}
	}
	return nil, "", err
}

// oidSHA1 is the MAC digest of a legacy PKCS#12.
var oidSHA1 = asn1.ObjectIdentifier{1, 3, 14, 3, 2, 26}

// pkcs12MACIsSHA1 reports whether content has a SHA-1 MAC. No MAC, or content
// that does not parse, reports false.
func pkcs12MACIsSHA1(content []byte) bool {
	var pfx struct {
		Version  int
		AuthSafe asn1.RawValue
		MacData  struct {
			Mac struct {
				Algorithm struct {
					Algorithm  asn1.ObjectIdentifier
					Parameters asn1.RawValue `asn1:"optional"`
				}
				Digest []byte
			}
			MacSalt    []byte
			Iterations int `asn1:"optional,default:1"`
		} `asn1:"optional"`
	}
	if _, err := asn1.Unmarshal(content, &pfx); err != nil {
		return false
	}
	return pfx.MacData.Mac.Algorithm.Algorithm.Equal(oidSHA1)
}

// encodePKCS12 writes entries back as a trust store under password, legacy
// when the store it came from had a SHA-1 MAC (see the file comment). It is a
// var so a test can make the encode fail, which valid certificates otherwise
// never do.
var encodePKCS12 = func(entries []pkcs12.TrustStoreEntry, password string, legacy bool) ([]byte, error) {
	named := slices.Clone(entries)
	for i := range named {
		// Entries sharing the empty alias would merge in the JVM.
		if named[i].FriendlyName == "" {
			named[i].FriendlyName = named[i].Cert.Subject.String()
		}
	}
	switch {
	case password == "":
		return pkcs12.Passwordless.EncodeTrustStoreEntries(named, "")
	case legacy:
		return pkcs12.LegacyDES.EncodeTrustStoreEntries(named, password)
	default:
		return pkcs12.Modern.EncodeTrustStoreEntries(named, password)
	}
}

// pkcs12With returns a PKCS#12 trust store holding everything in content plus
// a trusted certificate for each der, under the password content opened with.
// content is already known to begin with the PKCS#12 magic. A store
// decodePKCS12 will not open is one this cannot rewrite, so injection is
// skipped for it and the step's JVM is left not trusting the CA.
func pkcs12With(content []byte, ders [][]byte) ([]byte, error) {
	entries, password, err := decodePKCS12(content)
	if err != nil {
		return nil, err
	}
	for i, der := range ders {
		cert, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, err
		}
		entries = append(entries, pkcs12.TrustStoreEntry{Cert: cert, FriendlyName: injectedAliasFor(i)})
	}
	return encodePKCS12(entries, password, pkcs12MACIsSHA1(content))
}

// pkcs12Without returns a PKCS#12 trust store holding everything in content but
// the certificate, under the password content opened with, and reports whether
// it removed anything. content is already known to begin with the PKCS#12 magic.
//
// A store decodePKCS12 will not open (a key with its chain, or a trust store
// under another password), or one holding the DER among its bytes but not as a
// decoded trusted certificate, is one this cannot rewrite: it returns
// (nil, false, nil) and leaves the caller to report it. Removing the last
// certificate is fine: the emptied store re-encodes and decodes cleanly,
// carrying no DER.
func pkcs12Without(content []byte, ders [][]byte) ([]byte, bool, error) {
	entries, password, err := decodePKCS12(content)
	if err != nil {
		logf("a PKCS#12 keystore this cannot decode as a trust store: %v", err)
		return nil, false, nil
	}
	// Captured before the delete: slices.DeleteFunc rewrites entries' backing
	// array in place and returns a shorter slice, leaving entries' own length
	// unchanged, so comparing kept against it is what says a copy was found.
	before := len(entries)
	kept := slices.DeleteFunc(entries, func(entry pkcs12.TrustStoreEntry) bool {
		return holdsAnyDER(entry.Cert.Raw, ders)
	})
	if len(kept) == before {
		return nil, false, nil
	}
	out, err := encodePKCS12(kept, password, pkcs12MACIsSHA1(content))
	if err != nil {
		return nil, false, err
	}
	return out, true, nil
}

// Passwords tried on a PKCS#12, both to find the CA and to rewrite the store:
// none, and the JDK default a copy of cacerts usually keeps. Others pass
// unread: dependencies ship encrypted test keystores (the Azure SDK for Go
// does), and failing on those would fail builds that never touched the CA.
var sealedKeystorePasswords = []string{"", keystorePassword}

// sealedPKCS12Holds reports whether f is a PKCS#12 that opens under one of
// sealedKeystorePasswords and holds a certificate carrying one of needles.
func sealedPKCS12Holds(f io.ReaderAt, size int64, needles [][]byte) (bool, error) {
	if size < 2 || size > maxKeystoreBytes {
		return false, nil
	}
	// Nearly every file is not a keystore, so the magic is checked before
	// reading the whole file.
	head := make([]byte, 2)
	if _, err := f.ReadAt(head, 0); err != nil {
		return false, err
	}
	if !looksLikePKCS12(head) {
		return false, nil
	}
	content := make([]byte, size)
	if _, err := f.ReadAt(content, 0); err != nil && err != io.EOF {
		return false, err
	}
	// The same decode removal uses, so a copy found here is one pkcs12Without
	// can take out.
	entries, _, err := decodePKCS12(content)
	if errors.Is(err, pkcs12.ErrTooManyIterations) {
		logf("left a PKCS#12 unread: %v", err)
	}
	for _, entry := range entries {
		if holdsAnyDER(entry.Cert.Raw, needles) {
			return true, nil
		}
	}
	return false, nil
}
