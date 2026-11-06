package main

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"testing"
)

// apkDB is the shape of /lib/apk/db/installed: one record per package, each
// file an R: line under its F: directory with its Z: checksum after it.
func apkDB(bundleSum string) string {
	return "P:musl\nV:1.2.5-r0\nF:lib\nR:ld-musl.so.1\nZ:Q1AAAA\n\n" +
		"P:ca-certificates-bundle\nV:20260909-r0\nF:etc/ssl\nR:cert.pem\na:0:0:777\nZ:Q1LINK\n" +
		"F:etc/ssl/certs\nR:ca-certificates.crt\nZ:" + bundleSum + "\n\n"
}

func sha1Record(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "f")
	mustWriteFile(t, path, content)
	sum, err := apkChecksumOfFile(path, false)
	if err != nil {
		t.Fatal(err)
	}
	return sum
}

// newAPKBundle is newBundle in an apk-based image whose database records the
// store as the image ships it.
func newAPKBundle(t *testing.T) (bundle, rootfs string) {
	t.Helper()
	bundle, rootfs = newBundle(t, []string{"PATH=/usr/bin"})
	mustMkdirAll(t, filepath.Join(rootfs, "lib", "apk", "db"))
	mustWriteFile(t, dbPath(rootfs), apkDB(sha1Record(t, "ORIGINAL-ROOTS\n")))
	return bundle, rootfs
}

func dbPath(rootfs string) string {
	return filepath.Join(rootfs, "lib", "apk", "db", "installed")
}

func certsOf(rootfs string) string { return filepath.Join(rootfs, "etc", "ssl", "certs") }

func mountSource(t *testing.T, bundle, dest string) string {
	t.Helper()
	source, _ := findMount(t, loadMounts(t, bundle), dest)["source"].(string)
	return source
}

func ownLogText() string {
	var out strings.Builder
	dumpOwnLog(&out)
	return out.String()
}

func TestParseAPKDatabaseReadsRecordsPackagesAndDirectories(t *testing.T) {
	db := apkDB("Q1BUNDLE") +
		"P:new\nf:S\nF:etc\nR:a\nZ:Q1NEW\n\n" +
		"P:old\nF:etc\nR:b\nZ:Q1OLD\n\n" +
		"P:empty\nV:1\n"
	got := parseAPKDatabase([]byte(db))
	want := map[string]apkRecord{
		"lib/ld-musl.so.1":                  {value: "Q1AAAA", pkg: "musl"},
		"etc/ssl/cert.pem":                  {value: "Q1LINK", pkg: "ca-certificates-bundle"},
		"etc/ssl/certs/ca-certificates.crt": {value: "Q1BUNDLE", pkg: "ca-certificates-bundle"},
		"etc/a":                             {value: "Q1NEW", truncatedSHA256: true, pkg: "new"},
		"etc/b":                             {value: "Q1OLD", pkg: "old"},
	}
	if len(got.records) != len(want) {
		t.Fatalf("got %v", got.records)
	}
	for path, record := range want {
		if got.records[path] != record {
			t.Errorf("%s: got %+v, want %+v", path, got.records[path], record)
		}
	}
	if files := got.packages["ca-certificates-bundle"]; !slices.Equal(files, []string{"etc/ssl/cert.pem", "etc/ssl/certs/ca-certificates.crt"}) {
		t.Errorf("files: %v", files)
	}
	if files, ok := got.packages["empty"]; !ok || len(files) != 0 {
		t.Errorf("a package with no files: %v, %v", files, ok)
	}
	if owners := got.dirOwners["etc"]; !slices.Equal(owners, []string{"new", "old"}) {
		t.Errorf("owners of etc: %v", owners)
	}
}

// A Z: line belongs to the R: line above it only until the record or the
// directory ends.
func TestParseAPKDatabaseReadsZOnlyAfterItsFile(t *testing.T) {
	for _, db := range []string{
		"F:etc\nR:a\n\nZ:Q1OLD\n",
		"F:etc\nR:a\nF:usr\nZ:Q1OLD\n",
	} {
		if got := parseAPKDatabase([]byte(db)).records; len(got) != 0 {
			t.Errorf("%q gave %v", db, got)
		}
	}
	if got := parseAPKDatabase([]byte("F:etc\nR:a\nZ:Q1KEPT\nZ:Q1OLD\n")).records; got["etc/a"].value != "Q1KEPT" {
		t.Errorf("got %v", got)
	}
}

