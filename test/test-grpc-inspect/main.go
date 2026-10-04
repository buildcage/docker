// The gRPC origin the inspect tests call through the proxy, and the client a
// build step calls it with.
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"
)

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: grpc-fixture serve|check|watch|invoke [flags]")
	}
	fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	switch os.Args[1] {
	case "serve":
		cert := fs.String("cert", "/certs/cert.pem", "certificate")
		key := fs.String("key", "/certs/key.pem", "key")
		silence := fs.Duration("silence", 35*time.Second, "how long Watch waits between its two messages")
		fs.Parse(os.Args[2:])
		serve(*cert, *key, *silence)
	case "check", "watch", "invoke":
		target := fs.String("target", "grpc.example.com:443", "host:port")
		method := fs.String("method", "", "full method name to invoke")
		fs.Parse(os.Args[2:])
		call(os.Args[1], *target, *method)
	default:
		log.Fatalf("unknown command %q", os.Args[1])
	}
}

type healthServer struct {
	healthpb.UnimplementedHealthServer
	silence time.Duration
}

func (healthServer) Check(context.Context, *healthpb.HealthCheckRequest) (*healthpb.HealthCheckResponse, error) {
	return &healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}, nil
}

func (h healthServer) Watch(_ *healthpb.HealthCheckRequest, stream healthpb.Health_WatchServer) error {
	for i := 0; i < 2; i++ {
		if i > 0 {
			select {
			case <-time.After(h.silence):
			case <-stream.Context().Done():
				return stream.Context().Err()
			}
		}
		if err := stream.Send(&healthpb.HealthCheckResponse{Status: healthpb.HealthCheckResponse_SERVING}); err != nil {
			return err
		}
	}
	return nil
}

func serve(certFile, keyFile string, silence time.Duration) {
	pair, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		log.Fatal(err)
	}
	s := grpc.NewServer(grpc.Creds(credentials.NewTLS(&tls.Config{Certificates: []tls.Certificate{pair}})))
	healthpb.RegisterHealthServer(s, healthServer{silence: silence})
	lis, err := net.Listen("tcp", ":443")
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(s.Serve(lis))
}

func call(cmd, target, method string) {
	// passthrough rather than dns, whose resolver also asks for a TXT record
	// under a name no rule allows.
	conn, err := grpc.NewClient("passthrough:///"+target, grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{})))
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	switch cmd {
	case "check":
		resp, err := healthpb.NewHealthClient(conn).Check(ctx, &healthpb.HealthCheckRequest{})
		if err != nil {
			fmt.Println(status.Code(err))
			return
		}
		fmt.Println(resp.Status)
	case "invoke":
		err := conn.Invoke(ctx, method, &healthpb.HealthCheckRequest{}, &healthpb.HealthCheckResponse{})
		fmt.Println(status.Code(err))
	case "watch":
		stream, err := healthpb.NewHealthClient(conn).Watch(ctx, &healthpb.HealthCheckRequest{})
		if err != nil {
			fmt.Println(status.Code(err))
			return
		}
		n := 0
		for {
			_, err := stream.Recv()
			if errors.Is(err, io.EOF) {
				fmt.Printf("messages=%d\n", n)
				return
			}
			if err != nil {
				fmt.Printf("messages=%d %s\n", n, status.Code(err))
				return
			}
			n++
		}
	}
}
