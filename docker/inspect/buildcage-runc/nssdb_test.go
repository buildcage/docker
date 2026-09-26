package main

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// The template certutil makes, as far as the wrapper cares: a few files it
// copies without reading.
var testNSSTemplate = map[string]string{
	"cert9.db":   "CERT9-WITH-THE-PROXY-CA",
	"key4.db":    "KEY4-EMPTY",
	"pkcs11.txt": "library=\nname=NSS Internal PKCS #11 Module\n",
}

// useNSSTemplate gives placeNSSDB a template database to copy.
func useNSSTemplate(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	for name, content := range testNSSTemplate {
		mustWriteFile(t, filepath.Join(dir, name), content)
	}
	old := nssTemplateDir
	nssTemplateDir = dir
	t.Cleanup(func() { nssTemplateDir = old })
}

// stepUser is a uid and gid the test process can hand files to: any when it
// runs as root, only its own otherwise.
func stepUser() (uid, gid int) {
	if os.Geteuid() == 0 {
		return 1000, 1000
	}
	return os.Getuid(), os.Getgid()
}

// newNSSBundle is a bundle whose process runs as uid:gid with env, over a
// rootfs holding only /etc and the given home directory, and whose overlay
// upper directory is the rootfs itself so finish reads the layer back.
func newNSSBundle(t *testing.T, env []string, uid, gid int, home string) (bundle, rootfs string) {
	t.Helper()
	bundle, rootfs = newBundleNoStore(t, env)
	if home != "" {
		mustMkdirAll(t, filepath.Join(rootfs, home))
	}
	setSpecField(t, bundle, "process", func(proc map[string]any) {
		proc["user"] = map[string]any{"uid": uid, "gid": gid}
	})
	useMountInfo(t, overlayLine(rootfs, rootfs))
	return bundle, rootfs
}

// setSpecField rewrites one top-level object of the bundle's config.json.
func setSpecField(t *testing.T, bundle, key string, edit func(map[string]any)) {
	t.Helper()
	path := filepath.Join(bundle, "config.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatal(err)
	}
	field, _ := config[key].(map[string]any)
	if field == nil {
		field = map[string]any{}
	}
	edit(field)
	config[key] = field
	out, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, path, string(out))
}

// nssMountSource returns the scratch directory bound at dest, failing the test
// when there is none.
func nssMountSource(t *testing.T, bundle, dest string) string {
	t.Helper()
	source, _ := findMount(t, loadMounts(t, bundle), dest)["source"].(string)
	return source
}

func assertNoMountAt(t *testing.T, bundle, dest string) {
	t.Helper()
	for _, m := range loadMounts(t, bundle) {
		if m["destination"] == dest {
			t.Fatalf("a mount was added at %s", dest)
		}
	}
}

func mustOwner(t *testing.T, path string) (uid, gid int, mode os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	st := info.Sys().(*syscall.Stat_t)
	return int(st.Uid), int(st.Gid), info.Mode().Perm()
}

// A home with no database gets the template at the XDG path Chromium would
// create, writable by the step's user, and the directories created to hold it
// are taken back once the step ends.
func TestNSSDBIsBoundAtTheXDGPathAndTakenBack(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, rootfs := newNSSBundle(t, []string{"HOME=/home/app"}, uid, gid, "/home/app")

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	scratch := nssMountSource(t, bundle, "/home/app/.local/share/pki/nssdb")
	for name, want := range testNSSTemplate {
		path := filepath.Join(scratch, name)
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != want {
			t.Fatalf("%s holds %q, not the template's %q", name, got, want)
		}
		if u, g, mode := mustOwner(t, path); u != uid || g != gid || mode != 0o600 {
			t.Fatalf("%s is %d:%d %o, want %d:%d 600", name, u, g, mode, uid, gid)
		}
	}
	if u, g, mode := mustOwner(t, scratch); u != uid || g != gid || mode != 0o700 {
		t.Fatalf("the database directory is %d:%d %o, want %d:%d 700", u, g, mode, uid, gid)
	}
	for _, dir := range []string{".local", ".local/share", ".local/share/pki", ".local/share/pki/nssdb"} {
		if u, g, mode := mustOwner(t, filepath.Join(rootfs, "home/app", dir)); u != uid || g != gid || mode != 0o700 {
			t.Fatalf("~/%s was created %d:%d %o, want %d:%d 700", dir, u, g, mode, uid, gid)
		}
	}

	if err := in.finish(true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(rootfs, "home/app/.local")); !os.IsNotExist(err) {
		t.Fatal("~/.local was left behind")
	}
	if _, err := os.Stat(scratch); !os.IsNotExist(err) {
		t.Fatal("the scratch database was left behind")
	}
}