func TestAPKChecksumOfFileIsWhatApkRecords(t *testing.T) {
	// SHA-1("abc") is a9993e36...d0d89d.
	if got := sha1Record(t, "abc"); got != "Q1qZk+NkcGgWq6PiVxeFDCbJzQ2J0=" {
		t.Errorf("SHA-1: got %s", got)
	}
	path := filepath.Join(t.TempDir(), "f")
	mustWriteFile(t, path, "abc")
	full := sha256.Sum256([]byte("abc"))
	got, err := apkChecksumOfFile(path, true)
	if err != nil || got != "Q1"+base64.StdEncoding.EncodeToString(full[:20]) {
		t.Errorf("truncated SHA-256: got %s, %v", got, err)
	}
}

func TestAPKChecksumOfFileRefusesWhatIsNotAFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle")
	mustWriteFile(t, path, "x")
	link := filepath.Join(t.TempDir(), "link")
	mustSymlink(t, path, link)
	if _, err := apkChecksumOfFile(link, false); !errors.Is(err, errNotRegular) {
		t.Errorf("symlink: got %v", err)
	}
	t.Run("swapped for a symlink after the check", func(t *testing.T) {
		old := openBundle
		openBundle = func(string, int, os.FileMode) (bundleFile, error) { return nil, syscall.ELOOP }
		t.Cleanup(func() { openBundle = old })
		if _, err := apkChecksumOfFile(path, false); !errors.Is(err, errNotRegular) {
			t.Fatalf("got %v", err)
		}
	})
	for _, tc := range []struct {
		name   string
		broken brokenFile
		want   error
	}{
		{"failed stat", brokenFile{failStat: true}, errBrokenFile},
		{"not a file", brokenFile{notRegular: true}, errNotRegular},
		{"failed read", brokenFile{failReadAt: 1}, errBrokenFile},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useBrokenBundleFile(t, &tc.broken)
			if _, err := apkChecksumOfFile(path, false); !errors.Is(err, tc.want) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

func TestReadDatabaseRefusesOneTooLargeToHold(t *testing.T) {
	path := filepath.Join(t.TempDir(), "installed")
	mustSparseFile(t, path, maxCustomDirBytes+1)
	if _, _, err := readDatabase(path); !errors.Is(err, errDatabaseTooLarge) {
		t.Fatalf("got %v", err)
	}
}

// The image or the step can leave a device node at the database's path, which
// the wrapper must not open as root on the host.
func TestReadDatabaseRefusesWhatIsNotAFileBeforeOpeningIt(t *testing.T) {
	opened := 0
	old := openBundle
	openBundle = func(path string, flag int, perm os.FileMode) (bundleFile, error) {
		opened++
		return old(path, flag, perm)
	}
	t.Cleanup(func() { openBundle = old })

	for _, tc := range []struct {
		name    string
		arrange func(t *testing.T, path string)
	}{
		{"device", func(t *testing.T, path string) {
			var null syscall.Stat_t
			if err := syscall.Stat("/dev/null", &null); err != nil {
				t.Skipf("no /dev/null: %v", err)
			}
			if err := syscall.Mknod(path, syscall.S_IFCHR|0o644, int(null.Rdev)); err != nil {
				t.Skipf("mknod unavailable: %v", err)
			}
		}},
		{"FIFO", func(t *testing.T, path string) {
			if err := syscall.Mkfifo(path, 0o644); err != nil {
				t.Skipf("mkfifo unavailable: %v", err)
			}
		}},
		{"directory", func(t *testing.T, path string) { mustMkdirAll(t, path) }},
		{"symlink", func(t *testing.T, path string) {
			target := filepath.Join(t.TempDir(), "installed")
			mustWriteFile(t, target, "P:musl\n")
			mustSymlink(t, target, path)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "installed")
			tc.arrange(t, path)
			opened = 0
			if _, _, err := readDatabase(path); !errors.Is(err, errNotRegular) {
				t.Errorf("got %v", err)
			}
			if opened != 0 {
				t.Errorf("opened it %d times", opened)
			}
		})
	}
}

// A database naming a file with ".." under the mirrored directory points into
// the rootfs, never past the mirror into the host.
func TestAPKSeesCleansThePathBeforeMatchingTheMirror(t *testing.T) {
	rootfs, scratch := t.TempDir(), t.TempDir()
	b := &dirBind{containerDir: "/etc/ssl/certs", scratchDir: scratch, apk: &apkState{rootfs: rootfs}}
	for rel, want := range map[string]string{
		"etc/ssl/certs/ca-certificates.crt":               filepath.Join(scratch, "ca-certificates.crt"),
		"etc/ssl/certs/sub/../ca-certificates.crt":        filepath.Join(scratch, "ca-certificates.crt"),
		"etc/ssl/certs/../../../../../../../../etc/hosts": filepath.Join(rootfs, "etc", "hosts"),
		"etc/ssl/certs/../cert.pem":                       filepath.Join(rootfs, "etc", "ssl", "cert.pem"),
	} {
		got, ok := b.apkSees(rel)
		if !ok || got != want {
			t.Errorf("%s: got %s, %v, want %s", rel, got, ok, want)
		}
	}
}

