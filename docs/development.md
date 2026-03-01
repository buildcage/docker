# Development Guide

This document covers local development, testing, and the project structure of buildcage.

## Local Usage

You can run buildcage locally without GitHub Actions using Docker Compose and Make.

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

### End-to-End Workflow

```bash
# 1. Start buildcage
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
```

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

## Makefile Commands

| Command | Description |
|---------|-------------|
| `make help` | Show available commands |
| `make run_audit_mode` | Start in audit mode |
| `make run_restrict_mode` | Start in restrict mode (default domains) |
| `make test_audit_mode` | Run audit mode tests (start → build → verify → clean up) |
| `make test_restrict_mode` | Run restrict mode tests (start → build → verify → clean up) |
| `make clean` | Remove all resources |

## Directory Structure

```
.
├── setup/
│   ├── action.yml             # GitHub Action: dash14/buildcage/setup@v1
│   ├── compose.yml            # Compose config for GitHub Actions (with image tag)
│   ├── main.mjs               # Setup entrypoint (rule generation, compose up)
│   ├── post.mjs               # Post-action cleanup
│   ├── convert-rules.mjs      # CLI: wildcard rules → regex (used by Makefile)
│   └── lib/
│       ├── rules.mjs          # Rule parser (wildcards, regex, ports)
│       └── rules.test.mjs     # Unit tests for rules.mjs
├── report/
│   ├── action.yml             # GitHub Action: dash14/buildcage/report@v1
│   └── main.mjs               # Log analysis and Job Summary output
├── docs/
│   ├── rules.md               # Rule format reference
│   ├── security.md            # Security design
│   └── self-hosting.md        # Self-hosting guide
├── compose.yml                # Docker Compose config
├── compose.test.yml           # Test override config
├── Makefile                   # Operational commands
├── docker/
│   ├── Dockerfile             # Multi-stage BuildKit + haproxy + dnsmasq + s6-overlay
│   └── files/                 # Builder container config files
│       ├── buildkitd.toml     # BuildKit config
│       ├── cni.conflist       # CNI config (isolated-net)
│       ├── dnsmasq.conf       # DNS config (all domains → gateway)
│       ├── haproxy.cfg.template # Dynamic HAProxy config (HTTP/HTTPS)
│       ├── s6-rc.d/           # s6-overlay service definitions
│       └── s6-scripts/        # s6-overlay init scripts
└── test/
    ├── Dockerfile.audit       # Audit mode test
    ├── Dockerfile.restrict    # Restrict mode test
    ├── assert-audit-mode.sh   # Audit mode verification script
    ├── assert-restrict-mode.sh # Restrict mode verification script
    ├── helpers.sh             # Test helpers
    ├── test-server/           # Test HTTP server
    └── test-dns/              # Test DNS server
```
