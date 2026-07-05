# Development Guide

This document covers local development, testing, and the project structure of Buildcage.

## Local Usage

You can run Buildcage locally without GitHub Actions using Docker Compose and Make.

> GitHub Actions inputs use lowercase names (e.g., `proxy_mode`), while environment variables for local usage use uppercase (e.g., `PROXY_MODE`).

### Starting the Builder

**Audit mode** (log all connections):

```bash
make run_audit_mode
```

**Restrict mode** (allowlist-based):

```bash
make run_restrict_mode
```

**Start with custom domains**:

```bash
ALLOWED_HTTPS_RULES="github.com:443 npmjs.org:443 example.com:443" make run_restrict_mode
```

**Explicit proxy engine** (BuildKit's native `--proxy-network` instead of the CNI/HAProxy stack —
see [Proxy Engines](../README.md#proxy-engines)):

```bash
make run_explicit_mode
```

`PROXY_ENGINE=explicit` selects `docker/explicit/Dockerfile` at build time (see `compose.yaml`'s
`build.dockerfile: ${PROXY_ENGINE:-transparent}/Dockerfile`); the default, unset case builds
`docker/transparent/Dockerfile` exactly as before.

### End-to-End Workflow

```bash
# 1. Start Buildcage
make run_audit_mode

# 2. Build
docker buildx build --builder buildcage --progress=plain -f Dockerfile .

# 3. View report
docker compose logs builder

# 4. Clean up
make clean
```

## Testing

```bash
# Audit mode test (start → build → verify → clean up)
make test_audit_mode

# Restrict mode test (start → build → verify → clean up)
make test_restrict_mode

# Explicit proxy engine test (start → build → verify → clean up)
make test_explicit_mode
```

## Local Development

### Image provenance verification bypass

When running the setup action locally against a branch ref or a local `./setup` path, the
action cannot resolve the ref to a published release. Because the setup action is fail-closed
by default, it will exit with an error for such "unverifiable" refs.

For development use, you can allow the action to pull the image without verification by
setting:

```bash
BUILDCAGE_ALLOW_UNVERIFIED=1
```

> **⚠ This flag is for local development only.**
> Never use it in CI or production workflows.
> It is active only for unverifiable refs (branch names, local paths); version tags and
> commit SHAs always go through full Sigstore verification regardless of this flag.

See [security.md](./security.md#known-limitations) for more details.

## Viewing Logs

```bash
# All communication logs
docker compose logs builder

# Real-time log monitoring
docker compose logs -f builder
```

**Log format:**

```
[28/Feb/2026:10:15:30 +0000] buildcage [ALLOWED] "github.com:443" -
[28/Feb/2026:10:15:31 +0000] buildcage [BLOCKED] "malicious.com:443" not-allowed
[28/Feb/2026:10:15:32 +0000] buildcage [AUDIT] "npmjs.org:80" -
```

Fields: `[timestamp] buildcage [status] "domain:port" reason`

**In `proxy_engine: explicit`**, there is no HAProxy log — allowed requests appear directly in the
build step's own console output (`proxy network requests:` in the `docker buildx build` log), and
denied requests are recorded in buildkitd's own debug log at `/var/log/buildkitd/current` inside the
container. The `report` action reads whichever of the two files exists, so `docker compose logs
builder` (which shows buildkitd's combined stdout either way) and the `report` action work
unmodified against either engine.

## Makefile Commands

| Command | Description |
|---------|-------------|
| `make help` | Show available commands |
| `make run_audit_mode` | Start in audit mode |
| `make run_restrict_mode` | Start in restrict mode (default domains) |
| `make run_explicit_mode` | Start with the explicit proxy engine (restrict mode) |
| `make test_audit_mode` | Run audit mode tests (start → build → verify → clean up) |
| `make test_restrict_mode` | Run restrict mode tests (start → build → verify → clean up) |
| `make test_explicit_mode` | Run explicit-engine tests (start → build → verify → clean up) |
| `make test_unit` | Run unit tests |
| `make clean` | Remove all resources |

## Directory Structure

```
.
├── setup/                       # GitHub Actions setup
│   ├── action.yml               # Action entry (node24 → dist/main.cjs, dist/post.cjs)
│   ├── compose.yaml             # Compose config for GitHub Actions (with image tag)
│   ├── src/                     # Source (ESM)
│   │   ├── main.js              # Verify image provenance, resolve image ref, compose up
│   │   ├── post.js              # Post-action cleanup
│   │   └── lib/                 # Helpers: OCI registry, Sigstore verification, error types
│   └── dist/                    # Bundled output (rollup → CommonJS)
│       ├── main.cjs
│       └── post.cjs
├── report/                      # GitHub Actions report
│   ├── action.yml               # Action entry (node24 → dist/main.cjs)
│   ├── src/                     # Source (ESM)
│   │   ├── main.js              # Log analysis and Job Summary output
│   │   └── lib/                 # Helpers: Job Summary rendering
│   └── dist/                    # Bundled output (rollup → CommonJS)
│       └── main.cjs
├── docker/
│   ├── transparent/              # proxy_engine: transparent (default)
│   │   ├── Dockerfile            # Multi-stage BuildKit + haproxy + dnsmasq + s6-overlay
│   │   └── files/
│   │       ├── buildkitd.toml       # BuildKit config
│   │       ├── cni.conflist         # CNI config (isolated-net)
│   │       ├── dnsmasq.conf         # DNS config (all domains → gateway)
│   │       ├── haproxy.cfg.template # Dynamic HAProxy config (HTTP/HTTPS)
│   │       ├── s6-rc.d/             # s6-overlay service definitions
│   │       ├── s6-scripts/          # s6-overlay init scripts
│   │       └── tools/               # QuickJS scripts (run inside container)
│   │           ├── convert-rule.js  # stdin wildcard → stdout regex filter
│   │           ├── report.js        # Parse HAProxy logs → structured JSON
│   │           └── lib/
│   │               ├── log-parser.js    # Log parsing and aggregation
│   │               └── log-parser.test.js
│   ├── explicit/                 # proxy_engine: explicit (BuildKit --proxy-network)
│   │   ├── Dockerfile            # buildkitd + quickjs only — no s6, no haproxy, no dnsmasq
│   │   ├── buildkit-proxy/       # Go module: entrypoint/PID1, supervises buildkitd,
│   │   │                         # gRPC proxy that injects the source policy into Solve
│   │   │   ├── main.go
│   │   │   ├── supervisor.go     # prepares env + launches/manages the buildkitd child process
│   │   │   ├── ca_prod.go        # buildkitdEnv() — production (no-op), default build
│   │   │   ├── ca_testhooks.go   # buildkitdEnv() — test-only CA trust, `-tags testhooks` only
│   │   │   ├── solve.go          # Solve interception + client-policy merge
│   │   │   ├── proxy.go          # generic passthrough for every other RPC
│   │   │   ├── codec.go
│   │   │   ├── frame.go
│   │   │   └── policy.go
│   │   └── files/
│   │       ├── buildkitd.toml       # proxyNetwork = true, internal grpc socket
│   │       ├── cni.conflist         # used only as the internal proxy's own egress network
│   │       └── tools/
│   │           ├── gen-source-policy.js  # rules → BuildKit source-policy JSON
│   │           ├── report.js             # parses buildkitd's own debug log
│   │           └── lib/
│   │               ├── source-policy.js
│   │               ├── source-policy.test.js
│   │               ├── buildkitd-log-parser.js
│   │               └── buildkitd-log-parser.test.js
│   └── shared/                   # used by both engines' Dockerfiles
│       └── tools/lib/
│           ├── rules.js          # Wildcard → regex conversion (same syntax, both engines)
│           ├── rules.test.js
│           └── test-shim.js      # Minimal test runner for QuickJS
├── docs/
│   ├── development.md           # Development guide
│   ├── rules.md                 # Rule format reference
│   ├── security.md              # Security design
│   └── self-hosting.md          # Self-hosting guide
├── test/
│   ├── Dockerfile.audit         # Audit mode test
│   ├── Dockerfile.restrict      # Restrict mode test
│   ├── Dockerfile.explicit      # Explicit-engine test
│   ├── assert-audit-mode.sh     # Audit mode verification script
│   ├── assert-restrict-mode.sh  # Restrict mode verification script
│   ├── assert-explicit-mode.sh  # Explicit-engine verification script
│   ├── assert-explicit-source-policy-conflict.sh
│   ├── helpers.sh               # Test helpers
│   ├── test-server/             # Test HTTP server (transparent-engine tests)
│   ├── test-dns/                # Test DNS server (transparent-engine tests)
│   ├── test-server-explicit/    # Test HTTP server (explicit-engine tests — static cert
│   │                            # trusted via BUILDKIT_PROXY_EXTRA_CA_FILE)
│   └── test-dns-explicit/       # Test DNS server (explicit-engine tests — forwards
│                                # non-test domains to a real resolver, for FROM pulls)
├── compose.yaml                 # Docker Compose config (dockerfile path selected by PROXY_ENGINE)
├── compose.test-transparent.yaml # Test override config (transparent engine)
├── compose.test-explicit.yaml    # Test override config (explicit engine)
└── Makefile                     # Operational commands
```
