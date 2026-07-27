# Build buildkit-proxy (statically linked; discarded after this stage)
#
# BUILDKIT_PROXY_BUILD_TAGS is empty for every real build (including
# published releases): the "testhooks" build tag (see
# setup/docker/explicit/buildkit-proxy/ca_testhooks.go) is compiled in only
# when compose.test-explicit.yaml explicitly passes it, so
# integration-test-only code (a self-signed-cert CA-trust escape hatch) is
# physically absent from the published image's binary.
#
# --platform=$BUILDPLATFORM pins this stage to the build host's own
# architecture even when the overall image is being built for a different
# target platform (e.g. linux/arm64 on an amd64 GitHub Actions runner), so
# the Go toolchain always runs natively instead of under QEMU emulation.
# GOOS/GOARCH below then cross-compile the actual output binary for the
# target platform — CGO_ENABLED=0 makes this a plain, fast cross-compile.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS buildkit-proxy-build
ARG BUILDKIT_PROXY_BUILD_TAGS=""
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY setup/docker/explicit/buildkit-proxy/go.mod setup/docker/explicit/buildkit-proxy/go.sum ./
RUN go mod download
COPY setup/docker/explicit/buildkit-proxy/ ./
RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -tags="${BUILDKIT_PROXY_BUILD_TAGS}" -o /out/buildkit-proxy .

# Compile the QuickJS-targeted TypeScript sources to plain ESM JavaScript
# that `qjs --std -m` can execute directly (QuickJS has no TypeScript
# support). tsc only strips types; rolldown does the actual bundling — same
# division of labor as the Actions entrypoints (see rolldown.config.js), just
# targeting quickjs-ng's ESM runtime (format esm, "qjs:std"/"qjs:os" left
# external) instead of Node's CJS. Output is architecture-independent, so —
# same reasoning as buildkit-proxy-build above — this stage is pinned to
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
COPY setup/docker/explicit/scripts/ ./setup/docker/explicit/scripts/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm run build:qjs

# Compiles report-action.node.ts (Node-targeted) to a single-file CJS
# bundle `node` can execute standalone. Keep byte-identical to the same
# stage in setup/docker/transparent/Dockerfile (run/docker/Dockerfile
# doesn't need it — run builds its own report in-process instead).
FROM --platform=$BUILDPLATFORM ghcr.io/pnpm/pnpm:11@sha256:e26f380828856f205feaaf42abd157df9ce41bc8e17b662eeaa3379a9638dee0 AS report-action-build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY rolldown.report-action.config.js tsconfig.json ./
COPY core/lib/ ./core/lib/
COPY setup/docker/explicit/scripts/ ./setup/docker/explicit/scripts/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm run build:report-action

# Final image
FROM moby/buildkit:v0.31.1@sha256:6b59b7df63a8cb9902736f9ddf7fcff8261613d3e7449b8ea8b7537fc399c03a

LABEL org.opencontainers.image.title="buildcage (explicit proxy engine)" \
      org.opencontainers.image.description="Secure Docker build environment using BuildKit's native --proxy-network" \
      org.opencontainers.image.licenses="MIT AND Apache-2.0" \
      org.opencontainers.image.source="https://github.com/dash14/buildcage" \
      io.github.dash14.buildcage.report-source="true"

# quickjs-ng is the only extra package needed, for source-policy generation.
RUN apk add --no-cache quickjs-ng

# buildkit-proxy binary
COPY --from=buildkit-proxy-build /out/buildkit-proxy /opt/buildcage/bin/buildkit-proxy

# BuildKit config
RUN mkdir -p /etc/buildkit /var/log/buildkitd
COPY setup/docker/explicit/files/buildkitd.toml /etc/buildkit/buildkitd.toml

# Tools (QuickJS scripts, rolldown-bundled by qjs-build above). gen-source-policy.js
# is explicit-only, so it lives next to this Dockerfile instead of core/ (see
# setup/docker/explicit/scripts/). Self-contained bundle — no separate
# /opt/buildcage/shared/ copy is needed, unlike before TypeScript migration.
COPY --from=qjs-build /build/dist/qjs/setup/docker/explicit/scripts/gen-source-policy.js /opt/buildcage/scripts/gen-source-policy.js

# report-action.js — the runner-side report generator `docker cp`'d out by
# the report action itself (never staged elsewhere); see its own header
# comment for details.
COPY --from=report-action-build /build/dist/report-action/setup/docker/explicit/scripts/report-action.js /opt/buildcage/scripts/report-action.js

# License
COPY setup/docker/explicit/files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

ENTRYPOINT ["/opt/buildcage/bin/buildkit-proxy"]
