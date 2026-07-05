# Development Guide

This document covers local development, testing, and the project structure of Buildcage.

## Local Usage

You can run Buildcage locally without GitHub Actions using Docker Compose and Make.

> GitHub Actions inputs use lowercase names (e.g., `proxy_mode`), while environment variables for local usage use uppercase (e.g., `PROXY_MODE`).

### Starting the Builder

There's one `run_{engine}_{mode}_mode` target per (`transparent`, `explicit`) x (`audit`, `restrict`)
combination:

```bash
make run_transparent_audit_mode
make run_transparent_restrict_mode
make run_explicit_audit_mode
make run_explicit_restrict_mode
```

**Start with custom domains** (restrict mode only):

```bash
ALLOWED_HTTPS_RULES="github.com:443 npmjs.org:443 example.com:443" make run_transparent_restrict_mode
```

The `explicit_*` targets use BuildKit's native `--proxy-network` instead of the CNI/HAProxy stack
(see [Proxy Engines](../README.md#proxy-engines)). `PROXY_ENGINE=explicit` selects
`docker/explicit/Dockerfile` at build time (see `compose.yaml`'s
`build.dockerfile: ${PROXY_ENGINE:-transparent}/Dockerfile`); the `transparent_*` targets build
`docker/transparent/Dockerfile` exactly as before.

### End-to-End Workflow

```bash
# 1. Start Buildcage
make run_transparent_audit_mode

# 2. Build
docker buildx build --builder buildcage --progress=plain -f Dockerfile .

# 3. View report
docker compose logs builder

# 4. Clean up
make clean
```

## Testing

Each `run_{engine}_{mode}_mode` target has a matching `test_{engine}_{mode}_mode` target
(start → build the matching `test/Dockerfile.*` → verify → clean up):

```bash
make test_transparent_audit_mode
make test_transparent_restrict_mode
make test_explicit_audit_mode
make test_explicit_restrict_mode
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
| `make run_transparent_audit_mode` | Start transparent engine in audit mode |
| `make run_transparent_restrict_mode` | Start transparent engine in restrict mode (default domains) |
| `make run_explicit_audit_mode` | Start explicit proxy engine in audit mode |
| `make run_explicit_restrict_mode` | Start explicit proxy engine in restrict mode |
| `make test_transparent_audit_mode` | Run transparent-engine audit mode tests (start → build → verify → clean up) |
| `make test_transparent_restrict_mode` | Run transparent-engine restrict mode tests (start → build → verify → clean up) |
| `make test_explicit_audit_mode` | Run explicit-engine audit mode tests (start → build → verify → clean up) |
| `make test_explicit_restrict_mode` | Run explicit-engine restrict mode tests (start → build → verify → clean up) |
| `make test_unit` | Run unit tests |
| `make clean` | Remove all resources |

## Directory Structure

```
.
├── setup/                    # GitHub Actions setup action
│   ├── action.yml            # Action entry (node24 → dist/main.cjs, dist/post.cjs)
│   ├── src/                  # Source (ESM): verify image provenance, resolve image ref, compose up
│   └── dist/                 # Bundled output (rollup → CommonJS)
├── report/                   # GitHub Actions report action
│   ├── action.yml            # Action entry (node24 → dist/main.cjs)
│   ├── src/                  # Source (ESM): log analysis, per-command breakdown, Job Summary output
│   └── dist/                 # Bundled output (rollup → CommonJS)
├── docker/
│   ├── tools/                # QuickJS scripts shared by the built images (shared/, transparent/,
│   │                         # explicit/ — each engine's rule/log/policy parsing and its tests)
│   ├── transparent/          # proxy_engine: transparent — Dockerfile + BuildKit/haproxy/dnsmasq/
│   │                         # s6-overlay config
│   └── explicit/             # proxy_engine: explicit — Dockerfile + buildkit-proxy/ (Go module:
│                             # entrypoint/PID1, supervises buildkitd, injects the source policy
│                             # into Solve via a gRPC proxy)
├── docs/                     # development.md, rules.md, security.md, self-hosting.md
├── test/                     # Dockerfile.*/assert-*.sh per {engine}-{mode} combination, plus
│                             # test-server(-explicit)/test-dns(-explicit) fixture containers
├── compose.yaml              # Docker Compose config (dockerfile path selected by PROXY_ENGINE)
├── compose.test-*.yaml       # Test override config, one per engine
└── Makefile                  # Operational commands
```
