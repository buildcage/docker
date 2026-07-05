package main

import (
	"errors"
	"io"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// passthroughHandler generically relays any RPC not explicitly registered on
// this server to the real backend, without ever decoding the payload (frame
// carries opaque bytes). This is what makes Session (bidi-stream), Status,
// DiskUsage, Prune, ListWorkers, Info, ListenBuildHistory, UpdateBuildHistory,
// and the grpc health-check service work unmodified, and keeps future
// BuildKit RPC additions automatically covered with zero code changes.
func passthroughHandler(backend *grpc.ClientConn) grpc.StreamHandler {
	return func(_ any, serverStream grpc.ServerStream) error {
		fullMethod, ok := grpc.MethodFromServerStream(serverStream)
		if !ok {
			return status.Error(codes.Internal, "buildcage: could not determine full method name")
		}

		ctx := serverStream.Context()
		if md, ok := metadata.FromIncomingContext(ctx); ok {
			ctx = metadata.NewOutgoingContext(ctx, md.Copy())
		}

		clientStream, err := backend.NewStream(ctx, &grpc.StreamDesc{
			StreamName:    fullMethod,
			ServerStreams: true,
			ClientStreams: true,
		}, fullMethod, grpc.CallContentSubtype(rawCodecName))
		if err != nil {
			return err
		}

		// client(server-facing) -> backend
		c2sErr := make(chan error, 1)
		go func() {
			for {
				f := new(frame)
				if err := serverStream.RecvMsg(f); err != nil {
					if errors.Is(err, io.EOF) {
						c2sErr <- clientStream.CloseSend()
					} else {
						c2sErr <- err
					}
					return
				}
				if err := clientStream.SendMsg(f); err != nil {
					c2sErr <- err
					return
				}
			}
		}()

		// waitC2S waits for the client->backend goroutine above to finish, so
		// every return path below consistently gives it a chance to unwind
		// before the handler returns (rather than only the graceful-EOF path
		// waiting). Bounded by ctx instead of blocking forever: a one-sided
		// backend failure doesn't guarantee the other goroutine's
		// serverStream.RecvMsg unblocks on its own, but returning here also
		// tears down serverStream, which unblocks it shortly after anyway.
		waitC2S := func() {
			select {
			case <-c2sErr:
			case <-ctx.Done():
			}
		}

		// backend -> client(server-facing)
		for {
			f := new(frame)
			err := clientStream.RecvMsg(f)
			if errors.Is(err, io.EOF) {
				return <-c2sErr
			}
			if err != nil {
				waitC2S()
				return err
			}
			if err := serverStream.SendMsg(f); err != nil {
				waitC2S()
				return err
			}
		}
	}
}
