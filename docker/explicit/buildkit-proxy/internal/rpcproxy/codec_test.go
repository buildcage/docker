package rpcproxy

import (
	"bytes"
	"testing"

	controlapi "github.com/moby/buildkit/api/services/control"
)

func TestRawCodecFrameRoundTrip(t *testing.T) {
	want := []byte{0x01, 0x02, 0x03, 0xff, 0x00}
	var c RawCodec

	data, err := c.Marshal(&frame{payload: want})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if !bytes.Equal(data, want) {
		t.Fatalf("Marshal returned %v, want %v", data, want)
	}

	got := new(frame)
	if err := c.Unmarshal(data, got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if !bytes.Equal(got.payload, want) {
		t.Fatalf("Unmarshal produced %v, want %v", got.payload, want)
	}
}

func TestRawCodecProtoRoundTrip(t *testing.T) {
	var c RawCodec
	want := &controlapi.SolveRequest{Ref: "build-ref-123"}

	data, err := c.Marshal(want)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}

	got := new(controlapi.SolveRequest)
	if err := c.Unmarshal(data, got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.Ref != want.Ref {
		t.Fatalf("Unmarshal produced Ref=%q, want %q", got.Ref, want.Ref)
	}
}

func TestRawCodecUnsupportedType(t *testing.T) {
	var c RawCodec
	if _, err := c.Marshal("not a frame or proto.Message"); err == nil {
		t.Fatal("Marshal: expected error for unsupported type, got nil")
	}
	if err := c.Unmarshal([]byte("x"), new(string)); err == nil {
		t.Fatal("Unmarshal: expected error for unsupported type, got nil")
	}
}