// A directory the step put something of its own into stays; only the ones left
// empty go.
func TestNSSDBLeavesADirectoryTheStepUsed(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, rootfs := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(rootfs, "root/.local/share/app.db"), "the step's own")

	if err := in.finish(true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(rootfs, "root/.local/share/app.db")); err != nil {
		t.Fatal("the step's own file went with the created directories")
	}
	if _, err := os.Lstat(filepath.Join(rootfs, "root/.local/share/pki")); !os.IsNotExist(err) {
		t.Fatal("~/.local/share/pki was left behind")
	}
}

// The legacy path wins whenever it is there, even empty and even beside an XDG
// one, and what the image kept in it is covered rather than touched.
func TestNSSDBCoversTheLegacyPathFirst(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, rootfs := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")
	legacy := filepath.Join(rootfs, "root/.pki/nssdb")
	mustMkdirAll(t, legacy)
	mustWriteFile(t, filepath.Join(legacy, "cert9.db"), "THE IMAGE'S OWN")
	mustMkdirAll(t, filepath.Join(rootfs, "root/.local/share/pki/nssdb"))

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	nssMountSource(t, bundle, "/root/.pki/nssdb")
	assertNoMountAt(t, bundle, "/root/.local/share/pki/nssdb")
	if err := in.finish(true); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(legacy, "cert9.db"))
	if err != nil || string(got) != "THE IMAGE'S OWN" {
		t.Fatalf("the image's own database changed: %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(rootfs, "root/.local/share/pki/nssdb")); err != nil {
		t.Fatal("an XDG database the image already had was taken away")
	}
}

// An XDG database already in the image is covered where it is, creating nothing.
func TestNSSDBCoversAnExistingXDGDatabase(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, rootfs := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")
	mustMkdirAll(t, filepath.Join(rootfs, "root/.local/share/pki/nssdb"))

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	nssMountSource(t, bundle, "/root/.local/share/pki/nssdb")
	for _, dir := range in.created.dirs {
		if strings.Contains(dir, "pki/nssdb") || strings.HasSuffix(dir, "/root/.local") {
			t.Fatalf("created %s for a database that was already there", dir)
		}
	}
	if err := in.finish(true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(rootfs, "root/.local/share/pki/nssdb")); err != nil {
		t.Fatal("the image's own database directory was taken away")
	}
}

// A step that changes the database fails the build: there is nowhere true to
// write the change back to.
func TestNSSDBChangedByTheStepFailsTheStep(t *testing.T) {
	for name, change := range map[string]func(t *testing.T, scratch string){
		"a file rewritten": func(t *testing.T, scratch string) {
			mustWriteFile(t, filepath.Join(scratch, "cert9.db"), "WITH A CA OF THE STEP'S OWN")
		},
		"a file added": func(t *testing.T, scratch string) {
			mustWriteFile(t, filepath.Join(scratch, "cert9.db-journal"), "")
		},
		"a file removed": func(t *testing.T, scratch string) {
			if err := os.Remove(filepath.Join(scratch, "key4.db")); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			useTempLog(t)
			useFakeRsync(t)
			useNSSTemplate(t)
			uid, gid := stepUser()
			bundle, _ := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")

			in, err := inject(bundle, testCA)
			if err != nil {
				t.Fatal(err)
			}
			scratch := nssMountSource(t, bundle, "/root/.local/share/pki/nssdb")
			change(t, scratch)

			err = in.finish(true)
			if err == nil || !strings.Contains(err.Error(), "changed the NSS database at /root/.local/share/pki/nssdb") {
				t.Fatalf("got %v, want the change to fail the step", err)
			}
			if _, err := os.Stat(scratch); !os.IsNotExist(err) {
				t.Fatal("the scratch database was left behind")
			}
		})
	}
}

