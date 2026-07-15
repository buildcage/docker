package control

import (
	"context"
	"errors"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/moby/buildkit/session/filesync"
	fstypes "github.com/tonistiigi/fsutil/types"
)

// fakeDiffCopyClient stubs Send/Recv/CloseSend/Context of
// filesync.FileSync_DiffCopyClient; any other method panics on the embedded
// nil interface, which is fine since relayPacketStream never calls one.
type fakeDiffCopyClient struct {
	filesync.FileSync_DiffCopyClient
	sendFn      func(*fstypes.Packet) error
	recvFn      func() (*fstypes.Packet, error)
	closeSendFn func() error
}

func (f *fakeDiffCopyClient) Send(p *fstypes.Packet) error   { return f.sendFn(p) }
func (f *fakeDiffCopyClient) Recv() (*fstypes.Packet, error) { return f.recvFn() }
func (f *fakeDiffCopyClient) CloseSend() error               { return f.closeSendFn() }

// fakeDiffCopyServer stubs Send/Recv/Context of
// filesync.FileSync_DiffCopyServer for the same reason. ctx defaults to
// context.Background() when unset.
type fakeDiffCopyServer struct {
	filesync.FileSync_DiffCopyServer
	sendFn func(*fstypes.Packet) error
	recvFn func() (*fstypes.Packet, error)
	ctx    context.Context
}

func (f *fakeDiffCopyServer) Send(p *fstypes.Packet) error   { return f.sendFn(p) }
func (f *fakeDiffCopyServer) Recv() (*fstypes.Packet, error) { return f.recvFn() }
func (f *fakeDiffCopyServer) Context() context.Context {
	if f.ctx != nil {
		return f.ctx
	}
	return context.Background()
}

// TestRelayPacketStreamRelaysBothDirectionsBeforeUpstreamEOF synchronizes
// upstream's EOF on downstream having fully finished (via CloseSend), so it
// can deterministically assert on both directions' relayed packets — see
// TestRelayPacketStreamReturnsAsSoonAsUpstreamReachesEOF for the (more
// realistic) case where upstream reaches EOF first.
func TestRelayPacketStreamRelaysBothDirectionsBeforeUpstreamEOF(t *testing.T) {
	downstreamIn := []*fstypes.Packet{{ID: 1}, {ID: 2}}
	upstreamIn := []*fstypes.Packet{{ID: 10}, {ID: 20}}

	var mu sync.Mutex
	var downstreamIdx, upstreamIdx int
	var upstreamSent, downstreamSent []*fstypes.Packet
	downstreamDone := make(chan struct{})

	upstream := &fakeDiffCopyClient{
		sendFn: func(p *fstypes.Packet) error {
			mu.Lock()
			defer mu.Unlock()
			upstreamSent = append(upstreamSent, p)
			return nil
		},
		recvFn: func() (*fstypes.Packet, error) {
			mu.Lock()
			idx := upstreamIdx
			if idx < len(upstreamIn) {
				upstreamIdx++
			}
			mu.Unlock()
			if idx < len(upstreamIn) {
				return upstreamIn[idx], nil
			}
			<-downstreamDone
			return nil, io.EOF
		},
		closeSendFn: func() error {
			close(downstreamDone)
			return nil
		},
	}
	downstream := &fakeDiffCopyServer{
		sendFn: func(p *fstypes.Packet) error {
			mu.Lock()
			defer mu.Unlock()
			downstreamSent = append(downstreamSent, p)
			return nil
		},
		recvFn: func() (*fstypes.Packet, error) {
			mu.Lock()
			defer mu.Unlock()
			if downstreamIdx >= len(downstreamIn) {
				return nil, io.EOF
			}
			p := downstreamIn[downstreamIdx]
			downstreamIdx++
			return p, nil
		},
	}

	if err := relayPacketStream(upstream, downstream); err != nil {
		t.Fatalf("relayPacketStream: unexpected error: %v", err)
	}

	if len(upstreamSent) != 2 || upstreamSent[0].ID != 1 || upstreamSent[1].ID != 2 {
		t.Fatalf("expected downstream's packets relayed to upstream in order, got %+v", upstreamSent)
	}
	if len(downstreamSent) != 2 || downstreamSent[0].ID != 10 || downstreamSent[1].ID != 20 {
		t.Fatalf("expected upstream's packets relayed to downstream in order, got %+v", downstreamSent)
	}
}

