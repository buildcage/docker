package main

// This file owns the "supervisor" role: preparing the environment and
// launching/managing the real buildkitd child process. It is otherwise
// unrelated to the gRPC policy-injection proxy in codec.go/frame.go/proxy.go/
// solve.go, which is this binary's primary purpose.
//
// buildkitdEnv (called from startBuildkitd below) is defined in ca_prod.go
// or ca_testhooks.go depending on the "testhooks" build tag — see that
// file's doc comment for why a second, test-only variant exists at all.

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// writeResolvConf points the container's own resolv.conf at the external
// resolver list, which buildkitd's internal MITM proxy reads via Go's
// stdlib resolver to resolve DNS for its own egress. Called by main.go only
// when EXTERNAL_RESOLVER is set; otherwise the container's own resolv.conf
// (e.g. Docker's embedded DNS) is left untouched.
func writeResolvConf(externalResolver string) error {
	var sb strings.Builder
	for _, ip := range strings.Split(externalResolver, ",") {
		ip = strings.TrimSpace(ip)
		if ip == "" {
			continue
		}
		fmt.Fprintf(&sb, "nameserver %s\n", ip)
	}
	return os.WriteFile("/etc/resolv.conf", []byte(sb.String()), 0o644)
}

// generateSourcePolicy invokes the QuickJS policy generator (which reuses
// core/shared/lib/rules.ts's wildcard/regex compiler) and writes its
// stdout — a sourcepolicy.pb.Policy protobuf-JSON document — to outPath.
// Fails closed: any error here aborts startup rather than running without a
// policy.
func generateSourcePolicy(outPath string) error {
	cmd := exec.Command("qjs", "--std", "-m", "/opt/buildcage/scripts/gen-source-policy.js",
		getenv("PROXY_MODE", "restrict"),
		os.Getenv("ALLOWED_HTTPS_RULES"),
		os.Getenv("ALLOWED_HTTP_RULES"),
		os.Getenv("ALLOWED_IP_RULES"),
	)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("gen-source-policy.js failed: %w: %s", err, stderr.String())
	}
	return os.WriteFile(outPath, out, 0o644)
}

// startBuildkitd launches the real buildkitd as a child process, teeing its
// combined stdout/stderr to both the container's own stdout (so `docker logs`
// works) and a log file that report.js parses for policy-denial entries.
// BuildKit's source-policy engine logs denials into this stream via its own
// structured logger.
//
// Allowed requests are not read from this log file: report/src/lib/vertex-log.ts
// fetches those separately via `buildctl debug logs --progress=rawjson`, which
// tags every entry with the vertex (RUN step) that produced it. Getting that
// same data from buildkitd's own log instead would require running it with
// BUILDKIT_DEBUG_EXEC_OUTPUT=1, which also mirrors every RUN step's own
// console output into this same stream.
func startBuildkitd(logFile string) (*exec.Cmd, error) {
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command("buildkitd", "--config=/etc/buildkit/buildkitd.toml")
	cmd.Stdout = io.MultiWriter(os.Stdout, f)
	cmd.Stderr = io.MultiWriter(os.Stderr, f)
	env, err := buildkitdEnv()
	if err != nil {
		return nil, err
	}
	cmd.Env = env
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}
