# Mac-friendly dev-loop counterpart to the real run action.
#
# Buildcage's own runc/kernel-namespace operations can't run natively on
# macOS (Darwin), so local development drives run-isolated.sh from inside a
# container instead: this one runs with `pid: host` (see
# ../compose.sandbox-dev.yaml) so it can see the proxy
# container's PID/netns via /proc, exactly like the real GitHub Actions
# runner host does for the real proxy container in production. It is NOT
# used in production or in CI's test_sandbox job (see
# docs/development.md) — those run run-isolated.sh directly on the runner
# host, matching what actually happens when a user's workflow executes.
#
# runc and gen-seccomp-profile are built directly into this image (mirroring
# ../docker/Dockerfile's own stages) rather than `docker cp`-extracted from
# the proxy image at runtime, so this dev loop doesn't need the Docker
# socket mounted in just to reach a sibling container — it stays scoped to
# testing run-isolated.sh itself.
# renovate: datasource=github-releases depName=opencontainers/runc
ARG RUNC_VERSION=v1.5.1
ARG RUNC_SHA256_AMD64=177df879d50c913eb205e898d5c1c05a18f574053c0ce5524c471208eaf06f6f
ARG RUNC_SHA256_ARM64=ca70e7dbd6616ca782a59b5d3ac86909123fdaa9fa3f89dcf29051c70eee7ce9

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

FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2 AS gen-seccomp-profile-build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY docker/gen-seccomp-profile/go.mod docker/gen-seccomp-profile/go.sum ./
RUN go mod download
COPY docker/gen-seccomp-profile/main.go ./
RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build -trimpath -ldflags="-s -w" -o /out/gen-seccomp-profile .

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

RUN apk add --no-cache bash util-linux iproute2 findutils jq

COPY --from=deps /opt/buildcage/bin/runc /usr/local/bin/runc
COPY --from=gen-seccomp-profile-build /out/gen-seccomp-profile /usr/local/bin/gen-seccomp-profile

CMD ["sleep", "infinity"]
