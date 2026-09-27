package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// injectSlot injects into a bundle whose step user has a home and, when
// pkcs11 is not nil, a legacy database of its own holding that pkcs11.txt.
func injectSlot(t *testing.T, pkcs11 *string) (in *injection, bundle, rootfs, mirror string) {
	t.Helper()
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, rootfs = newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")
	if pkcs11 != nil {
		legacy := filepath.Join(rootfs, "root", nssDBPath)
		mustMkdirAll(t, legacy)
		mustWriteFile(t, filepath.Join(legacy, "cert9.db"), "THE STEP'S OWN")
		mustWriteFile(t, filepath.Join(legacy, "pkcs11.txt"), *pkcs11)
		giveToStepUser(t, legacy, uid, gid)
	}
	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	return in, bundle, rootfs, slotAt(t, in, bundle, "/root/.pki/nssdb")
}

func ptr(s string) *string { return &s }

func mustRead(t *testing.T, path string) string {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(got)
}

func TestNSSDBSlotGoesIntoANewDatabaseAndComesBackOut(t *testing.T) {
	in, bundle, rootfs, mirror := injectSlot(t, nil)
	uid, gid := stepUser()

	if got := mustRead(t, filepath.Join(mirror, "pkcs11.txt")); got != string(nssSlot) {
		t.Fatalf("pkcs11.txt holds %q, want only the slot", got)
	}
	if u, g, mode := mustOwner(t, filepath.Join(mirror, "pkcs11.txt")); u != uid || g != gid || mode != 0o600 {
		t.Fatalf("pkcs11.txt is %d:%d %o, want %d:%d 600", u, g, mode, uid, gid)
	}
	if u, g, mode := mustOwner(t, mirror); u != uid || g != gid || mode != 0o700 {
		t.Fatalf("the mirror is %d:%d %o, want %d:%d 700", u, g, mode, uid, gid)
	}
	for _, dir := range []string{".pki", ".pki/nssdb"} {
		if u, g, mode := mustOwner(t, filepath.Join(rootfs, "root", dir)); u != uid || g != gid || mode != 0o700 {
			t.Fatalf("~/%s was created %d:%d %o, want %d:%d 700", dir, u, g, mode, uid, gid)
		}
	}
	caDB, _ := findMount(t, loadMounts(t, bundle), nssCADBDir)["source"].(string)
	if _, _, mode := mustOwner(t, caDB); mode != 0o755 {
		t.Fatalf("the CA database directory is %o, want 755", mode)
	}
	for name, want := range testNSSTemplate {
		path := filepath.Join(caDB, name)
		if got := mustRead(t, path); got != want {
			t.Fatalf("%s holds %q, not the template's %q", name, got, want)
		}
		if _, _, mode := mustOwner(t, path); mode != 0o644 {
			t.Fatalf("%s is %o, want 644", name, mode)
		}
	}

	if err := in.finish(true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(rootfs, "root/.pki")); !os.IsNotExist(err) {
		t.Fatal("~/.pki was left behind")
	}
	for _, dir := range []string{mirror, caDB} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("%s was left behind", dir)
		}
	}
}

// Chromium creates a database where there was none; the step keeps it, less
// the pkcs11.txt that held only the slot.
func TestNSSDBSlotKeepsADatabaseTheStepCreated(t *testing.T) {
	in, _, rootfs, mirror := injectSlot(t, nil)
	mustWriteFile(t, filepath.Join(mirror, "cert9.db"), "CREATED BY CHROMIUM")

	if err := in.finish(true); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(rootfs, "root", nssDBPath)
	if got := mustRead(t, filepath.Join(legacy, "cert9.db")); got != "CREATED BY CHROMIUM" {
		t.Fatalf("cert9.db holds %q", got)
	}
	if _, err := os.Lstat(filepath.Join(legacy, "pkcs11.txt")); !os.IsNotExist(err) {
		t.Fatal("the pkcs11.txt holding only the slot was written back")
	}
}

