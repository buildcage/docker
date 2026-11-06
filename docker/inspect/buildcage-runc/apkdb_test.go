package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// apkDB is the shape of /lib/apk/db/installed: one record per package, each
// file an R: line under its F: directory with its Z: checksum after it.
func apkDB(bundleSum string) string {
	return "P:musl\nV:1.2.5-r0\nF:lib\nR:ld-musl.so.1\nZ:Q1AAAA\n\n" +
		"P:ca-certificates-bundle\nV:20260909-r0\nF:etc/ssl\nR:cert.pem\na:0:0:777\nZ:Q1LINK\n" +
		"F:etc/ssl/certs\nR:ca-certificates.crt\nZ:" + bundleSum + "\n\n"
}

// newAPKBundle is newBundle in an apk-based image whose database records the
// store as the image ships it.
func newAPKBundle(t *testing.T) (bundle, rootfs string) {
	t.Helper()
	bundle, rootfs = newBundle(t, []string{"PATH=/usr/bin"})
	mustMkdirAll(t, filepath.Join(rootfs, "lib", "apk", "db"))
	mustWriteFile(t, filepath.Join(rootfs, "lib", "apk", "db", "installed"), apkDB(apkChecksumOf([]byte("ORIGINAL-ROOTS\n"))))
	return bundle, rootfs
}

func mountSource(t *testing.T, bundle, dest string) string {
	t.Helper()
	source, _ := findMount(t, loadMounts(t, bundle), dest)["source"].(string)
	return source
}

func TestAPKChecksumIsTheBase64SHA1ApkWrites(t *testing.T) {
	// SHA-1("abc") is a9993e36...d0d89d.
	sum := apkChecksumOf([]byte("abc"))
	if sum != "Q1qZk+NkcGgWq6PiVxeFDCbJzQ2J0=" {
		t.Fatalf("got %s", sum)
	}
}

func TestRewriteAPKChecksumsSwapsOnlyTheNamedFileWithTheGivenValue(t *testing.T) {
	db := apkDB("Q1OLD")
	swap := map[string]map[string]string{"etc/ssl/certs/ca-certificates.crt": {"Q1OLD": "Q1NEW"}}

	got, changed := rewriteAPKChecksums([]byte(db), swap)
	if !changed || string(got) != apkDB("Q1NEW") {
		t.Fatalf("changed=%v\n%s", changed, got)
	}

	// A file whose record holds another value, and the same name in another
	// directory, are left alone.
	for _, other := range []map[string]map[string]string{
		{"etc/ssl/certs/ca-certificates.crt": {"Q1OTHER": "Q1NEW"}},
		{"etc/ca-certificates.crt": {"Q1OLD": "Q1NEW"}},
		{"etc/ssl/cert.pem": {"Q1OLD": "Q1NEW"}},
	} {
		if got, changed := rewriteAPKChecksums([]byte(db), other); changed || string(got) != db {
			t.Errorf("%v changed the database:\n%s", other, got)
		}
	}
}

// A Z: line belongs to the R: line above it only until the record or the
// directory ends, and a file without a trailing newline keeps that shape.
func TestRewriteAPKChecksumsReadsZOnlyAfterItsFile(t *testing.T) {
	swap := map[string]map[string]string{"etc/a": {"Q1OLD": "Q1NEW"}}
	for _, db := range []string{
		"F:etc\nR:a\n\nZ:Q1OLD\n",
		"F:etc\nR:a\nF:usr\nZ:Q1OLD\n",
		"F:etc\nR:a\nZ:Q1KEPT\nZ:Q1OLD\n",
	} {
		if _, changed := rewriteAPKChecksums([]byte(db), swap); changed {
			t.Errorf("%q swapped a Z: line that is not the file's", db)
		}
	}
	got, _ := rewriteAPKChecksums([]byte("F:etc\nR:a\nZ:Q1OLD"), swap)
	if string(got) != "F:etc\nR:a\nZ:Q1NEW" {
		t.Errorf("got %q", got)
	}
}

func dbPath(rootfs string) string {
	return filepath.Join(rootfs, "lib", "apk", "db", "installed")
}

