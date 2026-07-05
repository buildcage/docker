// Command buildkit-proxy is the entrypoint for buildcage's "explicit proxy
// engine" image. It supervises buildkitd as a child process and sits in
// front of its real control socket, injecting a source policy (built from
// allowed_https_rules/allowed_http_rules/allowed_ip_rules) into every Solve
// request. There is no s6-overlay in this image: this binary is PID 1.
//
// Responsibilities are split across files by role, not just by topic:
//   - main.go: top-level startup sequencing only.
//   - supervisor.go: prepares the environment and launches/manages the real
//     buildkitd child process. This is orthogonal to gRPC proxying below.
//   - ca_prod.go / ca_testhooks.go: buildkitdEnv(), gated by the "testhooks"
//     build tag — see supervisor.go's doc comment for why this exists.
//   - codec.go, frame.go, proxy.go, solve.go: the gRPC proxy itself (Solve
//     interception + generic passthrough for every other RPC).
//   - policy.go: loads the compiled source policy JSON.
package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	controlapi "github.com/moby/buildkit/api/services/control"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/encoding"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("buildcage: %v", err)
	}
}

func run() error {
	encoding.RegisterCodec(rawCodec{})

	listenAddr := getenv("BUILDKIT_PROXY_LISTEN", "/run/buildkit/buildkitd.sock")
	backendAddr := getenv("BUILDKIT_PROXY_BACKEND", "/run/buildkit/buildkitd-internal.sock")
	policyFile := getenv("BUILDKIT_PROXY_POLICY_FILE", "/etc/buildkit/source-policy.json")
	logFile := getenv("BUILDKIT_PROXY_LOG_FILE", "/var/log/buildkitd/current")

	if err := writeResolvConf(getenv("EXTERNAL_RESOLVER", "1.1.1.1,8.8.8.8")); err != nil {
		return fmt.Errorf("writing resolv.conf: %w", err)
	}

	if err := generateSourcePolicy(policyFile); err != nil {
		return fmt.Errorf("generating source policy: %w", err)
	}

	policy, err := loadPolicy(policyFile)
	if err != nil {
		return fmt.Errorf("loading source policy: %w", err)
	}

	buildkitdCmd, err := startBuildkitd(logFile)
	if err != nil {
		return fmt.Errorf("starting buildkitd: %w", err)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		sig := <-sigCh
		log.Printf("buildcage: received %s, forwarding to buildkitd", sig)
		_ = buildkitdCmd.Process.Signal(syscall.SIGTERM)
	}()

	if err := os.MkdirAll(filepath.Dir(listenAddr), 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", filepath.Dir(listenAddr), err)
	}
	_ = os.Remove(listenAddr)
	ln, err := net.Listen("unix", listenAddr)
	if err != nil {
		return fmt.Errorf("listening on %s: %w", listenAddr, err)
	}

	backend, err := grpc.NewClient(
		"unix://"+backendAddr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(grpc.CallContentSubtype(rawCodecName)),
	)
	if err != nil {
		return fmt.Errorf("dialing backend %s: %w", backendAddr, err)
	}
	defer backend.Close()

	srv := grpc.NewServer(
		grpc.ForceServerCodec(rawCodec{}),
		grpc.UnknownServiceHandler(passthroughHandler(backend)),
	)
	srv.RegisterService(&controlServiceDesc, &solveServer{
		policy:  policy,
		backend: controlapi.NewControlClient(backend),
	})

	serveErrCh := make(chan error, 1)
	go func() { serveErrCh <- srv.Serve(ln) }()

	log.Printf("buildcage: listening on %s, backend %s", listenAddr, backendAddr)

	waitErr := buildkitdCmd.Wait()
	srv.Stop()
	<-serveErrCh
	return waitErr
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
