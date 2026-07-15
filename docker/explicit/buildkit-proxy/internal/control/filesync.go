package control

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/dash14/buildcage/buildkit-proxy/internal/dockerfilearg"
	"github.com/dash14/buildcage/buildkit-proxy/internal/events"

	"github.com/moby/buildkit/session"
	"github.com/moby/buildkit/session/filesync"
	"github.com/tonistiigi/fsutil"
	fstypes "github.com/tonistiigi/fsutil/types"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// dirNameMetadataKey mirrors session/filesync's own (unexported) "dir-name"
// gRPC metadata key, which tells a FileSync call which client-side local dir
// (e.g. "context" or "dockerfile") it's for.
const dirNameMetadataKey = "dir-name"

// dockerfileFileSync implements filesync.FileSyncServer for the downstream
// leg (buildkit-proxy pretending to be buildx toward the real buildkitd, see
// session.go). Every call is relayed through to the real buildx (upstream)
// unchanged, except for the Dockerfile's own local dir, where the real
// content is received, missing ARGs are injected (dockerfilearg.Rewrite),
// and the patched content is sent instead of the original.
type dockerfileFileSync struct {
	upstream            session.Caller
	dockerfileLocalName string
	argSpecs            []dockerfilearg.InjectArg
	// sessionID identifies the Session this dockerfileFileSync serves, for
	// the arg_injection_applied/arg_injection_failed events logged below.
	// Not a Solve ref: a single Session can be shared by several Solve
	// calls (e.g. bake), so FileSync-level code has no reliable way to
	// attribute an event to one particular ref — see events.Event's doc
	// comment.
	sessionID string
}

func (d *dockerfileFileSync) DiffCopy(stream filesync.FileSync_DiffCopyServer) error {
	return d.relay(stream, filesync.NewFileSyncClient(d.upstream.Conn()).DiffCopy)
}

func (d *dockerfileFileSync) TarStream(stream filesync.FileSync_TarStreamServer) error {
	return d.relay(stream, filesync.NewFileSyncClient(d.upstream.Conn()).TarStream)
}

// dialFunc matches both FileSyncClient.DiffCopy and FileSyncClient.TarStream
// (both return the same generic bidi-streaming client type), so relay can
// serve either method with the same body.
type dialFunc func(ctx context.Context, opts ...grpc.CallOption) (filesync.FileSync_DiffCopyClient, error)

func (d *dockerfileFileSync) relay(downstream filesync.FileSync_DiffCopyServer, dial dialFunc) error {
	ctx := downstream.Context()
	md, _ := metadata.FromIncomingContext(ctx)
	upstreamCtx := metadata.NewOutgoingContext(ctx, md.Copy())

	upstream, err := dial(upstreamCtx)
	if err != nil {
		return fmt.Errorf("buildcage: dialing upstream FileSync: %w", err)
	}

	dirName := ""
	if v := md.Get(dirNameMetadataKey); len(v) > 0 {
		dirName = v[0]
	}
	if dirName != d.dockerfileLocalName {
		return relayPacketStream(upstream, downstream)
	}
	return d.terminateAndRewrite(ctx, upstream, downstream)
}

// relayC2S starts relaying downstream's messages to upstream in a
// goroutine, returning a channel that receives the outcome (CloseSend's
// result on a clean EOF, or the first error encountered) exactly once.
// Shared by relayPacketStream and relayBytesStream, which differ only in
// how they wait for this direction to finish relative to their own s2c
// loop — see each function's doc comment for why those differ.
func relayC2S[M any](downstream interface{ Recv() (*M, error) }, upstream interface {
	Send(*M) error
	CloseSend() error
}) <-chan error {
	c2sErr := make(chan error, 1)
	go func() {
		for {
			p, err := downstream.Recv()
			if err != nil {
				if errors.Is(err, io.EOF) {
					c2sErr <- upstream.CloseSend()
				} else {
					c2sErr <- err
				}
				return
			}
			if err := upstream.Send(p); err != nil {
				c2sErr <- err
				return
			}
		}
	}()
	return c2sErr
}

// relayPacketStream copies fsutil Packet messages between the two streams
// unmodified in both directions.
//
// Unlike rpcproxy.PassthroughHandler (which this was originally modeled
// on), it cannot wait for *both* directions to reach io.EOF before
// returning: the fsutil wire protocol (see vendor fsutil's receive.go
// package doc) ends with the receiver (downstream here) sending a single
// PACKET_FIN once it has everything it wants, at which point the sender
// (upstream here) is done and returns — the receiver never itself closes
// its send direction afterwards, since finishing the RPC is exactly what
// it's waiting for. So once upstream reaches EOF (confirmed by testing
// against a real buildx: it always follows shortly after a relayed FIN),
// this must return immediately rather than also wait for
// downstream.Recv() to end, which would otherwise hang until the caller
// gives up.
func relayPacketStream(upstream filesync.FileSync_DiffCopyClient, downstream filesync.FileSync_DiffCopyServer) error {
	c2sErr := relayC2S[fstypes.Packet](downstream, upstream)

	for {
		p, err := upstream.Recv()
		if errors.Is(err, io.EOF) {
			// If the other direction's goroutine has already finished (with
			// an error or otherwise) by this point, surface that instead of
			// masking it with a blanket success — but never block waiting
			// for it, since it may legitimately have nothing left to do
			// (see this function's doc comment above).
			select {
			case gErr := <-c2sErr:
				return gErr
			default:
			}
			// The goroutine hasn't reported anything yet, but if the whole
			// exchange was already cancelled (e.g. the sibling Session leg
			// in session.go finished first, tearing down the shared ctx),
			// that's a more honest answer than a blanket nil — still
			// non-blocking, so this can't reintroduce the hang above.
			if cErr := downstream.Context().Err(); cErr != nil {
				return cErr
			}
			return nil
		}
		if err != nil {
			return err
		}
		if err := downstream.Send(p); err != nil {
			return err
		}
	}
}

