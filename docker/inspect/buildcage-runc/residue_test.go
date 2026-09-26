package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// useWarnOnCAResidue stands for a build set up with fail_on_ca_residue: false.
func useWarnOnCAResidue(t *testing.T) {
	t.Helper()
	old := failOnCAResidue
	failOnCAResidue = false
	t.Cleanup(func() { failOnCAResidue = old })
}

// A copy of the CA the sweep cannot take out stays in the image with a warning,
// and the rest of the undo still runs.
func TestFinishOnlyWarnsAboutACopyItCannotStripWhenAskedTo(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useWarnOnCAResidue(t)
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(rootfs, "cacerts.bin"), "EFI-VAR\x00"+string(testDER))

	readStderr := captureStderr(t)
	err = in.finish(true)
	stderr := readStderr()
	if err != nil {
		t.Fatalf("got %v, want only a warning", err)
	}
	if !strings.Contains(stderr, "buildcage: warning:") || !strings.Contains(stderr, "cannot strip: /cacerts.bin") {
		t.Errorf("the warning does not name the copy:\n%s", stderr)
	}
	if _, err := os.Stat(filepath.Join(rootfs, "cacerts.bin")); err != nil {
		t.Errorf("the step's own file went: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(rootfs, "etc", "pki")); !os.IsNotExist(err) {
		t.Error("the anchor directories were left behind")
	}
}

// A copy the reading back finds is residue too.
func TestStripLayerLeftoverIsResidue(t *testing.T) {
	err := stripLayerWithALeftover(t)
	if !errors.Is(err, errCALeftInLayer) || !isCAResidue(err) {
		t.Fatalf("got %v, want residue", err)
	}
}

func stripLayerWithALeftover(t *testing.T) error {
	t.Helper()
	root := t.TempDir()
	rootfs, upper := filepath.Join(root, "rootfs"), filepath.Join(root, "fs")
	mustMkdirAll(t, rootfs)
	mustMkdirAll(t, upper)
	mustWriteFile(t, filepath.Join(upper, "bundle.pem"), string(testCA))
	useMountInfo(t, overlayLine(rootfs, upper))
	return stripLayer(rootfs, upperDirOf(rootfs), testCA)
}

// A write to the NSS database is discarded with a warning.
func TestNSSDBChangeOnlyWarnsWhenAskedTo(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	useWarnOnCAResidue(t)
	uid, gid := stepUser()
	bundle, _ := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	scratch := nssMountSource(t, bundle, "/root/.pki/nssdb")
	mustWriteFile(t, filepath.Join(scratch, "cert9.db"), "WITH A CA OF THE STEP'S OWN")

	readStderr := captureStderr(t)
	err = in.finish(true)
	stderr := readStderr()
	if err != nil {
		t.Fatalf("got %v, want only a warning", err)
	}
	if !strings.Contains(stderr, "changed the NSS database at /root/.pki/nssdb") {
		t.Errorf("the warning does not name the database:\n%s", stderr)
	}
	if _, err := os.Stat(scratch); !os.IsNotExist(err) {
		t.Error("the scratch database was left behind")
	}
}

// A copy the step leaves in a mirrored store goes back to the rootfs with the
// rest of the step's change, rather than taking the change down with it.
func TestMirrorWritesBackAroundACopyItCannotStripWhenAskedTo(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useWarnOnCAResidue(t)
	bundle, rootfs := newBundle(t, []string{"PATH=/usr/bin"})

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	scratch, _ := findMount(t, loadMounts(t, bundle), "/etc/ssl/certs")["source"].(string)
	mustWriteFile(t, filepath.Join(scratch, "store.bin"), "EFI-VAR\x00"+string(testDER))

	readStderr := captureStderr(t)
	err = in.finish(true)
	readStderr()
	if err != nil {
		t.Fatalf("got %v, want only a warning", err)
	}
	if _, err := os.Stat(filepath.Join(rootfs, "etc", "ssl", "certs", "store.bin")); err != nil {
		t.Errorf("the step's change was not written back: %v", err)
	}
}

// Anything else still fails the build, whatever the setting says.
func TestTolerateResidueLeavesOtherFailuresAlone(t *testing.T) {
	useWarnOnCAResidue(t)
	if err := tolerateResidue(errBrokenWalk); !errors.Is(err, errBrokenWalk) {
		t.Fatalf("got %v, want the failure passed through", err)
	}
	if err := tolerateResidue(nil); err != nil {
		t.Fatalf("got %v from no failure", err)
	}
}

// A step failed over residue says how to let the build carry on instead.
func TestRunHintsAtFailOnCAResidue(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useTempCAFile(t, string(testCA))
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	t.Setenv("ROOTFS", rootfs)
	useFakeRunc(t, `printf 'EFI-VAR\000BUILDCAGE-CA' > "$ROOTFS/cacerts.bin"`)

	readStderr := captureStderr(t)
	code := run([]string{"run", "--bundle", bundle, "id"})
	stderr := readStderr()

	if code != 1 {
		t.Errorf("run exited %d, want 1", code)
	}
	if !strings.Contains(stderr, "buildcage: hint:") || !strings.Contains(stderr, "fail_on_ca_residue: false") {
		t.Errorf("no hint at fail_on_ca_residue:\n%s", stderr)
	}
}

// A step failed over anything else is not pointed at a setting that would not
// help it.
func TestRunDoesNotHintAtFailOnCAResidueForOtherFailures(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useTempCAFile(t, string(testCA))
	bundle, _ := newBundle(t, []string{"PATH=/usr/bin"})
	t.Setenv("SCRATCH_ROOT", scratchRoot)
	useFakeRunc(t, `for f in "$SCRATCH_ROOT"/*/ca-certificates.crt; do echo REGENERATED > "$f"; done`)
	failRsyncOn(t, 3)

	readStderr := captureStderr(t)
	run([]string{"run", "--bundle", bundle, "id"})
	if stderr := readStderr(); strings.Contains(stderr, "fail_on_ca_residue") {
		t.Errorf("a failed write-back hinted at fail_on_ca_residue:\n%s", stderr)
	}
}
