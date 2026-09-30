package main

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// File the container is pointed at when a variable was not already set and the
// tool needs one of its own: bound read-only under the /dev tmpfs runc gives
// every container, so it never reaches a layer.
const ownCAPath = "/dev/buildcage-ca.pem"

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
	// Left unset, store or no store: the tool then reads its default trust.
	appendIfSet
)

var caVariables = []struct {
	name      string
	whenUnset unsetBehaviour
	// npm reads its npm_config_* variables whatever their case.
	anyCase bool
}{
	{"NODE_EXTRA_CA_CERTS", pointAtOwnCA, false},
	{"DENO_CERT", pointAtOwnCA, false},
	{"CURL_CA_BUNDLE", leaveUnset, false},
	{"REQUESTS_CA_BUNDLE", pointAtSystemStore, false},
	{"PIP_CERT", pointAtSystemStore, false},
	// OpenSSL's own override, replacing rather than adding to the default
	// search path: also read by Go's crypto/x509 on Unix, Ruby, and Rust's
	// rustls-native-certs. Not by GnuTLS, so Debian's wget and git go by the
	// store at their own compiled-in path instead.
	{"SSL_CERT_FILE", pointAtSystemStore, false},
	// Each replaces its tool's bundle. Base images carrying a company CA
	// often set them.
	{"GIT_SSL_CAINFO", appendIfSet, false},
	{"npm_config_cafile", appendIfSet, true},
	{"AWS_CA_BUNDLE", appendIfSet, false},
	{"CARGO_HTTP_CAINFO", appendIfSet, false},
	{"BUNDLE_SSL_CA_CERT", appendIfSet, false},
}

// caPlan is what the variable pass settled on: the files the CA has to be
// appended to, the variables to add to the process spec, and the scratch
// directory holding the proxy-CA-only file, if any variable needed one.
type caPlan struct {
	targets  map[string]bool
	env      map[string]string
	ownCADir string
}

