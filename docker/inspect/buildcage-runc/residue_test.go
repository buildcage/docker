package main

import (
	"errors"
	"fmt"
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
	err = in.finish()
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

// So does a JKS keystore sealed with a password of its own, which is found but
// cannot be resealed.
func TestFinishOnlyWarnsAboutAKeystoreItCannotResealWhenAskedTo(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useWarnOnCAResidue(t)
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, overlayLine(rootfs, rootfs))

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	sealed := keystore(2, trustedEntry(2, "buildcage", testDER))
	sealed[len(sealed)-1] ^= 0xff
	mustWriteFile(t, filepath.Join(rootfs, "truststore.jks"), string(sealed))

	readStderr := captureStderr(t)
	err = in.finish()
	stderr := readStderr()
	if err != nil {
		t.Fatalf("got %v, want only a warning", err)
	}
	if !strings.Contains(stderr, "cannot strip: /truststore.jks") {
		t.Errorf("the warning does not name the keystore:\n%s", stderr)
	}
}

// A step whose layer cannot be read back does not run, whatever
// fail_on_ca_residue says, and nothing is placed in its rootfs.
func TestInjectRefusesAStepWithoutALayerToReadBack(t *testing.T) {
	for _, fail := range []bool{true, false} {
		t.Run(fmt.Sprintf("fail_on_ca_residue %v", fail), func(t *testing.T) {
			useTempLog(t)
			useFakeRsync(t)
			old := failOnCAResidue
			failOnCAResidue = fail
			t.Cleanup(func() { failOnCAResidue = old })
			bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
			useMountInfo(t, mountLine(rootfs, "ext4", "rw"))

			if _, err := inject(bundle, testCA); !errors.Is(err, errLayerUnread) {
				t.Fatalf("got %v, want the unread layer to refuse the step", err)
			}
			if entries, _ := os.ReadDir(rootfs); len(entries) != 1 || entries[0].Name() != "etc" {
				t.Errorf("rootfs holds %v, want it untouched", entries)
			}
		})
	}
}

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
	return stripLayer(rootfs, upperDirOf(rootfs), testCA, nil)
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
	err = in.finish()
	stderr := readStderr()
	if err != nil {
		t.Fatalf("got %v, want only a warning", err)
	}
	if n := strings.Count(stderr, "store.bin"); n != 1 {
		t.Errorf("the copy is warned about %d times, want once:\n%s", n, stderr)
	}
	if _, err := os.Stat(filepath.Join(rootfs, "etc", "ssl", "certs", "store.bin")); err != nil {
		t.Errorf("the step's change was not written back: %v", err)
	}
}

func TestTolerateResidueLeavesOtherFailuresAlone(t *testing.T) {
	useWarnOnCAResidue(t)
	for _, failure := range []error{errBrokenWalk, errLayerUnread} {
		if err := tolerateResidue(failure); !errors.Is(err, failure) {
			t.Fatalf("got %v, want %v passed through", err, failure)
		}
	}
	if err := tolerateResidue(nil); err != nil {
		t.Fatalf("got %v from no failure", err)
	}
}

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

// A step whose layer cannot be read back fails before runc starts it, and the
// build log says why without pointing at fail_on_ca_residue.
func TestRunRefusesAStepWithoutALayerToReadBack(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useTempCAFile(t, string(testCA))
	bundle, rootfs := newBundleNoStore(t, []string{"PATH=/usr/bin"})
	useMountInfo(t, mountLine(rootfs, "ext4", "rw"))
	ran := filepath.Join(t.TempDir(), "ran")
	t.Setenv("RAN", ran)
	useFakeRunc(t, `touch "$RAN"`)

	readStderr := captureStderr(t)
	code := run([]string{"run", "--bundle", bundle, "id"})
	stderr := readStderr()

	if code != 1 {
		t.Errorf("run exited %d, want 1", code)
	}
	if _, err := os.Stat(ran); !os.IsNotExist(err) {
		t.Errorf("runc ran the step: %v", err)
	}
	if !strings.Contains(stderr, "not running the step: "+errLayerUnread.Error()) {
		t.Errorf("the build log does not say why:\n%s", stderr)
	}
	if strings.Contains(stderr, "fail_on_ca_residue") {
		t.Errorf("an unread layer hinted at fail_on_ca_residue:\n%s", stderr)
	}
}

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

// A copy the sweep cannot strip does not stop the slot being cut from a copy
// of the home in the same layer, and the result names each residue once:
// it fails the build by default and only warns under fail_on_ca_residue: false.
func TestStripLayerGoesOnPastACopyItCannotStrip(t *testing.T) {
	own := "library=\nname=NSS Internal PKCS #11 Module\n\n"
	for _, fail := range []bool{true, false} {
		t.Run(fmt.Sprintf("fail_on_ca_residue %v", fail), func(t *testing.T) {
			useTempLog(t)
			old := failOnCAResidue
			failOnCAResidue = fail
			t.Cleanup(func() { failOnCAResidue = old })
			rootfs := t.TempDir()
			mustWriteFile(t, filepath.Join(rootfs, "bundle.tar"), "ustar\x00"+string(testCA))
			home := filepath.Join(rootfs, "backup", nssDBPath)
			mustMkdirAll(t, home)
			mustWriteFile(t, filepath.Join(home, "pkcs11.txt"), own+string(nssSlot))
			big := filepath.Join(rootfs, "big")
			mustMkdirAll(t, big)
			mustWriteFile(t, filepath.Join(big, "pkcs11.txt"), string(nssSlot)+strings.Repeat("#", maxPKCS11TxtBytes))

			err := stripLayer(rootfs, rootfs, testCA, nil)
			if !errors.Is(err, errUnstrippableCA) || !errors.Is(err, errNSSSlotLeftInLayer) || errors.Is(err, errCALeftInLayer) {
				t.Fatalf("got %v, want the copy and the unread slot reported, the copy once", err)
			}
			if n := strings.Count(err.Error(), "/bundle.tar"); n != 1 {
				t.Errorf("the copy is named %d times, want once: %v", n, err)
			}
			if got := mustRead(t, filepath.Join(home, "pkcs11.txt")); got != own {
				t.Errorf("the copied home holds %q, want the slot cut", got)
			}
			readStderr := captureStderr(t)
			tolerated := tolerateResidue(err)
			readStderr()
			if fail != (tolerated != nil) {
				t.Errorf("got %v under fail_on_ca_residue %v", tolerated, fail)
			}
		})
	}
}

// A failure that is not residue still ends the sweep there.
func TestStripLayerStopsOnAFailedSweep(t *testing.T) {
	useTempLog(t)
	rootfs := t.TempDir()
	failWalkOn(t, rootfs, 1)
	if err := stripLayer(rootfs, rootfs, testCA, nil); !errors.Is(err, errBrokenWalk) || isCAResidue(err) {
		t.Fatalf("got %v, want the failed walk alone", err)
	}
}
