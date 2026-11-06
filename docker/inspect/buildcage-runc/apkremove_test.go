package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// newAPKBundleWithLink is newAPKBundle with the bundle package's link to the
// bundle in place, as Alpine ships it.
func newAPKBundleWithLink(t *testing.T) (bundle, rootfs string) {
	t.Helper()
	bundle, rootfs = newAPKBundle(t)
	mustSymlink(t, "certs/ca-certificates.crt", filepath.Join(rootfs, "etc", "ssl", "cert.pem"))
	return bundle, rootfs
}

// removalStep runs inject, lets step act as the step, and finishes.
func removalStep(t *testing.T, bundle string, step func(mirror string)) error {
	t.Helper()
	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	step(mountSource(t, bundle, "/etc/ssl/certs"))
	return restore.finish()
}

// apkRemovesTheBundlePackage does what removing the bundle package does under
// inspect: apk removes the link, keeps the bundle the CA changed, and drops the
// package from its database.
func apkRemovesTheBundlePackage(t *testing.T, rootfs string) {
	t.Helper()
	if err := os.Remove(filepath.Join(rootfs, "etc", "ssl", "cert.pem")); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, dbPath(rootfs), "P:musl\nV:1.2.5-r0\nF:lib\nR:ld-musl.so.1\nZ:Q1AAAA\n\n")
}

func removeAPKDatabase(t *testing.T, rootfs string) {
	t.Helper()
	if err := os.RemoveAll(filepath.Join(rootfs, "lib", "apk")); err != nil {
		t.Fatal(err)
	}
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func TestInjectRemovesTheBundleOfAPackageTheStepRemoved(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newAPKBundleWithLink(t)
	mustWriteFile(t, filepath.Join(rootfs, "etc", "hostname"), "h\n")

	if err := removalStep(t, bundle, func(string) { apkRemovesTheBundlePackage(t, rootfs) }); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(rootfs, "etc", "ssl")) {
		t.Errorf("/etc/ssl is still there")
	}
	if !exists(filepath.Join(rootfs, "etc", "hostname")) {
		t.Errorf("/etc went too")
	}
	for _, want := range []string{
		"removed /etc/ssl/certs/ca-certificates.crt, as apk would have without the CA when it removed ca-certificates-bundle",
		"removed /etc/ssl/certs, which apk would have removed once it was empty",
		"removed /etc/ssl, which apk would have removed once it was empty",
	} {
		if !strings.Contains(ownLogText(), want) {
			t.Errorf("%q is not in the log:\n%s", want, ownLogText())
		}
	}
}

// With the database gone as well, the package's other files having gone too
// is what tells a removal apart from a step that only removed the database.
func TestInjectJudgesARemovalByThePackagesFilesWhenTheDatabaseIsGone(t *testing.T) {
	for _, tc := range []struct {
		name    string
		removed bool
		step    func(t *testing.T, rootfs string)
	}{
		{"its files gone", true, func(t *testing.T, rootfs string) {
			if err := os.Remove(filepath.Join(rootfs, "etc", "ssl", "cert.pem")); err != nil {
				t.Fatal(err)
			}
		}},
		{"a file left", false, func(*testing.T, string) {}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useFakeRsync(t)
			bundle, rootfs := newAPKBundleWithLink(t)
			err := removalStep(t, bundle, func(mirror string) {
				tc.step(t, rootfs)
				mustWriteFile(t, filepath.Join(mirror, "touched"), "")
				removeAPKDatabase(t, rootfs)
			})
			if err != nil {
				t.Fatal(err)
			}
			if got := exists(filepath.Join(certsOf(rootfs), "ca-certificates.crt")); got == tc.removed {
				t.Errorf("bundle there: %v", got)
			}
		})
	}
}

// A file the package lists under the mirrored directory is judged as the step
// left it, in the mirror.
func TestInjectReadsAFileUnderTheMirroredDirectoryFromTheMirror(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundle(t)
	mustWriteFile(t, filepath.Join(certsOf(rootfs), "ca-bundle.crt"), "ALIAS\n")
	db := strings.Replace(mustRead(t, dbPath(rootfs)), "R:ca-certificates.crt\n", "R:ca-bundle.crt\nZ:Q1ALIAS\nR:ca-certificates.crt\n", 1)
	mustWriteFile(t, dbPath(rootfs), db)

	err := removalStep(t, bundle, func(mirror string) {
		if err := os.Remove(filepath.Join(mirror, "ca-bundle.crt")); err != nil {
			t.Fatal(err)
		}
		removeAPKDatabase(t, rootfs)
	})
	if err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(certsOf(rootfs), "ca-certificates.crt")) {
		t.Error("the bundle is still there")
	}
}

