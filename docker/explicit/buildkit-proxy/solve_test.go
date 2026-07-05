package main

import (
	"context"
	"testing"

	controlapi "github.com/moby/buildkit/api/services/control"
	sourcepolicypb "github.com/moby/buildkit/sourcepolicy/pb"
	"google.golang.org/grpc"
)

// fakeControlClient stubs only Solve; any other method would panic on the
// embedded nil interface, which is fine since these tests never call one.
type fakeControlClient struct {
	controlapi.ControlClient
	solveFn func(ctx context.Context, in *controlapi.SolveRequest, opts ...grpc.CallOption) (*controlapi.SolveResponse, error)
}

func (f *fakeControlClient) Solve(ctx context.Context, in *controlapi.SolveRequest, opts ...grpc.CallOption) (*controlapi.SolveResponse, error) {
	return f.solveFn(ctx, in, opts...)
}

func TestSolveMergesExistingSourcePolicy(t *testing.T) {
	buildcagePolicy := &sourcepolicypb.Policy{Version: 1, Rules: []*sourcepolicypb.Rule{
		{Action: sourcepolicypb.PolicyAction_DENY, Selector: &sourcepolicypb.Selector{Identifier: "^https?://.*", MatchType: sourcepolicypb.MatchType_REGEX}},
		{Action: sourcepolicypb.PolicyAction_ALLOW, Selector: &sourcepolicypb.Selector{Identifier: "^https://allowed\\.example\\.com(/.*)?$", MatchType: sourcepolicypb.MatchType_REGEX}},
	}}
	clientRule := &sourcepolicypb.Rule{
		Action:   sourcepolicypb.PolicyAction_CONVERT,
		Selector: &sourcepolicypb.Selector{Identifier: "docker-image://docker.io/library/alpine:latest", MatchType: sourcepolicypb.MatchType_EXACT},
	}
	clientPolicy := &sourcepolicypb.Policy{Version: 1, Rules: []*sourcepolicypb.Rule{clientRule}}

	var gotReq *controlapi.SolveRequest
	s := &solveServer{
		policy: buildcagePolicy,
		backend: &fakeControlClient{
			solveFn: func(_ context.Context, in *controlapi.SolveRequest, _ ...grpc.CallOption) (*controlapi.SolveResponse, error) {
				gotReq = in
				return &controlapi.SolveResponse{}, nil
			},
		},
	}

	req := &controlapi.SolveRequest{Ref: "build-ref-1", SourcePolicy: clientPolicy}
	if _, err := s.Solve(context.Background(), req); err != nil {
		t.Fatalf("Solve: unexpected error merging a client-supplied SourcePolicy: %v", err)
	}
	if gotReq == nil {
		t.Fatal("backend.Solve was not called")
	}
	got := gotReq.SourcePolicy
	if got == nil || len(got.Rules) != 3 {
		t.Fatalf("expected a merged policy with 3 rules (1 client + 2 buildcage), got %v", got)
	}
	if got.Rules[0] != clientRule {
		t.Fatalf("expected the client's rule first (evaluated first, so buildcage's rules always have the final say), got %v", got.Rules[0])
	}
	if got.Rules[1] != buildcagePolicy.Rules[0] || got.Rules[2] != buildcagePolicy.Rules[1] {
		t.Fatal("expected buildcage's own rules last, in their original order")
	}
}

func TestSolveInjectsPolicyWhenAbsent(t *testing.T) {
	wantPolicy := &sourcepolicypb.Policy{Version: 1, Rules: []*sourcepolicypb.Rule{{
		Action:   sourcepolicypb.PolicyAction_DENY,
		Selector: &sourcepolicypb.Selector{Identifier: "^https?://.*", MatchType: sourcepolicypb.MatchType_REGEX},
	}}}

	var gotReq *controlapi.SolveRequest
	s := &solveServer{
		policy: wantPolicy,
		backend: &fakeControlClient{
			solveFn: func(_ context.Context, in *controlapi.SolveRequest, _ ...grpc.CallOption) (*controlapi.SolveResponse, error) {
				gotReq = in
				return &controlapi.SolveResponse{}, nil
			},
		},
	}

	req := &controlapi.SolveRequest{Ref: "build-ref-2"}
	if _, err := s.Solve(context.Background(), req); err != nil {
		t.Fatalf("Solve: unexpected error: %v", err)
	}
	if gotReq == nil {
		t.Fatal("backend.Solve was not called")
	}
	if gotReq.SourcePolicy != wantPolicy {
		t.Fatalf("SourcePolicy not injected: got %v, want %v", gotReq.SourcePolicy, wantPolicy)
	}
}

func TestSolveIgnoresSourcePolicySession(t *testing.T) {
	wantPolicy := &sourcepolicypb.Policy{Version: 1}
	var gotReq *controlapi.SolveRequest
	s := &solveServer{
		policy: wantPolicy,
		backend: &fakeControlClient{
			solveFn: func(_ context.Context, in *controlapi.SolveRequest, _ ...grpc.CallOption) (*controlapi.SolveResponse, error) {
				gotReq = in
				return &controlapi.SolveResponse{}, nil
			},
		},
	}

	// A dynamic/session-based policy (e.g. docker/buildx's Rego feature) must
	// NOT be treated as a conflict — only a static SourcePolicy is merged.
	req := &controlapi.SolveRequest{Ref: "build-ref-3", SourcePolicySession: "session-id-abc"}
	if _, err := s.Solve(context.Background(), req); err != nil {
		t.Fatalf("Solve: unexpected error for SourcePolicySession-only request: %v", err)
	}
	if gotReq.SourcePolicy != wantPolicy {
		t.Fatal("policy should still be injected when only SourcePolicySession was set")
	}
	if gotReq.SourcePolicySession != "session-id-abc" {
		t.Fatal("SourcePolicySession must be passed through untouched")
	}
}
