# renovate: datasource=github-releases depName=containernetworking/plugins
ARG CNI_VERSION=v1.9.1
ARG CNI_SHA256_AMD64=b98f74a0f8522f0a83867178729c1aa70f2158f90c45a2ca8fa791db1c76b303
ARG CNI_SHA256_ARM64=56171987d3947707c3563db2f4001bccaf50fd63468611b9f3cbecb1375ee7ec

# The BuildKit base is a release behind and carries HAProxy 3.2, whose resolver
# defaults are not the ones the generated config is written against.
# renovate: datasource=docker depName=alpine
ARG HAPROXY_ALPINE_BRANCH=3.24
ARG HAPROXY_BRANCH=3.4

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
# docker/explicit/Dockerfile. Needs both engines' scripts/ dirs:
# gen-source-policy.qjs.ts only exists under explicit/, report-action.node.ts
# under this engine's own dir.
FROM --platform=$BUILDPLATFORM ghcr.io/pnpm/pnpm:11@sha256:e26f380828856f205feaaf42abd157df9ce41bc8e17b662eeaa3379a9638dee0 AS scripts-build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY rolldown.scripts.config.js ./
COPY src/core/ ./src/core/
COPY docker/explicit/scripts/ ./docker/explicit/scripts/
COPY docker/universal/scripts/ ./docker/universal/scripts/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm run build:scripts

# Final image
FROM moby/buildkit:v0.33.0@sha256:6c2fa84a6b61ccd72899dde4239f8d5717f05f9a8ca6f3cad185fb1a95a94de3

LABEL org.opencontainers.image.title="buildcage" \
      org.opencontainers.image.description="Secure Docker build environment with network access control" \
      org.opencontainers.image.licenses="MIT AND GPL-2.0-or-later" \
      org.opencontainers.image.source="https://github.com/buildcage/docker" \
      io.github.buildcage.report-source="true"
# report finds this container by this label; must match src/core/lib/docker/report-source.ts.

RUN apk add --no-cache \
      s6-overlay \
      dnsmasq \
      iptables \
      curl \
      quickjs-ng

# Its own apk call so the extra repository serves this package alone; naming the
# branch is what makes apk fail rather than warn and fall back to the base's
# own. Drop the repository once the base's Alpine carries this branch.
ARG HAPROXY_ALPINE_BRANCH
ARG HAPROXY_BRANCH
RUN apk add --no-cache \
      --repository https://dl-cdn.alpinelinux.org/alpine/v${HAPROXY_ALPINE_BRANCH}/main \
      "haproxy~${HAPROXY_BRANCH}"

ENV S6_KEEP_ENV=1
ENV S6_LOGGING=0
# Every oneshot here sets something up that the cage depends on, so a failed one
# has to take the container down rather than leave it running and apparently
# healthy while buildkitd is silently absent.
ENV S6_BEHAVIOUR_IF_STAGE2_FAILS=2
# Bounds the start transition itself, which otherwise waits forever on a service
# that never reports ready.
ENV S6_CMD_WAIT_FOR_SERVICES_MAXTIME=90000
# Shutdown sleeps this long unconditionally between its SIGTERM and SIGKILL, so
# the default 3000 costs every teardown 3s. The services stop in under 1s.
ENV S6_KILL_GRACETIME=500

# envsubst
COPY --from=deps /usr/bin/envsubst /usr/bin/envsubst
COPY --from=deps /usr/lib/libintl.so* /usr/lib/

# CNI
COPY --from=deps /opt/cni/bin /opt/cni/bin

# BuildKit
RUN mkdir -p /etc/buildkit
COPY docker/universal/files/buildkitd.toml /etc/buildkit/buildkitd.toml
COPY docker/universal/files/cni.conflist   /etc/buildkit/cni.conflist

# DNS
COPY docker/universal/files/dnsmasq.conf /etc/dnsmasq.conf

# HAProxy
RUN mkdir -p /etc/haproxy/rules /var/log/haproxy
COPY docker/universal/files/haproxy.cfg.template /etc/haproxy/haproxy.cfg.template

# Tools (QuickJS scripts, rolldown-bundled by scripts-build above). Each is a self-contained
# bundle, so no separate /opt/buildcage/shared/ copy is needed.
COPY --from=scripts-build /build/dist/qjs/src/core/scripts/convert-rule.js /opt/buildcage/scripts/convert-rule.js

# report-action.js is the runner-side report generator `docker cp`'d out by
# the report action itself (never staged elsewhere); see its own header
# comment for details.
COPY --from=scripts-build /build/dist/report-action/docker/universal/scripts/report-action.js /opt/buildcage/scripts/report-action.js

# License
COPY docker/universal/files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

# s6 service definitions and init scripts
COPY docker/universal/files/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
COPY docker/universal/files/s6-scripts/ /etc/s6-overlay/scripts/

ENTRYPOINT ["/init"]