// With HOME left empty, runc takes it from the image's /etc/passwd, and so
// does the wrapper.
func TestNSSDBFindsTheHomeInPasswd(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, rootfs := newNSSBundle(t, []string{"HOME="}, uid, gid, "/home/app")
	mustWriteFile(t, filepath.Join(rootfs, "etc/passwd"),
		"root:x:0:0:root:/root:/bin/sh\n"+
			"broken line\n"+
			"app:x:"+itoa(uid)+":"+itoa(gid)+"::/home/app:/bin/sh\n")

	if _, err := inject(bundle, testCA); err != nil {
		t.Fatal(err)
	}
	nssMountSource(t, bundle, "/home/app/.local/share/pki/nssdb")
}

func itoa(i int) string {
	b, _ := json.Marshal(i)
	return string(b)
}

// Every case that leaves the database alone: nothing is bound, and nothing is
// created in the rootfs.
func TestNSSDBIsLeftAloneWhenItCannotBePlaced(t *testing.T) {
	for name, tc := range map[string]struct {
		env      []string
		home     string
		passwd   string
		arrange  func(t *testing.T, bundle, rootfs string)
		template bool
	}{
		"no template":              {env: []string{"HOME=/root"}, home: "/root"},
		"an empty template":        {env: []string{"HOME=/root"}, home: "/root", template: true, arrange: emptyTheTemplate},
		"a relative HOME":          {env: []string{"HOME=root"}, home: "/root", template: true},
		"HOME at the root":         {env: []string{"HOME=/"}, template: true},
		"no passwd entry":          {home: "/root", template: true, passwd: "root:x:0:0:root:/root:/bin/sh\n"},
		"no passwd":                {home: "/root", template: true},
		"an empty passwd home":     {home: "/root", template: true, passwd: "app:x:{uid}:{gid}:::/bin/sh\n"},
		"a HOME that is not there": {env: []string{"HOME=/home/nobody"}, template: true},
		"a HOME that is a file": {env: []string{"HOME=/home/app"}, template: true, arrange: func(t *testing.T, _, rootfs string) {
			mustMkdirAll(t, filepath.Join(rootfs, "home"))
			mustWriteFile(t, filepath.Join(rootfs, "home/app"), "")
		}},
		"HOME above the root": {env: []string{"HOME=/../../.."}, template: true},
		"a HOME escaping the rootfs": {env: []string{"HOME=/up"}, template: true, arrange: func(t *testing.T, _, rootfs string) {
			mustSymlink(t, "../../../../..", filepath.Join(rootfs, "up"))
		}},
		"a passwd escaping the rootfs": {home: "/root", template: true, arrange: func(t *testing.T, _, rootfs string) {
			if err := os.RemoveAll(filepath.Join(rootfs, "etc")); err != nil {
				t.Fatal(err)
			}
			mustSymlink(t, "../../../../..", filepath.Join(rootfs, "etc"))
		}},
		"a legacy parent that is a file": {env: []string{"HOME=/root"}, home: "/root", template: true, arrange: func(t *testing.T, _, rootfs string) {
			mustWriteFile(t, filepath.Join(rootfs, "root/.pki"), "")
		}},
		"a database that cannot be read back": {env: []string{"HOME=/root"}, home: "/root", template: true, arrange: func(t *testing.T, _, _ string) {
			failWalkUnder(t, scratchRoot)
		}},
		"a database that is a file": {env: []string{"HOME=/root"}, home: "/root", template: true, arrange: func(t *testing.T, _, rootfs string) {
			mustMkdirAll(t, filepath.Join(rootfs, "root/.pki"))
			mustWriteFile(t, filepath.Join(rootfs, "root/.pki/nssdb"), "")
		}},
		"a database under a symlink out of the rootfs": {env: []string{"HOME=/root"}, home: "/root", template: true, arrange: func(t *testing.T, _, rootfs string) {
			mustSymlink(t, "../../../../../..", filepath.Join(rootfs, "root/.pki"))
		}},
		"a mount over the home": {env: []string{"HOME=/root"}, home: "/root", template: true, arrange: func(t *testing.T, bundle, _ string) {
			mountAt(t, bundle, "/root")
		}},
		"a mount inside the database": {env: []string{"HOME=/root"}, home: "/root", template: true, arrange: func(t *testing.T, bundle, _ string) {
			mountAt(t, bundle, "/root/.local/share/pki/nssdb/cache")
		}},
		"no scratch directory": {env: []string{"HOME=/root"}, home: "/root", template: true, arrange: func(t *testing.T, _, _ string) {
			scratchRoot = "/dev/null/scratch"
		}},
	} {
		t.Run(name, func(t *testing.T) {
			useTempLog(t)
			useFakeRsync(t)
			if tc.template {
				useNSSTemplate(t)
			}
			uid, gid := stepUser()
			bundle, rootfs := newNSSBundle(t, tc.env, uid, gid, tc.home)
			if tc.passwd != "" {
				passwd := strings.NewReplacer("{uid}", itoa(uid), "{gid}", itoa(gid)).Replace(tc.passwd)
				mustWriteFile(t, filepath.Join(rootfs, "etc/passwd"), passwd)
			}
			if tc.arrange != nil {
				tc.arrange(t, bundle, rootfs)
			}
			before := listTree(t, rootfs)

			in, err := inject(bundle, testCA)
			if err != nil {
				t.Fatal(err)
			}
			if in.nss != nil {
				t.Fatalf("a database was bound at %s", in.nss.containerDir)
			}
			for _, m := range loadMounts(t, bundle) {
				if dest, _ := m["destination"].(string); m["type"] == "bind" && strings.Contains(dest, "pki") {
					t.Fatalf("a mount was added at %s", dest)
				}
			}
			// The anchors the same injection placed are not this test's subject.
			after := listTree(t, rootfs)
			for path := range after {
				if !before[path] && strings.Contains(path, "pki/nssdb") {
					t.Fatalf("%s was created", path)
				}
			}
		})
	}
}

