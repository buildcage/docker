# renovate: datasource=github-releases depName=opencontainers/runc
ARG RUNC_VERSION=v1.5.1
ARG RUNC_SHA256_AMD64=177df879d50c913eb205e898d5c1c05a18f574053c0ce5524c471208eaf06f6f
ARG RUNC_SHA256_ARM64=ca70e7dbd6616ca782a59b5d3ac86909123fdaa9fa3f89dcf29051c70eee7ce9

# renovate: datasource=github-releases depName=gojue/ecapture
ARG ECAPTURE_VERSION=v2.5.2
ARG ECAPTURE_SHA256_AMD64=96d960536a8bfba3cbd6218fa01358886a9dce744891a00dd0e323cd85f26038
ARG ECAPTURE_SHA256_ARM64=fca78b5963be0a7e882181a92e23d9281b4db0ccedca949656b6cf8557709f99

# Prepare dependencies — runc's official release binaries are already
# statically linked (including libseccomp), so no compilation is needed,
# only a checksum-pinned download (see docs/development.md). ecapture's
# release tarball is fetched the same way — its binary is also statically
# linked (no libc dependency), confirmed to run unmodified on this same
# Alpine/musl base during development.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS deps
ARG RUNC_VERSION
ARG RUNC_SHA256_AMD64
ARG RUNC_SHA256_ARM64
ARG ECAPTURE_VERSION
ARG ECAPTURE_SHA256_AMD64
ARG ECAPTURE_SHA256_ARM64
RUN apk add --no-cache curl && \
    mkdir -p /opt/buildcage/bin && \
    ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    EXPECTED_SHA256=$([ "$ARCH" = "amd64" ] && echo "$RUNC_SHA256_AMD64" || echo "$RUNC_SHA256_ARM64") && \
    curl -fsSL "https://github.com/opencontainers/runc/releases/download/${RUNC_VERSION}/runc.${ARCH}" \
      -o /opt/buildcage/bin/runc && \
    echo "${EXPECTED_SHA256}  /opt/buildcage/bin/runc" | sha256sum -c && \
    chmod +x /opt/buildcage/bin/runc && \
    ECAPTURE_EXPECTED_SHA256=$([ "$ARCH" = "amd64" ] && echo "$ECAPTURE_SHA256_AMD64" || echo "$ECAPTURE_SHA256_ARM64") && \
    curl -fsSL "https://github.com/gojue/ecapture/releases/download/${ECAPTURE_VERSION}/ecapture-${ECAPTURE_VERSION}-linux-${ARCH}.tar.gz" \
      -o /tmp/ecapture.tar.gz && \
    echo "${ECAPTURE_EXPECTED_SHA256}  /tmp/ecapture.tar.gz" | sha256sum -c && \
    tar -C /opt/buildcage/bin --strip-components=1 -xzf /tmp/ecapture.tar.gz "ecapture-${ECAPTURE_VERSION}-linux-${ARCH}/ecapture" && \
    chmod +x /opt/buildcage/bin/ecapture

# Building gen-seccomp-profile here only compiles the binary — it's
# extracted onto the runner host and run natively there, not at image
# build time; see gen-seccomp-profile/main.go for why. Pure Go
# (CGO_ENABLED=0), so this cross-compiles natively via BUILDPLATFORM
# without needing QEMU, same as buildkit-proxy-build in
# setup/docker/explicit/Dockerfile.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS gen-seccomp-profile-build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY run/docker/gen-seccomp-profile/go.mod run/docker/gen-seccomp-profile/go.sum ./
RUN go mod download
COPY run/docker/gen-seccomp-profile/main.go ./
RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -o /out/gen-seccomp-profile .

# Bundle the QuickJS scripts (rolldown; see rolldown.scripts.config.js) —
# qjs has no TypeScript support. Architecture-independent output, so
# pinned to --platform=$BUILDPLATFORM like gen-seccomp-profile-build above
# (no QEMU). run only needs this qjs half — see scripts-build in
# setup/docker/{explicit,transparent}/Dockerfile for the report-action half.
FROM --platform=$BUILDPLATFORM ghcr.io/pnpm/pnpm:11@sha256:e26f380828856f205feaaf42abd157df9ce41bc8e17b662eeaa3379a9638dee0 AS qjs-build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY rolldown.scripts.config.js ./
COPY core/ ./core/
COPY setup/docker/explicit/scripts/ ./setup/docker/explicit/scripts/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm run build:qjs

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
      quickjs-ng

ENV S6_KEEP_ENV=1
ENV S6_LOGGING=0

# DNS
COPY run/docker/files/dnsmasq.conf /etc/dnsmasq.conf

# HAProxy
RUN mkdir -p /etc/haproxy/rules /var/log/haproxy
COPY run/docker/files/haproxy.cfg.template /etc/haproxy/haproxy.cfg.template

# Tools (QuickJS scripts, rolldown-bundled by qjs-build above) — convert-rule.js is used
# by init-haproxy-cfg. Self-contained bundle — no separate /opt/buildcage/shared/ copy
# is needed, unlike before TypeScript migration. No report-action.js here: run/src/lib/
# report.ts builds its own report in-process instead of fetching one from the container.
COPY --from=qjs-build /build/dist/qjs/core/scripts/convert-rule.js /opt/buildcage/scripts/convert-rule.js

# runc — extracted onto the runner host at `run` action startup and used by
# run-isolated.sh to execute the isolated command (see docs/development.md)
COPY --from=deps /opt/buildcage/bin/runc /opt/buildcage/bin/runc

# ecapture — extracted onto the runner host at `run` action startup and run
# natively there (not inside this container), alongside the isolated command,
# so it observes the same host filesystem the sandbox's rootfs is bind-mounted
# from (see docs/security.md's Run Action HTTPS communication logs section).
COPY --from=deps /opt/buildcage/bin/ecapture /opt/buildcage/bin/ecapture

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
