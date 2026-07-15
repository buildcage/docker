package dockerfilearg

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRewriteInjectsAfterSingleFrom(t *testing.T) {
	src := []byte("FROM alpine\nRUN echo hi\n")
	specs := []InjectArg{{Name: "NODE_USE_SYSTEM_CA", Value: "1"}}

	got, applied := Rewrite(src, specs)
	want := "FROM alpine\nARG NODE_USE_SYSTEM_CA=1\nRUN echo hi\n"
	if string(got) != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
	if len(applied) != 1 || applied[0].Name != "NODE_USE_SYSTEM_CA" {
		t.Fatalf("expected applied to report the injected spec, got %+v", applied)
	}
}

func TestRewriteInjectsAfterEveryStage(t *testing.T) {
	src := []byte("FROM golang AS build\nRUN go build\nFROM alpine AS final\nCOPY --from=build /out /out\n")
	specs := []InjectArg{{Name: "NODE_USE_SYSTEM_CA", Value: "1"}}

	got, applied := Rewrite(src, specs)
	want := "FROM golang AS build\nARG NODE_USE_SYSTEM_CA=1\nRUN go build\nFROM alpine AS final\nARG NODE_USE_SYSTEM_CA=1\nCOPY --from=build /out /out\n"
	if string(got) != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
	if len(applied) != 1 || applied[0].Name != "NODE_USE_SYSTEM_CA" {
		t.Fatalf("expected applied to report the injected spec once (per-spec, not per-stage), got %+v", applied)
	}
}

func TestRewriteSkipsWhenAlreadyDeclaredGlobally(t *testing.T) {
	// Declared only in stage 2; stage 1 must still not get an injection,
	// since "already specified" is checked file-wide, not per-stage.
	src := []byte("FROM golang AS build\nRUN go build\nFROM alpine AS final\nARG NODE_USE_SYSTEM_CA=1\nRUN echo hi\n")
	specs := []InjectArg{{Name: "NODE_USE_SYSTEM_CA", Value: "1"}}

	got, applied := Rewrite(src, specs)
	if string(got) != string(src) {
		t.Fatalf("expected no changes when ARG is declared anywhere in the file, got:\n%s", got)
	}
	if len(applied) != 0 {
		t.Fatalf("expected no applied specs, got %+v", applied)
	}
}

func TestRewriteInjectsOnlyUndeclaredSpecs(t *testing.T) {
	src := []byte("FROM alpine\nARG NODE_USE_SYSTEM_CA=1\nRUN echo hi\n")
	specs := []InjectArg{
		{Name: "NODE_USE_SYSTEM_CA", Value: "1"},
		{Name: "SOME_OTHER_FLAG", Value: "1"},
	}

	// Injection always happens right after FROM's own line, ahead of any
	// pre-existing lines that followed it (including the pre-existing
	// NODE_USE_SYSTEM_CA declaration on line 2 here).
	got, applied := Rewrite(src, specs)
	want := "FROM alpine\nARG SOME_OTHER_FLAG=1\nARG NODE_USE_SYSTEM_CA=1\nRUN echo hi\n"
	if string(got) != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
	if len(applied) != 1 || applied[0].Name != "SOME_OTHER_FLAG" {
		t.Fatalf("expected only the undeclared spec reported as applied, got %+v", applied)
	}
}

func TestRewriteIsCaseSensitiveForArgNames(t *testing.T) {
	// A lowercase declaration must not suppress injection of the (different,
	// case-sensitive) uppercase spec name.
	src := []byte("FROM alpine\nARG node_use_system_ca=1\nRUN echo hi\n")
	specs := []InjectArg{{Name: "NODE_USE_SYSTEM_CA", Value: "1"}}

	got, applied := Rewrite(src, specs)
	want := "FROM alpine\nARG NODE_USE_SYSTEM_CA=1\nARG node_use_system_ca=1\nRUN echo hi\n"
	if string(got) != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
	if len(applied) != 1 || applied[0].Name != "NODE_USE_SYSTEM_CA" {
		t.Fatalf("expected the spec reported as applied, got %+v", applied)
	}
}

func TestRewritePreservesCRLF(t *testing.T) {
	src := []byte("FROM alpine\r\nRUN echo hi\r\n")
	specs := []InjectArg{{Name: "NODE_USE_SYSTEM_CA", Value: "1"}}

	got, _ := Rewrite(src, specs)
	want := "FROM alpine\r\nARG NODE_USE_SYSTEM_CA=1\r\nRUN echo hi\r\n"
	if string(got) != want {
		t.Fatalf("got:\n%q\nwant:\n%q", got, want)
	}
	if strings.Count(string(got), "\r\n") != strings.Count(string(got), "\n") {
		t.Fatalf("expected every newline to be part of a CRLF pair, got:\n%q", got)
	}
}

