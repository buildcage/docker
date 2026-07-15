package control

import (
	"context"
	"errors"
	"fmt"

	"github.com/dash14/buildcage/buildkit-proxy/internal/dockerfilearg"
	"github.com/dash14/buildcage/buildkit-proxy/internal/events"
	"github.com/dash14/buildcage/buildkit-proxy/internal/rpcproxy"

	controlapi "github.com/moby/buildkit/api/services/control"
	"github.com/moby/buildkit/session"
	"github.com/moby/buildkit/session/filesync"
	"github.com/moby/buildkit/session/grpchijack"
	"golang.org/x/net/http2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// These mirror the session package's own (unexported) header names
// (session/session.go's headerSessionID etc.) — duplicated here because
// they're not exported, and grpchijack.Hijack/Dialer only deal in raw
// map[string][]string metadata rather than these named constants.
const (
	headerSessionID        = "X-Docker-Expose-Session-Uuid"
	headerSessionSharedKey = "X-Docker-Expose-Session-Sharedkey"
	headerSessionMethod    = "X-Docker-Expose-Session-Grpc-Method"
)

// dockerfileLocalName mirrors frontend/dockerui.DefaultLocalNameDockerfile:
// the client-side local dir name buildx uses to sync the Dockerfile itself,
// separate from the main build context ("context"). Duplicated as a
// constant here rather than importing the (much larger) dockerui package
// for this one stable, long-established string.
const dockerfileLocalName = "dockerfile"

// SessionServer implements the Session RPC of moby.buildkit.v1.Control. It
// replaces the plain byte-for-byte relay every other Control method still
// gets (rpcproxy.PassthroughHandler) because injecting ARGs into the
// Dockerfile requires understanding the FileSync traffic tunneled inside
// Session.
//
// Session multiplexes several independent gRPC services (FileSync, Auth,
// SSH, Secrets, ...) over one hijacked connection ("two-legged" design):
//
//   - upstream leg: buildkit-proxy plays the daemon's role towards the real
//     buildx client, via a shared session.Manager (exactly what buildkitd's
//     own control server does).
//   - downstream leg: buildkit-proxy plays buildx's role towards the real
//     buildkitd, dialing a brand-new Session with the *same* session ID the
//     real buildx used. Reusing the same ID (rather than
//     session.NewSession's freshly-minted one) means SolveRequest.Session,
//     SourcePolicySession, and FrontendAttrs["local-sessionid:*"] all keep
//     resolving correctly on the backend without any rewriting in solve.go.
//     The downstream leg's *grpc.Server explicitly registers FileSync (to
//     reach the "dockerfile" dir-name branch) and FileSend, and falls back
//     to rpcproxy.PassthroughHandler for everything else (Auth/SSH/Secrets/...).
//     FileSend must be registered even though it needs no ARG-injection
//     logic of its own: session/filesync's own code checks
//     session.Caller.Supports() before allowing either of its two services
//     through, so an *unregistered* FileSync/FileSend would be rejected
//     outright ("method ... not supported by the client") rather than
//     falling back to the passthrough — unlike every other Attachable
//     (Auth/SSH/Secrets/...), none of which perform that check.
type SessionServer struct {
	UpstreamMgr *session.Manager
	Backend     controlapi.ControlClient
	ArgSpecs    []dockerfilearg.InjectArg
}

func (s *SessionServer) Session(stream controlapi.Control_SessionServer) error {
	conn, _, opts := grpchijack.Hijack(stream)

	sessionID := ""
	if v := metadata.MD(opts).Get(headerSessionID); len(v) > 0 {
		sessionID = v[0]
	}
	if sessionID == "" {
		conn.Close()
		return errors.New("buildcage: Session RPC missing " + headerSessionID)
	}

	ctx, cancel := context.WithCancel(stream.Context())
	defer cancel()

	upstreamErr := make(chan error, 1)
	go func() {
		// session.Manager.HandleConn closes conn itself once the session
		// ends normally, but not if it errors out before registering the
		// session (e.g. grpcClientConn failing) — close it ourselves only
		// on that failure path, so the normal path's own close isn't
		// duplicated (an unconditional defer here was tried and reverted:
		// it caused buildctl debug logs/histories — which open their own
		// short-lived Session — to duplicate their output).
		err := s.UpstreamMgr.HandleConn(ctx, conn, opts)
		if err != nil {
			conn.Close()
		}
		upstreamErr <- err
	}()

	downstreamErr := make(chan error, 1)
	go func() {
		downstreamErr <- s.runDownstreamLeg(ctx, sessionID, opts)
	}()

	// Whichever leg finishes first (gracefully, on client disconnect, or
	// with an error) determines the outcome; cancel to make sure the other
	// leg unwinds too rather than leaking goroutines/connections, then wait
	// for it before returning.
	var err error
	select {
	case err = <-upstreamErr:
		cancel()
		<-downstreamErr
	case err = <-downstreamErr:
		cancel()
		<-upstreamErr
	}
	if err != nil {
		events.Log(events.Event{
			Type:      "session_ended_with_error",
			Level:     events.LevelWarning,
			SessionID: sessionID,
			Message:   err.Error(),
		})
	}
	return err
}

// runDownstreamLeg waits for the upstream session to be reachable, then
// dials a brand-new Session to the real backend, reusing sessionID and
// sharedkey so it resolves as the very same session on the backend's side.
func (s *SessionServer) runDownstreamLeg(ctx context.Context, sessionID string, upstreamOpts map[string][]string) error {
	upstreamCaller, err := s.UpstreamMgr.Get(ctx, sessionID, false)
	if err != nil {
		return fmt.Errorf("buildcage: waiting for upstream session %s: %w", sessionID, err)
	}

	downstreamSrv := grpc.NewServer(
		grpc.ForceServerCodec(rpcproxy.RawCodec{}),
		grpc.UnknownServiceHandler(rpcproxy.PassthroughHandler(upstreamCaller.Conn())),
	)
	filesync.RegisterFileSyncServer(downstreamSrv, &dockerfileFileSync{
		upstream:            upstreamCaller,
		dockerfileLocalName: dockerfileLocalName,
		argSpecs:            s.ArgSpecs,
		sessionID:           sessionID,
	})
	filesync.RegisterFileSendServer(downstreamSrv, &dockerfileFileSend{upstream: upstreamCaller})

	meta := map[string][]string{headerSessionID: {sessionID}}
	if v := metadata.MD(upstreamOpts).Get(headerSessionSharedKey); len(v) > 0 {
		meta[headerSessionSharedKey] = v
	}
	for name, info := range downstreamSrv.GetServiceInfo() {
		for _, m := range info.Methods {
			meta[headerSessionMethod] = append(meta[headerSessionMethod], "/"+name+"/"+m.Name)
		}
	}

	downstreamConn, err := grpchijack.Dialer(s.Backend)(ctx, "h2c", meta)
	if err != nil {
		return fmt.Errorf("buildcage: dialing downstream session %s: %w", sessionID, err)
	}
	go func() {
		<-ctx.Done()
		downstreamConn.Close()
	}()

	(&http2.Server{}).ServeConn(downstreamConn, &http2.ServeConnOpts{Handler: downstreamSrv})
	return nil
}

// sessionHandler adapts SessionServer.Session to the grpc.StreamHandler
// shape expected by a hand-built grpc.ServiceDesc, mirroring exactly how
// BuildKit's own generated _Control_Session_Handler wraps the raw
// grpc.ServerStream (see api/services/control/control_grpc.pb.go).
func sessionHandler(srv any, stream grpc.ServerStream) error {
	return srv.(*Handlers).Session.Session(&grpc.GenericServerStream[controlapi.BytesMessage, controlapi.BytesMessage]{ServerStream: stream})
}
