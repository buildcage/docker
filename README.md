# buildcage

![buildcage](./assets/banner.png)

A custom builder that controls outbound network access during Docker builds using an allowlist approach, mitigating supply chain attack risks.

## Background

During Docker build `RUN` instructions, package managers (apt, npm, pip, etc.) freely access the internet. While convenient, this poses the following risks:

- **Supply chain attacks**: Malicious packages or compromised dependencies can make unintended outbound connections during builds (as seen in incidents like the event-stream attack)
- **Data exfiltration**: Environment variables or source code could be sent to external servers during builds

Docker's built-in `--network=none` option completely blocks all network access, making it impossible to install packages at all.

**buildcage** solves this problem by allowing only the necessary connections via an allowlist, while blocking everything else.

## What is buildcage?

buildcage is a buildx custom builder that isolates the network of BuildKit RUN steps. It provides two operation modes:

- **Audit mode**: Records all network destinations during builds, useful for creating allowlists
- **Restrict mode**: Allows access only to permitted domains, blocking everything else

## Features

- 🔒 **Network isolation**: Isolates RUN instruction execution environments using CNI
- 📊 **Communication logs**: Detailed destination analysis
- 🚀 **GitHub Actions support**: Available as a reusable action for CI/CD pipelines

## Architecture

Containers spawned by BuildKit RUN steps are connected to a separate, isolated network via CNI. This network blocks all outbound traffic except to the internal DNS server and the internal proxy server.

The internal DNS server returns the proxy server's IP address for every DNS query, ensuring that all traffic from RUN step containers is routed through the proxy.

The internal proxy server inspects the SNI field (for HTTPS) or the Host header (for HTTP) of each request and checks it against the allowlist to decide whether to allow or block the connection.

```
┌──────────────────────────────────────────────────────────────────┐
│ Builder container (privileged, single container)                 │
│                                                                  │
│  ┌──────────────────────────┐                                    │
│  │ buildkitd (PID 1)        │──→ internet (image pull)           │
│  │ --oci-worker-net=cni     │                                    │
│  └──────────────────────────┘                                    │
│                                                                  │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐  │
│  │ dnsmasq                  │  │ nginx                        │  │
│  │ all domains → 172.20.0.1 │  │ HTTP proxy (port 80)         │  │
│  │ port 53                  │  │ HTTPS stream proxy (port 443)│  │
│  └──────────────────────────┘  │ Allow/Block based on         │  │
│              ↑                 │   SNI (HTTPS) / Host (HTTP)  │  │
│              │ DNS             │          ↓                   │  │
│              │                 │ internet (allowed domains)   │  │
│              │                 └──────────────────────────────┘  │
│   ···········│·· buildkit0 bridge (172.20.0.1) ··················│
│              │                    ↑                              │
│  ┌───────────┴────────────────────┴────────┐                     │
│  │ RUN Step containers (CNI isolated-net)  │                     │
│  │ IP: 172.20.0.100 - 172.20.0.200         │                     │
│  │                                         │                     │
│  │ DNS → 172.20.0.1:53 (dnsmasq)           │                     │
│  │ HTTP/HTTPS → 172.20.0.1 (nginx)         │                     │
│  │ Other traffic → blocked (iptables)      │                     │
│  └─────────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

## Operation Modes

### Audit Mode (PROXY_MODE=audit)
- **Behavior**: Allows all HTTP/HTTPS connections
- **Use cases**:
  - Investigating which domains are used during builds
  - Analyzing communication patterns for new projects
  - Establishing a baseline for security policy creation
- **Logging**: Records all connections with `[AUDIT]` marker

### Restrict Mode (PROXY_MODE=restrict)
- **Behavior**: Only allows access to domains on the allowlist
- **Use cases**:
  - Secure builds in production environments
  - Supply chain attack prevention
  - Preventing unintended outbound connections
- **Logging**: Categorizes and records as `[ALLOWED]`/`[BLOCKED]`

## Environment Variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `PROXY_MODE` | `audit`/`restrict` | `restrict` | Operation mode |
| `ALLOWED_HTTP_DOMAINS` | `domain1,domain2,...` | empty | Allowed HTTP domains (comma-separated) |
| `ALLOWED_HTTPS_DOMAINS` | `domain1,domain2,...` | empty | Allowed HTTPS domains (comma-separated) |
| `HTTP_PORTS` | `port1,port2,...` | `80` | HTTP proxy listen ports |
| `HTTPS_PORTS` | `port1,port2,...` | `443` | HTTPS proxy listen ports |
| `EXTERNAL_RESOLVER` | `ip1 ip2 ...` | `1.1.1.1 8.8.8.8 valid=300s` | Upstream DNS resolver for nginx |

## Usage with GitHub Actions

### Setup

```yaml
- name: Start buildcage builder
  id: buildcage
  uses: dash14/buildcage/setup@v1
  with:
    proxy_mode: audit
    allowed_https_domains: registry.npmjs.org
```

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `buildcage_image` | No | `ghcr.io/dash14/buildcage` | Docker image name |
| `buildcage_version` | No | `latest` | Image tag |
| `proxy_mode` | No | `restrict` | Operation mode (`audit` / `restrict`) |
| `allowed_http_domains` | No | empty | Allowed HTTP domains (comma-separated) |
| `allowed_https_domains` | No | empty | Allowed HTTPS domains (comma-separated) |

**Output:**

| Name | Description |
|------|-------------|
| `endpoint` | BuildKit endpoint to pass to `docker buildx create --driver remote` |

### Report

Displays communication logs after builds and fails if any BLOCKED connections are found:

```yaml
- name: Show proxy report
  uses: dash14/buildcage/report@v1