// planCATrust walks caVariables and decides, per variable, whether the CA goes
// into the file it already names, whether to point it at the system store, or
// whether to give it a file holding only this CA. See the unsetBehaviour
// comment above for why each variable falls where it does.
func planCATrust(s *spec, bundle string, ca []byte, store systemStore) caPlan {
	// Every bundle the CA has to go into, keyed by resolved path so a file
	// named by two variables is only written once.
	plan := caPlan{targets: map[string]bool{}, env: map[string]string{}}
	if store.found {
		plan.targets[store.hostPath] = true
	}

	// setOwnCA points variableName at ownCAPath, binding it once and sharing
	// it across every variable that falls back to it.
	setOwnCA := func(variableName string) {
		if plan.ownCADir == "" {
			if s.mountedWithin(ownCAPath) {
				logf("a mount already covers %s; not setting %s", ownCAPath, variableName)
				return
			}
			dir, err := newScratchDir(bundle)
			file := filepath.Join(dir, "ca.pem")
			if err == nil {
				err = os.WriteFile(file, ca, 0o644)
			}
			if err != nil {
				removeScratchDir(dir)
				logf("cannot write %s: %v", ownCAPath, err)
				return
			}
			s.addReadOnlyBindMount(ownCAPath, file)
			plan.ownCADir = dir
		}
		plan.env[variableName] = ownCAPath
	}

	// appendTo adds the file a variable already names to the targets. A
	// relative value is read from the step's working directory, the best
	// guess at where the tool starts.
	appendTo := func(name, value string) {
		path := value
		if !filepath.IsAbs(path) {
			path = filepath.Join(s.processCwd(), path)
		}
		resolved, err := resolveInRoot(s.rootfs, path)
		if err != nil {
			logf("%s=%s could not be resolved inside the rootfs (%v); leaving it alone", name, value, err)
			return
		}
		// resolveInRoot accepts a path whose directories do not exist yet, for
		// the anchors. A bundle cannot be under a missing directory, so a
		// variable pointing at one is the step's own and is left alone.
		if _, err := os.Stat(filepath.Dir(resolved)); err != nil {
			logf("%s=%s names a directory that is not there; leaving it alone", name, value)
			return
		}
		if info, err := os.Stat(resolved); err == nil && info.IsDir() {
			logf("%s=%s is a directory, not a bundle; leaving it alone", name, value)
			return
		}
		plan.targets[resolved] = true
	}

	for _, variable := range caVariables {
		// Already pointed somewhere: add to that file rather than redirecting
		// the variable, which would discard whatever the author put there.
		set := false
		for name, value := range s.env {
			if value != "" && (name == variable.name || variable.anyCase && strings.EqualFold(name, variable.name)) {
				appendTo(name, value)
				set = true
			}
		}
		if set {
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
// exited: the mirrored directories to reconcile, the scratch directory of the
// proxy-CA-only file if one was bound, the directories the injection created,
// and what the step's own layer is read back through.
type injection struct {
	rootfs   string
	ca       []byte
	binds    []*dirBind
	ownCADir string
	created  createdDirs
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
// The layer is read back whatever the step exited with: BuildKit commits it
// for a non-zero exit the LLB's ValidExitCodes allows, and keeps a failed
// step's layer for debugging. A layer that cannot be read back counts as
// residue.
func (in *injection) finish() error {
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
	if in.ownCADir != "" {
		removeScratchDir(in.ownCADir)
	}
	// After the write-back, whose own result lands in the layer.
	sweepErr := tolerateResidue(stripLayer(in.rootfs, in.upper, in.ca, in.nssAppended()))
	// After the sweep, which has by now emptied and removed the anchor files,
	// so a directory the injection created is empty and can go.
	removeCreatedDirs(in.rootfs, in.created)
	if firstErr != nil {
		if sweepErr != nil {
			logf("%v", sweepErr)
		}
		return firstErr
	}
	return sweepErr
}

// nssAppended is what the NSS mirror's pkcs11.txt gained, if there is one.
func (in *injection) nssAppended() []byte {
	for _, b := range in.binds {
		if b.nssAppended != nil {
			return b.nssAppended
		}
	}
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
		logf("no overlay upper directory found for the step's layer; not placing anchors")
	}

	plan := planCATrust(s, bundle, ca, store)

	binds := bindTargets(s, bundle, groupTargetsByBind(plan.targets, store), ca, store)

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
		} else if b := prepareBind(s, bundle, hostDir, names, ca, customDirLimit, true); b != nil {
			binds = append(binds, b)
		}
	}

	// Chromium reads neither the store nor any variable (see nssdb.go).
	nssMirror, nssCreated := placeNSSDB(s, bundle, ca)
	if nssMirror != nil {
		binds = append(binds, nssMirror)
	}
	created.add(nssCreated.dirs)

	s.setEnv(plan.env)
	if err := s.save(); err != nil {
		logf("cannot update the process spec: %v", err)
	}

	return &injection{rootfs: s.rootfs, ca: ca, binds: binds, ownCADir: plan.ownCADir, created: created, upper: upper}, nil
}

// bindTargets binds each group of CA targets, nested groups folded into the
// outermost. An outer directory that cannot be bound is dropped, its own
// targets going without the CA, and the groups folded into it are bound the
// same way without it.
func bindTargets(s *spec, bundle string, groups map[string][]string, ca []byte, store systemStore) []*dirBind {
	var binds []*dirBind
	merged, parts := mergeNestedGroups(groups)
	for _, hostDir := range bindDirsInOrder(merged, store) {
		if b := prepareBind(s, bundle, hostDir, merged[hostDir], ca, bindLimit(hostDir, parts[hostDir], store), false); b != nil {
			binds = append(binds, b)
			continue
		}
		inner := map[string][]string{}
		for _, dir := range parts[hostDir] {
			if dir != hostDir {
				inner[dir] = groups[dir]
			}
		}
		if len(inner) > 0 {
			logf("binding the CA targets under %s without it", containerPathOf(s.rootfs, hostDir))
			binds = append(binds, bindTargets(s, bundle, inner, ca, store)...)
		}
	}
	return binds
}

// bindLimit is what prepare holds hostDir to: nothing for the store directory
// alone, the store's limits for a directory the store was folded into, and the
// custom ones otherwise.
func bindLimit(hostDir string, parts []string, store systemStore) mirrorLimit {
	if !store.found {
		return customDirLimit
	}
	if hostDir == store.dir() {
		return mirrorLimit{}
	}
	if slices.Contains(parts, store.dir()) {
		return storeDirLimit
	}
	return customDirLimit
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
func prepareBind(s *spec, bundle, hostDir string, names []string, ca []byte, limit mirrorLimit, keystore bool) *dirBind {
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
		limit:        limit,
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
