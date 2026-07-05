package main

import (
	"fmt"
	"os"

	sourcepolicypb "github.com/moby/buildkit/sourcepolicy/pb"
	"google.golang.org/protobuf/encoding/protojson"
)

// loadPolicy reads a sourcepolicy.pb.Policy encoded as protobuf-JSON, exactly
// as produced by docker/explicit/files/tools/gen-source-policy.js.
func loadPolicy(path string) (*sourcepolicypb.Policy, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	var pol sourcepolicypb.Policy
	if err := protojson.Unmarshal(data, &pol); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return &pol, nil
}
