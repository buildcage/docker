// gen-seccomp-profile resolves moby/profiles' Docker default seccomp
// profile into the OCI Runtime Spec form runc's config.json expects,
// against a synthetic spec with an empty capability set (matching the
// sandboxed process, which always runs with its capability bounding set
// fully cleared). Writes the result to stdout as JSON.
//
// This binary is compiled at buildcage's own image-build time but is not
// meant to be *run* then: its output depends on the architecture and the
// actual kernel of whatever machine runs it (a handful of syscalls in the
// profile are gated by a real uname(2) call via a minKernel condition), so
// it must be run on the real target — extracted from the proxy image onto
// the GitHub Actions runner host (docker cp, same mechanism used for
// runc) and invoked natively there, before any namespace isolation is set
// up for the sandboxed command. See docs/development.md.
//
// If the kernel it happens to run on doesn't match the actual runner
// exactly (not expected in normal operation, since it's the same host),
// the risk is asymmetric and low-severity either way: a syscall wrongly
// included just fails with ENOSYS on a kernel that lacks it (not a
// security issue), and a syscall wrongly excluded only breaks a tool that
// needed it (a compatibility issue, not a widened attack surface) — it can
// never result in a *more* permissive filter than intended.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/moby/profiles/seccomp"
	specs "github.com/opencontainers/runtime-spec/specs-go"
)

func main() {
	rs := &specs.Spec{
		Process: &specs.Process{
			Capabilities: &specs.LinuxCapabilities{
				Bounding: []string{},
			},
		},
	}

	linuxSeccomp, err := seccomp.GetDefaultProfile(rs)
	if err != nil {
		fmt.Fprintln(os.Stderr, "gen-seccomp-profile:", err)
		os.Exit(1)
	}

	// Machine-readable only (sandbox/runc-bootstrap.ts's extractRuncBootstrap
	// JSON.parses this straight off stdout) -- no pretty-printing needed.
	if err := json.NewEncoder(os.Stdout).Encode(linuxSeccomp); err != nil {
		fmt.Fprintln(os.Stderr, "gen-seccomp-profile:", err)
		os.Exit(1)
	}
}
