// Command buildcage-runc stands in front of BuildKit's own buildkit-runc for
// the `inspect` engine.
//
// BuildKit resolves its OCI worker binary with exec.LookPath and hands it to
// go-runc, and `[worker.oci] binary` in buildkitd.toml names which one. That
// lets buildcage sit in front of every RUN step without forking BuildKit: for
// the subcommands that carry a bundle it makes the step trust the proxy's CA,
// runs the real runc, then undoes that before BuildKit commits the snapshot.
//
// The engine intercepts at the network level, so nothing here injects proxy
// variables; a step needs no proxy configuration at all.
//
// Only files are undone. The environment is added to the OCI process spec,
// which BuildKit does not carry into the image config, so it cannot reach a
// layer in the first place.
package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
)

// These are vars, not consts, so tests can point them at files they own
// instead of the real host paths.
var (
	realRunc = "/usr/bin/buildkit-runc"
	caFile   = "/opt/buildcage/ca.pem"
	logFile  = "/var/log/buildcage/runc.log"
)

// One file carries every step of every build, and BuildKit runs steps
// concurrently: an offset into it bounds nothing, and a line in it says nothing
// about which step wrote it.
var (
	logTag = fmt.Sprintf("[pid %d]", os.Getpid())
	ownLog strings.Builder
)

// Subcommands runc accepts. Only those carrying a bundle are acted on; the
// rest are passed through untouched.
var subcommands = map[string]bool{
	"run": true, "create": true, "start": true, "exec": true,
	"delete": true, "kill": true, "state": true, "ps": true,
	"pause": true, "resume": true, "list": true, "spec": true,
	"events": true, "update": true, "checkpoint": true, "restore": true,
}

func logf(format string, a ...any) {
	line := logTag + " " + fmt.Sprintf(format, a...) + "\n"
	ownLog.WriteString(line)

	_ = os.MkdirAll(filepath.Dir(logFile), 0o755)
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = io.WriteString(f, line)
}

// Nothing collects the log from the builder container, so without this a
// failure reaches the build log as a bare non-zero exit.
func dumpOwnLog(w io.Writer) {
	if ownLog.Len() == 0 {
		return
	}
	fmt.Fprintf(w, "buildcage: %s for this step:\n", logFile)
	_, _ = io.WriteString(w, ownLog.String())
}

// parseArgs returns the runc subcommand and the --bundle value, if any.
func parseArgs(args []string) (sub, bundle string) {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--bundle" || arg == "-b" {
			if i+1 < len(args) {
				bundle = args[i+1]
				i++
			}
			continue
		}
		if value, ok := strings.CutPrefix(arg, "--bundle="); ok {
			bundle = value
			continue
		}
		if sub == "" && !strings.HasPrefix(arg, "-") && subcommands[arg] {
			sub = arg
		}
	}
	return sub, bundle
}

// Untested by design: os.Exit, which a test can never be inside. Every
// decision it makes is in run, which returns the code instead.
//
//coverage:ignore start
func main() {
	os.Exit(run(os.Args[1:]))
}

//coverage:ignore stop

// run wraps one runc invocation and returns the code to exit with, so a test
// can observe both that code and what the write-back does to it.
func run(args []string) int {
	sub, bundle := parseArgs(args)
	if bundle != "" {
		logTag = "[" + filepath.Base(bundle) + "]"
	}
	injected := setupInjection(sub, bundle)

	cmd := exec.Command(realRunc, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr

	if err := cmd.Start(); err != nil {
		logf("cannot run %s: %v", realRunc, err)
		if injected != nil {
			_ = injected.finish(false)
		}
		return 1
	}
	defer forwardSignals(cmd)()

	code := 0
	if err := cmd.Wait(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			code = exitErr.ExitCode()
			// Untested by design, the else below: Wait returns an *exec.ExitError or
			// nil while the wrapper hands runc the three streams directly and copies
			// none of them itself. Kept because that is a property of these few lines
			// rather than of os/exec.
			//coverage:ignore start
		} else {
			logf("cannot run %s: %v", realRunc, err)
			code = 1
		}
		//coverage:ignore stop
	}
	if injected != nil {
		// Only a step that exited zero has a layer BuildKit will commit, and
		// so a layer worth reading back.
		if err := injected.finish(code == 0); err != nil {
			logf("taking the CA back out failed, failing the build: %v", err)
			dumpOwnLog(os.Stderr)
			if isCAResidue(err) {
				fmt.Fprintf(os.Stderr, "buildcage: hint: %s\n", residueHint)
			}
			if code == 0 {
				code = 1
			}
		}
	}
	return code
}

// setupInjection makes the step trust the proxy's CA, returning what undoes it
// again, or nil when there is nothing to undo.
//
// `run` only, not `create`: restore is tied to the wrapped process exiting, but
// `runc create` returns before the process runs, so the CA would be gone by
// `runc start`. BuildKit's runcexecutor uses `run`.
func setupInjection(sub, bundle string) *injection {
	if sub != "run" || bundle == "" {
		return nil
	}
	ca, err := os.ReadFile(caFile)
	if err != nil {
		// Without a CA there is nothing to trust and nothing to undo; the step
		// still runs, and its TLS failures will say so.
		logf("no CA at %s (%v); running without injection", caFile, err)
		return nil
	}
	injected, err := inject(bundle, ca)
	if err != nil {
		logf("injection failed for %s: %v", bundle, err)
		return nil
	}
	return injected
}

// forwardSignals relays signals to runc until the returned function is called.
// Named ones only: an unfiltered Notify also catches SIGURG, which the Go
// runtime raises constantly. Called after cmd.Start, so cmd.Process is set
// (reading it earlier would race cmd.Wait).
func forwardSignals(cmd *exec.Cmd) (stop func()) {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT, syscall.SIGHUP)
	go func() {
		// Untested by design: reaching this means sending the test process a real
		// signal and racing cmd.Wait for it. What it does, forward and carry on, is
		// one line, and a flaky test would say less about it than the line.
		//coverage:ignore start
		for s := range signals {
			_ = cmd.Process.Signal(s)
		}
		//coverage:ignore stop
	}()
	return func() { signal.Stop(signals) }
}
