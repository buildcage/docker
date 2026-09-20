package main

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// File the container is pointed at when a variable was not already set and the
// tool needs one of its own. Removed again when the step ends.
const ownCAPath = "/etc/buildcage-ca.pem"

// How each variable is treated when the image or Dockerfile did not set it.
//
// The distinction between the kinds is what the variable means to the tool
// that reads it. NODE_EXTRA_CA_CERTS and DENO_CERT are added to a built-in
// set, so pointing them at a file holding only this CA leaves everything else
// trusted. The others replace the bundle outright, so they are pointed at the
// system store, which by then carries the CA alongside whatever roots the
// image shipped. They fall back to the same CA-only file only when there is no
// store to point at, which takes every candidate path failing to be written
// (see ensureSystemStore). That covers ordinary HTTP(S) traffic, since inspect
// re-signs all of it with this same CA, but not a passthrough connection's
// real certificate; see README.md#limitations for which requests that leaves
// unable to verify.
type unsetBehaviour int

const (
	// Point at a file holding only this CA, added to the tool's own set.
	pointAtOwnCA unsetBehaviour = iota
	// Point at the system store, which replaces the tool's bundle.
	pointAtSystemStore
)

var caVariables = []struct {
	name      string
	whenUnset unsetBehaviour
}{
	{"NODE_EXTRA_CA_CERTS", pointAtOwnCA},
	{"DENO_CERT", pointAtOwnCA},
	// curl finds the store on its own, so this only decides what it reads
	// when there is none: the CA-only file rather than nothing.
	{"CURL_CA_BUNDLE", pointAtSystemStore},
	{"REQUESTS_CA_BUNDLE", pointAtSystemStore},
	{"PIP_CERT", pointAtSystemStore},
	// OpenSSL's own override, replacing rather than adding to the default
	// search path: also read by Go's crypto/x509 on Unix, Ruby, and Rust's
	// rustls-native-certs. Not by GnuTLS, so Debian's wget goes by the store
	// at its own compiled-in path instead.
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
	// Only a store the image shipped: one this wrapper wrote already holds
	// the certificate.
	if store.shipped {
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
			plan.targets[resolved] = true
			continue
		}
		switch variable.whenUnset {
		case pointAtSystemStore:
			if store.available() {
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
// exited: the mirrored directories to reconcile, the proxy-CA-only file to
// remove if one was written, and whatever the injection had to create in the
// rootfs to give the step a store.
type injection struct {
	binds        []*dirBind
	rootfs       string
	ca           []byte
	createdOwnCA string
	created      createdPaths
}

// finish diffs each mirrored directory against its pre-step state and writes
// back only what changed. A non-nil error means the write-back itself failed
// and the build must not proceed with a possibly half-written layer.
func (in *injection) finish() error {
	// What the injection wrote goes first, so the links a rebuilt bundle left
	// beside itself resolve to something already gone by the time the
	// mirrors are reconciled.
	removed := map[string]bool{}
	in.undoCreated(removed)

	var firstErr error
	for _, b := range in.binds {
		if err := b.finish(removed); err != nil {
			logf("CA write-back failed for %s: %v", b.containerDir, err)
			if firstErr == nil {
				firstErr = err
			}
		}
		b.cleanup()
	}
	if in.createdOwnCA != "" {
		if err := os.Remove(in.createdOwnCA); err != nil && !os.IsNotExist(err) {
			logf("cannot remove %s: %v", in.createdOwnCA, err)
		}
	}
	return firstErr
}

// undoCreated takes back the store and the anchors the injection wrote. A
// step that installed the distribution's own ca-certificates over them leaves
// a real bundle behind, which is the step's to keep: only the certificate
// goes, and whatever held nothing else with it.
func (in *injection) undoCreated(removed map[string]bool) {
	report := func(path string, err error) {
		if err != nil {
			logf("cannot take %s back out: %v", path, err)
		}
	}
	dirs := in.created.fileDirs()
	for _, dir := range dirs {
		report(dir, stripCADir(dir, in.ca, removed))
	}
	// A second pass, so every directory has given up its certificates before
	// any link into one of them is judged.
	for _, dir := range dirs {
		report(dir, dropLinksTo(in.rootfs, dir, removed))
	}
	for _, dir := range in.created.removalOrder() {
		err := os.Remove(dir)
		// Gone, or holding something the step put there: either way the
		// injection has nothing left of its own here.
		if os.IsNotExist(err) || errors.Is(err, syscall.ENOTEMPTY) {
			err = nil
		}
		report(dir, err)
	}
}

// inject makes the step trust the proxy's CA, returning what finishes the
// injection once the step has exited.
func inject(bundle string, ca []byte) (*injection, error) {
	s, err := loadSpec(bundle)
	if err != nil {
		return nil, err
	}

	store, created := ensureSystemStore(s.rootfs, ca)
	anchors := placeAnchors(s.rootfs, ca)
	created.files = append(created.files, anchors.files...)
	created.dirs = append(created.dirs, anchors.dirs...)

	plan := planCATrust(s, ca, store)

	var binds []*dirBind
	for hostDir, files := range groupTargetsByDir(plan.targets) {
		containerDir := containerPathOf(s.rootfs, hostDir)
		if containerDir == "/" {
			logf("refusing to bind the container root; skipping CA injection for %v", files)
			continue
		}
		if s.mountConflicts(containerDir) {
			logf("a mount already covers %s; skipping CA injection there", containerDir)
			continue
		}

		scratch, err := newScratchDir(bundle)
		if err != nil {
			logf("cannot create a scratch directory for %s: %v", containerDir, err)
			continue
		}
		names := make([]string, len(files))
		for i, f := range files {
			names[i] = filepath.Base(f)
		}
		b := &dirBind{
			rootfs:       s.rootfs,
			hostDir:      hostDir,
			containerDir: containerDir,
			scratchDir:   scratch,
			bundleFiles:  names,
			custom:       !(store.shipped && hostDir == store.dir()),
		}
		if err := b.prepare(ca); err != nil {
			logf("cannot prepare CA injection for %s: %v", containerDir, err)
			b.cleanup()
			continue
		}
		s.addBindMount(containerDir, scratch)
		binds = append(binds, b)
	}

	s.setEnv(plan.env)
	if err := s.save(); err != nil {
		logf("cannot update the process spec: %v", err)
	}

	return &injection{
		binds:        binds,
		rootfs:       s.rootfs,
		ca:           ca,
		createdOwnCA: plan.createdOwnCA,
		created:      created,
	}, nil
}
