// Package dockerfilearg is buildkit-proxy's Dockerfile ARG-injection logic:
// given a Dockerfile's source and a list of ARG specs, it inserts whichever
// ones are not already declared, so that the buildkitd-injected
// --proxy-network MITM CA is trusted by tools that ignore the system CA
// store by default (e.g. Node.js/npm, which need NODE_USE_SYSTEM_CA=1 to
// consult it). See docker/explicit/buildkit-proxy's package doc in main.go
// and the plan discussion for the full rationale.
//
// This package is pure Dockerfile-text/AST logic with no dependency on gRPC,
// Session, or FileSync — control calls into it once it has the real
// Dockerfile bytes in hand.
package dockerfilearg

// InjectArg is a Dockerfile ARG name/value pair to inject into every build
// stage that does not already declare it.
type InjectArg struct {
	Name  string
	Value string
}

// DefaultInjectArgs is compiled into buildkit-proxy at buildcage's own image
// build time. Values are intentionally fixed here rather than made
// runtime-configurable: no current use case needs per-deployment overrides,
// and configurability (parsing, schema, fail-closed handling, tests) would
// add cost without benefit today. If that changes, follow main.go's getenv
// pattern (e.g. a BUILDKIT_PROXY_INJECT_ARGS env var) rather than expanding
// this file.
var DefaultInjectArgs = []InjectArg{
	{Name: "NODE_USE_SYSTEM_CA", Value: "1"},
}