// A symlink the step left in the mirror resolves inside the mirror, as
// resolveInRoot resolves one in the rootfs, never on the host.
func TestAPKSeesKeepsASymlinkInTheMirrorInsideIt(t *testing.T) {
	rootfs, scratch, host := t.TempDir(), t.TempDir(), t.TempDir()
	mustWriteFile(t, filepath.Join(host, "x"), "")
	mustSymlink(t, host, filepath.Join(scratch, "sub"))
	mustSymlink(t, "loop-b", filepath.Join(scratch, "loop-a"))
	mustSymlink(t, "loop-a", filepath.Join(scratch, "loop-b"))
	b := &dirBind{containerDir: "/etc/ssl/certs", scratchDir: scratch, apk: &apkState{rootfs: rootfs}}

	got, ok := b.apkSees("etc/ssl/certs/sub/x")
	if want := filepath.Join(scratch, host, "x"); !ok || got != want {
		t.Errorf("got %s, %v, want %s", got, ok, want)
	}
	if got, ok := b.apkSees("etc/ssl/certs/loop-a/x"); ok {
		t.Errorf("a symlink loop resolved to %s", got)
	}
}

// stepLeaves runs inject, lets the step leave content at each name in the
// store's mirror, and finishes.
func stepLeaves(t *testing.T, bundle string, files map[string]string) error {
	t.Helper()
	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mirror := mountSource(t, bundle, "/etc/ssl/certs")
	for name, content := range files {
		mustWriteFile(t, filepath.Join(mirror, name), content)
	}
	return restore.finish()
}

// An upgrade under any engine replaces a bundle that matches apk's record; the
// CA kept it from matching, so its .apk-new goes into place.
func TestInjectMovesTheAPKNewOfAnUpgradeIntoPlace(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)

	if err := stepLeaves(t, bundle, map[string]string{"ca-certificates.crt.apk-new": "NEW-ROOTS\n"}); err != nil {
		t.Fatal(err)
	}

	if got := mustRead(t, filepath.Join(certsOf(rootfs), "ca-certificates.crt")); got != "NEW-ROOTS\n" {
		t.Errorf("store: %q", got)
	}
	if _, err := os.Lstat(filepath.Join(certsOf(rootfs), "ca-certificates.crt.apk-new")); !os.IsNotExist(err) {
		t.Errorf("the .apk-new is still there: %v", err)
	}
	if want := "moved /etc/ssl/certs/ca-certificates.crt.apk-new over /etc/ssl/certs/ca-certificates.crt"; !strings.Contains(ownLogText(), want) {
		t.Errorf("%q is not in the log:\n%s", want, ownLogText())
	}
}

// A package built as apk v3 records truncated SHA-256 values.
func TestInjectMatchesATruncatedSHA256Record(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)
	full := sha256.Sum256([]byte("ORIGINAL-ROOTS\n"))
	db := strings.Replace(apkDB("Q1"+base64.StdEncoding.EncodeToString(full[:20])), "V:20260909-r0\n", "V:20260909-r0\nf:S\n", 1)
	mustWriteFile(t, dbPath(rootfs), db)

	if err := stepLeaves(t, bundle, map[string]string{"ca-certificates.crt.apk-new": "NEW-ROOTS\n"}); err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, filepath.Join(certsOf(rootfs), "ca-certificates.crt")); got != "NEW-ROOTS\n" {
		t.Errorf("store: %q", got)
	}
}

// A reinstall compares the bundle with the package's file, which the .apk-new
// holds, so with no record to match the .apk-new still goes into place when
// it holds what the bundle held.
func TestInjectMovesTheAPKNewOfAReinstallIntoPlace(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})

	if err := stepLeaves(t, bundle, map[string]string{"ca-certificates.crt.apk-new": "ORIGINAL-ROOTS\n"}); err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, filepath.Join(certsOf(rootfs), "ca-certificates.crt")); got != "ORIGINAL-ROOTS\n" {
		t.Errorf("store: %q", got)
	}
	if _, err := os.Lstat(filepath.Join(certsOf(rootfs), "ca-certificates.crt.apk-new")); !os.IsNotExist(err) {
		t.Errorf("the .apk-new is still there: %v", err)
	}
}

