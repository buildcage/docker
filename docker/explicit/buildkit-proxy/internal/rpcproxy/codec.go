// Package rpcproxy is the generic gRPC dual-codec + byte-for-byte
// passthrough plumbing that lets a single grpc.Server both fully decode one
// method (Solve, via real generated proto types) and relay every other
// method opaquely to the real backend, without buildkit-proxy needing to
// understand — or keep up with — BuildKit's full Control/Session API
// surface. control uses both RawCodec and PassthroughHandler to build its
// own Solve/Session interception on top of this.
package rpcproxy

import (
	"fmt"

	"google.golang.org/protobuf/proto"
)

// RawCodecName is the grpc content-subtype used by RawCodec on both the
// server (via grpc.ForceServerCodec) and the client connection to the real
// buildkitd (via grpc.CallContentSubtype), so both sides agree on framing.
const RawCodecName = "proxy"

// RawCodec lets a single grpc.Server handle both a fully-typed method (Solve,
// using real generated proto types, so fields we never touch — like the LLB
// Definition graph — round-trip byte-for-byte automatically) and a generic
// passthrough for every other method (using *frame, which carries the raw
// wire bytes untouched).
type RawCodec struct{}

func (RawCodec) Name() string { return RawCodecName }

func (RawCodec) Marshal(v any) ([]byte, error) {
	switch m := v.(type) {
	case *frame:
		return m.payload, nil
	case proto.Message:
		return proto.Marshal(m)
	default:
		return nil, fmt.Errorf("rawCodec: unsupported marshal type %T", v)
	}
}

func (RawCodec) Unmarshal(data []byte, v any) error {
	switch m := v.(type) {
	case *frame:
		m.payload = append([]byte(nil), data...)
		return nil
	case proto.Message:
		return proto.Unmarshal(data, m)
	default:
		return fmt.Errorf("rawCodec: unsupported unmarshal type %T", v)
	}
}
