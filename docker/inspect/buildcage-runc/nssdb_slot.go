package main

// The slot itself: the entry appended to the mirror's pkcs11.txt, taken back
// out of the mirror after the step, and cut out of any copy the step left in
// its layer.

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"syscall"
)

// nssSlot is what pkcs11.txt gains. library= must name the softoken: left
// empty, the entry gives Chromium no second slot. The trailing blank line ends
// the entry, so a module the step adds after it with modutil stays an entry of
// its own.
var nssSlot = []byte("library=libsoftokn3.so\n" +
	"name=\"buildcage proxy CA\"\n" +
	"parameters=\"configdir='sql:" + nssCADBDir + "' flags=readOnly\"\n" +
	"NSS=\"\"\n\n")

// nssSlotConfigDir identifies the slot even after the rest of its entry is
// edited.
var nssSlotConfigDir = []byte("configdir='sql:" + nssCADBDir + "'")

// A real pkcs11.txt is a few hundred bytes per module.
const maxPKCS11TxtBytes = 1 << 20

// appendNSSSlot adds the slot to pkcs11.txt, creating it for the step's user
// when missing, and returns the bytes it appended. Entries are separated by a
// blank line, which the file gains first when it does not already end in one.
func appendNSSSlot(path string, uid, gid int) ([]byte, error) {
	_, statErr := os.Lstat(path)
	f, err := openBundle(path, os.O_CREATE|os.O_RDWR|os.O_APPEND|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0o600)
	if err != nil {
		return nil, asNotRegular(path, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%s: %w", path, errNotRegular)
	}
	var appended []byte
	if size := info.Size(); size > 0 {
		tail := make([]byte, min(size, 2))
		if _, err := f.ReadAt(tail, size-int64(len(tail))); err != nil {
			return nil, err
		}
		switch {
		case bytes.HasSuffix(tail, []byte("\n\n")) || string(tail) == "\n":
		case bytes.HasSuffix(tail, []byte("\n")):
			appended = []byte("\n")
		default:
			appended = []byte("\n\n")
		}
	}
	appended = append(appended, nssSlot...)
	if _, err := f.WriteString(string(appended)); err != nil {
		return nil, err
	}
	if os.IsNotExist(statErr) {
		if err := lchown(path, uid, gid); err != nil {
			return nil, err
		}
	}
	return appended, nil
}

// removeNSSSlot takes back what appendNSSSlot added. NSS rewrites pkcs11.txt
// only by copying the entries it keeps byte for byte, so the slot is found
// where it was left unless the step itself took it out, in which case the file
// is written back as the step left it. The separator goes too only when nothing
// follows the slot: an entry after it would otherwise run into the one before.
// A pkcs11.txt the step replaced with something other than a file carries no
// slot. One the injection created is removed once it holds nothing else.
func removeNSSSlot(path string, appended []byte, created bool) error {
	f, err := openBundle(path, os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		if os.IsNotExist(err) || errors.Is(err, syscall.EISDIR) || errors.Is(asNotRegular(path, err), errNotRegular) {
			return nil
		}
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return nil
	}
	if info.Size() > maxPKCS11TxtBytes {
		return fmt.Errorf("%s is %d bytes, too large to take the proxy CA's slot back out of", path, info.Size())
	}
	content := make([]byte, info.Size())
	if _, err := f.ReadAt(content, 0); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	cut, i := appended, bytes.LastIndex(content, appended)
	if i < 0 || i+len(cut) < len(content) {
		cut, i = nssSlot, bytes.LastIndex(content, nssSlot)
	}
	if i < 0 {
		logf("%s no longer holds the proxy CA's slot; writing it back as the step left it", path)
		return nil
	}
	kept := slices.Concat(content[:i], content[i+len(cut):])
	if created && len(kept) == 0 {
		return os.Remove(path)
	}
	if _, err := f.WriteAt(kept, 0); err != nil {
		return err
	}
	return f.Truncate(int64(len(kept)))
}

// stripNSSSlotCopy cuts every copy of the slot out of the pkcs11.txt at path.
// When the file still ends in appended, the separator and slot appendNSSSlot
// added, the separator goes too. A file left empty is removed. It returns why
// the file still counts as residue, or "" when it does not.
func stripNSSSlotCopy(path string, appended []byte) (string, error) {
	f, err := openBundle(path, os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return "", asNotRegular(path, err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	// Too large to be one NSS wrote.
	if info.Size() > maxPKCS11TxtBytes {
		return "over 1 MiB, not read", nil
	}
	content := make([]byte, info.Size())
	if _, err := f.ReadAt(content, 0); err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	kept := content
	if len(appended) > 0 && bytes.HasSuffix(kept, appended) {
		kept = kept[:len(kept)-len(appended)]
	}
	for bytes.Contains(kept, nssSlot) {
		kept = bytes.ReplaceAll(kept, nssSlot, nil)
	}
	if len(kept) < len(content) {
		if len(kept) == 0 {
			return "", os.Remove(path)
		}
		if _, err := f.WriteAt(kept, 0); err != nil {
			return "", err
		}
		if err := f.Truncate(int64(len(kept))); err != nil {
			return "", err
		}
	}
	if bytes.Contains(kept, nssSlotConfigDir) {
		return "still names " + nssCADBDir, nil
	}
	return "", nil
}
