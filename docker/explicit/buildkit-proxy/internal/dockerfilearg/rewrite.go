package dockerfilearg

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"

	"github.com/moby/buildkit/frontend/dockerfile/command"
	"github.com/moby/buildkit/frontend/dockerfile/parser"
)

// Rewrite inserts "ARG <name>=<value>" immediately after every FROM
// instruction (each build stage needs its own declaration — an ARG declared
// before the first FROM is not automatically visible inside later stages),
// for each spec whose name is not already declared as an ARG anywhere in the
// file.
//
// It returns src unchanged (the same slice, no copy) whenever parsing fails
// or no injection is needed: interpreting a Dockerfile is buildkitd's job,
// not this proxy's, so a bug or an unusual construct here must never be able
// to break an otherwise-valid build. applied lists exactly the specs that
// were actually inserted (a subset of specs, in the same order), so callers
// can report what happened — it's nil whenever rewritten equals src.
func Rewrite(src []byte, specs []InjectArg) (rewritten []byte, applied []InjectArg) {
	if len(specs) == 0 {
		return src, nil
	}

	result, err := parser.Parse(bytes.NewReader(src))
	if err != nil || result == nil || result.AST == nil {
		return src, nil
	}

	declared := collectDeclaredArgNames(result.AST)
	pending := make([]InjectArg, 0, len(specs))
	for _, spec := range specs {
		if _, ok := declared[spec.Name]; !ok {
			pending = append(pending, spec)
		}
	}
	if len(pending) == 0 {
		return src, nil
	}

	fromEndLines := collectFromEndLines(result.AST)
	if len(fromEndLines) == 0 {
		return src, nil
	}

	return insertArgsAfterLines(src, fromEndLines, pending), pending
}

// collectDeclaredArgNames returns the set of ARG names declared anywhere in
// the file (across all stages), since "already specified" is checked
// file-wide rather than per-stage for simplicity.
func collectDeclaredArgNames(root *parser.Node) map[string]struct{} {
	names := make(map[string]struct{})
	for _, n := range root.Children {
		if !strings.EqualFold(n.Value, command.Arg) {
			continue
		}
		// ARG supports multiple space-separated NAME[=VALUE] pairs on one
		// line, represented as a Next-linked chain off the instruction node.
		for cur := n.Next; cur != nil; cur = cur.Next {
			name := cur.Value
			if idx := strings.IndexByte(name, '='); idx >= 0 {
				name = name[:idx]
			}
			names[name] = struct{}{}
		}
	}
	return names
}

// collectFromEndLines returns the 1-based source line each FROM instruction
// ends on, in file order, so callers can insert new lines right after it.
func collectFromEndLines(root *parser.Node) []int {
	var lines []int
	for _, n := range root.Children {
		if !strings.EqualFold(n.Value, command.From) {
			continue
		}
		lines = append(lines, n.EndLine)
	}
	return lines
}

// insertArgsAfterLines rebuilds src, inserting one "ARG NAME=VALUE" line per
// spec right after each 1-based line number in afterLines. The file's
// original line ending (LF vs CRLF, detected once for the whole file) is
// reused for both the untouched lines and the newly inserted ones.
func insertArgsAfterLines(src []byte, afterLines []int, specs []InjectArg) []byte {
	term := []byte("\n")
	if bytes.Contains(src, []byte("\r\n")) {
		term = []byte("\r\n")
	}

	targets := make(map[int]struct{}, len(afterLines))
	for _, l := range afterLines {
		targets[l] = struct{}{}
	}

	normalized := bytes.ReplaceAll(src, []byte("\r\n"), []byte("\n"))
	normalized = bytes.TrimSuffix(normalized, []byte("\n"))
	lines := bytes.Split(normalized, []byte("\n"))

	var out bytes.Buffer
	out.Grow(len(src) + len(specs)*len(afterLines)*32)
	for i, line := range lines {
		out.Write(line)
		out.Write(term)
		if _, ok := targets[i+1]; ok {
			for _, s := range specs {
				out.WriteString("ARG ")
				out.WriteString(s.Name)
				out.WriteByte('=')
				out.WriteString(s.Value)
				out.Write(term)
			}
		}
	}
	return out.Bytes()
}

// RewriteDir rewrites every regular file in dir except ones ending in
// ".dockerignore" (the only other file this local dir ever carries). There
// is ordinarily exactly one such file — the Dockerfile itself, under
// whichever name the client requested — but any candidate present is
// treated the same way; harmless even if more than one exists.
func RewriteDir(dir string, specs []InjectArg) (applied []InjectArg, err error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(strings.ToLower(e.Name()), ".dockerignore") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		src, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		rewritten, fileApplied := Rewrite(src, specs)
		if bytes.Equal(rewritten, src) {
			continue
		}
		if err := os.WriteFile(path, rewritten, 0o644); err != nil {
			return nil, err
		}
		applied = append(applied, fileApplied...)
	}
	return applied, nil
}