func TestNSSDBSlotIsAppendedAsAnEntryOfItsOwn(t *testing.T) {
	for name, tc := range map[string]struct{ original, separator string }{
		"ending in a blank line": {"library=\nname=internal\n\n", ""},
		"ending in a newline":    {"library=\nname=internal\n", "\n"},
		"ending mid-line":        {"library=\nname=internal", "\n\n"},
		"a lone newline":         {"\n", ""},
		"empty":                  {"", ""},
	} {
		t.Run(name, func(t *testing.T) {
			in, _, rootfs, mirror := injectSlot(t, ptr(tc.original))
			want := tc.original + tc.separator + string(nssSlot)
			if got := mustRead(t, filepath.Join(mirror, "pkcs11.txt")); got != want {
				t.Fatalf("pkcs11.txt holds %q, want %q", got, want)
			}

			// A change elsewhere, so the mirror is written back.
			mustWriteFile(t, filepath.Join(mirror, "cert9.db"), "CHANGED BY THE STEP")
			if err := in.finish(true); err != nil {
				t.Fatal(err)
			}
			legacy := filepath.Join(rootfs, "root", nssDBPath)
			if got := mustRead(t, filepath.Join(legacy, "pkcs11.txt")); got != tc.original {
				t.Fatalf("pkcs11.txt was written back as %q, want %q", got, tc.original)
			}
			if got := mustRead(t, filepath.Join(legacy, "cert9.db")); got != "CHANGED BY THE STEP" {
				t.Fatalf("the step's change was not written back: %q", got)
			}
		})
	}
}

// What modutil does: NSS copies the entries it keeps byte for byte and
// appends the new one.
func TestNSSDBSlotLeavesAModuleTheStepAdded(t *testing.T) {
	original := "library=\nname=internal\n\n"
	in, _, rootfs, mirror := injectSlot(t, ptr(original))
	module := "library=/usr/lib/opensc-pkcs11.so\nname=OpenSC\n\n"
	mustAppendFile(t, filepath.Join(mirror, "pkcs11.txt"), module)

	if err := in.finish(true); err != nil {
		t.Fatal(err)
	}
	got := mustRead(t, filepath.Join(rootfs, "root", nssDBPath, "pkcs11.txt"))
	if got != original+module {
		t.Fatalf("pkcs11.txt was written back as %q, want %q", got, original+module)
	}
}

func TestNSSDBSlotTheStepRewroteIsStillTakenOut(t *testing.T) {
	for name, tc := range map[string]struct{ rewrite, want string }{
		// The separator the injection added is gone, the slot itself is not.
		"without the separator": {"library=\nname=rewritten" + string(nssSlot), "library=\nname=rewritten"},
		"the slot taken out":    {"library=\nname=rewritten\n", "library=\nname=rewritten\n"},
	} {
		t.Run(name, func(t *testing.T) {
			in, _, rootfs, mirror := injectSlot(t, ptr("library=\nname=internal\n"))
			mustWriteFile(t, filepath.Join(mirror, "pkcs11.txt"), tc.rewrite)

			if err := in.finish(true); err != nil {
				t.Fatal(err)
			}
			if got := mustRead(t, filepath.Join(rootfs, "root", nssDBPath, "pkcs11.txt")); got != tc.want {
				t.Fatalf("pkcs11.txt was written back as %q, want %q", got, tc.want)
			}
		})
	}
}

// Nothing but a file can carry the slot, so anything else is written back as
// the step left it.
func TestNSSDBSlotLeavesAPkcs11TxtThatIsNoLongerAFile(t *testing.T) {
	for name, replace := range map[string]func(t *testing.T, path string){
		"a symlink":   func(t *testing.T, path string) { mustSymlink(t, "elsewhere", path) },
		"a directory": func(t *testing.T, path string) { mustMkdirAll(t, path) },
		"gone":        func(*testing.T, string) {},
	} {
		t.Run(name, func(t *testing.T) {
			in, _, rootfs, mirror := injectSlot(t, ptr("library=\n"))
			path := filepath.Join(mirror, "pkcs11.txt")
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			replace(t, path)

			if err := in.finish(true); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(rootfs, "root", nssDBPath, "cert9.db")); err != nil {
				t.Fatal("the rest of the database was not written back")
			}
		})
	}
}

func TestNSSDBSlotRefusesAPkcs11TxtTooLargeToRead(t *testing.T) {
	in, _, _, mirror := injectSlot(t, ptr("library=\n"))
	mustSparseFile(t, filepath.Join(mirror, "pkcs11.txt"), maxPKCS11TxtBytes+1)

	if err := in.finish(true); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("got %v, want a pkcs11.txt too large to read to fail the step", err)
	}
}

// Changing the CA's trust in the step copies it into the step's own database,
// which is binary and so cannot be cut.
func TestNSSDBSlotFailsOnTheCACopiedIntoTheStepsDatabase(t *testing.T) {
	in, _, _, mirror := injectSlot(t, ptr("library=\n"))
	mustWriteFile(t, filepath.Join(mirror, "cert9.db"), "SQLite\x00"+string(certificateDERs(testCA)[0]))

	if err := in.finish(true); !errors.Is(err, errUnstrippableCA) {
		t.Fatalf("got %v, want the copy to fail the step as residue", err)
	}
}

