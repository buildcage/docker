package main

import (
	"fmt"

	"google.golang.org/protobuf/proto"
)

// rawCodecName is the grpc content-subtype used by rawCodec on both the
// server (via grpc.ForceServerCodec) and the client connection to the real
// buildkitd (via grpc.CallContentSubtype), so both sides agree on framing.
const rawCodecName = "proxy"

// rawCodec lets a single grpc.Server handle both a fully-typed method (Solve,
// using real generated proto types, so fields we never touch — like the LLB
// Definition graph — round-trip byte-for-byte automatically) and a generic
// passthrough for every other method (using *frame, which carries the raw
// wire bytes untouched).
type rawCodec struct{}

func (rawCodec) Name() string { return rawCodecName }

func (rawCodec) Marshal(v any) ([]byte, error) {
	switch m := v.(type) {
	case *frame:
		return m.payload, nil
	case proto.Message:
		return proto.Marshal(m)
	default:
		return nil, fmt.Errorf("rawCodec: unsupported marshal type %T", v)
	}
}

func (rawCodec) Unmarshal(data []byte, v any) error {
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
