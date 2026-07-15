// Package control implements the two RPCs of moby.buildkit.v1.Control that
// buildkit-proxy actually needs to understand — Solve (source-policy
// injection) and Session (the Dockerfile ARG-injection MITM tunneled inside
// its FileSync traffic) — registered via ServiceDesc/Handlers below. Every
// other Control method (and every other gRPC service) is left to
// rpcproxy.PassthroughHandler, wired up by main.go.
package control

import (
	"context"
	"fmt"
	"strings"

	"github.com/dash14/buildcage/buildkit-proxy/internal/events"

	controlapi "github.com/moby/buildkit/api/services/control"
	sourcepolicypb "github.com/moby/buildkit/sourcepolicy/pb"
	"google.golang.org/grpc"
)

// SolveServer implements only the Solve RPC of moby.buildkit.v1.Control.
// It is registered as a normal typed grpc method (real proto codec), while
// every other Control method (and every other service) falls through to the
// generic passthroughHandler via grpc.UnknownServiceHandler.
type SolveServer struct {
	Policy  *sourcepolicypb.Policy
	Backend controlapi.ControlClient
}

func (s *SolveServer) Solve(ctx context.Context, req *controlapi.SolveRequest) (*controlapi.SolveResponse, error) {
	if req.SourcePolicy != nil {
		events.Log(events.Event{
			Type:    "source_policy_merged",
			Level:   events.LevelNotice,
			Ref:     req.Ref,
			Message: fmt.Sprintf("merged %d client-supplied source policy rule(s) with buildcage's own policy", len(req.SourcePolicy.Rules)),
		})
		req.SourcePolicy = mergePolicy(req.SourcePolicy, s.Policy)
	} else {
		req.SourcePolicy = s.Policy
	}
	// req.SourcePolicySession (dynamic/session-based policy, e.g. docker/buildx's own
	// Rego policy feature) is deliberately left untouched. BuildKit evaluates it as an
	// additional AND condition alongside our static policy, so it composes safely and
	// is not treated as a conflict.

	if likelyBypassesDockerfileFileSync(req) {
		events.Log(events.Event{
			Type:  "arg_injection_skipped",
			Level: events.LevelError,
			Ref:   req.Ref,
			Message: "Dockerfile is not synced via local FileSync (remote git/http context, or " +
				"pre-resolved frontend inputs), so buildkit-proxy could not inject any ARGs into it",
		})
	}

	return s.Backend.Solve(ctx, req)
}

// likelyBypassesDockerfileFileSync reports whether this build's Dockerfile
// is unreachable via the Session "dockerfile" local dir that filesync.go's
// dockerfileFileSync intercepts — meaning ARG injection silently cannot
// apply to it. Two known bypasses (see frontend/dockerui's initContext in
// moby/buildkit): a remote git/http(s) build context, where the Dockerfile
// is read server-side from the same source as the context instead of being
// synced from the client; and FrontendInputs (e.g. some gateway/bake
// invocations), which hand buildkitd an already-resolved LLB definition
// directly, bypassing FileSync entirely.
//
// req.Frontend is "" (not "dockerfile.v0") for ordinary docker buildx
// builds — confirmed by live capture against a real docker-container
// builder — since BuildKit itself defaults an unset Frontend to the
// dockerfile frontend. A request naming any other, explicit frontend is out
// of scope for this check (nothing this proxy does applies to it either
// way), so both "" and "dockerfile.v0" are treated as in-scope.
func likelyBypassesDockerfileFileSync(req *controlapi.SolveRequest) bool {
	if req.Frontend != "" && req.Frontend != "dockerfile.v0" {
		return false
	}
	if len(req.FrontendInputs) > 0 {
		return true
	}
	ctx := req.FrontendAttrs["context"]
	return strings.HasPrefix(ctx, "http://") || strings.HasPrefix(ctx, "https://") ||
		strings.HasPrefix(ctx, "git://") || strings.HasPrefix(ctx, "git@")
}

// mergePolicy composes a client-supplied static SourcePolicy with buildcage's
// own policy into a single document, client rules first and buildcage's own
// rules last.
//
// BuildKit's sourcepolicy engine evaluates rules within one document in
// order, with the last matching ALLOW/DENY rule winning (see
// sourcepolicy/engine.go's evaluatePolicy doc comment). Placing buildcage's
// rules last means its own DENY-all-then-ALLOW-listed-domains block always
// has the final say for every http(s) source: whatever the client's rules
// decided for the same identifier is overwritten by buildcage's own verdict.
// For any other scheme (docker-image://, git://, etc.) buildcage's rules
// never match at all, so the client's rules apply unmodified — buildcage
// only ever governs what it was configured to govern.
//
// CONVERT rules need no special handling despite being able to short-circuit
// a single evaluation pass: Engine.Evaluate re-evaluates the *entire* merged
// document from the top after every mutation (up to 20 times, erroring
// closed beyond that), so buildcage's trailing rules always get a chance to
// vet whatever identifier a client conversion converges on before it's used
// — confirmed both for LLB source resolution (solver/llbsolver) and for the
// exec-proxy's own runtime HTTP(S) checks (util/network/proxyprovider's
// proxyHandler.check, which calls the same Engine.Evaluate).
func mergePolicy(client, buildcage *sourcepolicypb.Policy) *sourcepolicypb.Policy {
	rules := make([]*sourcepolicypb.Rule, 0, len(client.Rules)+len(buildcage.Rules))
	rules = append(rules, client.Rules...)
	rules = append(rules, buildcage.Rules...)
	return &sourcepolicypb.Policy{
		Version: buildcage.Version,
		Rules:   rules,
	}
}

// solveHandler adapts SolveServer.Solve to the grpc.MethodDesc.Handler shape
// expected by a hand-built grpc.ServiceDesc.
func solveHandler(srv any, ctx context.Context, dec func(any) error, _ grpc.UnaryServerInterceptor) (any, error) {
	req := new(controlapi.SolveRequest)
	if err := dec(req); err != nil {
		return nil, err
	}
	return srv.(*Handlers).Solve.Solve(ctx, req)
}

// Handlers is the single object registered against ServiceDesc — a
// grpc.ServiceDesc only accepts one implementation value per service, so
// solveHandler and sessionHandler each reach into this to find the specific
// server they need.
type Handlers struct {
	Solve   *SolveServer
	Session *SessionServer
}

// ServiceDesc registers the Solve method and the Session stream of
// moby.buildkit.v1.Control. Every other method on this service (and every
// other service, e.g. Status, DiskUsage, Prune, ListWorkers, Info,
// ListenBuildHistory, UpdateBuildHistory, the grpc health-check service) is
// unregistered and therefore dispatched to grpc.UnknownServiceHandler.
var ServiceDesc = grpc.ServiceDesc{
	ServiceName: "moby.buildkit.v1.Control",
	HandlerType: (*any)(nil),
	Methods: []grpc.MethodDesc{
		{MethodName: "Solve", Handler: solveHandler},
	},
	Streams: []grpc.StreamDesc{
		{
			StreamName:    "Session",
			Handler:       sessionHandler,
			ServerStreams: true,
			ClientStreams: true,
		},
	},
}
