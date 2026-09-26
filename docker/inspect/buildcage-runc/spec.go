package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// spec is the step's OCI runtime spec. It keeps the decoded JSON as-is rather
// than a typed struct so that every field BuildKit wrote survives the
// round-trip, including the ones this wrapper has no opinion about.
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
	// UseNumber so a number past 2^53 (an RLIM_INFINITY ulimit, a seccomp
	// argument) survives the load/save round trip as the text BuildKit wrote
	// rather than rounding through float64, which runc can reject or misapply.
	// The wrapper reads no number itself, so json.Number costs nothing here.
	var raw map[string]any
	dec := json.NewDecoder(bytes.NewReader(content))
	dec.UseNumber()
	if err := dec.Decode(&raw); err != nil {
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

// processUser reads the numeric uid and gid BuildKit resolved USER into; a spec
// naming none runs as root.
func (s *spec) processUser() (uid, gid int) {
	proc, _ := s.raw["process"].(map[string]any)
	user, _ := proc["user"].(map[string]any)
	return specInt(user["uid"]), specInt(user["gid"])
}

// specInt reads a number loadSpec kept as json.Number, or 0 when there is none.
func specInt(v any) int {
	n, ok := v.(json.Number)
	if !ok {
		return 0
	}
	i, err := n.Int64()
	if err != nil {
		return 0
	}
	return int(i)
}

// setEnv adds variables to the process spec in memory; call save to persist.
func (s *spec) setEnv(extra map[string]string) {
	if len(extra) == 0 {
		return
	}
	proc, ok := s.raw["process"].(map[string]any)
	if !ok {
		return
	}
	env, _ := proc["env"].([]any)
	for key, value := range extra {
		// Appending is enough: runc de-duplicates and keeps the last entry.
		env = append(env, key+"="+value)
	}
	proc["env"] = env
	s.raw["process"] = proc
}

func (s *spec) save() error {
	out, err := json.Marshal(s.raw)
	// Untested by design: s.raw came out of json.Unmarshal and is only ever
	// added to with strings and maps, so it holds nothing Marshal can refuse.
	//coverage:ignore start
	if err != nil {
		return err
	}
	//coverage:ignore stop
	return os.WriteFile(s.path, out, 0o644)
}

// mountConflicts reports whether a mount already in the spec sits at, above or
// below dest. Destinations are compared cleaned: a step's --mount target is
// passed through as written, and /etc//ssl/certs names the same directory runc
// mounts over.
func (s *spec) mountConflicts(dest string) bool {
	dest = filepath.Clean(dest)
	mounts, _ := s.raw["mounts"].([]any)
	for _, m := range mounts {
		entry, ok := m.(map[string]any)
		if !ok {
			continue
		}
		existing, _ := entry["destination"].(string)
		if existing == "" {
			continue
		}
		existing = filepath.Clean(existing)
		if pathWithin(dest, existing) || pathWithin(existing, dest) {
			return true
		}
	}
	return false
}

// pathWithin reports whether the clean path p is dir or lies under it.
func pathWithin(p, dir string) bool {
	return p == dir || strings.HasPrefix(p, strings.TrimSuffix(dir, "/")+"/")
}

func (s *spec) addBindMount(dest, src string) {
	mounts, _ := s.raw["mounts"].([]any)
	s.raw["mounts"] = append(mounts, map[string]any{
		"destination": dest,
		"type":        "bind",
		"source":      src,
		"options":     []any{"rbind", "rw"},
	})
}