// TestRelayPacketStreamReturnsAsSoonAsUpstreamReachesEOF covers the actual
// fsutil protocol shape (see relayPacketStream's doc comment): downstream
// (the receiver) sends a FIN and then has nothing further to send, so
// relayPacketStream must return the moment upstream (the sender) reaches
// EOF, rather than waiting on downstream.Recv() — which would otherwise
// hang forever, as it did in production before this was fixed.
func TestRelayPacketStreamReturnsAsSoonAsUpstreamReachesEOF(t *testing.T) {
	upstream := &fakeDiffCopyClient{
		recvFn: func() (*fstypes.Packet, error) { return nil, io.EOF },
	}
	downstream := &fakeDiffCopyServer{
		recvFn: func() (*fstypes.Packet, error) {
			<-make(chan struct{}) // never returns
			return nil, nil
		},
	}

	done := make(chan error, 1)
	go func() { done <- relayPacketStream(upstream, downstream) }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("relayPacketStream did not return promptly once upstream reached EOF")
	}
}

// TestRelayPacketStreamReturnsContextErrorOnCancelledDownstream covers the
// case where the c2s goroutine hasn't reported anything yet (e.g. it's
// stuck in downstream.Recv() with nothing left to receive) but the whole
// exchange was already cancelled — this must surface as the context's
// error rather than a blanket nil, without blocking to find out.
func TestRelayPacketStreamReturnsContextErrorOnCancelledDownstream(t *testing.T) {
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()

	upstream := &fakeDiffCopyClient{
		recvFn: func() (*fstypes.Packet, error) { return nil, io.EOF },
	}
	downstream := &fakeDiffCopyServer{
		ctx: cancelledCtx,
		recvFn: func() (*fstypes.Packet, error) {
			<-make(chan struct{}) // never returns
			return nil, nil
		},
	}

	done := make(chan error, 1)
	go func() { done <- relayPacketStream(upstream, downstream) }()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected context.Canceled to surface instead of a blanket nil, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("relayPacketStream did not return promptly once upstream reached EOF")
	}
}

// TestRelayPacketStreamSurfacesAlreadyFinishedDownstreamError checks that a
// downstream error recorded before upstream reaches EOF is still surfaced,
// rather than always being silently replaced by a nil return.
func TestRelayPacketStreamSurfacesAlreadyFinishedDownstreamError(t *testing.T) {
	wantErr := errors.New("boom")
	downstream := &fakeDiffCopyServer{
		recvFn: func() (*fstypes.Packet, error) { return nil, wantErr },
	}
	upstream := &fakeDiffCopyClient{
		recvFn: func() (*fstypes.Packet, error) {
			// Give the c2s goroutine time to record its error before this
			// reports EOF, so the non-blocking check in relayPacketStream
			// observes it deterministically.
			time.Sleep(50 * time.Millisecond)
			return nil, io.EOF
		},
	}

	err := relayPacketStream(upstream, downstream)
	if !errors.Is(err, wantErr) {
		t.Fatalf("expected the already-finished downstream error to surface, got %v", err)
	}
}

func TestRelayPacketStreamPropagatesUpstreamRecvError(t *testing.T) {
	wantErr := errors.New("boom")
	downstream := &fakeDiffCopyServer{
		recvFn: func() (*fstypes.Packet, error) { return nil, io.EOF },
	}
	upstream := &fakeDiffCopyClient{
		recvFn:      func() (*fstypes.Packet, error) { return nil, wantErr },
		closeSendFn: func() error { return nil },
	}

	err := relayPacketStream(upstream, downstream)
	if !errors.Is(err, wantErr) {
		t.Fatalf("expected upstream recv error to propagate, got %v", err)
	}
}

// fakeDiffSendClient/fakeDiffSendServer are relayBytesStream's equivalent of
// fakeDiffCopyClient/fakeDiffCopyServer above, for filesync.BytesMessage
// instead of *fstypes.Packet.
type fakeDiffSendClient struct {
	filesync.FileSend_DiffCopyClient
	sendFn      func(*filesync.BytesMessage) error
	recvFn      func() (*filesync.BytesMessage, error)
	closeSendFn func() error
}

func (f *fakeDiffSendClient) Send(p *filesync.BytesMessage) error   { return f.sendFn(p) }
func (f *fakeDiffSendClient) Recv() (*filesync.BytesMessage, error) { return f.recvFn() }
func (f *fakeDiffSendClient) CloseSend() error                      { return f.closeSendFn() }