func TestInjectRecordsTheStoreWithTheCAForApk(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)
	then := time.Date(2001, 2, 3, 4, 5, 6, 7, time.UTC)
	if err := os.Chtimes(dbPath(rootfs), then, then); err != nil {
		t.Fatal(err)
	}

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	injected := mustRead(t, filepath.Join(mountSource(t, bundle, "/etc/ssl/certs"), "ca-certificates.crt"))
	if !strings.Contains(injected, string(testCA)) {
		t.Fatalf("the store mirror carries no CA: %q", injected)
	}
	if got, want := mustRead(t, dbPath(rootfs)), apkDB(apkChecksumOf([]byte(injected))); got != want {
		t.Fatalf("the database does not record the store with the CA:\n%s", got)
	}
	if got := mustStatMtime(t, dbPath(rootfs)); !got.Equal(then) {
		t.Errorf("the database's mtime moved to %v", got)
	}
	for _, m := range loadMounts(t, bundle) {
		if dest, _ := m["destination"].(string); strings.HasPrefix(dest, "/lib") {
			t.Errorf("mounted %s", dest)
		}
	}
}

// What apk does on an upgrade once the record matches: replace the bundle and
// the database, each by renaming a new file over it.
func TestInjectKeepsTheBundleAndRecordApkReplaced(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	storeMirror := mountSource(t, bundle, "/etc/ssl/certs")
	mustWriteFile(t, filepath.Join(storeMirror, ".apk.tmp"), "NEW-ROOTS\n")
	if err := os.Rename(filepath.Join(storeMirror, ".apk.tmp"), filepath.Join(storeMirror, "ca-certificates.crt")); err != nil {
		t.Fatal(err)
	}
	upgraded := apkDB(apkChecksumOf([]byte("NEW-ROOTS\n")))
	mustWriteFile(t, dbPath(rootfs)+".new", upgraded)
	if err := os.Rename(dbPath(rootfs)+".new", dbPath(rootfs)); err != nil {
		t.Fatal(err)
	}

	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}

	if got := mustRead(t, filepath.Join(rootfs, "etc", "ssl", "certs", "ca-certificates.crt")); got != "NEW-ROOTS\n" {
		t.Errorf("store: %q", got)
	}
	if got := mustRead(t, dbPath(rootfs)); got != upgraded {
		t.Errorf("database:\n%s", got)
	}
}

// apk rewrites the whole database for any package it adds, carrying the
// bundle's record over as it read it; that record goes back to the one
// without the CA, and the mtime apk left stays.
func TestInjectGivesBackTheRecordOfABundleApkLeftAlone(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mustAppendFile(t, dbPath(rootfs), "P:jq\nV:1.8-r0\n\n")
	rewritten := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := os.Chtimes(dbPath(rootfs), rewritten, rewritten); err != nil {
		t.Fatal(err)
	}

	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}

	want := apkDB(apkChecksumOf([]byte("ORIGINAL-ROOTS\n"))) + "P:jq\nV:1.8-r0\n\n"
	if got := mustRead(t, dbPath(rootfs)); got != want {
		t.Errorf("database:\n%s", got)
	}
	if got := mustStatMtime(t, dbPath(rootfs)); !got.Equal(rewritten) {
		t.Errorf("mtime %v, want the %v apk left", got, rewritten)
	}
}

// A database the step never touched goes back to its content and mtime, so a
// layer differ that compares them commits no copy of it.
func TestInjectLeavesAnUntouchedDatabaseAsItWas(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)
	then := time.Date(2001, 2, 3, 4, 5, 6, 7, time.UTC)
	if err := os.Chtimes(dbPath(rootfs), then, then); err != nil {
		t.Fatal(err)
	}

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}

	if got := mustRead(t, dbPath(rootfs)); got != apkDB(apkChecksumOf([]byte("ORIGINAL-ROOTS\n"))) {
		t.Errorf("database:\n%s", got)
	}
	if got := mustStatMtime(t, dbPath(rootfs)); !got.Equal(then) {
		t.Errorf("mtime %v, want %v", got, then)
	}
}

// A database the step removed has no record left to give back.
func TestInjectLeavesADatabaseTheStepRemovedRemoved(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(rootfs, "lib", "apk")); err != nil {
		t.Fatal(err)
	}
	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dbPath(rootfs)); !os.IsNotExist(err) {
		t.Errorf("the database is back: %v", err)
	}
}