// apk keeps these under any engine, so they stay.
func TestInjectLeavesAnAPKNewApkWouldHaveLeftAnyway(t *testing.T) {
	for _, tc := range []struct {
		name    string
		arrange func(t *testing.T, rootfs string)
		step    func(t *testing.T, mirror string)
	}{
		{"a bundle the image changed", func(t *testing.T, rootfs string) {
			mustAppendFile(t, filepath.Join(certsOf(rootfs), "ca-certificates.crt"), "COMPANY-CA\n")
		}, nil},
		{"a bundle the step changed", nil, func(t *testing.T, mirror string) {
			mustAppendFile(t, filepath.Join(mirror, "ca-certificates.crt"), "COMPANY-CA\n")
		}},
		{"an .apk-new the image had", func(t *testing.T, rootfs string) {
			mustWriteFile(t, filepath.Join(certsOf(rootfs), "ca-certificates.crt.apk-new"), "NEW-ROOTS\n")
		}, func(t *testing.T, mirror string) {
			mustWriteFile(t, filepath.Join(mirror, "other"), "")
		}},
		{"a bundle the step removed", nil, func(t *testing.T, mirror string) {
			if err := os.Remove(filepath.Join(mirror, "ca-certificates.crt")); err != nil {
				t.Fatal(err)
			}
		}},
		{"a bundle the step left as a symlink", nil, func(t *testing.T, mirror string) {
			mustSymlink(t, "ca-certificates.crt.apk-new", filepath.Join(mirror, "ca-certificates.crt"))
		}},
		{"an .apk-new that is a symlink", nil, func(t *testing.T, mirror string) {
			mustSymlink(t, "elsewhere", filepath.Join(mirror, "ca-certificates.crt.apk-new"))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useFakeRsync(t)
			bundle, rootfs := newAPKBundle(t)
			if tc.arrange != nil {
				tc.arrange(t, rootfs)
			}
			restore, err := inject(bundle, testCA)
			if err != nil {
				t.Fatal(err)
			}
			mirror := mountSource(t, bundle, "/etc/ssl/certs")
			if _, err := os.Lstat(filepath.Join(mirror, "ca-certificates.crt.apk-new")); os.IsNotExist(err) {
				mustWriteFile(t, filepath.Join(mirror, "ca-certificates.crt.apk-new"), "NEW-ROOTS\n")
			}
			if tc.step != nil {
				tc.step(t, mirror)
			}
			if err := restore.finish(); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Lstat(filepath.Join(certsOf(rootfs), "ca-certificates.crt.apk-new")); err != nil {
				t.Errorf("the .apk-new is gone: %v", err)
			}
		})
	}
}

// A bundle the image shipped as something other than a file, or did not ship,
// is not one apk would replace either.
func TestPromoteAPKNewLeavesABundleThatWasNotAFile(t *testing.T) {
	scratch := t.TempDir()
	mustWriteFile(t, filepath.Join(scratch, "bundle.pem.apk-new"), "NEW\n")
	mustWriteFile(t, filepath.Join(scratch, "absent.pem.apk-new"), "NEW\n")
	b := &dirBind{scratchDir: scratch, bundleFiles: []string{"bundle.pem", "absent.pem"},
		apkRecorded: map[string]bool{"bundle.pem": true, "absent.pem": true},
		original:    []fileEntry{{path: "bundle.pem", mode: os.ModeSymlink}}}
	if err := b.promoteAPKNew(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"bundle.pem.apk-new", "absent.pem.apk-new"} {
		if got := mustRead(t, filepath.Join(scratch, name)); got != "NEW\n" {
			t.Errorf("%s: got %q", name, got)
		}
	}
}

func TestNoteAPKRecordsSkipsWhatItCannotRead(t *testing.T) {
	for _, tc := range []struct {
		name    string
		arrange func(t *testing.T, rootfs string)
		want    string
	}{
		{"unresolvable path", func(t *testing.T, rootfs string) {
			if err := os.RemoveAll(filepath.Join(rootfs, "lib")); err != nil {
				t.Fatal(err)
			}
			mustSymlink(t, "lib-loop", filepath.Join(rootfs, "lib"))
			mustSymlink(t, "lib", filepath.Join(rootfs, "lib-loop"))
		}, "cannot resolve " + apkDBPath},
		{"unreadable database", func(t *testing.T, rootfs string) {
			if err := os.Remove(dbPath(rootfs)); err != nil {
				t.Fatal(err)
			}
			mustMkdirAll(t, dbPath(rootfs))
		}, "cannot read apk's database"},
		{"unreadable bundle", func(t *testing.T, rootfs string) {
			path := filepath.Join(certsOf(rootfs), "ca-certificates.crt")
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			mustMkdirAll(t, path)
		}, "cannot compare /etc/ssl/certs/ca-certificates.crt with apk's record"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useTempLog(t)
			_, rootfs := newAPKBundle(t)
			tc.arrange(t, rootfs)
			b := &dirBind{hostDir: certsOf(rootfs), containerDir: "/etc/ssl/certs", bundleFiles: []string{"ca-certificates.crt"}}

			noteAPKRecords(rootfs, []*dirBind{b})
			if b.apkRecorded != nil {
				t.Errorf("recorded %v", b.apkRecorded)
			}
			if !strings.Contains(ownLogText(), tc.want) {
				t.Errorf("%q is not in the log:\n%s", tc.want, ownLogText())
			}
		})
	}
}

