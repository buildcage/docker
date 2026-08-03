# renovate: datasource=github-releases depName=containernetworking/plugins
ARG CNI_VERSION=v1.9.1
ARG CNI_SHA256_AMD64=b98f74a0f8522f0a83867178729c1aa70f2158f90c45a2ca8fa791db1c76b303
ARG CNI_SHA256_ARM64=56171987d3947707c3563db2f4001bccaf50fd63468611b9f3cbecb1375ee7ec

# Prepare dependencies
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS deps
ARG CNI_VERSION
ARG CNI_SHA256_AMD64
ARG CNI_SHA256_ARM64
RUN apk add --no-cache curl gettext && \
    mkdir -p /opt/cni/bin && \
    ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    EXPECTED_SHA256=$([ "$ARCH" = "amd64" ] && echo "$CNI_SHA256_AMD64" || echo "$CNI_SHA256_ARM64") && \
    curl -fsSL "https://github.com/containernetworking/plugins/releases/download/${CNI_VERSION}/cni-plugins-linux-${ARCH}-${CNI_VERSION}.tgz" \
      -o /tmp/cni.tgz && \
    echo "${EXPECTED_SHA256}  /tmp/cni.tgz" | sha256sum -c && \
    tar -C /opt/cni/bin -xz -f /tmp/cni.tgz ./bridge ./host-local ./loopback

# Bundle the Docker-image scripts (rolldown; see rolldown.scripts.config.js):
# the QuickJS scripts and report-action.node.ts. Architecture-independent
# output, so pinned to --platform=$BUILDPLATFORM like the `deps` stage
# above (no QEMU). Keep byte-identical to the same stage in
# setup/docker/explicit/Dockerfile (run/docker/Dockerfile only needs the
# qjs half — it builds its own report in-process instead). Needs both
# engines' scripts/ dirs: gen-source-policy.qjs.ts only exists under
# explicit/, report-action.node.ts under this engine's own dir.
FROM --platform=$BUILDPLATFORM ghcr.io/pnpm/pnpm:11@sha256:e26f380828856f205feaaf42abd157df9ce41bc8e17b662eeaa3379a9638dee0 AS scripts-build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY rolldown.scripts.config.js ./
COPY core/ ./core/
COPY setup/docker/explicit/scripts/ ./setup/docker/explicit/scripts/
COPY setup/docker/transparent/scripts/ ./setup/docker/transparent/scripts/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm run build:scripts

# Final image
FROM moby/buildkit:v0.31.2@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec

LABEL org.opencontainers.image.title="buildcage" \
      org.opencontainers.image.description="Secure Docker build environment with network access control" \
      org.opencontainers.image.licenses="MIT AND GPL-2.0-or-later" \
      org.opencontainers.image.source="https://github.com/dash14/buildcage" \
      io.github.buildcage.report-source="true"
# Keep in sync with core/lib/docker/report-source.ts's REPORT_SOURCE_LABEL.

RUN apk add --no-cache \
      s6-overlay \
      haproxy \
      dnsmasq \
      iptables \
      curl \
      quickjs-ng

ENV S6_KEEP_ENV=1
ENV S6_LOGGING=0

# envsubst
COPY --from=deps /usr/bin/envsubst /usr/bin/envsubst
COPY --from=deps /usr/lib/libintl.so* /usr/lib/

# CNI
COPY --from=deps /opt/cni/bin /opt/cni/bin

# BuildKit
RUN mkdir -p /etc/buildkit
COPY setup/docker/transparent/files/buildkitd.toml /etc/buildkit/buildkitd.toml
COPY setup/docker/transparent/files/cni.conflist   /etc/buildkit/cni.conflist

# DNS
COPY setup/docker/transparent/files/dnsmasq.conf /etc/dnsmasq.conf

# HAProxy
RUN mkdir -p /etc/haproxy/rules /var/log/haproxy
COPY setup/docker/transparent/files/haproxy.cfg.template /etc/haproxy/haproxy.cfg.template

# Tools (QuickJS scripts, rolldown-bundled by scripts-build above). Each is a self-contained
# bundle — no separate /opt/buildcage/shared/ copy is needed, unlike before TypeScript
# migration.
COPY --from=scripts-build /build/dist/qjs/core/scripts/convert-rule.js /opt/buildcage/scripts/convert-rule.js

# report-action.js — the runner-side report generator `docker cp`'d out by
# the report action itself (never staged elsewhere); see its own header
# comment for details.
COPY --from=scripts-build /build/dist/report-action/setup/docker/transparent/scripts/report-action.js /opt/buildcage/scripts/report-action.js

# License
COPY setup/docker/transparent/files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

# s6 service definitions and init scripts
COPY setup/docker/transparent/files/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
COPY setup/docker/transparent/files/s6-scripts/ /etc/s6-overlay/scripts/

ENTRYPOINT ["/init"]