// The wrapper runs as root on the host, so a symlink the step left on the way
// to the database is followed only inside the rootfs: one leading out finds no
// database there, and a loop fails the step.
func TestInjectRefusesADatabaseTheStepSwappedForASymlink(t *testing.T) {
	for _, tc := range []struct {
		name string
		swap func(t *testing.T, rootfs, outside string)
		want error
	}{
		{"the file", func(t *testing.T, rootfs, outside string) {
			mustSymlink(t, outside, dbPath(rootfs))
		}, nil},
		{"a directory above it", func(t *testing.T, rootfs, _ string) {
			if err := os.RemoveAll(filepath.Join(rootfs, "lib")); err != nil {
				t.Fatal(err)
			}
			mustSymlink(t, "lib-loop", filepath.Join(rootfs, "lib"))
			mustSymlink(t, "lib", filepath.Join(rootfs, "lib-loop"))
		}, errTooManySymlinks},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useTempLog(t)
			useFakeRsync(t)
			bundle, rootfs := newAPKBundle(t)
			outside := filepath.Join(t.TempDir(), "host-file")
			mustWriteFile(t, outside, apkDB("Q1ANY"))

			restore, err := inject(bundle, testCA)
			if err != nil {
				t.Fatal(err)
			}
			tc.swap(t, rootfs, outside)

			if err := restore.finish(); !errors.Is(err, tc.want) {
				t.Fatalf("got %v", err)
			}
			if got := mustRead(t, outside); got != apkDB("Q1ANY") {
				t.Errorf("the file the symlink names was written: %q", got)
			}
		})
	}
}

// A bundle the image changed itself is one apk keeps on an upgrade, CA or no
// CA, so its record is left as it is.
func TestInjectLeavesTheRecordOfABundleTheImageChanged(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)
	mustAppendFile(t, filepath.Join(rootfs, "etc", "ssl", "certs", "ca-certificates.crt"), "COMPANY-CA\n")
	before := mustRead(t, dbPath(rootfs))

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	if got := mustRead(t, dbPath(rootfs)); got != before {
		t.Fatalf("the database was changed:\n%s", got)
	}
}

// A bundle a variable names but the image does not ship has no record to
// match; the store beside it still gets its own.
func TestInjectSkipsABundleThatWasNotThereBefore(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)
	mustMkdirAll(t, filepath.Join(rootfs, "opt"))
	s, err := loadSpec(bundle)
	if err != nil {
		t.Fatal(err)
	}
	s.raw["process"] = map[string]any{"env": toAny([]string{"GIT_SSL_CAINFO=/opt/git-ca.pem"})}
	if err := s.save(); err != nil {
		t.Fatal(err)
	}

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	defer restore.finish()

	injected := mustRead(t, filepath.Join(mountSource(t, bundle, "/etc/ssl/certs"), "ca-certificates.crt"))
	if got := mustRead(t, dbPath(rootfs)); got != apkDB(apkChecksumOf([]byte(injected))) {
		t.Fatalf("database:\n%s", got)
	}
}

// A database that cannot be written fails the step before it runs: the write
// may have stopped partway.
func TestInjectRefusesAStepWhoseDatabaseItCannotWrite(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)
	old := changeTimes
	changeTimes = func(path string, a, m time.Time) error {
		if path == dbPath(rootfs) {
			return errBrokenFile
		}
		return old(path, a, m)
	}
	t.Cleanup(func() { changeTimes = old })

	if _, err := inject(bundle, testCA); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v", err)
	}
	if mounts := loadMounts(t, bundle); len(mounts) != 0 {
		t.Errorf("the spec was saved with %v", mounts)
	}
}