type fakeDiffSendServer struct {
	filesync.FileSend_DiffCopyServer
	sendFn func(*filesync.BytesMessage) error
	recvFn func() (*filesync.BytesMessage, error)
	ctx    context.Context
}

func (f *fakeDiffSendServer) Send(p *filesync.BytesMessage) error   { return f.sendFn(p) }
func (f *fakeDiffSendServer) Recv() (*filesync.BytesMessage, error) { return f.recvFn() }
func (f *fakeDiffSendServer) Context() context.Context {
	if f.ctx != nil {
		return f.ctx
	}
	return context.Background()
}

// TestRelayBytesStreamRelaysBothDirections mirrors
// TestRelayPacketStreamRelaysBothDirectionsBeforeUpstreamEOF: relayBytesStream
// always waits for both directions (no fsutil FIN convention applies to
// FileSend), so both sides reaching EOF independently must still result in
// every chunk being relayed before returning.
func TestRelayBytesStreamRelaysBothDirections(t *testing.T) {
	downstreamIn := []*filesync.BytesMessage{{Data: []byte("a")}, {Data: []byte("b")}}
	upstreamIn := []*filesync.BytesMessage{{Data: []byte("x")}, {Data: []byte("y")}}

	var mu sync.Mutex
	var downstreamIdx, upstreamIdx int
	var upstreamSent, downstreamSent []*filesync.BytesMessage

	upstream := &fakeDiffSendClient{
		sendFn: func(p *filesync.BytesMessage) error {
			mu.Lock()
			defer mu.Unlock()
			upstreamSent = append(upstreamSent, p)
			return nil
		},
		recvFn: func() (*filesync.BytesMessage, error) {
			mu.Lock()
			defer mu.Unlock()
			if upstreamIdx >= len(upstreamIn) {
				return nil, io.EOF
			}
			p := upstreamIn[upstreamIdx]
			upstreamIdx++
			return p, nil
		},
		closeSendFn: func() error { return nil },
	}
	downstream := &fakeDiffSendServer{
		sendFn: func(p *filesync.BytesMessage) error {
			mu.Lock()
			defer mu.Unlock()
			downstreamSent = append(downstreamSent, p)
			return nil
		},
		recvFn: func() (*filesync.BytesMessage, error) {
			mu.Lock()
			defer mu.Unlock()
			if downstreamIdx >= len(downstreamIn) {
				return nil, io.EOF
			}
			p := downstreamIn[downstreamIdx]
			downstreamIdx++
			return p, nil
		},
	}

	if err := relayBytesStream(upstream, downstream); err != nil {
		t.Fatalf("relayBytesStream: unexpected error: %v", err)
	}
	if len(upstreamSent) != 2 || string(upstreamSent[0].Data) != "a" || string(upstreamSent[1].Data) != "b" {
		t.Fatalf("expected downstream's chunks relayed to upstream in order, got %+v", upstreamSent)
	}
	if len(downstreamSent) != 2 || string(downstreamSent[0].Data) != "x" || string(downstreamSent[1].Data) != "y" {
		t.Fatalf("expected upstream's chunks relayed to downstream in order, got %+v", downstreamSent)
	}
}

// TestRelayBytesStreamDoesNotHangWhenDownstreamNeverResponds proves the
// waitC2S fix: previously, the upstream-EOF branch did an unconditional
// blocking `<-c2sErr`, so a c2s goroutine wedged in downstream.Recv() with
// no cancellation escape would hang the RPC handler forever. Now it must
// return once downstream's own context is cancelled.
func TestRelayBytesStreamDoesNotHangWhenDownstreamNeverResponds(t *testing.T) {
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()

	upstream := &fakeDiffSendClient{
		recvFn: func() (*filesync.BytesMessage, error) { return nil, io.EOF },
	}
	downstream := &fakeDiffSendServer{
		ctx: cancelledCtx,
		recvFn: func() (*filesync.BytesMessage, error) {
			<-make(chan struct{}) // never returns
			return nil, nil
		},
	}

	done := make(chan error, 1)
	go func() { done <- relayBytesStream(upstream, downstream) }()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected context.Canceled to surface, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("relayBytesStream did not return once downstream's context was cancelled")
	}
}