// Keystores, the NSS database, a file apk has no record of, a bundle that does
// not match its record and one the image does not ship are not marked.
func TestNoteAPKRecordsMarksOnlyBundlesMatchingTheirRecord(t *testing.T) {
	useTempLog(t)
	_, rootfs := newAPKBundle(t)
	mustWriteFile(t, filepath.Join(certsOf(rootfs), "other.pem"), "OTHER\n")
	mustWriteFile(t, filepath.Join(certsOf(rootfs), "changed.pem"), "CHANGED\n")
	mustWriteFile(t, dbPath(rootfs), apkDB(sha1Record(t, "ORIGINAL-ROOTS\n"))+
		"P:x\nF:etc/ssl/certs\nR:gone.pem\nZ:Q1GONE\nR:changed.pem\nZ:Q1SHIPPED\n")
	store := &dirBind{hostDir: certsOf(rootfs), containerDir: "/etc/ssl/certs",
		bundleFiles: []string{"ca-certificates.crt", "other.pem", "gone.pem", "changed.pem"}}
	keystore := &dirBind{keystore: true, hostDir: certsOf(rootfs), containerDir: "/etc/ssl/certs", bundleFiles: []string{"ca-certificates.crt"}}
	nss := &dirBind{nssBase: "/n", hostDir: certsOf(rootfs), containerDir: "/etc/ssl/certs", bundleFiles: []string{"ca-certificates.crt"}}

	noteAPKRecords(rootfs, []*dirBind{store, keystore, nss})
	if len(store.apkRecorded) != 1 || !store.apkRecorded["ca-certificates.crt"] {
		t.Errorf("store: %v", store.apkRecorded)
	}
	if keystore.apkRecorded != nil || nss.apkRecorded != nil {
		t.Errorf("keystore %v, nss %v", keystore.apkRecorded, nss.apkRecorded)
	}
	if strings.Contains(ownLogText(), "cannot compare") {
		t.Errorf("a missing bundle was logged:\n%s", ownLogText())
	}
}

func TestPromoteAPKNewReportsWhatItCannotRead(t *testing.T) {
	t.Run("a path through a file", func(t *testing.T) {
		scratch := t.TempDir()
		mustWriteFile(t, filepath.Join(scratch, "sub"), "")
		b := &dirBind{scratchDir: scratch, bundleFiles: []string{"sub/bundle.pem"},
			original: []fileEntry{{path: "sub/bundle.pem"}}}
		if err := b.promoteAPKNew(); err == nil {
			t.Fatal("succeeded")
		}
	})
	for _, unreadable := range []string{"bundle.pem", "bundle.pem.apk-new"} {
		t.Run("unreadable "+unreadable, func(t *testing.T) {
			skipIfRoot(t)
			scratch := t.TempDir()
			mustWriteFile(t, filepath.Join(scratch, "bundle.pem"), "x")
			mustWriteFile(t, filepath.Join(scratch, "bundle.pem.apk-new"), "y")
			before, err := hashFile(filepath.Join(scratch, "bundle.pem"))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(filepath.Join(scratch, unreadable), 0); err != nil {
				t.Fatal(err)
			}
			b := &dirBind{scratchDir: scratch, bundleFiles: []string{"bundle.pem"},
				original: []fileEntry{{path: "bundle.pem", sha256: before}}}
			if err := b.promoteAPKNew(); !errors.Is(err, os.ErrPermission) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

// A failed move fails the step, which would otherwise commit the bundle apk
// would have replaced.
func TestInjectFailsWhenItCannotMoveTheAPKNew(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newAPKBundle(t)
	old := renameFile
	renameFile = func(string, string) error { return errBrokenFile }
	t.Cleanup(func() { renameFile = old })

	if err := stepLeaves(t, bundle, map[string]string{"ca-certificates.crt.apk-new": "NEW-ROOTS\n"}); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v", err)
	}
}