func TestPlaceAPKRecordsLeavesTheRecordsAloneWhenItCannotSetThem(t *testing.T) {
	for _, tc := range []struct {
		name    string
		arrange func(t *testing.T, bundle, rootfs string)
		want    string
	}{
		{"unresolvable path", func(t *testing.T, _, rootfs string) {
			if err := os.RemoveAll(filepath.Join(rootfs, "lib")); err != nil {
				t.Fatal(err)
			}
			mustSymlink(t, "lib-loop", filepath.Join(rootfs, "lib"))
			mustSymlink(t, "lib", filepath.Join(rootfs, "lib-loop"))
		}, "cannot resolve " + apkDBPath},
		{"unreadable database", func(t *testing.T, _, rootfs string) {
			if err := os.Remove(dbPath(rootfs)); err != nil {
				t.Fatal(err)
			}
			mustMkdirAll(t, dbPath(rootfs))
		}, "cannot read apk's database"},
		{"a mount over it", func(t *testing.T, bundle, _ string) {
			s, err := loadSpec(bundle)
			if err != nil {
				t.Fatal(err)
			}
			s.addBindMount("/lib/apk", "/cache")
			if err := s.save(); err != nil {
				t.Fatal(err)
			}
		}, "a mount already covers /lib/apk/db/installed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useTempLog(t)
			useFakeRsync(t)
			bundle, rootfs := newAPKBundle(t)
			b := storeBind(t, bundle, rootfs)
			tc.arrange(t, bundle, rootfs)
			s, err := loadSpec(bundle)
			if err != nil {
				t.Fatal(err)
			}

			if got, err := placeAPKRecords(s, []*dirBind{b}); got != nil || err != nil {
				t.Fatalf("got %v, %v", got, err)
			}
			var out strings.Builder
			dumpOwnLog(&out)
			if !strings.Contains(out.String(), tc.want) {
				t.Errorf("%q is not in the log:\n%s", tc.want, out.String())
			}
		})
	}
}

// storeBind is the store's bind as inject leaves it, mirrored with the CA in.
func storeBind(t *testing.T, bundle, rootfs string) *dirBind {
	t.Helper()
	s, err := loadSpec(bundle)
	if err != nil {
		t.Fatal(err)
	}
	b := prepareBind(s, bundle, filepath.Join(rootfs, "etc", "ssl", "certs"), []string{"ca-certificates.crt"}, testCA, mirrorLimit{}, false)
	if b == nil {
		t.Fatal("the store could not be bound")
	}
	t.Cleanup(b.cleanup)
	return b
}

func TestPlaceAPKRecordsLeavesTheRecordsAloneWhenABundleCannotBeRead(t *testing.T) {
	for _, tc := range []struct {
		name    string
		arrange func(t *testing.T, b *dirBind)
	}{
		{"before the CA", func(t *testing.T, b *dirBind) {
			path := filepath.Join(b.hostDir, "ca-certificates.crt")
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			mustSymlink(t, "elsewhere", path)
		}},
		{"with the CA", func(t *testing.T, b *dirBind) {
			if err := os.Remove(filepath.Join(b.scratchDir, "ca-certificates.crt")); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useTempLog(t)
			useFakeRsync(t)
			bundle, rootfs := newAPKBundle(t)
			b := storeBind(t, bundle, rootfs)
			tc.arrange(t, b)
			s, err := loadSpec(bundle)
			if err != nil {
				t.Fatal(err)
			}

			if got, err := placeAPKRecords(s, []*dirBind{b}); got != nil || err != nil {
				t.Fatalf("got %v, %v", got, err)
			}
			var out strings.Builder
			dumpOwnLog(&out)
			if want := "cannot compare the CA bundles with apk's records"; !strings.Contains(out.String(), want) {
				t.Errorf("%q is not in the log:\n%s", want, out.String())
			}
		})
	}
}

// A database the step grew past what a real one holds fails the step rather
// than being read into memory to give the records back.
func TestInjectFailsOnADatabaseTheStepGrewTooLarge(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mustSparseFile(t, dbPath(rootfs), maxCustomDirBytes+1)
	if err := restore.finish(); !errors.Is(err, errDatabaseTooLarge) {
		t.Fatalf("got %v", err)
	}
}

// Keystores and the NSS database are not files apk records.
func TestAPKChecksumsForSkipsKeystoresAndTheNSSDatabase(t *testing.T) {
	sums, err := apkChecksumsFor([]byte(apkDB("Q1ANY")), []*dirBind{
		{keystore: true, hostDir: "/nonexistent", bundleFiles: []string{"cacerts"}},
		{nssBase: "/nonexistent", hostDir: "/nonexistent", bundleFiles: []string{"pkcs11.txt"}},
	})
	if err != nil || sums != nil {
		t.Fatalf("got %v, %v", sums, err)
	}
}

