package main

import (
	"context"
	"log"

	controlapi "github.com/moby/buildkit/api/services/control"
	sourcepolicypb "github.com/moby/buildkit/sourcepolicy/pb"
	"google.golang.org/grpc"
)

// solveServer implements only the Solve RPC of moby.buildkit.v1.Control.
// It is registered as a normal typed grpc method (real proto codec), while
// every other Control method (and every other service) falls through to the
// generic passthroughHandler via grpc.UnknownServiceHandler.
type solveServer struct {
	policy  *sourcepolicypb.Policy
	backend controlapi.ControlClient
}

func (s *solveServer) Solve(ctx context.Context, req *controlapi.SolveRequest) (*controlapi.SolveResponse, error) {
	if req.SourcePolicy != nil {
		log.Printf("buildcage: merging %d client-supplied source policy rule(s) with buildcage's own policy for ref=%s", len(req.SourcePolicy.Rules), req.Ref)
		req.SourcePolicy = mergePolicy(req.SourcePolicy, s.policy)
	} else {
		req.SourcePolicy = s.policy
	}
	// req.SourcePolicySession (dynamic/session-based policy, e.g. docker/buildx's own
	// Rego policy feature) is deliberately left untouched. BuildKit evaluates it as an
	// additional AND condition alongside our static policy, so it composes safely and
	// is not treated as a conflict.
	return s.backend.Solve(ctx, req)
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

// solveHandler adapts solveServer.Solve to the grpc.MethodDesc.Handler shape
// expected by a hand-built grpc.ServiceDesc.
func solveHandler(srv any, ctx context.Context, dec func(any) error, _ grpc.UnaryServerInterceptor) (any, error) {
	req := new(controlapi.SolveRequest)
	if err := dec(req); err != nil {
		return nil, err
	}
	return srv.(*solveServer).Solve(ctx, req)
}

// controlServiceDesc registers ONLY the Solve method of moby.buildkit.v1.Control.
// Every other method on this service (and every other service, e.g. Session,
// Status, DiskUsage, Prune, ListWorkers, Info, ListenBuildHistory,
// UpdateBuildHistory, the grpc health-check service) is unregistered and
// therefore dispatched to grpc.UnknownServiceHandler.
var controlServiceDesc = grpc.ServiceDesc{
	ServiceName: "moby.buildkit.v1.Control",
	HandlerType: (*any)(nil),
	Methods: []grpc.MethodDesc{
		{MethodName: "Solve", Handler: solveHandler},
	},
}