func emptyTheTemplate(t *testing.T, _, _ string) {
	t.Helper()
	entries, err := os.ReadDir(nssTemplateDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if err := os.Remove(filepath.Join(nssTemplateDir, e.Name())); err != nil {
			t.Fatal(err)
		}
	}
	// A directory in it is not a database file either.
	mustMkdirAll(t, filepath.Join(nssTemplateDir, "subdir"))
}

func mountAt(t *testing.T, bundle, dest string) {
	t.Helper()
	path := filepath.Join(bundle, "config.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatal(err)
	}
	config["mounts"] = []any{map[string]any{"destination": dest, "type": "tmpfs", "source": "tmpfs"}}
	out, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, path, string(out))
}

// listTree is every path under root, relative to it.
func listTree(t *testing.T, root string) map[string]bool {
	t.Helper()
	paths := map[string]bool{}
	err := filepath.WalkDir(root, func(path string, _ os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		paths[rel] = true
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return paths
}

// A template that cannot be read is no template.
func TestReadNSSTemplateReportsAFileItCannotRead(t *testing.T) {
	skipIfRoot(t)
	useNSSTemplate(t)
	if err := os.Chmod(filepath.Join(nssTemplateDir, "cert9.db"), 0); err != nil {
		t.Fatal(err)
	}
	if _, err := readNSSTemplate(); err == nil {
		t.Fatal("expected an unreadable template to be refused")
	}
}

// A step user the wrapper cannot hand the database to leaves it unbound rather
// than bound read-only, which Chromium would ignore just the same.
func TestNSSDBIsLeftAloneWhenItCannotBeHandedToTheStepUser(t *testing.T) {
	skipIfRoot(t)
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	bundle, _ := newNSSBundle(t, []string{"HOME=/root"}, 0, 0, "/root")

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	if in.nss != nil {
		t.Fatal("a database was bound that the step's user could not write")
	}
}

// A HOME whose directories cannot be created leaves the database unbound.
func TestNSSDBIsLeftAloneWhenTheDirectoriesCannotBeCreated(t *testing.T) {
	skipIfRoot(t)
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, rootfs := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")
	mustMakeReadOnly(t, filepath.Join(rootfs, "root"))

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	if in.nss != nil {
		t.Fatal("a database was bound over a directory that could not be created")
	}
	assertNoMountAt(t, bundle, "/root/.local/share/pki/nssdb")
}

// A database the wrapper cannot read back is reported, as a change would be.
func TestNSSDBFinishReportsADatabaseItCannotRead(t *testing.T) {
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, _ := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	failWalkOn(t, in.nss.scratchDir, 1)
	if err := in.finish(true); err == nil {
		t.Fatal("expected a database that cannot be read back to fail the step")
	}
}

// processUser reads what BuildKit wrote, and a spec naming nobody runs as root.
func TestProcessUser(t *testing.T) {
	for name, tc := range map[string]struct {
		process  map[string]any
		uid, gid int
	}{
		"numbers":      {map[string]any{"user": map[string]any{"uid": 1000, "gid": 100}}, 1000, 100},
		"no user":      {map[string]any{}, 0, 0},
		"not a number": {map[string]any{"user": map[string]any{"uid": 1.5, "gid": "x"}}, 0, 0},
	} {
		t.Run(name, func(t *testing.T) {
			bundle, _ := newBundleNoStore(t, nil)
			setSpecField(t, bundle, "process", func(proc map[string]any) {
				for k, v := range tc.process {
					proc[k] = v
				}
			})
			s, err := loadSpec(bundle)
			if err != nil {
				t.Fatal(err)
			}
			if uid, gid := s.processUser(); uid != tc.uid || gid != tc.gid {
				t.Fatalf("got %d:%d, want %d:%d", uid, gid, tc.uid, tc.gid)
			}
		})
	}
}

// failWalkUnder fails every walk of a directory under root, which is where
// the scratch directories whose names a test cannot know in advance are made.
func failWalkUnder(t *testing.T, root string) {
	t.Helper()
	old := walkDir
	walkDir = func(dir string, fn fs.WalkDirFunc) error {
		if strings.HasPrefix(dir, root+"/") {
			return errBrokenWalk
		}
		return old(dir, fn)
	}
	t.Cleanup(func() { walkDir = old })
}

// A directory that is gone by the time it is handed over stops the handover.
func TestOwnDirsReportsADirectoryItCannotHandOver(t *testing.T) {
	uid, gid := stepUser()
	if err := ownDirs([]string{filepath.Join(t.TempDir(), "gone")}, uid, gid); err == nil {
		t.Fatal("expected a missing directory to be reported")
	}
}

// A legacy database whose presence cannot be told is not guessed at: taking
// the XDG path could leave Chromium reading the legacy one after all.
func TestNSSDBIsLeftAloneWhenTheLegacyPathCannotBeRead(t *testing.T) {
	skipIfRoot(t)
	useTempLog(t)
	useFakeRsync(t)
	useNSSTemplate(t)
	uid, gid := stepUser()
	bundle, rootfs := newNSSBundle(t, []string{"HOME=/root"}, uid, gid, "/root")
	pki := filepath.Join(rootfs, "root/.pki")
	mustMkdirAll(t, pki)
	if err := os.Chmod(pki, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(pki, 0o755) })

	in, err := inject(bundle, testCA)
	if err != nil {
		t.Fatal(err)
	}
	if in.nss != nil {
		t.Fatalf("a database was bound at %s", in.nss.containerDir)
	}
}