func TestInjectKeepsTheBundleWhereApkWouldHaveKeptIt(t *testing.T) {
	for _, tc := range []struct {
		name string
		link bool
		step func(t *testing.T, rootfs, mirror string)
	}{
		{"the package still installed", true, func(t *testing.T, rootfs, mirror string) {}},
		{"the bundle changed by the step", true, func(t *testing.T, rootfs, mirror string) {
			apkRemovesTheBundlePackage(t, rootfs)
			mustAppendFile(t, filepath.Join(mirror, "ca-certificates.crt"), "COMPANY-CA\n")
		}},
		{"nothing to judge a removal by", false, func(t *testing.T, rootfs, mirror string) {
			removeAPKDatabase(t, rootfs)
		}},
		{"a database that cannot be read", true, func(t *testing.T, rootfs, mirror string) {
			if err := os.Remove(dbPath(rootfs)); err != nil {
				t.Fatal(err)
			}
			mustMkdirAll(t, dbPath(rootfs))
		}},
		{"a file whose place cannot be told", true, func(t *testing.T, rootfs, mirror string) {
			removeAPKDatabase(t, rootfs)
			if err := os.Remove(filepath.Join(rootfs, "etc", "ssl", "cert.pem")); err != nil {
				t.Fatal(err)
			}
			mustSymlink(t, "loop-b", filepath.Join(rootfs, "loop-a"))
			mustSymlink(t, "loop-a", filepath.Join(rootfs, "loop-b"))
			if err := os.Rename(filepath.Join(rootfs, "etc"), filepath.Join(rootfs, "etc-real")); err != nil {
				t.Fatal(err)
			}
			mustSymlink(t, "loop-a", filepath.Join(rootfs, "etc"))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useTempLog(t)
			useFakeRsync(t)
			bundle, rootfs := newAPKBundle(t)
			if tc.link {
				mustSymlink(t, "certs/ca-certificates.crt", filepath.Join(rootfs, "etc", "ssl", "cert.pem"))
			}
			err := removalStep(t, bundle, func(mirror string) {
				mustWriteFile(t, filepath.Join(mirror, "touched"), "")
				tc.step(t, rootfs, mirror)
			})
			if tc.name == "a file whose place cannot be told" {
				// The write-back target can no longer be reached, which fails the
				// step on its own; the bundle must not have been dropped first.
				if err == nil {
					t.Fatal("finished")
				}
				if !strings.Contains(err.Error(), "re-resolving the write-back target") {
					t.Fatalf("got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !exists(filepath.Join(certsOf(rootfs), "ca-certificates.crt")) {
				t.Error("the bundle was removed")
			}
		})
	}
}

// An emptied directory another installed package still lists, or one that is
// not empty, stays.
func TestInjectKeepsADirectoryApkWouldHaveKept(t *testing.T) {
	cnf := "P:openssl\nF:etc/ssl\nR:openssl.cnf\nZ:Q1CNF\n\n"
	for _, tc := range []struct {
		name    string
		arrange func(t *testing.T, rootfs string)
		step    func(t *testing.T, rootfs, mirror string)
		certs   bool
	}{
		{"listed by an installed package", func(t *testing.T, rootfs string) {
			mustAppendFile(t, dbPath(rootfs), cnf)
			mustWriteFile(t, filepath.Join(rootfs, "etc", "ssl", "openssl.cnf"), "C\n")
		}, func(t *testing.T, rootfs, mirror string) {
			apkRemovesTheBundlePackage(t, rootfs)
			mustAppendFile(t, dbPath(rootfs), cnf)
		}, false},
		{"not empty", nil, func(t *testing.T, rootfs, mirror string) {
			apkRemovesTheBundlePackage(t, rootfs)
			mustWriteFile(t, filepath.Join(mirror, "mine.pem"), "M\n")
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useFakeRsync(t)
			bundle, rootfs := newAPKBundleWithLink(t)
			if tc.arrange != nil {
				tc.arrange(t, rootfs)
			}
			if err := removalStep(t, bundle, func(mirror string) { tc.step(t, rootfs, mirror) }); err != nil {
				t.Fatal(err)
			}
			if exists(filepath.Join(certsOf(rootfs), "ca-certificates.crt")) {
				t.Error("the bundle is still there")
			}
			if got := exists(certsOf(rootfs)); got != tc.certs {
				t.Errorf("/etc/ssl/certs there: %v", got)
			}
			if !exists(filepath.Join(rootfs, "etc", "ssl")) {
				t.Error("/etc/ssl went")
			}
		})
	}
}

func TestInjectFailsWhenItCannotRemoveTheBundle(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundleWithLink(t)
	old := removeFile
	removeFile = func(path string) error {
		if filepath.Base(path) == "ca-certificates.crt" {
			return errBrokenFile
		}
		return old(path)
	}
	t.Cleanup(func() { removeFile = old })

	if err := removalStep(t, bundle, func(string) { apkRemovesTheBundlePackage(t, rootfs) }); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v", err)
	}
}

// A directory it cannot remove is left, as apk leaves one.
func TestInjectLeavesADirectoryItCannotRemove(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	bundle, rootfs := newAPKBundleWithLink(t)
	old := removeFile
	removeFile = func(path string) error {
		if filepath.Base(path) == "certs" {
			return errBrokenFile
		}
		return old(path)
	}
	t.Cleanup(func() { removeFile = old })

	if err := removalStep(t, bundle, func(string) { apkRemovesTheBundlePackage(t, rootfs) }); err != nil {
		t.Fatal(err)
	}
	if !exists(certsOf(rootfs)) {
		t.Error("/etc/ssl/certs went")
	}
	if want := "cannot remove the emptied /etc/ssl/certs"; !strings.Contains(ownLogText(), want) {
		t.Errorf("%q is not in the log:\n%s", want, ownLogText())
	}
}

// A bundle another package records once the step is done, as after an
// upgrade that moved it, is one apk kept; so is a directory a package the
// step installed lists, and anything when the database lists no package.
func TestInjectKeepsWhatAPackageStillInstalledRecords(t *testing.T) {
	for _, tc := range []struct {
		name   string
		after  string
		bundle bool
		certs  bool
	}{
		{"the bundle moved to another package", "P:ca-certificates-new\nF:etc/ssl/certs\nR:ca-certificates.crt\nZ:Q1MOVED\n\n", true, true},
		{"the directory listed by a new package", "P:certs-dir\nF:etc/ssl/certs\n\n", false, true},
		{"a database listing no package", "", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useFakeRsync(t)
			bundle, rootfs := newAPKBundleWithLink(t)
			err := removalStep(t, bundle, func(string) {
				apkRemovesTheBundlePackage(t, rootfs)
				if tc.after == "" {
					mustWriteFile(t, dbPath(rootfs), "")
				} else {
					mustAppendFile(t, dbPath(rootfs), tc.after)
				}
			})
			if err != nil {
				t.Fatal(err)
			}
			if got := exists(filepath.Join(certsOf(rootfs), "ca-certificates.crt")); got != tc.bundle {
				t.Errorf("bundle there: %v", got)
			}
			if got := exists(certsOf(rootfs)); got != tc.certs {
				t.Errorf("/etc/ssl/certs there: %v", got)
			}
		})
	}
}

// A bundle folded into a bind of its parent directory has its own directory
// emptied and removed first.
func TestInjectRemovesTheDirectoryOfANestedBundle(t *testing.T) {
	useFakeRsync(t)
	_, rootfs := newAPKBundleWithLink(t)
	s, err := loadSpec(filepath.Dir(rootfs))
	if err != nil {
		t.Fatal(err)
	}
	b := prepareBind(s, filepath.Dir(rootfs), filepath.Join(rootfs, "etc", "ssl"), []string{"certs/ca-certificates.crt"}, testCA, mirrorLimit{}, false)
	if b == nil {
		t.Fatal("not bound")
	}
	t.Cleanup(b.cleanup)
	noteAPKRecords(rootfs, []*dirBind{b})
	apkRemovesTheBundlePackage(t, rootfs)
	if err := os.Remove(filepath.Join(b.scratchDir, "cert.pem")); err != nil {
		t.Fatal(err)
	}

	if err := b.finish(); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(rootfs, "etc", "ssl")) {
		t.Error("/etc/ssl is still there")
	}
}
