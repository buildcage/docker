package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Alpine's update-ca-certificates writes each certificate followed by a blank
// line, the CA among them when it rebuilds the bundle from the anchor
// directory during a step. Taking the CA out leaves the rest as it would have
// been without it.
func TestRemoveCAKeepsOneBlankLineBetweenSeparatedCertificates(t *testing.T) {
	other := string(certPEM(testCert(t, "other")))
	for _, tc := range []struct {
		name          string
		bundle, wants string
		inBundle      bool
	}{
		{"last", other + "\n" + string(testCA) + "\n", other + "\n", true},
		{"between", other + "\n" + string(testCA) + "\n" + other + "\n", other + "\n" + other + "\n", true},
		{"appended after a blank line", other + "\n" + string(testCA), other + "\n", false},
		{"no blank line after", other + "\n" + string(testCA) + other, other + "\n" + other, false},
		{"no blank line before", other + string(testCA) + "\n" + other, other + "\n" + other, false},
		{"first", string(testCA) + "\n" + other, other, true},
		{"after a single byte", "\n" + string(testCA) + "\n" + other, "\n\n" + other, false},
		{"only", string(testCA) + "\n", "", true},
		{"a copy alone", string(testCA), "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "bundle.pem")
			mustWriteFile(t, path, tc.bundle)
			inBundle, err := removeCA(path, caMarksOf(testCA))
			if err != nil {
				t.Fatal(err)
			}
			if got := mustRead(t, path); got != tc.wants {
				t.Fatalf("got %q, want %q", got, tc.wants)
			}
			if inBundle != tc.inBundle {
				t.Fatalf("reported in a bundle: %v, want %v", inBundle, tc.inBundle)
			}
		})
	}
}

// readerFailingBack serves data, and fails a read that goes back before an
// offset once one at or past it has been served.
type readerFailingBack struct {
	data   string
	at     int64
	passed *bool
}

func (r readerFailingBack) ReadAt(p []byte, off int64) (int, error) {
	if off >= r.at {
		*r.passed = true
	} else if *r.passed {
		return 0, errBrokenFile
	}
	return strings.NewReader(r.data).ReadAt(p, off)
}

// A bundle without an .apk-new does not stop the bundles after it from being
// looked at, and an .apk-new the rebuilt bundle already matches goes.
func TestPromoteAPKNewGoesOnPastABundleWithoutOne(t *testing.T) {
	scratch := t.TempDir()
	mustWriteFile(t, filepath.Join(scratch, "first.pem"), "A\n")
	mustWriteFile(t, filepath.Join(scratch, "second.pem"), "NEW\n")
	mustWriteFile(t, filepath.Join(scratch, "second.pem.apk-new"), "NEW\n")
	b := &dirBind{scratchDir: scratch, bundleFiles: []string{"first.pem", "second.pem"},
		original: []fileEntry{{path: "first.pem"}, {path: "second.pem"}}}
	if err := b.promoteAPKNew(); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(scratch, "second.pem.apk-new")) {
		t.Error("the .apk-new the bundle matches is still there")
	}
}

// A rebuilt bundle that matches its .apk-new stays as the step left it, mtime
// and all, and the .apk-new goes, as apk writes none then. Failing to remove
// it fails the step.
func TestPromoteAPKNewKeepsARebuiltBundleThatMatches(t *testing.T) {
	scratch := t.TempDir()
	mustWriteFile(t, filepath.Join(scratch, "bundle.pem"), "NEW\n")
	mustWriteFile(t, filepath.Join(scratch, "bundle.pem.apk-new"), "NEW\n")
	rebuilt := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(scratch, "bundle.pem"), rebuilt, rebuilt); err != nil {
		t.Fatal(err)
	}
	b := &dirBind{scratchDir: scratch, bundleFiles: []string{"bundle.pem"}, original: []fileEntry{{path: "bundle.pem"}}}

	old := removeFile
	removeFile = func(string) error { return errBrokenFile }
	if err := b.promoteAPKNew(); !errors.Is(err, errBrokenFile) {
		t.Errorf("a failed removal: got %v", err)
	}
	removeFile = old

	if err := b.promoteAPKNew(); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(scratch, "bundle.pem.apk-new")) {
		t.Error("the .apk-new is still there")
	}
	if got := mustStatMtime(t, filepath.Join(scratch, "bundle.pem")); !got.Equal(rebuilt) || b.apkReplaced["bundle.pem"] {
		t.Errorf("the bundle was replaced: mtime %v, replaced %v", got, b.apkReplaced)
	}
}

// A bundle an .apk-new replaced goes back with the mtime apk left on it, as a
// file apk wrote, even when its content is what it was.
func TestInjectKeepsTheMtimeOfAReplacedBundle(t *testing.T) {
	useFakeRsync(t)
	bundle, _ := newAPKBundle(t)
	restore, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mirror := mountSource(t, bundle, "/etc/ssl/certs")
	apkNew := filepath.Join(mirror, "ca-certificates.crt.apk-new")
	mustWriteFile(t, apkNew, "ORIGINAL-ROOTS\n")
	written := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := os.Chtimes(apkNew, written, written); err != nil {
		t.Fatal(err)
	}
	var atWriteBack time.Time
	orig := runRsync
	runRsync = func(args []string) ([]byte, error) {
		if !isRsyncDryRun(args) && rsyncSrc(args) == mirror {
			atWriteBack = mustStatMtime(t, filepath.Join(mirror, "ca-certificates.crt"))
		}
		return orig(args)
	}
	t.Cleanup(func() { runRsync = orig })

	if err := restore.finish(); err != nil {
		t.Fatal(err)
	}
	if !atWriteBack.Equal(written) {
		t.Errorf("the bundle went back with mtime %v, want %v", atWriteBack, written)
	}
}

// The certificate starts where the search's third read does, so the window
// holds nothing before it and reading the bytes before the cut is a read of
// its own.
func TestFindCertificatesReportsAFailedReadAroundTheCut(t *testing.T) {
	data := filler(2*scanChunk-2) + "\n\n" + string(testCA) + "\n"
	begin := int64(strings.Index(data, "-----BEGIN"))
	passed := false
	w := newFileWindow(readerFailingBack{data: data, at: begin, passed: &passed}, int64(len(data)))
	if _, _, err := findCertificates(w, caMarksOf(testCA)); !errors.Is(err, errBrokenFile) {
		t.Fatalf("got %v", err)
	}
}
