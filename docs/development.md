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
ALLOWED_HTTPS_DOMAINS="github.com,npmjs.org,example.com" make run_restrict_mode
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
[28/Jan/2026:10:15:30 +0000] [ALLOWED] TCP 200 1234 5678 0.123 "github.com:443"
[28/Jan/2026:10:15:31 +0000] [BLOCKED] TCP 502 0 0 0.001 "malicious.com:443"
[28/Jan/2026:10:15:32 +0000] [AUDIT] HTTP 200 2345 6789 0.234 "npmjs.org:80"
```

Fields: `[timestamp] [status] protocol http_status bytes_sent bytes_received duration "domain:port"`

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
│   └── compose.yml            # Compose config for GitHub Actions (with image tag)
├── report/
│   ├── action.yml             # GitHub Action: dash14/buildcage/report@v1
│   └── main.mjs               # Log analysis and Job Summary output
├── docs/                      # Documents
├── compose.yml                # Docker Compose config
├── compose.test.yml           # Test override config
├── Makefile                   # Operational commands
├── docker/
│   ├── Dockerfile             # Multi-stage BuildKit + nginx + dnsmasq
│   └── files/                 # Builder container config files
│       ├── entrypoint.sh      # iptables/dnsmasq/nginx/buildkitd startup
│       ├── buildkitd.toml     # BuildKit config
│       ├── cni.conflist       # CNI config (isolated-net)
│       ├── dnsmasq.conf       # DNS config (all domains → gateway)
│       └── nginx.conf.template # Dynamic nginx config (HTTP/HTTPS)
└── test/
    ├── Dockerfile.audit       # Audit mode test
    ├── Dockerfile.restrict    # Restrict mode test
    ├── assert-audit-mode.sh   # Audit mode verification script
    ├── assert-restrict-mode.sh # Restrict mode verification script
    ├── helpers.sh             # Test helpers
    ├── test-server/           # Test HTTP server
    └── test-dns/              # Test DNS server
```