func TestNSSDBIsCoveredWhenTheSlotCannotBeAdded(t *testing.T) {
	for name, arrange := range map[string]func(t *testing.T, bundle, legacy string){
		"a database the user cannot write": func(t *testing.T, _, legacy string) {
			if err := os.Chmod(legacy, 0o555); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.Chmod(legacy, 0o755) })
		},
		"a cert9.db the user cannot write": func(t *testing.T, _, legacy string) {
			if err := os.Chmod(filepath.Join(legacy, "cert9.db"), 0o444); err != nil {
				t.Fatal(err)
			}
		},
		"a cert9.db that is a symlink": func(t *testing.T, _, legacy string) {
			if err := os.Remove(filepath.Join(legacy, "cert9.db")); err != nil {
				t.Fatal(err)
			}
			mustSymlink(t, "/etc/passwd", filepath.Join(legacy, "cert9.db"))
		},
		"a pkcs11.txt that is a symlink": func(t *testing.T, _, legacy string) {
			mustSymlink(t, "/etc/passwd", filepath.Join(legacy, "pkcs11.txt"))
		},
		"a database too large to mirror": func(t *testing.T, _, legacy string) {
			mustSparseFile(t, filepath.Join(legacy, "big.db"), maxCustomDirBytes+1)
		},
		"a mount where the CA database goes": func(t *testing.T, bundle, _ string) {
			mountAt(t, bundle, nssCADBDir+"/x")
		},
		"a mirror that cannot be made": func(t *testing.T, _, _ string) {
			failRsyncOn(t, 1)
		},
		"a mirror that cannot be read": func(t *testing.T, _, _ string) {
			failWalkUnderOnce(t, scratchRoot)
		},
	} {
		t.Run(name, func(t *testing.T) {
			useTempLog(t)
			useFakeRsync(t)
			useNSSTemplate(t)
			uid, gid := stepUser()
			bundle, rootfs := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")
			legacy := filepath.Join(rootfs, "root", nssDBPath)
			mustMkdirAll(t, legacy)
			mustWriteFile(t, filepath.Join(legacy, "cert9.db"), "THE STEP'S OWN")
			giveToStepUser(t, legacy, uid, gid)
			arrange(t, bundle, legacy)

			in, err := inject(bundle, testCA)
			if err != nil {
				t.Fatal(err)
			}
			assertNoSlot(t, in)
			if in.nss == nil || in.nss.containerDir != "/root/.pki/nssdb" {
				t.Fatal("the database was not covered instead")
			}
		})
	}
}

// failWalkUnderOnce fails the first walk of anything under root, which here is
// the mirror's first manifest, and lets the cover's own walks through.
func failWalkUnderOnce(t *testing.T, root string) {
	t.Helper()
	failed := false
	old := walkDir
	walkDir = func(dir string, fn fs.WalkDirFunc) error {
		if !failed && strings.HasPrefix(dir, root+"/") {
			failed = true
			return errBrokenWalk
		}
		return old(dir, fn)
	}
	t.Cleanup(func() { walkDir = old })
}

// The mirror's second manifest, taken after the slot went in.
func TestNSSDBIsCoveredWhenTheMirrorCannotBeReadAfterTheSlot(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, _ := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")
	walks := 0
	old := walkDir
	walkDir = func(dir string, fn fs.WalkDirFunc) error {
		if strings.HasPrefix(dir, scratchRoot+"/") {
			if walks++; walks == 2 {
				return errBrokenWalk
			}
		}
		return old(dir, fn)
	}
	t.Cleanup(func() { walkDir = old })

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	assertNoSlot(t, in)
	if in.nss == nil {
		t.Fatal("the database was not covered instead")
	}
}

// An XDG path that cannot be read leaves the legacy one to cover.
func TestNSSDBIsCoveredWhenTheXDGPathCannotBeResolved(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, rootfs := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")
	mustSymlink(t, "../../../../../..", filepath.Join(rootfs, "root/.local"))

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	assertNoSlot(t, in)
	if in.nss == nil || in.nss.containerDir != "/root/.pki/nssdb" {
		t.Fatal("the legacy path was not covered instead")
	}
}

func TestNSSDBIsCoveredWhenTheDatabaseCannotBeListed(t *testing.T) {
	skipIfRoot(t)
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, rootfs := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")
	legacy := filepath.Join(rootfs, "root", nssDBPath)
	mustMkdirAll(t, legacy)
	// Writable, but not searchable, so its files cannot be looked at.
	if err := os.Chmod(legacy, 0o200); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(legacy, 0o755) })

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	assertNoSlot(t, in)
}

type fakeInfo struct {
	fs.FileInfo
	mode     fs.FileMode
	uid, gid uint32
}

