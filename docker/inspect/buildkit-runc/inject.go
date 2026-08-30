package main

import (
	"encoding/json"
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
// connection's real certificate — see "No system CA store" in
// docs/inspect-engine.md for exactly which requests that leaves unable to
// verify.
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
	// search path: also read by Go's crypto/x509 on Unix, Ruby, wget, and
	// Rust's rustls-native-certs.
	{"SSL_CERT_FILE", pointAtSystemStore},
}

type spec struct {
	raw    map[string]any
	path   string
	rootfs string
	env    map[string]string
}

func loadSpec(bundle string) (*spec, error) {
	path := filepath.Join(bundle, "config.json")
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raw map[string]any
	if err := json.Unmarshal(content, &raw); err != nil {
		return nil, err
	}

	rootfs := "rootfs"
	if root, ok := raw["root"].(map[string]any); ok {
		if p, ok := root["path"].(string); ok && p != "" {
			rootfs = p
		}
	}
	if !filepath.IsAbs(rootfs) {
		rootfs = filepath.Join(bundle, rootfs)
	}

	s := &spec{raw: raw, path: path, rootfs: rootfs, env: map[string]string{}}
	if proc, ok := raw["process"].(map[string]any); ok {
		if env, ok := proc["env"].([]any); ok {
			for _, entry := range env {
				kv, ok := entry.(string)
				if !ok {
					continue
				}
				// runc keeps the last of a repeated key, so later wins here too.
				if i := strings.IndexByte(kv, '='); i > 0 {
					s.env[kv[:i]] = kv[i+1:]
				}
			}
		}
	}
	return s, nil
}

// setEnv adds variables to the process spec and writes it back.
func (s *spec) setEnv(extra map[string]string) error {
	if len(extra) == 0 {
		return nil
	}
	proc, ok := s.raw["process"].(map[string]any)
	if !ok {
		return nil
	}
	env, _ := proc["env"].([]any)
	for key, value := range extra {
		// Appending is enough: runc de-duplicates and keeps the last entry.
		env = append(env, key+"="+value)
	}
	proc["env"] = env
	s.raw["process"] = proc
	out, err := json.Marshal(s.raw)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, out, 0o644)
}

// inject makes the step trust the proxy's CA and returns the undo.
func inject(bundle string, ca []byte) (func(), error) {
	s, err := loadSpec(bundle)
	if err != nil {
		return nil, err
	}

	// A store's absence is not fatal: the store itself is simply not an
	// append target, and every otherwise-unset variable falls back to the
	// proxy-CA-only file instead (see the unsetBehaviour comment above).
	systemStore, systemStorePath, storeErr := findSystemStore(s.rootfs)
	haveSystemStore := storeErr == nil
	if !haveSystemStore {
		logf("no system CA store in %s (%v); falling back to proxy-CA-only trust", s.rootfs, storeErr)
	}

	// Every bundle the CA has to go into, keyed by resolved path so a file
	// named by two variables is only written once.
	targets := map[string]bool{}
	if haveSystemStore {
		targets[systemStore] = true
	}
	newEnv := map[string]string{}
	createdOwnCA := ""

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
		if createdOwnCA == "" {
			if _, err := os.Stat(resolved); err == nil {
				logf("%s already exists; not setting %s", ownCAPath, variableName)
				return
			}
			if err := os.WriteFile(resolved, ca, 0o644); err != nil {
				logf("cannot write %s: %v", ownCAPath, err)
				return
			}
			createdOwnCA = resolved
		}
		newEnv[variableName] = ownCAPath
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
			targets[resolved] = true
			continue
		}
		switch variable.whenUnset {
		case leaveUnset:
			if !haveSystemStore {
				setOwnCA(variable.name)
			}
		case pointAtSystemStore:
			if haveSystemStore {
				newEnv[variable.name] = systemStorePath
			} else {
				setOwnCA(variable.name)
			}
		case pointAtOwnCA:
			setOwnCA(variable.name)
		}
	}

	appended := make([]string, 0, len(targets))
	for target := range targets {
		if err := appendCA(target, ca); err != nil {
			logf("cannot add the CA to %s: %v", target, err)
			continue
		}
		appended = append(appended, target)
	}

	if err := s.setEnv(newEnv); err != nil {
		logf("cannot update the process environment: %v", err)
	}

	return func() {
		// The environment lives only in config.json, which is not part of the
		// snapshot, so only the files have to be undone.
		for _, target := range appended {
			if err := removeCA(target); err != nil {
				logf("cannot remove the CA from %s: %v", target, err)
			}
		}
		if createdOwnCA != "" {
			if err := os.Remove(createdOwnCA); err != nil && !os.IsNotExist(err) {
				logf("cannot remove %s: %v", createdOwnCA, err)
			}
		}
	}, nil
}
