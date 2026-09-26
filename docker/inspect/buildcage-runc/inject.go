package main

import (
	"os"
	"path/filepath"
	"strings"
)

// File the container is pointed at when a variable was not already set and the
// tool needs one of its own. Removed again when the step ends.
const ownCAPath = "/etc/buildcage-ca.pem"

// How each variable is treated when the image or Dockerfile did not set it,
// and what it falls back to when there is no system CA store to work with.
//
// The distinction between the kinds is what the variable means to the tool
// that reads it: NODE_EXTRA_CA_CERTS and DENO_CERT are added to a built-in
// set, so pointing them at a file holding only this CA leaves everything
// else trusted, store or no store. The others replace the bundle outright:
// with a store, they are pointed at it (which by then carries the CA plus
// the real public roots); with no store there is nothing left that still
// carries those roots, so they fall back to the same proxy-CA-only file
// NODE_EXTRA_CA_CERTS/DENO_CERT use. That covers ordinary HTTP(S) traffic
// (inspect re-signs all of it with this same CA) but not a passthrough
// connection's real certificate; see README.md#limitations for exactly which
// requests that leaves unable to verify.
type unsetBehaviour int

const (
	// The tool reads the system store on its own; with no store, falls back
	// to proxy-CA-only trust the same way pointAtSystemStore does.
	leaveUnset unsetBehaviour = iota
	// Point at a file holding only this CA, added to the tool's own set.
	pointAtOwnCA
	// Point at the system store, which replaces the tool's bundle; with no
	// store, falls back to the same proxy-CA-only file as pointAtOwnCA.
	pointAtSystemStore
)

var caVariables = []struct {
	name      string
	whenUnset unsetBehaviour
}{
	{"NODE_EXTRA_CA_CERTS", pointAtOwnCA},
	{"DENO_CERT", pointAtOwnCA},
	{"CURL_CA_BUNDLE", leaveUnset},
	{"REQUESTS_CA_BUNDLE", pointAtSystemStore},
	{"PIP_CERT", pointAtSystemStore},
	// OpenSSL's own override, replacing rather than adding to the default
	// search path: also read by Go's crypto/x509 on Unix, Ruby, and Rust's
	// rustls-native-certs. Not by GnuTLS, so Debian's wget and git go by the
	// store at their own compiled-in path instead.
	{"SSL_CERT_FILE", pointAtSystemStore},
}

// caPlan is what the variable pass settled on: the files the CA has to be
// appended to, the variables to add to the process spec, and the proxy-CA-only
// file it wrote, if any variable needed one.
type caPlan struct {
	targets      map[string]bool
	env          map[string]string
	createdOwnCA string
}

// planCATrust walks caVariables and decides, per variable, whether the CA goes
// into the file it already names, whether to point it at the system store, or
// whether to give it a file holding only this CA. See the unsetBehaviour
// comment above for why each variable falls where it does.
func planCATrust(s *spec, ca []byte, store systemStore) caPlan {
	// Every bundle the CA has to go into, keyed by resolved path so a file
	// named by two variables is only written once.
	plan := caPlan{targets: map[string]bool{}, env: map[string]string{}}
	if store.found {
		plan.targets[store.hostPath] = true
	}

	// setOwnCA points variableName at ownCAPath, writing it once and sharing
	// it across every variable that falls back to it.
	setOwnCA := func(variableName string) {
		resolved, err := resolveInRoot(s.rootfs, ownCAPath)
		if err != nil {
			logf("cannot place %s: %v", ownCAPath, err)
			return
		}
		// More than one variable can take this path, and all of them share
		// the file: only the first to get here writes it.
		if plan.createdOwnCA == "" {
			if _, err := os.Stat(resolved); err == nil {
				logf("%s already exists; not setting %s", ownCAPath, variableName)
				return
			}
			if err := os.WriteFile(resolved, ca, 0o644); err != nil {
				logf("cannot write %s: %v", ownCAPath, err)
				return
			}
			plan.createdOwnCA = resolved
		}
		plan.env[variableName] = ownCAPath
	}

	for _, variable := range caVariables {
		if value, set := s.env[variable.name]; set && value != "" {
			// Already pointed somewhere: add to that file rather than
			// redirecting the variable, which would discard whatever the
			// author put there.
			resolved, err := resolveInRoot(s.rootfs, value)
			if err != nil {
				logf("%s=%s could not be resolved inside the rootfs (%v); leaving it alone",
					variable.name, value, err)
				continue
			}
			// resolveInRoot now resolves a path whose directories do not exist
			// yet, which the anchors need but this does not: a bundle cannot be
			// under a directory that is not there, so a variable pointing at one
			// is the step's own and is left alone rather than mirrored.
			if _, err := os.Stat(filepath.Dir(resolved)); err != nil {
				logf("%s=%s names a directory that is not there; leaving it alone", variable.name, value)
				continue
			}
			if info, err := os.Stat(resolved); err == nil && info.IsDir() {
				logf("%s=%s is a directory, not a bundle; leaving it alone", variable.name, value)
				continue
			}
			plan.targets[resolved] = true
			continue
		}
		switch variable.whenUnset {
		case leaveUnset:
			if !store.found {
				setOwnCA(variable.name)
			}
		case pointAtSystemStore:
			if store.found {
				plan.env[variable.name] = store.containerPath
			} else {
				setOwnCA(variable.name)
			}
		case pointAtOwnCA:
			setOwnCA(variable.name)
		}
	}
	return plan
}

