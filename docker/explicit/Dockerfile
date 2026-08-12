# Build buildkit-proxy (statically linked; discarded after this stage)
#
# BUILDKIT_PROXY_BUILD_TAGS is empty for every real build (including
# published releases): the "testhooks" build tag (see
# docker/explicit/buildkit-proxy/ca_testhooks.go) is compiled in only
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
COPY docker/explicit/buildkit-proxy/go.mod docker/explicit/buildkit-proxy/go.sum ./
RUN go mod download
COPY docker/explicit/buildkit-proxy/ ./
RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -tags="${BUILDKIT_PROXY_BUILD_TAGS}" -o /out/buildkit-proxy .

# Bundle the Docker-image scripts (rolldown; see rolldown.scripts.config.js):
# the QuickJS scripts and report-action.node.ts. Architecture-independent
# output, so pinned to --platform=$BUILDPLATFORM like buildkit-proxy-build
# above (no QEMU). Keep byte-identical to the same stage in
# docker/transparent/Dockerfile.
FROM --platform=$BUILDPLATFORM ghcr.io/pnpm/pnpm:11@sha256:e26f380828856f205feaaf42abd157df9ce41bc8e17b662eeaa3379a9638dee0 AS scripts-build
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts
COPY rolldown.scripts.config.js ./
COPY src/core/ ./src/core/
COPY docker/lib/ ./docker/lib/
COPY docker/explicit/scripts/ ./docker/explicit/scripts/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm run build:scripts

# Final image
FROM moby/buildkit:v0.31.2@sha256:2f5adac4ecd194d9f8c10b7b5d7bceb5186853db1b26e5abd3a657af0b7e26ec

LABEL org.opencontainers.image.title="buildcage (explicit proxy engine)" \
      org.opencontainers.image.description="Secure Docker build environment using BuildKit's native --proxy-network" \
      org.opencontainers.image.licenses="MIT AND Apache-2.0" \
      org.opencontainers.image.source="https://github.com/buildcage/docker" \
      io.github.buildcage.report-source="true"
# report finds this container by this label — must match src/core/lib/docker/report-source.ts.

# quickjs-ng is the only extra package needed, for source-policy generation.
RUN apk add --no-cache quickjs-ng

# buildkit-proxy binary
COPY --from=buildkit-proxy-build /out/buildkit-proxy /opt/buildcage/bin/buildkit-proxy

# BuildKit config
RUN mkdir -p /etc/buildkit /var/log/buildkitd
COPY docker/explicit/files/buildkitd.toml /etc/buildkit/buildkitd.toml

# Tools (QuickJS scripts, rolldown-bundled by scripts-build above). gen-source-policy.js
# is explicit-only, so it lives next to this Dockerfile instead of src/core/ (see
# docker/explicit/scripts/). Self-contained bundle — no separate
# /opt/buildcage/shared/ copy is needed, unlike before TypeScript migration.
COPY --from=scripts-build /build/dist/qjs/docker/explicit/scripts/gen-source-policy.js /opt/buildcage/scripts/gen-source-policy.js

# report-action.js — the runner-side report generator `docker cp`'d out by
# the report action itself (never staged elsewhere); see its own header
# comment for details.
COPY --from=scripts-build /build/dist/report-action/docker/explicit/scripts/report-action.js /opt/buildcage/scripts/report-action.js

# License
COPY docker/explicit/files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

ENTRYPOINT ["/opt/buildcage/bin/buildkit-proxy"]