func TestGuardedAccessRefusesWhatIsNotAFile(t *testing.T) {
	for _, tc := range []struct {
		name   string
		broken brokenFile
		write  bool
	}{
		{"read, failed stat", brokenFile{failStat: true}, false},
		{"read, not a file", brokenFile{notRegular: true}, false},
		{"write, failed stat", brokenFile{failStat: true}, true},
		{"write, not a file", brokenFile{notRegular: true}, true},
		{"write, failed truncate", brokenFile{failTruncate: true}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "installed")
			mustWriteFile(t, path, "x")
			useBrokenBundleFile(t, &tc.broken)
			var err error
			if tc.write {
				err = writeDatabase(path, []byte("y"))
			} else {
				_, err = readDatabase(path)
			}
			if err == nil {
				t.Fatal("succeeded")
			}
			if got := mustRead(t, path); got != "x" {
				t.Errorf("the file was written: %q", got)
			}
		})
	}
}

func TestGuardedAccessRefusesASymlink(t *testing.T) {
	path := filepath.Join(t.TempDir(), "installed")
	mustWriteFile(t, path, "x")
	link := filepath.Join(t.TempDir(), "link")
	mustSymlink(t, path, link)
	if err := writeDatabase(link, []byte("y")); !errors.Is(err, errNotRegular) {
		t.Errorf("write: got %v", err)
	}
	if _, err := apkChecksumOfFile(link); !errors.Is(err, errNotRegular) {
		t.Errorf("checksum: got %v", err)
	}
	if got := mustRead(t, path); got != "x" {
		t.Errorf("the file was written: %q", got)
	}
}

func TestAPKChecksumOfFileReportsAFailedRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bundle")
	mustWriteFile(t, path, "x")
	useBrokenBundleFile(t, &brokenFile{failReadAt: 1})
	if _, err := apkChecksumOfFile(path); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v", err)
	}
}

func TestReadDatabaseRefusesOneTooLargeToHold(t *testing.T) {
	path := filepath.Join(t.TempDir(), "installed")
	mustSparseFile(t, path, maxCustomDirBytes+1)
	if _, err := readDatabase(path); !errors.Is(err, errDatabaseTooLarge) {
		t.Fatalf("got %v", err)
	}
}

// What apk does on a reinstall: keep the bundle carrying the CA and write the
// package's copy beside it. Without the CA it would have rewritten the bundle
// with that same content.
func TestInjectRemovesAnAPKNewHoldingWhatTheBundleHoldsWithoutTheCA(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(mountSource(t, bundle, "/etc/ssl/certs"), "ca-certificates.crt.apk-new"), "ORIGINAL-ROOTS\n")
	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}

	certs := filepath.Join(rootfs, "etc", "ssl", "certs")
	if _, err := os.Lstat(filepath.Join(certs, "ca-certificates.crt.apk-new")); !os.IsNotExist(err) {
		t.Errorf("the .apk-new is still there: %v", err)
	}
	if got := mustRead(t, filepath.Join(certs, "ca-certificates.crt")); got != "ORIGINAL-ROOTS\n" {
		t.Errorf("store: %q", got)
	}
	var out strings.Builder
	dumpOwnLog(&out)
	if want := "removed /etc/ssl/certs/ca-certificates.crt.apk-new"; !strings.Contains(out.String(), want) {
		t.Errorf("%q is not in the log:\n%s", want, out.String())
	}
}

// An .apk-new apk would have left without the CA too, one the image already
// had, and one that is not a file all stay.
func TestInjectKeepsAnAPKNewApkWouldHaveLeftAnyway(t *testing.T) {
	for _, tc := range []struct {
		name    string
		before  func(t *testing.T, certs string)
		arrange func(t *testing.T, mirror string)
	}{
		{"different content", nil, func(t *testing.T, mirror string) {
			mustWriteFile(t, filepath.Join(mirror, "ca-certificates.crt.apk-new"), "NEW-ROOTS\n")
		}},
		{"already in the image", func(t *testing.T, certs string) {
			mustWriteFile(t, filepath.Join(certs, "ca-certificates.crt.apk-new"), "ORIGINAL-ROOTS\n")
		}, func(t *testing.T, mirror string) {
			mustWriteFile(t, filepath.Join(mirror, "other"), "")
		}},
		{"a symlink", nil, func(t *testing.T, mirror string) {
			mustSymlink(t, "ca-certificates.crt", filepath.Join(mirror, "ca-certificates.crt.apk-new"))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useFakeRsync(t)
			bundle, rootfs := newAPKBundle(t)
			certs := filepath.Join(rootfs, "etc", "ssl", "certs")
			if tc.before != nil {
				tc.before(t, certs)
			}
			restore, err := inject(bundle, testCA)
			if err != nil {
				t.Fatal(err)
			}
			tc.arrange(t, mountSource(t, bundle, "/etc/ssl/certs"))
			if err := restore.finish(); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Lstat(filepath.Join(certs, "ca-certificates.crt.apk-new")); err != nil {
				t.Errorf("the .apk-new is gone: %v", err)
			}
		})
	}
}

