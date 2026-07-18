# Mac-friendly dev-loop counterpart to the real sandbox action.
#
# Buildcage's own runc/kernel-namespace operations can't run natively on
# macOS (Darwin), so local development drives run-isolated.sh from inside a
# container instead: this one runs with `pid: host` (see
# ../compose.sandbox-dev.yaml) so it can see the sandbox proxy
# container's PID/netns via /proc, exactly like the real GitHub Actions
# runner host does for the real proxy container in production. It is NOT
# used in production or in CI's test_sandbox job (see
# docs/development.md) — those run run-isolated.sh directly on the runner
# host, matching what actually happens when a user's workflow executes.
FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

RUN apk add --no-cache bash util-linux iproute2 findutils

CMD ["sleep", "infinity"]
