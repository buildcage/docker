package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// useTempLog points logf and the dump at a file the test owns, since a test
// process usually can't write the real host path.
func useTempLog(t *testing.T) {
	t.Helper()
	old := logFile
	logFile = filepath.Join(t.TempDir(), "runc.log")
	t.Cleanup(func() { logFile = old })
}

// One file carries every step of every build, so a failure must report the
// failing step's lines and no one else's.
func TestDumpLogSinceCoversOnlyThisInvocation(t *testing.T) {
	useTempLog(t)
	logf("an earlier step on this builder")
	from := logSize()
	logf("CA write-back failed for %s: %v", "/etc/ssl/certs", "rsync exit status 23")

	var out strings.Builder
	dumpLogSince(&out, from)

	got := out.String()
	if strings.Contains(got, "an earlier step") {
		t.Errorf("the dump reached back into an earlier step:\n%s", got)
	}
	if !strings.Contains(got, "rsync exit status 23") {
		t.Errorf("the dump left out this step's own failure:\n%s", got)
	}
	if !strings.Contains(got, logFile) {
		t.Errorf("the dump does not say where the lines came from:\n%s", got)
	}
}

// Nothing to report means no output at all, not a bare header.
func TestDumpLogSinceWithNothingToReport(t *testing.T) {
	useTempLog(t)

	var out strings.Builder
	dumpLogSince(&out, logSize())
	if out.String() != "" {
		t.Errorf("expected no output before the log exists, got %q", out.String())
	}

	logf("an earlier step on this builder")
	out.Reset()
	dumpLogSince(&out, logSize())
	if out.String() != "" {
		t.Errorf("a step that logged nothing should report nothing, got %q", out.String())
	}
}

func TestLogSizeIgnoresAMissingLog(t *testing.T) {
	useTempLog(t)
	if got := logSize(); got != 0 {
		t.Errorf("logSize() = %d for a log that does not exist yet, want 0", got)
	}
	logf("first line")
	info, err := os.Stat(logFile)
	if err != nil {
		t.Fatal(err)
	}
	if got := logSize(); got != info.Size() {
		t.Errorf("logSize() = %d, want %d", got, info.Size())
	}
}
