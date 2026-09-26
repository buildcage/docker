# renovate: datasource=github-releases depName=containernetworking/plugins
ARG CNI_VERSION=v1.9.1
ARG CNI_SHA256_AMD64=b98f74a0f8522f0a83867178729c1aa70f2158f90c45a2ca8fa791db1c76b303
ARG CNI_SHA256_ARM64=56171987d3947707c3563db2f4001bccaf50fd63468611b9f3cbecb1375ee7ec

# renovate: datasource=github-releases depName=coredns/coredns
ARG COREDNS_VERSION=1.14.7
ARG COREDNS_SHA256_AMD64=9a09356438c6d9591cb80011a2a7a52f87fc3a113f6690e41f243f98b98faac9
ARG COREDNS_SHA256_ARM64=bf26782d19b5340e3e6cb50f1ed6df72f58e4a30932c79d167f0f0a8b1e92e16

# The BuildKit base is a release behind and carries HAProxy 3.2, whose resolver
# defaults are not the ones the generated config is written against.
# renovate: datasource=docker depName=alpine
ARG HAPROXY_ALPINE_BRANCH=3.24
ARG HAPROXY_BRANCH=3.4

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS deps
ARG CNI_VERSION
ARG CNI_SHA256_AMD64
ARG CNI_SHA256_ARM64
ARG COREDNS_VERSION
ARG COREDNS_SHA256_AMD64
ARG COREDNS_SHA256_ARM64
RUN apk add --no-cache curl util-linux-misc && \
    ARCH=$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/') && \
    mkdir -p /opt/cni/bin && \
    CNI_SHA=$([ "$ARCH" = "amd64" ] && echo "$CNI_SHA256_AMD64" || echo "$CNI_SHA256_ARM64") && \
    curl -fsSL "https://github.com/containernetworking/plugins/releases/download/${CNI_VERSION}/cni-plugins-linux-${ARCH}-${CNI_VERSION}.tgz" \
      -o /tmp/cni.tgz && \
    echo "${CNI_SHA}  /tmp/cni.tgz" | sha256sum -c && \
    tar -C /opt/cni/bin -xz -f /tmp/cni.tgz ./bridge ./host-local ./loopback && \
    COREDNS_SHA=$([ "$ARCH" = "amd64" ] && echo "$COREDNS_SHA256_AMD64" || echo "$COREDNS_SHA256_ARM64") && \
    curl -fsSL "https://github.com/coredns/coredns/releases/download/v${COREDNS_VERSION}/coredns_${COREDNS_VERSION}_linux_${ARCH}.tgz" \
      -o /tmp/coredns.tgz && \
    echo "${COREDNS_SHA}  /tmp/coredns.tgz" | sha256sum -c && \
    tar -C /usr/local/bin -xz -f /tmp/coredns.tgz coredns

# Build the runc wrapper (statically linked). --platform=$BUILDPLATFORM keeps
# the Go toolchain on the build host's own architecture; GOOS/GOARCH then
# cross-compile for the target.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine@sha256:4cb7ac979db5fcc41cae44b2227ba5ab8a51e8807f40d9ba4dee20a0ad960b5b AS runc-wrapper-build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY docker/inspect/buildcage-runc/ ./
RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
    go build -trimpath -ldflags="-s -w" -o /out/buildcage-runc .

# Bundle the Docker-image scripts (rolldown; see rolldown.scripts.config.js):
# the QuickJS config generator and report-action.node.ts. Architecture-
# independent output, so pinned to --platform=$BUILDPLATFORM like
# runc-wrapper-build above (no QEMU).
FROM --platform=$BUILDPLATFORM ghcr.io/pnpm/pnpm:11@sha256:e26f380828856f205feaaf42abd157df9ce41bc8e17b662eeaa3379a9638dee0 AS scripts-build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY rolldown.scripts.config.js ./
COPY src/core/ ./src/core/
COPY docker/inspect/scripts/ ./docker/inspect/scripts/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm run build:scripts

# Final image
FROM moby/buildkit:v0.33.0@sha256:6c2fa84a6b61ccd72899dde4239f8d5717f05f9a8ca6f3cad185fb1a95a94de3

LABEL org.opencontainers.image.title="buildcage (inspect proxy engine)" \
      org.opencontainers.image.description="Secure Docker build environment enforcing on method, URL and path" \
      org.opencontainers.image.licenses="MIT AND Apache-2.0 AND GPL-2.0-or-later AND ISC AND MPL-2.0" \
      org.opencontainers.image.source="https://github.com/buildcage/docker" \
      io.github.buildcage.report-source="true"
# report finds this container by this label; must match src/core/lib/docker/report-source.ts.

# nss-tools is for certutil, which init-inspect-cfg makes Chromium's NSS
# database with.
RUN apk add --no-cache \
      s6-overlay \
      openssl \
      nss-tools \
      iptables \
      curl \
      quickjs-ng \
      rsync

# haproxy carries what this engine needs in one binary: it tells a TLS
# handshake from a plain request by its first bytes, generates certificates for
# an SNI, resolves names itself, and normalizes a path before matching it.
#
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

COPY --from=deps /opt/cni/bin /opt/cni/bin
COPY --from=deps /usr/local/bin/coredns /usr/local/bin/coredns
# For s6-rc.d/haproxy/run. The binary alone needs only musl; the package
# would pull in ~6MB.
COPY --from=deps /bin/pipesz /usr/bin/pipesz

# CoreDNS answers queries the build controls, so it must not run as root.
# setcap keeps :53 bindable once it has dropped.
RUN apk add --no-cache --virtual .setcap libcap-utils && \
    addgroup -S coredns && adduser -S -D -H -G coredns coredns && \
    setcap cap_net_bind_service=+ep /usr/local/bin/coredns && \
    apk del .setcap

COPY --from=runc-wrapper-build /out/buildcage-runc /opt/buildcage/bin/buildcage-runc

RUN mkdir -p /etc/buildkit /etc/coredns /etc/haproxy /var/log/haproxy \
      /var/log/coredns /var/log/buildcage /run/buildcage
COPY docker/inspect/files/buildkitd.toml /etc/buildkit/buildkitd.toml
COPY docker/inspect/files/cni.conflist   /etc/buildkit/cni.conflist

# Writes haproxy.cfg and the Corefile at startup, both from one rule set in a single run.
COPY --from=scripts-build /build/dist/qjs/docker/inspect/scripts/gen-configs.js /opt/buildcage/scripts/gen-configs.js

# Never run inside the image: the report action `docker cp`s it out and runs
# it on the runner (see report-action.node.ts).
COPY --from=scripts-build /build/dist/report-action/docker/inspect/scripts/report-action.js /opt/buildcage/scripts/report-action.js

COPY docker/inspect/files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

COPY docker/inspect/files/s6-rc.d/    /etc/s6-overlay/s6-rc.d/
COPY docker/inspect/files/s6-scripts/ /etc/s6-overlay/scripts/

# Test-only. The integration fixtures serve a self-signed certificate no public
# store contains, so the proxy has to be told to trust it when it verifies the
# origin. The marker exists only in an image built with this arg set, so a
# released proxy has no way to be told the same thing: the check in
# init-inspect-cfg finds nothing to act on. Never set for a real build.
ARG BUILDCAGE_TEST_HOOKS=""
RUN if [ -n "$BUILDCAGE_TEST_HOOKS" ]; then touch /opt/buildcage/.test-hooks; fi

ENTRYPOINT ["/init"]