```

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `fail_on_blocked` | No | `true` | Fail the step if blocked connections are detected |

### Complete Example

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Start buildcage builder
        id: buildcage
        uses: dash14/buildcage/setup@v1
        with:
          proxy_mode: restrict
          allowed_https_domains: registry.npmjs.org

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
        with:
          driver: remote
          endpoint: ${{ steps.buildcage.outputs.endpoint }}

      - name: Build
        uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          no-cache: true

      - name: Show proxy report
        uses: dash14/buildcage/report@v1
```

## Development

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

After starting, use it with the standard `docker buildx build`:

```bash
docker buildx build --builder buildcage --progress=plain -f Dockerfile .
```

### Testing

```bash
# Audit mode test (start → build → verify → clean up)
make test_audit_mode

# Restrict mode test (start → build → verify → clean up)
make test_restrict_mode
```

### Viewing Logs

```bash
# All communication logs
./report/report.sh

# Real-time log monitoring
docker compose logs -f builder
```

Log format:

```
[2026-01-28T10:15:30+00:00] [ALLOWED] TCP 200 1234 5678 0.123 "github.com"
[2026-01-28T10:15:31+00:00] [BLOCKED] TCP 502 0 0 0.001 "malicious.com"
[2026-01-28T10:15:32+00:00] [AUDIT] TCP 200 2345 6789 0.234 "npmjs.org"
```

### Makefile Commands

| Command | Description |
|---------|-------------|
| `make help` | Show available commands |
| `make run_audit_mode` | Start in audit mode |
| `make run_restrict_mode` | Start in restrict mode (default domains) |
| `make test_audit_mode` | Run audit mode tests (start → build → verify → clean up) |
| `make test_restrict_mode` | Run restrict mode tests (start → build → verify → clean up) |
| `make clean` | Remove all resources |

### Directory Structure

```
.
├── setup/
│   ├── action.yml             # GitHub Action: dash14/buildcage/setup@v1
│   └── compose.yml            # Compose config for GitHub Actions (with image tag)
├── report/
│   ├── action.yml             # GitHub Action: dash14/buildcage/report@v1
│   └── report.sh              # Log analysis script
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

### Troubleshooting

**When builds fail**:

```bash
# Check logs (includes dnsmasq/nginx/buildkitd output)
docker compose logs builder

# Manual test
docker buildx build --builder buildcage --progress=plain -f test/Dockerfile.restrict test/
```

**When connections are blocked**:

```bash
# Check connection destinations in audit mode
make clean
make run_audit_mode
docker buildx build --builder buildcage --no-cache --progress=plain -f test/Dockerfile.restrict test/
./report/report.sh

# Add required domains to the allowlist
make clean
ALLOWED_HTTPS_DOMAINS="github.com,example.com" make run_restrict_mode
```

## Security Details

### DNS Control
- **Full redirect**: Returns the proxy IP for all DNS queries
- **HTTPS record rejection**: Filters HTTPS records as an ECH countermeasure

### HTTP/HTTPS Proxy Control
- **HTTPS**: Server name determination via SNI reading without TLS termination / no impact on certificate validation
- **HTTP**: Domain determination via Host header
- **Dynamic allowlist**: Controlled via environment variables

### Network Isolation
- **CNI configuration**: Places temporary containers from BuildKit RUN steps into isolated-net (buildkit0 bridge, 172.20.0.0/24)
- **iptables**: Drops all FORWARD from buildkit0, also blocks direct access to buildkitd API
- **Direct IP connections are not supported**: All connections using direct IP addresses from within RUN steps (e.g., `curl http://1.2.3.4/`) are blocked by iptables. All outbound connections must go through the proxy via domain names

## Security Limitations

### Limitations of SNI-based Filtering

This tool performs access control by inspecting the **SNI (Server Name Indication)** in the TLS ClientHello. Since it uses a TCP proxy approach without TLS termination, **it cannot inspect the contents of encrypted HTTP traffic (such as Host headers)**.

Due to this design constraint, defense against the following attack techniques is difficult.

### Domain Fronting Attack

Domain fronting is an attack technique where the TLS SNI specifies an allowed domain, while the Host header in the encrypted HTTP request routes traffic to a different server.

```
Attack flow:
1. ClientHello SNI: allowed.example.com  ← nginx only sees this → allowed
2. HTTP Host header: malicious.example.com  ← encrypted, cannot be inspected
3. CDN routes based on Host header → reaches attacker's server
```

For this attack to succeed, the allowed domain and the attack target domain must reside on **the same CDN or hosting infrastructure**.

### Why Complete Prevention is Difficult

To fully defend against domain fronting, the proxy would need to terminate TLS (MITM) and inspect HTTP contents. However, this presents the following challenges:

- **MITM CA certificate generation and management** — The proxy would need to generate TLS certificates for each domain on the fly
- **CA certificate injection into build containers** — Build containers generated by BuildKit's OCI worker have independent filesystems, making it technically difficult to trust a MITM CA (would require modifications to buildkitd itself)
- **Side effects on TLS validation** — Trusting a self-signed CA would affect normal TLS certificate validation within build containers

Given these implementation costs versus the strict preconditions for the attack (the attacker's server must be on the same infrastructure as the allowed domain), this is treated as an **accepted risk**.

### Recommendations for Users

- **Keep allowed domains to a minimum** — Only specify the domains you need in `ALLOWED_HTTP_DOMAINS` / `ALLOWED_HTTPS_DOMAINS`
- **Be cautious with shared CDN domains** — When allowing shared domains such as CloudFront (`*.cloudfront.net`) or Cloudflare, the risk of domain fronting increases. Where possible, specify domains of services that use their own custom domains
- **Major CDN countermeasures** — Major CDN providers like CloudFront and Cloudflare have already introduced measures to restrict domain fronting. Check each provider's documentation for the latest status
