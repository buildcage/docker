package main

// frame is a passthrough marker type used by rawCodec for RPCs the proxy does
// not need to understand — it carries the raw wire bytes untouched, so a
// method never explicitly registered on this server (Session, Status,
// DiskUsage, Prune, ListWorkers, Info, ListenBuildHistory, UpdateBuildHistory,
// the grpc health-check service, and any future BuildKit RPC) flows through
// byte-for-byte via the UnknownServiceHandler.
type frame struct {
	payload []byte
}
