// Command buildkit-proxy is the entrypoint for buildcage's "explicit proxy
// engine" image. It supervises buildkitd as a child process and sits in
// front of its real control socket, injecting a source policy (built from
// allowed_https_rules/allowed_http_rules/allowed_ip_rules) into every Solve
// request, and injecting missing Dockerfile ARGs (so tools like npm that
// ignore the system CA store by default still trust the --proxy-network
// MITM CA) via the Session RPC's FileSync traffic. This binary is PID 1.
//
// main.go itself only sequences startup and wires the packages below
// together; each package owns one role:
//   - internal/bootstrap: prepares the environment and launches/manages the
//     real buildkitd child process, and loads the compiled source policy.
//     Orthogonal to the gRPC proxying below.
//   - internal/rpcproxy: the generic gRPC dual-codec + byte-for-byte
//     passthrough plumbing shared by every RPC this proxy doesn't need to
//     understand.
//   - internal/control: the Solve/Session interception built on top of
//     rpcproxy — source-policy injection, and the Session RPC interception
//     that lets it patch the Dockerfile in flight.
//   - internal/dockerfilearg: the actual ARG-injection logic (Dockerfile
//     AST-based, not text/regex-based) and the (hardcoded) list of ARGs to
//     inject, used by internal/control.
//   - internal/events: the structured, single-line event log both solve and
//     session/filesync code emit, which report.js turns into GitHub Actions
//     annotations.
package main

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/dash14/buildcage/buildkit-proxy/internal/bootstrap"
	"github.com/dash14/buildcage/buildkit-proxy/internal/control"
	"github.com/dash14/buildcage/buildkit-proxy/internal/dockerfilearg"
	"github.com/dash14/buildcage/buildkit-proxy/internal/rpcproxy"

	controlapi "github.com/moby/buildkit/api/services/control"
	"github.com/moby/buildkit/session"
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
	encoding.RegisterCodec(rpcproxy.RawCodec{})

	listenAddr := getenv("BUILDKIT_PROXY_LISTEN", "/run/buildkit/buildkitd.sock")
	backendAddr := getenv("BUILDKIT_PROXY_BACKEND", "/run/buildkit/buildkitd-internal.sock")
	policyFile := getenv("BUILDKIT_PROXY_POLICY_FILE", "/etc/buildkit/source-policy.json")
	logFile := getenv("BUILDKIT_PROXY_LOG_FILE", "/var/log/buildkitd/current")

	if resolver := os.Getenv("EXTERNAL_RESOLVER"); resolver != "" {
		if err := bootstrap.WriteResolvConf(resolver); err != nil {
			return fmt.Errorf("writing resolv.conf: %w", err)
		}
	}

	if err := bootstrap.GenerateSourcePolicy(policyFile); err != nil {
		return fmt.Errorf("generating source policy: %w", err)
	}

	policy, err := bootstrap.LoadPolicy(policyFile)
	if err != nil {
		return fmt.Errorf("loading source policy: %w", err)
	}

	buildkitdCmd, logFileHandle, err := bootstrap.StartBuildkitd(logFile)
	if err != nil {
		return fmt.Errorf("starting buildkitd: %w", err)
	}
	// Point buildkit-proxy's own log.Printf output (including the events
	// package's Log) at the same file report.js parses, in addition to its
	// existing stderr destination — see StartBuildkitd's doc comment.
	log.SetOutput(io.MultiWriter(os.Stderr, logFileHandle))

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
		grpc.WithDefaultCallOptions(grpc.CallContentSubtype(rpcproxy.RawCodecName)),
	)
	if err != nil {
		return fmt.Errorf("dialing backend %s: %w", backendAddr, err)
	}
	defer backend.Close()

	upstreamMgr, err := session.NewManager()
	if err != nil {
		return fmt.Errorf("creating session manager: %w", err)
	}

	srv := grpc.NewServer(
		grpc.ForceServerCodec(rpcproxy.RawCodec{}),
		grpc.UnknownServiceHandler(rpcproxy.PassthroughHandler(backend)),
	)
	srv.RegisterService(&control.ServiceDesc, &control.Handlers{
		Solve: &control.SolveServer{
			Policy:  policy,
			Backend: controlapi.NewControlClient(backend),
		},
		Session: &control.SessionServer{
			UpstreamMgr: upstreamMgr,
			Backend:     controlapi.NewControlClient(backend),
			ArgSpecs:    dockerfilearg.DefaultInjectArgs,
		},
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