func (f fakeInfo) Mode() fs.FileMode { return f.mode }
func (f fakeInfo) Sys() any          { return &syscall.Stat_t{Uid: f.uid, Gid: f.gid} }
func (f fakeInfo) ModTime() time.Time {
	return time.Time{}
}

func TestWritableBy(t *testing.T) {
	for name, tc := range map[string]struct {
		info fakeInfo
		uid  int
		want bool
	}{
		"root":                        {fakeInfo{mode: 0o500, uid: 1}, 0, true},
		"the owner":                   {fakeInfo{mode: 0o200, uid: 7}, 7, true},
		"the owner, read-only":        {fakeInfo{mode: 0o577, uid: 7}, 7, false},
		"the group":                   {fakeInfo{mode: 0o020, uid: 1, gid: 7}, 7, true},
		"the group, read-only":        {fakeInfo{mode: 0o757, uid: 1, gid: 7}, 7, false},
		"a supplementary group":       {fakeInfo{mode: 0o020, uid: 1, gid: 9}, 7, true},
		"anyone else":                 {fakeInfo{mode: 0o002, uid: 1, gid: 1}, 7, true},
		"anyone else, not writable":   {fakeInfo{mode: 0o775, uid: 1, gid: 1}, 7, false},
		"the owner ignores its group": {fakeInfo{mode: 0o570, uid: 7, gid: 7}, 7, false},
	} {
		t.Run(name, func(t *testing.T) {
			if got := writableBy(tc.info, tc.uid, 7, []int{9}); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestProcessGroups(t *testing.T) {
	bundle, _ := newBundleNoStore(t, nil)
	setSpecField(t, bundle, "process", func(proc map[string]any) {
		proc["user"] = map[string]any{"uid": 1, "gid": 2, "additionalGids": []any{3, 4}}
	})
	s, err := loadSpec(bundle)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.processGroups(); len(got) != 2 || got[0] != 3 || got[1] != 4 {
		t.Fatalf("got %v, want [3 4]", got)
	}
}

func TestAppendNSSSlotReportsWhatItCannotDo(t *testing.T) {
	for name, tc := range map[string]struct {
		broken   *brokenFile
		existing string
		lchown   bool
	}{
		"a failed stat":         {broken: &brokenFile{failStat: true}},
		"not a regular file":    {broken: &brokenFile{notRegular: true}},
		"a failed read":         {broken: &brokenFile{failReadAt: 1}, existing: "library=\n"},
		"a failed write":        {broken: &brokenFile{failWrite: 1}},
		"a failed hand-over":    {lchown: true},
		"a failed open":         {existing: "\x00dir"},
		"a symlink in its path": {existing: "\x00link"},
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "pkcs11.txt")
			switch tc.existing {
			case "":
			case "\x00dir":
				mustMkdirAll(t, path)
			case "\x00link":
				mustSymlink(t, "elsewhere", path)
			default:
				mustWriteFile(t, path, tc.existing)
			}
			if tc.broken != nil {
				useBrokenBundleFile(t, tc.broken)
			}
			if tc.lchown {
				old := lchown
				lchown = func(string, int, int) error { return errBrokenFile }
				t.Cleanup(func() { lchown = old })
			}
			if _, err := appendNSSSlot(path, 0, 0); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestRemoveNSSSlotReportsWhatItCannotDo(t *testing.T) {
	for name, broken := range map[string]*brokenFile{
		"a failed stat":     {failStat: true},
		"a failed read":     {failReadAt: 1},
		"a failed write":    {failWriteAt: 1},
		"a failed truncate": {failTruncate: true},
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "pkcs11.txt")
			mustWriteFile(t, path, "library=\n"+string(nssSlot))
			useBrokenBundleFile(t, broken)
			if err := removeNSSSlot(path, nssSlot, false); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestRemoveNSSSlotLeavesSomethingNotRegular(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pkcs11.txt")
	mustWriteFile(t, path, string(nssSlot))
	useBrokenBundleFile(t, &brokenFile{notRegular: true})
	if err := removeNSSSlot(path, nssSlot, true); err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, path); got != string(nssSlot) {
		t.Fatalf("got %q", got)
	}
}

func TestRemoveNSSSlotReportsAFileItCannotOpen(t *testing.T) {
	skipIfRoot(t)
	path := filepath.Join(t.TempDir(), "pkcs11.txt")
	mustWriteFile(t, path, string(nssSlot))
	if err := os.Chmod(path, 0); err != nil {
		t.Fatal(err)
	}
	if err := removeNSSSlot(path, nssSlot, false); err == nil {
		t.Fatal("expected an unreadable pkcs11.txt to be reported")
	}
}
