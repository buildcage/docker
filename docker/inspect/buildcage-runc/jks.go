package main

// JKS is what the JDK's own keytool writes, and what every distribution puts
// the JVM's trusted certificates in. A trust store rebuild on a system that
// carries a JRE copies the certificate into one of these, where it is the DER
// among the container's own bytes and no PEM removal can reach it.
//
//	magic(4)=feedfeed | version(4) | count(4)
//	entry: tag(4) | alias(UTF) | creation time(8)
//	  tag 2, a trusted certificate: type(UTF, version 2 on) | len(4) | DER
//	  tag 1, a private key: len(4) | key | chain(4) | (type, len, DER)*
//	trailing: SHA-1( password as UTF-16BE ‖ "Mighty Aphrodite" ‖ all of the above )
//
// An entry that stays is copied over byte for byte, so the only differences
// between what came in and what goes out are the count and the digest.

import (
	"bytes"
	"crypto/sha1"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"syscall"
)

var keystoreMagic = []byte{0xfe, 0xed, 0xfe, 0xed}

// The password the JDK ships the system keystore with, which is what every
// distribution's copy is still sealed with. A keystore under another one is
// not this wrapper's to rewrite, and the digest below is what tells them
// apart.
const keystorePassword = "changeit"

// What the JDK has mixed into the digest since it first shipped one.
var keystoreSalt = []byte("Mighty Aphrodite")

// Largest keystore this reads in. A system cacerts is a few hundred KB; this
// leaves room for one carrying a company's own roots without reading an
// arbitrary file into memory because it happens to start with the magic. A
// var, not a const, so a test can reach the limit without writing 16 MB.
var maxKeystoreBytes int64 = 16 << 20