// injection is what a completed inject leaves to be undone once the step has
// exited: the mirrored directories to reconcile, the NSS database to check, the
// proxy-CA-only file to remove if one was written, the directories the
// injection created, and what the step's own layer is read back through.
type injection struct {
	rootfs       string
	ca           []byte
	binds        []*dirBind
	nss          *nssBind
	createdOwnCA string
	created      createdDirs
	// The step's layer as found when the injection began, kept rather than
	// recomputed at finish: a transient mount-table read failure there would
	// otherwise report no layer and commit the anchors' scattered copies unswept.
	// Empty when there was no overlay, in which case no anchors were placed.
	upper string
}

// finish diffs each mirrored directory against its pre-step state, writes back
// only what changed, and then takes the certificate out of whatever else of
// the step's layer holds a copy. A non-nil error means the layer may still
// carry one, and the build must not proceed with it.
//
// committing says whether there is a layer to read back at all. A step that
// exited non-zero has already failed the build, and BuildKit releases its
// mutable snapshot rather than committing it, so sweeping that snapshot would
// only slow a failed build down over a layer nothing will see.
func (in *injection) finish(committing bool) error {
	var firstErr error
	for _, b := range in.binds {
		if err := b.finish(); err != nil {
			logf("CA write-back failed for %s: %v", b.containerDir, err)
			if firstErr == nil {
				firstErr = err
			}
		}
		b.cleanup()
	}
	if in.nss != nil {
		// Logged once, by run, as the error that fails the step.
		if err := tolerateResidue(in.nss.finish()); err != nil && firstErr == nil {
			firstErr = err
		}
		in.nss.cleanup()
	}
	if in.createdOwnCA != "" {
		// Re-resolve and remove only the path that still lands where inject
		// wrote it, for the same reason removeCreatedDirs does: an ancestor the
		// step turned into an absolute symlink would otherwise send os.Remove
		// out of the rootfs.
		resolved, err := resolveInRoot(in.rootfs, ownCAPath)
		if err != nil || resolved != in.createdOwnCA {
			logf("not removing %s: it no longer resolves there (%v)", ownCAPath, err)
		} else if err := os.Remove(resolved); err != nil && !os.IsNotExist(err) {
			logf("cannot remove %s: %v", ownCAPath, err)
		}
	}
	if firstErr != nil || !committing {
		// Either way the snapshot is about to be released rather than
		// committed, so there is nothing for a sweep of it to establish.
		return firstErr
	}
	// After the write-back, whose own result lands in the layer.
	if err := tolerateResidue(stripLayer(in.rootfs, in.upper, in.ca)); err != nil {
		return err
	}
	// After the sweep, which has by now emptied and removed the anchor files,
	// so a directory the injection created is empty and can go.
	removeCreatedDirs(in.rootfs, in.created)
	return nil
}

