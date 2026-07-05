# renovate: datasource=github-releases depName=containernetworking/plugins
ARG CNI_VERSION=v1.9.1
ARG CNI_SHA256_AMD64=b98f74a0f8522f0a83867178729c1aa70f2158f90c45a2ca8fa791db1c76b303
ARG CNI_SHA256_ARM64=56171987d3947707c3563db2f4001bccaf50fd63468611b9f3cbecb1375ee7ec

# Prepare CNI plugin binaries
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS deps
ARG CNI_VERSION
ARG CNI_SHA256_AMD64
ARG CNI_SHA256_ARM64
RUN apk add --no-cache curl && \
    mkdir -p /opt/cni/bin && \
    ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    EXPECTED_SHA256=$([ "$ARCH" = "amd64" ] && echo "$CNI_SHA256_AMD64" || echo "$CNI_SHA256_ARM64") && \
    curl -fsSL "https://github.com/containernetworking/plugins/releases/download/${CNI_VERSION}/cni-plugins-linux-${ARCH}-${CNI_VERSION}.tgz" \
      -o /tmp/cni.tgz && \
    echo "${EXPECTED_SHA256}  /tmp/cni.tgz" | sha256sum -c && \
    tar -C /opt/cni/bin -xz -f /tmp/cni.tgz ./bridge ./host-local ./loopback

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

# No s6-overlay, no haproxy, no dnsmasq, no iptables: buildkit-proxy is the
# entrypoint/PID1 and supervises buildkitd directly. quickjs is kept for
# source-policy generation only.
RUN apk add --no-cache quickjs

# CNI (used only as the internal MITM proxy's own egress network, per
# docs/security.md — the exec's own network namespace never touches CNI when
# proxyNetwork is enabled)
COPY --from=deps /opt/cni/bin /opt/cni/bin

# buildkit-proxy binary
COPY --from=buildkit-proxy-build /out/buildkit-proxy /opt/buildcage/bin/buildkit-proxy

# BuildKit / CNI config
RUN mkdir -p /etc/buildkit /var/log/buildkitd
COPY explicit/files/buildkitd.toml /etc/buildkit/buildkitd.toml
COPY explicit/files/cni.conflist   /etc/buildkit/cni.conflist

# Tools (QuickJS source-policy generator)
COPY explicit/files/tools/ /opt/buildcage/tools/
COPY shared/tools/lib/     /opt/buildcage/tools/lib/

# License
COPY explicit/files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

ENTRYPOINT ["/opt/buildcage/bin/buildkit-proxy"]
