package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestDropRemovedBundlesReportsABundleItCannotRead(t *testing.T) {
	scratch := t.TempDir()
	mustWriteFile(t, filepath.Join(scratch, "sub"), "")
	untouched := []fileEntry{{path: "sub/bundle.pem"}}
	b := &dirBind{scratchDir: scratch, bundleFiles: []string{"sub/bundle.pem"}, apkRecorded: map[string]bool{"sub/bundle.pem": true}, baseline: untouched}
	if _, err := b.dropRemovedBundles(untouched); err == nil {
		t.Fatal("succeeded")
	}
}

// A bundle the step wrote back after removing its package, even with the
// same content, is the step's, not one apk left.
func TestInjectKeepsABundleTheStepWroteBack(t *testing.T) {
	useFakeRsync(t)
	bundle, rootfs := newAPKBundleWithLink(t)
	err := removalStep(t, bundle, func(mirror string) {
		apkRemovesTheBundlePackage(t, rootfs)
		path := filepath.Join(mirror, "ca-certificates.crt")
		content := mustRead(t, path)
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		mustWriteFile(t, path, content)
		later := time.Now().Add(time.Hour)
		if err := os.Chtimes(path, later, later); err != nil {
			t.Fatal(err)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if !exists(filepath.Join(certsOf(rootfs), "ca-certificates.crt")) {
		t.Error("the bundle the step wrote back was removed")
	}
}

// The walk stops at a directory it cannot resolve, and otherwise goes on as
// far up as the removed packages listed.
func TestRemoveEmptiedDirsWalksUpWhileTheRemovedPackagesListedTheDirectory(t *testing.T) {
	rootfs := t.TempDir()
	removed := &apkState{rootfs: rootfs, afterRead: true, present: true, after: &apkDatabase{packages: map[string][]string{}},
		before: &apkDatabase{dirOwners: map[string][]string{"a": {"p"}, "loop/b": {"p"}}}}
	mustMkdirAll(t, filepath.Join(rootfs, "a"))
	removed.removeEmptiedDirs("/a")
	if exists(filepath.Join(rootfs, "a")) {
		t.Error("/a is still there")
	}

	mustSymlink(t, "loop", filepath.Join(rootfs, "loop"))
	removed.removeEmptiedDirs("/loop/b")
	if !exists(filepath.Join(rootfs, "loop")) {
		t.Error("the link went")
	}
}

// With the database gone, a directory's other owners are judged by what they
// listed: gone with their files, kept while a file is left.
func TestInjectJudgesADirectorysOtherOwnersWhenTheDatabaseIsGone(t *testing.T) {
	for _, tc := range []struct {
		name string
		cnf  bool
	}{
		{"their files gone", false},
		{"a file left", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useFakeRsync(t)
			bundle, rootfs := newAPKBundleWithLink(t)
			mustAppendFile(t, dbPath(rootfs), "P:openssl\nF:etc/ssl\nR:openssl.cnf\nZ:Q1CNF\nF:etc/ssl/certs\n\n")
			if tc.cnf {
				mustWriteFile(t, filepath.Join(rootfs, "etc", "ssl", "openssl.cnf"), "C\n")
			}
			err := removalStep(t, bundle, func(string) {
				if err := os.Remove(filepath.Join(rootfs, "etc", "ssl", "cert.pem")); err != nil {
					t.Fatal(err)
				}
				removeAPKDatabase(t, rootfs)
			})
			if err != nil {
				t.Fatal(err)
			}
			if exists(certsOf(rootfs)) != tc.cnf {
				t.Errorf("/etc/ssl/certs there: %v", exists(certsOf(rootfs)))
			}
			if got := exists(filepath.Join(rootfs, "etc", "ssl")); got != tc.cnf {
				t.Errorf("/etc/ssl there: %v", got)
			}
		})
	}
}

// Two bundles of one package share what is noted of it.
func TestNoteAPKRecordsNotesAPackageOnce(t *testing.T) {
	_, rootfs := newAPKBundleWithLink(t)
	mustWriteFile(t, filepath.Join(certsOf(rootfs), "second.pem"), "SECOND\n")
	db := strings.Replace(mustRead(t, dbPath(rootfs)), "R:ca-certificates.crt\n", "R:second.pem\nZ:"+sha1Record(t, "SECOND\n")+"\nR:ca-certificates.crt\n", 1)
	mustWriteFile(t, dbPath(rootfs), db)
	b := &dirBind{hostDir: certsOf(rootfs), containerDir: "/etc/ssl/certs", bundleFiles: []string{"ca-certificates.crt", "second.pem"}}

	noteAPKRecords(rootfs, []*dirBind{b})
	if len(b.apkRecorded) != 2 {
		t.Fatalf("recorded %v", b.apkRecorded)
	}
	if got := b.apk.presentBefore["ca-certificates-bundle"]; !slices.Equal(got, []string{"etc/ssl/cert.pem"}) {
		t.Errorf("present before: %v", got)
	}
}