// inject makes the step trust the proxy's CA, returning what finishes the
// injection once the step has exited.
func inject(bundle string, ca []byte) (*injection, error) {
	s, err := loadSpec(bundle)
	if err != nil {
		return nil, err
	}

	// A store's absence is not fatal: the store itself is simply not an
	// append target, and every otherwise-unset variable falls back to the
	// proxy-CA-only file instead (see the unsetBehaviour comment above).
	store, storeErr := findSystemStore(s.rootfs)
	if !store.found {
		logf("no system CA store in %s (%v); falling back to proxy-CA-only trust", s.rootfs, storeErr)
	}

	// Only when the step's layer can be read back afterwards: stripLayer is what
	// takes the copies a rebuild scatters back out, and without it the anchor is
	// not placed, leaving the engine the behaviour it had before (see
	// README.md#limitations).
	upper := upperDirOf(s.rootfs)
	var created createdDirs
	if upper != "" {
		created = placeAnchors(s.rootfs, ca)
	} else {
		logf("the step's layer is not an overlay upper directory; not placing anchors")
	}

	plan := planCATrust(s, ca, store)

	var binds []*dirBind
	groups := groupTargetsByBind(plan.targets, store)
	for _, hostDir := range bindDirsInOrder(groups, store) {
		names := groups[hostDir]
		custom := !(store.found && hostDir == store.dir())
		if b := prepareBind(s, bundle, hostDir, names, ca, custom, false); b != nil {
			binds = append(binds, b)
		}
	}

	// A JVM already in the base image reads only its own keystores, neither the
	// system store nor the CA-trust variables, so the CA goes into each too (see
	// jvmstore.go), grouped by directory so the ones a JDK keeps together share a
	// bind. A Debian JDK's cacerts is a symlink into the CA store directory, which
	// the store's own bind already mirrors and would shadow a second bind under;
	// there the CA goes into that mirror's copy of the keystore instead.
	keystoresByDir := map[string][]string{}
	for _, keystore := range findJVMKeystores(s) {
		dir := filepath.Dir(keystore)
		keystoresByDir[dir] = append(keystoresByDir[dir], filepath.Base(keystore))
	}
	for hostDir, names := range keystoresByDir {
		containerDir := containerPathOf(s.rootfs, hostDir)
		if covering := bindCovering(binds, containerDir); covering != nil {
			for _, name := range names {
				rel := filepath.Join(strings.TrimPrefix(containerDir, covering.containerDir), name)
				covering.coverKeystore(rel, ca)
			}
		} else if b := prepareBind(s, bundle, hostDir, names, ca, true, true); b != nil {
			binds = append(binds, b)
		}
	}

	// Chromium reads neither the store nor any variable, only an NSS database of
	// its own (see nssdb.go).
	nss, nssCreated := placeNSSDB(s, bundle)
	created.add(nssCreated.dirs)

	s.setEnv(plan.env)
	if err := s.save(); err != nil {
		logf("cannot update the process spec: %v", err)
	}

	return &injection{rootfs: s.rootfs, ca: ca, binds: binds, nss: nss, createdOwnCA: plan.createdOwnCA, created: created, upper: upper}, nil
}

// bindCovering returns the bind whose mirrored directory contains containerDir,
// or nil. A JVM keystore that resolves inside a directory a store bind already
// mirrors is folded into that bind rather than bound separately, which the
// store's mount would otherwise shadow.
func bindCovering(binds []*dirBind, containerDir string) *dirBind {
	for _, b := range binds {
		if containerDir == b.containerDir || strings.HasPrefix(containerDir, b.containerDir+"/") {
			return b
		}
	}
	return nil
}

// prepareBind mirrors hostDir, injects the CA into each named file (a PEM
// bundle, or a JVM keystore when keystore is set), binds the mirror over the
// step's view of the directory, and returns what finish reconciles. It returns
// nil, having logged why, when the directory cannot be bound.
func prepareBind(s *spec, bundle, hostDir string, names []string, ca []byte, custom, keystore bool) *dirBind {
	containerDir := containerPathOf(s.rootfs, hostDir)
	if containerDir == "/" {
		logf("refusing to bind the container root; skipping CA injection for %v", names)
		return nil
	}
	if s.mountConflicts(containerDir) {
		logf("a mount already covers %s; skipping CA injection there", containerDir)
		return nil
	}
	scratch, err := newScratchDir(bundle)
	if err != nil {
		logf("cannot create a scratch directory for %s: %v", containerDir, err)
		return nil
	}
	b := &dirBind{
		rootfs:       s.rootfs,
		hostDir:      hostDir,
		containerDir: containerDir,
		scratchDir:   scratch,
		bundleFiles:  names,
		custom:       custom,
		keystore:     keystore,
	}
	if err := b.prepare(ca); err != nil {
		logf("cannot prepare CA injection for %s: %v", containerDir, err)
		b.cleanup()
		return nil
	}
	s.addBindMount(containerDir, scratch)
	return b
}
