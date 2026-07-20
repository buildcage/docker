# renovate: datasource=github-releases depName=opencontainers/runc
ARG RUNC_VERSION=v1.5.1
ARG RUNC_SHA256_AMD64=177df879d50c913eb205e898d5c1c05a18f574053c0ce5524c471208eaf06f6f
ARG RUNC_SHA256_ARM64=ca70e7dbd6616ca782a59b5d3ac86909123fdaa9fa3f89dcf29051c70eee7ce9

# Prepare dependencies — runc's official release binaries are already
# statically linked (including libseccomp), so no compilation is needed,
# only a checksum-pinned download (see docs/development.md).
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS deps
ARG RUNC_VERSION
ARG RUNC_SHA256_AMD64
ARG RUNC_SHA256_ARM64
RUN apk add --no-cache curl && \
    mkdir -p /opt/buildcage/bin && \
    ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    EXPECTED_SHA256=$([ "$ARCH" = "amd64" ] && echo "$RUNC_SHA256_AMD64" || echo "$RUNC_SHA256_ARM64") && \
    curl -fsSL "https://github.com/opencontainers/runc/releases/download/${RUNC_VERSION}/runc.${ARCH}" \
      -o /opt/buildcage/bin/runc && \
    echo "${EXPECTED_SHA256}  /opt/buildcage/bin/runc" | sha256sum -c && \
    chmod +x /opt/buildcage/bin/runc

# Building gen-seccomp-profile here only compiles the binary — it's
# extracted onto the runner host and run natively there, not at image
# build time; see gen-seccomp-profile/main.go for why. Pure Go
# (CGO_ENABLED=0), so this cross-compiles natively via BUILDPLATFORM
# without needing QEMU, same as buildkit-proxy-build in
# setup/docker/explicit/Dockerfile.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine@sha256:56961d79ea8129efddcc0b8643fd8a5416b4e6228cfd477e3fd61deb2672c587 AS gen-seccomp-profile-build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY run/docker/gen-seccomp-profile/go.mod run/docker/gen-seccomp-profile/go.sum ./
RUN go mod download
COPY run/docker/gen-seccomp-profile/main.go ./
RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -o /out/gen-seccomp-profile .

# Final image
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

LABEL org.opencontainers.image.title="buildcage-proxy" \
      org.opencontainers.image.description="Network-isolated proxy for arbitrary GitHub Actions commands" \
      org.opencontainers.image.licenses="MIT AND GPL-2.0-or-later AND Apache-2.0" \
      org.opencontainers.image.source="https://github.com/dash14/buildcage"

RUN apk add --no-cache \
      s6-overlay \
      haproxy \
      dnsmasq \
      iptables \
      iproute2 \
      gettext \
      curl \
      quickjs

ENV S6_KEEP_ENV=1
ENV S6_LOGGING=0

# DNS
COPY run/docker/files/dnsmasq.conf /etc/dnsmasq.conf

# HAProxy
RUN mkdir -p /etc/haproxy/rules /var/log/haproxy
COPY run/docker/files/haproxy.cfg.template /etc/haproxy/haproxy.cfg.template

# Tools (QuickJS scripts) — convert-rule.js is used by init-haproxy-cfg,
# report.js/lib/log-parser.js by the run action's report step
COPY core/scripts/ /opt/buildcage/scripts/
COPY core/shared/  /opt/buildcage/shared/

# runc — extracted onto the runner host at `run` action startup and used by
# run-isolated.sh to execute the isolated command (see docs/development.md)
COPY --from=deps /opt/buildcage/bin/runc /opt/buildcage/bin/runc

# gen-seccomp-profile — extracted onto the runner host and run natively
# there (not inside this container) to produce the seccomp filter embedded
# in runc's config.json; see the build stage comment above for why.
COPY --from=gen-seccomp-profile-build /out/gen-seccomp-profile /opt/buildcage/bin/gen-seccomp-profile

# License
COPY run/docker/files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

# s6 service definitions and init scripts
COPY run/docker/files/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
COPY run/docker/files/s6-scripts/ /etc/s6-overlay/scripts/

ENTRYPOINT ["/init"]
