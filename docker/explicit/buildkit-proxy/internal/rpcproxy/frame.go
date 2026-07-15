package rpcproxy

// frame is a passthrough marker type used by RawCodec for RPCs the proxy
// does not need to understand — it carries the raw wire bytes untouched, so
// a method never explicitly registered on a given server (at the outer
// Control-service level: Status, DiskUsage, Prune, ListWorkers, Info,
// ListenBuildHistory, UpdateBuildHistory, the grpc health-check service, and
// any future BuildKit RPC; at the per-Session level built in control's
// session.go: every Attachable other than FileSync) flows through
// byte-for-byte via the UnknownServiceHandler.
type frame struct {
	payload []byte
}
