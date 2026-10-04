FROM --platform=$BUILDPLATFORM golang:1.27-alpine@sha256:4cb7ac979db5fcc41cae44b2227ba5ab8a51e8807f40d9ba4dee20a0ad960b5b AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum main.go ./
RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
    go build -trimpath -ldflags="-s -w" -o /out/grpc-fixture .

# The client, exported for the build step by the Makefile's grpc_fixture_client.
FROM scratch AS client
COPY --from=build /out/grpc-fixture /

FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
COPY --from=build /out/grpc-fixture /usr/local/bin/grpc-fixture
EXPOSE 443
# Assigned here rather than by Compose IPAM, as test-server-inspect does.
ENTRYPOINT ["/bin/sh", "-c", "ip addr add \"$TEST_NET_ADDR\" dev eth0 && exec grpc-fixture serve", "sh"]
