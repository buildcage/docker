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
FROM --platform=$BUILDPLATFORM golang:1.25-alpine@sha256:56961d79ea8129efddcc0b8643fd8a5416b4e6228cfd477e3fd61deb2672c587 AS buildkit-proxy-build
ARG BUILDKIT_PROXY_BUILD_TAGS=""
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY setup/docker/explicit/buildkit-proxy/go.mod setup/docker/explicit/buildkit-proxy/go.sum ./
RUN go mod download
COPY setup/docker/explicit/buildkit-proxy/ ./
RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -tags="${BUILDKIT_PROXY_BUILD_TAGS}" -o /out/buildkit-proxy .

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
COPY setup/docker/explicit/files/buildkitd.toml /etc/buildkit/buildkitd.toml

# Tools (QuickJS scripts). gen-source-policy.js/report.js are explicit-only,
# so they live next to this Dockerfile instead of core/ (see
# setup/docker/explicit/scripts/).
COPY setup/docker/explicit/scripts/ /opt/buildcage/scripts/
COPY core/shared/                   /opt/buildcage/shared/

# License
COPY setup/docker/explicit/files/THIRD_PARTY_LICENSES /opt/buildcage/THIRD_PARTY_LICENSES

ENTRYPOINT ["/opt/buildcage/bin/buildkit-proxy"]