// terminateAndRewrite fully receives the dockerfile-local-dir content from
// upstream into a temp dir, rewrites the Dockerfile in place, and re-sends
// the (small — just the Dockerfile and possibly its .dockerignore) directory
// from disk. Buffering the whole transfer is fine here: this local dir only
// ever carries a handful of small files, never the main build context. It
// logs an arg_injection_applied or arg_injection_failed event (see the
// events package) reporting the outcome — see doTerminateAndRewrite for the
// actual work.
func (d *dockerfileFileSync) terminateAndRewrite(ctx context.Context, upstream filesync.FileSync_DiffCopyClient, downstream filesync.FileSync_DiffCopyServer) error {
	applied, err := d.doTerminateAndRewrite(ctx, upstream, downstream)
	if err != nil {
		events.Log(events.Event{
			Type:      "arg_injection_failed",
			Level:     events.LevelError,
			SessionID: d.sessionID,
			Message:   err.Error(),
		})
		return err
	}
	if len(applied) > 0 {
		names := make([]string, len(applied))
		for i, a := range applied {
			names[i] = a.Name
		}
		events.Log(events.Event{
			Type:      "arg_injection_applied",
			Level:     events.LevelNotice,
			SessionID: d.sessionID,
			Message:   "injected ARG(s): " + strings.Join(names, ", "),
		})
	}
	return nil
}

func (d *dockerfileFileSync) doTerminateAndRewrite(ctx context.Context, upstream filesync.FileSync_DiffCopyClient, downstream filesync.FileSync_DiffCopyServer) ([]dockerfilearg.InjectArg, error) {
	tmpDir, err := os.MkdirTemp("", "buildcage-dockerfile-*")
	if err != nil {
		return nil, fmt.Errorf("buildcage: creating temp dir for dockerfile rewrite: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	if err := fsutil.Receive(ctx, upstream, tmpDir, fsutil.ReceiveOpt{}); err != nil {
		return nil, fmt.Errorf("buildcage: receiving dockerfile content: %w", err)
	}

	applied, err := dockerfilearg.RewriteDir(tmpDir, d.argSpecs)
	if err != nil {
		return nil, fmt.Errorf("buildcage: rewriting dockerfile: %w", err)
	}

	fs, err := fsutil.NewFS(tmpDir)
	if err != nil {
		return nil, fmt.Errorf("buildcage: opening rewritten dockerfile dir: %w", err)
	}
	if err := fsutil.Send(ctx, downstream, fs, nil); err != nil {
		return nil, fmt.Errorf("buildcage: sending rewritten dockerfile: %w", err)
	}
	return applied, nil
}

// dockerfileFileSend implements filesync.FileSendServer for the downstream
// leg, relaying every call through to the real buildx (upstream) unchanged.
// FileSend (unlike FileSync) carries no ARG-injection-relevant traffic — it
// only ever exports build output back to the client (e.g. for --load) — but
// it must still be registered and advertised (see runDownstreamLeg's
// meta[headerSessionMethod]) or the real backend rejects calling it with
// "method ... not supported by the client": unlike the other Attachables
// relayed generically via rpcproxy.PassthroughHandler as
// grpc.UnknownServiceHandler, session/filesync's own code checks
// session.Caller.Supports() for both of the services it defines (FileSync
// *and* FileSend) before calling either.
type dockerfileFileSend struct {
	upstream session.Caller
}

func (d *dockerfileFileSend) DiffCopy(downstream filesync.FileSend_DiffCopyServer) error {
	ctx := downstream.Context()
	md, _ := metadata.FromIncomingContext(ctx)
	upstreamCtx := metadata.NewOutgoingContext(ctx, md.Copy())

	upstream, err := filesync.NewFileSendClient(d.upstream.Conn()).DiffCopy(upstreamCtx)
	if err != nil {
		return fmt.Errorf("buildcage: dialing upstream FileSend: %w", err)
	}
	return relayBytesStream(upstream, downstream)
}

// relayBytesStream copies BytesMessage chunks between the two streams
// unmodified in both directions, waiting for both to reach io.EOF before
// returning — the same shape as rpcproxy.PassthroughHandler. Unlike
// relayPacketStream, FileSend carries no fsutil FIN convention that would
// make one side's EOF imply the RPC is already over, so the more
// conservative "wait for both" discipline is appropriate here.
func relayBytesStream(upstream filesync.FileSend_DiffCopyClient, downstream filesync.FileSend_DiffCopyServer) error {
	c2sErr := relayC2S[filesync.BytesMessage](downstream, upstream)

	// waitC2S waits for the c2s goroutine to report its outcome, bounded by
	// downstream's context instead of blocking forever if it never does.
	waitC2S := func() error {
		select {
		case err := <-c2sErr:
			return err
		case <-downstream.Context().Done():
			return downstream.Context().Err()
		}
	}

	for {
		p, err := upstream.Recv()
		if errors.Is(err, io.EOF) {
			return waitC2S()
		}
		if err != nil {
			_ = waitC2S()
			return err
		}
		if err := downstream.Send(p); err != nil {
			_ = waitC2S()
			return err
		}
	}
}