// The step removed the bundle and left only the .apk-new: nothing to compare.
func TestInjectKeepsAnAPKNewBesideARemovedBundle(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mirror := mountSource(t, bundle, "/etc/ssl/certs")
	if err := os.Remove(filepath.Join(mirror, "ca-certificates.crt")); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(mirror, "ca-certificates.crt.apk-new"), "ORIGINAL-ROOTS\n")
	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, filepath.Join(rootfs, "etc", "ssl", "certs", "ca-certificates.crt.apk-new")); got != "ORIGINAL-ROOTS\n" {
		t.Errorf("got %q", got)
	}
}

func TestDropRedundantAPKNewReportsWhatItCannotRead(t *testing.T) {
	t.Run("a path through a file", func(t *testing.T) {
		scratch := t.TempDir()
		mustWriteFile(t, filepath.Join(scratch, "sub"), "")
		b := &dirBind{scratchDir: scratch, bundleFiles: []string{"sub/bundle.pem"}}
		if err := b.dropRedundantAPKNew(); err == nil {
			t.Fatal("succeeded")
		}
	})
	for _, unreadable := range []string{"bundle.pem", "bundle.pem.apk-new"} {
		t.Run("unreadable "+unreadable, func(t *testing.T) {
			skipIfRoot(t)
			scratch := t.TempDir()
			mustWriteFile(t, filepath.Join(scratch, "bundle.pem"), "x")
			mustWriteFile(t, filepath.Join(scratch, "bundle.pem.apk-new"), "x")
			if err := os.Chmod(filepath.Join(scratch, unreadable), 0); err != nil {
				t.Fatal(err)
			}
			b := &dirBind{scratchDir: scratch, bundleFiles: []string{"bundle.pem"}}
			if err := b.dropRedundantAPKNew(); !errors.Is(err, os.ErrPermission) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

// A failure removing the .apk-new fails the step, which would otherwise commit
// the bundle beside a copy apk would not have left.
func TestInjectFailsWhenItCannotRemoveTheAPKNew(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newAPKBundle(t)

	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	apkNew := filepath.Join(mountSource(t, bundle, "/etc/ssl/certs"), "ca-certificates.crt.apk-new")
	mustWriteFile(t, apkNew, "ORIGINAL-ROOTS\n")
	failed := false
	old := removeFile
	removeFile = func(path string) error {
		if path == apkNew && !failed {
			failed = true
			return errBrokenFile
		}
		return old(path)
	}
	t.Cleanup(func() { removeFile = old })

	if err := restore.finish(); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v", err)
	}
}

// Swapping a record is not apk rewriting the database, so its mtime stays for
// the write-back to tell the two apart.
func TestWriteDatabaseKeepsTheMtime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "installed")
	mustWriteFile(t, path, "Z:Q1OLD\n")
	then := time.Date(2001, 2, 3, 4, 5, 6, 7, time.UTC)
	if err := os.Chtimes(path, then, then); err != nil {
		t.Fatal(err)
	}
	if err := writeDatabase(path, []byte("Z:Q1NEW\n")); err != nil {
		t.Fatal(err)
	}
	if got := mustRead(t, path); got != "Z:Q1NEW\n" {
		t.Errorf("content: %q", got)
	}
	if got := mustStatMtime(t, path); !got.Equal(then) {
		t.Errorf("mtime %v, want %v", got, then)
	}
}

func TestWriteDatabaseReportsAFailedWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "installed")
	mustWriteFile(t, path, "x")
	useBrokenBundleFile(t, &brokenFile{failWriteAt: 1})
	if err := writeDatabase(path, []byte("y")); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v", err)
	}
}

func TestWriteDatabaseReportsAnMtimeItCannotKeep(t *testing.T) {
	path := filepath.Join(t.TempDir(), "installed")
	mustWriteFile(t, path, "x")
	old := changeTimes
	changeTimes = func(string, time.Time, time.Time) error { return errBrokenFile }
	t.Cleanup(func() { changeTimes = old })
	if err := writeDatabase(path, []byte("y")); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v", err)
	}
}
