package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The rootfs comes from an image the build chose, so a symlink placed at one of
// the CA paths is attacker-controlled input to a process running as root on the
// host.
func TestResolveInRootRefusesToEscape(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "host-secret")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "etc"), 0o755); err != nil {
		t.Fatal(err)
	}

	cases := map[string]string{
		"symlink to an absolute host path": outside,
		"symlink climbing out with ..":     "../../../../../../etc/passwd",
	}
	for name, target := range cases {
		t.Run(name, func(t *testing.T) {
			link := filepath.Join(root, "etc", "ca.pem")
			_ = os.Remove(link)
			if err := os.Symlink(target, link); err != nil {
				t.Fatal(err)
			}
			// The property that matters is that nothing outside the rootfs is
			// ever returned. Refusing outright and failing to find a path that
			// only exists on the host are both acceptable.
			resolved, err := resolveInRoot(root, "/etc/ca.pem")
			if err == nil && !strings.HasPrefix(resolved, root+string(os.PathSeparator)) {
				t.Fatalf("resolved outside the rootfs: %s", resolved)
			}
			if resolved == outside {
				t.Fatal("resolved to the host file")
			}
		})
	}
}

// An absolute symlink inside a container points at the container's own root,
// not the host's, and must keep working.
func TestResolveInRootFollowsAbsoluteLinksInsideTheRootfs(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "etc", "ssl", "certs"), 0o755); err != nil {
		t.Fatal(err)
	}
	real := filepath.Join(root, "etc", "ssl", "certs", "ca-certificates.crt")
	if err := os.WriteFile(real, []byte("real"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/etc/ssl/certs/ca-certificates.crt", filepath.Join(root, "etc", "ssl", "cert.pem")); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveInRoot(root, "/etc/ssl/cert.pem")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != real {
		t.Fatalf("got %s, want %s", resolved, real)
	}
}

func TestResolveInRootAllowsAMissingFinalComponent(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "etc"), 0o755); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveInRoot(root, "/etc/not-there.pem")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != filepath.Join(root, "etc", "not-there.pem") {
		t.Fatalf("unexpected path %s", resolved)
	}
}

// Removal has to be exact rather than length-based: a step may append its own
// certificates, and cutting back to a remembered size would take them with it.
func TestRemoveCALeavesLaterAdditionsIntact(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	original := "ORIGINAL\n"
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := appendCA(path, []byte("BUILDCAGE-CA")); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("USER-ADDED\n"); err != nil {
		t.Fatal(err)
	}
	f.Close()

	if err := removeCA(path); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != original+"USER-ADDED\n" {
		t.Fatalf("got %q", got)
	}
	if strings.Contains(string(got), "BUILDCAGE-CA") {
		t.Fatal("the CA is still present")
	}
}

func TestRemoveCARestoresTheFileExactly(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	original := "ORIGINAL CONTENT\nSECOND LINE\n"
	if err := os.WriteFile(path, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := appendCA(path, []byte("CA")); err != nil {
		t.Fatal(err)
	}
	if err := removeCA(path); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != original {
		t.Fatalf("got %q, want %q", got, original)
	}
}

// A step that rewrote the file entirely leaves no block to find.
func TestRemoveCAIsANoOpWhenTheBlockIsGone(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.pem")
	if err := os.WriteFile(path, []byte("REWRITTEN\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := removeCA(path); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "REWRITTEN\n" {
		t.Fatalf("got %q", got)
	}
}

func TestParseArgs(t *testing.T) {
	cases := []struct {
		args   []string
		sub    string
		bundle string
	}{
		{[]string{"--log", "/x", "run", "--bundle", "/b", "--keep", "id"}, "run", "/b"},
		{[]string{"--log-format", "json", "create", "--bundle=/b", "id"}, "create", "/b"},
		{[]string{"delete", "id"}, "delete", ""},
		{[]string{"--log", "/x", "state", "id"}, "state", ""},
	}
	for _, c := range cases {
		sub, bundle := parseArgs(c.args)
		if sub != c.sub || bundle != c.bundle {
			t.Errorf("parseArgs(%v) = %q,%q want %q,%q", c.args, sub, bundle, c.sub, c.bundle)
		}
	}
}