// removeFromBinaryStore takes the certificate out of a binary trust store in
// place and reports whether it rewrote anything. A JKS (feedfeed) is told apart
// by its magic; a file that is one bare DER of the injected CA is emptied; a
// PKCS#12 (a DER SEQUENCE) keystore comes next; anything else is tried as an EFI
// signature database. A file that is none of them, or a keystore that cannot be
// rewritten safely, is left for the caller to report.
func removeFromBinaryStore(path string, ders [][]byte) (bool, error) {
	f, err := openBundle(path, os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return false, asNotRegular(path, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return false, err
	}
	size := info.Size()
	if size < int64(len(keystoreMagic)) || size > maxKeystoreBytes {
		return false, nil
	}
	content := make([]byte, size)
	if _, err := f.ReadAt(content, 0); err != nil && err != io.EOF {
		return false, err
	}

	var rewritten []byte
	switch {
	case bytes.HasPrefix(content, keystoreMagic):
		if rewritten, err = keystoreWithout(content, ders); err != nil {
			logf("%s: cannot rewrite this keystore: %v", path, err)
			return false, nil
		}
	case holdsOnlyInjectedCert(content, ders):
		// The whole file is the injected CA: leaving rewritten nil empties it,
		// and the sweep drops the emptied file. Ordered before PKCS#12 because a
		// bare DER certificate is also a SEQUENCE and would otherwise be taken for
		// a keystore that fails to decode.
	case looksLikePKCS12(content):
		var removed bool
		if rewritten, removed, err = pkcs12Without(content, ders); err != nil {
			return false, err
		}
		if !removed {
			return false, nil
		}
	default:
		var removed bool
		if rewritten, removed = signatureListsWithout(content, ders); !removed {
			return false, nil
		}
	}

	if _, err := f.WriteAt(rewritten, 0); err != nil {
		return false, err
	}
	return true, f.Truncate(int64(len(rewritten)))
}

// keystoreWithout returns the keystore with every entry holding the
// certificate taken out, resealed.
func keystoreWithout(content []byte, ders [][]byte) ([]byte, error) {
	if len(content) < len(keystoreMagic)+8+sha1.Size {
		return nil, errors.New("too short to be a keystore")
	}
	body := len(content) - sha1.Size
	// Checked before anything is rewritten: a keystore sealed with another
	// password is one this cannot reseal, and guessing would leave it
	// unreadable to the JVM that owns it.
	if !bytes.Equal(content[body:], keystoreDigest(content[:body])) {
		return nil, errors.New("not sealed with the system keystore password")
	}

	version, entries, err := parseKeystore(content[:body])
	if err != nil {
		return nil, err
	}

	out := make([]byte, len(keystoreMagic)+8, body)
	copy(out, keystoreMagic)
	binary.BigEndian.PutUint32(out[4:], version)
	kept, removed := 0, 0
	for _, entry := range entries {
		if !slices.ContainsFunc(entry.certificates, func(der []byte) bool { return holdsAnyDER(der, ders) }) {
			out = append(out, content[entry.start:entry.end]...)
			kept++
			continue
		}
		if !entry.trusted {
			return nil, errors.New("the certificate is in a private key's own chain")
		}
		removed++
	}
	if removed == 0 {
		return nil, errors.New("the certificate is in the keystore outside any entry")
	}
	binary.BigEndian.PutUint32(out[8:], uint32(kept))
	return append(out, keystoreDigest(out)...), nil
}

// keystoreWith returns the keystore with a trusted-certificate entry for each
// certificate added at the end, resealed. Symmetric with keystoreWithout: the
// existing entries are copied byte for byte, so the only differences from what
// came in are the added entries, the count, and the digest.
func keystoreWith(content []byte, ders [][]byte) ([]byte, error) {
	if len(content) < len(keystoreMagic)+8+sha1.Size {
		return nil, errors.New("too short to be a keystore")
	}
	body := len(content) - sha1.Size
	// The same seal check removal makes: a keystore under another password is
	// not this wrapper's to rewrite, and resealing it under this one would
	// leave it unreadable to the JVM that owns it.
	if !bytes.Equal(content[body:], keystoreDigest(content[:body])) {
		return nil, errors.New("not sealed with the system keystore password")
	}
	version, _, err := parseKeystore(content[:body])
	if err != nil {
		return nil, err
	}

	out := slices.Clone(content[:body])
	for i, der := range ders {
		out = append(out, buildTrustedEntry(version, injectedAliasFor(i), der)...)
	}
	binary.BigEndian.PutUint32(out[8:], binary.BigEndian.Uint32(out[8:])+uint32(len(ders)))
	return append(out, keystoreDigest(out)...), nil
}

// buildTrustedEntry builds a tag-2 entry: the CA as a trusted certificate under
// alias, in the shape the keystore's own version writes.
func buildTrustedEntry(version uint32, alias string, der []byte) []byte {
	entry := binary.BigEndian.AppendUint32(nil, 2)
	entry = appendJavaUTF(entry, alias)
	entry = binary.BigEndian.AppendUint64(entry, injectedCreationTime)
	if version > 1 {
		// The certificate type each DER is written under from version 2 on.
		entry = appendJavaUTF(entry, "X.509")
	}
	entry = binary.BigEndian.AppendUint32(entry, uint32(len(der)))
	return append(entry, der...)
}

// appendJavaUTF writes s the way Java does: a two-byte length and then the
// bytes. The aliases and type strings here are ASCII, so their byte length is
// the length Java's modified UTF-8 would write too.
func appendJavaUTF(b []byte, s string) []byte {
	b = binary.BigEndian.AppendUint16(b, uint16(len(s)))
	return append(b, s...)
}

// keystoreDigest is what seals a keystore: the password in UTF-16BE, the JDK's
// own salt, then the keystore up to where the digest goes.
//
// SHA-1 is the format, not a choice: it reproduces the integrity check the JDK
// writes, so a keystore the JVM will still open leaves no other option. It is
// not password hashing either, whatever a scan reads into it: nothing is stored
// or compared as a credential, the password is the fixed one the system
// keystore ships with, and the digest only says whether this file is that
// keystore.
func keystoreDigest(body []byte) []byte {
	h := sha1.New()
	// The password is ASCII, so each character is its own UTF-16 code unit.
	for _, r := range keystorePassword {
		_, _ = h.Write([]byte{byte(r >> 8), byte(r)})
	}
	_, _ = h.Write(keystoreSalt)
	_, _ = h.Write(body)
	return h.Sum(nil)
}

// keystoreEntry is one entry's extent in the keystore it was read from, and
// the certificates it carries. The bytes are kept as an extent rather than
// decoded fields so that an entry that stays is copied rather than rebuilt.
type keystoreEntry struct {
	start, end   int
	trusted      bool
	certificates [][]byte
}

// parseKeystore walks the entries without decoding more of each than it takes
// to find the next one.
func parseKeystore(body []byte) (uint32, []keystoreEntry, error) {
	r := &keystoreReader{body: body, at: len(keystoreMagic)}
	version := r.uint32()
	count := r.uint32()
	// Version 1 leaves out the certificate type that version 2 writes before
	// each DER; nothing else differs. Anything else is a format this has not
	// been shown, such as the PKCS#12 a distribution may move to.
	if version != 1 && version != 2 {
		return 0, nil, fmt.Errorf("keystore version %d", version)
	}

	var entries []keystoreEntry
	for range count {
		entry := keystoreEntry{start: r.at}
		tag := r.uint32()
		r.utf()      // alias
		r.advance(8) // creation time
		// Before the tag is read as one: a count larger than the entries runs
		// the reader off the end, and a zero read back from there is not a
		// tag the file ever held.
		if r.err != nil {
			return 0, nil, r.err
		}
		switch tag {
		case 2:
			entry.trusted = true
			entry.certificates = [][]byte{r.certificate(version)}
		case 1:
			r.advance(int(r.uint32())) // the wrapped private key
			// Counted down rather than ranged over: a length this has not
			// reached yet is whatever the file says, and a corrupt one would
			// otherwise spin for as long as it says before the overrun below
			// is noticed.
			for chain := r.uint32(); chain > 0 && r.err == nil; chain-- {
				entry.certificates = append(entry.certificates, r.certificate(version))
			}
		default:
			return 0, nil, fmt.Errorf("keystore entry tag %d", tag)
		}
		if r.err != nil {
			return 0, nil, r.err
		}
		entry.end = r.at
		entries = append(entries, entry)
	}
	if r.at != len(body) {
		return 0, nil, errors.New("keystore has trailing bytes after its last entry")
	}
	return version, entries, nil
}

// keystoreReader walks the body once, carrying the first overrun rather than
// returning one from every field.
type keystoreReader struct {
	body []byte
	at   int
	err  error
}

func (r *keystoreReader) advance(n int) []byte {
	if r.err != nil {
		return nil
	}
	if n < 0 || n > len(r.body)-r.at {
		r.err = errors.New("keystore ends inside an entry")
		return nil
	}
	at := r.at
	r.at += n
	return r.body[at:r.at]
}

func (r *keystoreReader) uint32() uint32 {
	b := r.advance(4)
	if b == nil {
		return 0
	}
	return binary.BigEndian.Uint32(b)
}

// utf is the two-byte length and the bytes after it that Java writes a string
// as. Nothing here reads one, only steps over it.
func (r *keystoreReader) utf() {
	b := r.advance(2)
	if b == nil {
		return
	}
	r.advance(int(binary.BigEndian.Uint16(b)))
}

func (r *keystoreReader) certificate(version uint32) []byte {
	if version > 1 {
		r.utf() // the certificate's type, "X.509" throughout
	}
	return r.advance(int(r.uint32()))
}
