# Build buildkit-proxy (statically linked; discarded after this stage)
#
# BUILDKIT_PROXY_BUILD_TAGS is empty for every real build (including
# published releases): the "testhooks" build tag (see
# docker/explicit/buildkit-proxy/ca_testhooks.go) is compiled in only when
# compose.test-explicit.yaml explicitly passes it, so integration-test-only code
# (a self-signed-cert CA-trust escape hatch) is physically absent from the
# published image's binary.
FROM golang:1.25-alpine@sha256:523c3effe300580ed375e43f43b1c9b091b68e935a7c3a92bfcc4e7ed55b18c2 AS buildkit-proxy-build
ARG BUILDKIT_PROXY_BUILD_TAGS=""
WORKDIR /src
COPY explicit/buildkit-proxy/go.mod explicit/buildkit-proxy/go.sum ./
RUN go mod download
COPY explicit/buildkit-proxy/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -tags="${BUILDKIT_PROXY_BUILD_TAGS}" -o /out/buildkit-proxy .

# Final image
FROM moby/buildkit:v0.31.1@sha256:6b59b7df63a8cb9902736f9ddf7fcff8261613d3e7449b8ea8b7537fc399c03a

LABEL org.opencontainers.image.title="buildcage (explicit proxy engine)" \
      org.opencontainers.image.description="Secure Docker build environment using BuildKit's native --proxy-network" \
      org.opencontainers.image.licenses="MIT AND Apache-2.0" \
      org.opencontainers.image.source="https://github.com/dash14/buildcage"

# quickjs is the only extra package needed, for source-policy generation.
RUN apk add --no-cache quickjs

# buildkit-proxy binary
COPY --from=buildkit-proxy-build /out/buildkit-proxy /opt/buildcage/bin/buildkit-proxy

# BuildKit config
RUN mkdir -p /etc/buildkit /var/log/buildkitd
COPY explicit/files/buildkitd.toml /etc/buildkit/buildkitd.toml

# Tools (QuickJS source-policy generator)
COPY tools/explicit/ /opt/buildcage/tools/explicit/
COPY tools/shared/   /opt/buildcage/tools/shared/

# License
COPY explicit/files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

ENTRYPOINT ["/opt/buildcage/bin/buildkit-proxy"]
