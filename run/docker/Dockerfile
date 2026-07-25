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
FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS gen-seccomp-profile-build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY run/docker/gen-seccomp-profile/go.mod run/docker/gen-seccomp-profile/go.sum ./
RUN go mod download
COPY run/docker/gen-seccomp-profile/main.go ./
RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -o /out/gen-seccomp-profile .

# Compile the QuickJS-targeted TypeScript sources to plain ESM JavaScript
# that `qjs --std -m` can execute directly (QuickJS has no TypeScript
# support). tsc only strips types; rolldown does the actual bundling — same
# division of labor as the Actions entrypoints (see rolldown.config.js), just
# targeting quickjs-ng's ESM runtime (format esm, "qjs:std"/"qjs:os" left
# external) instead of Node's CJS. Output is architecture-independent, so —
# same reasoning as gen-seccomp-profile-build above — this stage is pinned to
# --platform=$BUILDPLATFORM to always run natively (no QEMU). Keep this stage
# byte-identical across setup/docker/transparent/Dockerfile,
# setup/docker/explicit/Dockerfile, and run/docker/Dockerfile.
FROM --platform=$BUILDPLATFORM ghcr.io/pnpm/pnpm:11@sha256:e26f380828856f205feaaf42abd157df9ce41bc8e17b662eeaa3379a9638dee0 AS qjs-build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY rolldown.qjs.config.js tsconfig.qjs.json ./
COPY core/scripts/ ./core/scripts/
COPY core/lib/acl/ ./core/lib/acl/
COPY core/lib/log/ ./core/lib/log/
COPY core/lib/report/ ./core/lib/report/
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
# by init-haproxy-cfg, report.js by the run action's report step. Each is a self-contained
# bundle — no separate /opt/buildcage/shared/ copy is needed, unlike before TypeScript
# migration.
COPY --from=qjs-build /build/dist/qjs/core/scripts/convert-rule.js /opt/buildcage/scripts/convert-rule.js
COPY --from=qjs-build /build/dist/qjs/core/scripts/report.js       /opt/buildcage/scripts/report.js

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