func TestRewriteReturnsOriginalOnParseError(t *testing.T) {
	// An empty file fails to parse (no instructions at all); the function
	// must fail open rather than panic or fabricate content.
	src := []byte("")
	specs := []InjectArg{{Name: "NODE_USE_SYSTEM_CA", Value: "1"}}

	got, applied := Rewrite(src, specs)
	if len(got) != 0 {
		t.Fatalf("expected unchanged (empty) output on parse failure, got:\n%s", got)
	}
	if applied != nil {
		t.Fatalf("expected no applied specs on parse failure, got %+v", applied)
	}
}

func TestRewriteNoSpecsIsNoop(t *testing.T) {
	src := []byte("FROM alpine\nRUN echo hi\n")

	got, applied := Rewrite(src, nil)
	if string(got) != string(src) {
		t.Fatalf("expected unchanged output with no specs, got:\n%s", got)
	}
	if applied != nil {
		t.Fatalf("expected no applied specs, got %+v", applied)
	}
}

func TestRewriteNoFromIsNoop(t *testing.T) {
	// Not a realistic Dockerfile, but must not panic or fabricate a FROM.
	src := []byte("# just a comment\n")
	specs := []InjectArg{{Name: "NODE_USE_SYSTEM_CA", Value: "1"}}

	got, applied := Rewrite(src, specs)
	if string(got) != string(src) {
		t.Fatalf("expected unchanged output with no FROM instruction, got:\n%s", got)
	}
	if applied != nil {
		t.Fatalf("expected no applied specs, got %+v", applied)
	}
}

func TestRewriteDirRewritesOnlyTheDockerfile(t *testing.T) {
	dir := t.TempDir()
	dockerfilePath := filepath.Join(dir, "Dockerfile")
	ignorePath := filepath.Join(dir, "Dockerfile.dockerignore")

	if err := os.WriteFile(dockerfilePath, []byte("FROM alpine\nRUN echo hi\n"), 0o644); err != nil {
		t.Fatalf("writing Dockerfile: %v", err)
	}
	if err := os.WriteFile(ignorePath, []byte("*.log\n"), 0o644); err != nil {
		t.Fatalf("writing .dockerignore: %v", err)
	}

	specs := []InjectArg{{Name: "NODE_USE_SYSTEM_CA", Value: "1"}}
	applied, err := RewriteDir(dir, specs)
	if err != nil {
		t.Fatalf("RewriteDir: %v", err)
	}
	if len(applied) != 1 || applied[0].Name != "NODE_USE_SYSTEM_CA" {
		t.Fatalf("expected the injected spec reported as applied, got %+v", applied)
	}

	gotDockerfile, err := os.ReadFile(dockerfilePath)
	if err != nil {
		t.Fatalf("reading rewritten Dockerfile: %v", err)
	}
	wantDockerfile := "FROM alpine\nARG NODE_USE_SYSTEM_CA=1\nRUN echo hi\n"
	if string(gotDockerfile) != wantDockerfile {
		t.Fatalf("Dockerfile not rewritten as expected: got:\n%s\nwant:\n%s", gotDockerfile, wantDockerfile)
	}

	gotIgnore, err := os.ReadFile(ignorePath)
	if err != nil {
		t.Fatalf("reading .dockerignore: %v", err)
	}
	if string(gotIgnore) != "*.log\n" {
		t.Fatalf(".dockerignore must be left untouched, got:\n%s", gotIgnore)
	}
}

func TestRewriteDirNoopWhenAlreadyDeclared(t *testing.T) {
	dir := t.TempDir()
	dockerfilePath := filepath.Join(dir, "Dockerfile")
	original := []byte("FROM alpine\nARG NODE_USE_SYSTEM_CA=1\nRUN echo hi\n")
	if err := os.WriteFile(dockerfilePath, original, 0o644); err != nil {
		t.Fatalf("writing Dockerfile: %v", err)
	}

	before, err := os.Stat(dockerfilePath)
	if err != nil {
		t.Fatalf("stat before rewrite: %v", err)
	}

	specs := []InjectArg{{Name: "NODE_USE_SYSTEM_CA", Value: "1"}}
	applied, err := RewriteDir(dir, specs)
	if err != nil {
		t.Fatalf("RewriteDir: %v", err)
	}
	if len(applied) != 0 {
		t.Fatalf("expected no applied specs, got %+v", applied)
	}

	got, err := os.ReadFile(dockerfilePath)
	if err != nil {
		t.Fatalf("reading Dockerfile: %v", err)
	}
	if string(got) != string(original) {
		t.Fatalf("expected no change, got:\n%s", got)
	}
	after, err := os.Stat(dockerfilePath)
	if err != nil {
		t.Fatalf("stat after rewrite: %v", err)
	}
	if before.ModTime() != after.ModTime() {
		t.Fatal("expected the file to not be rewritten (mtime unchanged) when no injection is needed")
	}
}
