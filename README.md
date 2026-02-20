# buildcage

![buildcage](./assets/banner.png)

[![GitHub](https://img.shields.io/badge/GitHub-dash14%2Fbuildcage-blue?logo=github)](https://github.com/dash14/buildcage)
![version](https://img.shields.io/github/v/release/dash14/buildcage
)
![build](https://img.shields.io/github/actions/workflow/status/dash14/buildcage/docker-publish.yml
)
![test](https://img.shields.io/github/actions/workflow/status/dash14/buildcage/test.yml?label=test)
![license](https://img.shields.io/github/license/dash14/buildcage
)

**A secure Docker build environment that prevents supply chain attacks by restricting outbound network access during image builds.**

buildcage is a GitHub Actions-ready Docker container that runs a custom BuildKit builder. When you configure Docker Buildx to use buildcage as a remote builder, all network traffic from `RUN` steps in your Dockerfile is routed through an internal proxy that can log and block connections based on domain name.

You define a list of allowed domains, and only connections to those domains are permitted during builds — everything else is blocked.

*Think of it as a firewall for your Docker builds.*

## Why Use buildcage?

When you run `RUN npm install` or `RUN apt-get install` in a Dockerfile, these commands can connect to any server on the internet. **You have no visibility or control over where they connect.**

buildcage solves this by restricting outbound network access during builds to only the domains you explicitly allow.


## How It Works

buildcage runs as a [remote driver](https://docs.docker.com/build/builders/drivers/remote/) for Docker Buildx. All `RUN` step containers are placed on an isolated network, and outbound traffic is routed through a proxy that enforces your allowlist.

<img src="assets/diagram-overview.png" alt="How buildcage works" width="544" height="328">

- HTTPS: SNI (Server Name Indication) for domain matching — TLS is not terminated
- HTTP: Host header for domain matching
- Direct IP access: blocked by iptables

**Two modes available** (see [Reference](#reference) for details):

- **Audit mode**: Records all network destinations during builds, useful for creating allowlists.
- **Restrict mode**: Allows access only to permitted domains, blocking everything else.

## Who Should Use This?

### Recommended for:

- **CI/CD pipelines pulling from public registries** — if your builds download packages from npm, PyPI, RubyGems, or other public sources, buildcage limits the blast radius of compromised packages
- **Builds that handle secrets** — if your Dockerfiles use build secrets, tokens, or credentials, buildcage prevents them from being exfiltrated to unauthorized servers
- **Teams that need network visibility** — if you need to know exactly which external services your builds contact, buildcage logs every outbound connection and can enforce an allowlist

### May not be necessary for:

- **Fully offline builds** — if your builds run in an air-gapped environment with no external network access
- **Internal-only registries** — if all dependencies come from vetted, internal repositories with no public package sources
- **No-dependency builds** — if your Dockerfile only copies files and never runs commands that fetch external resources

## Features

- 🚀 **GitHub Actions support**: Available as reusable actions for CI/CD pipelines
- ✅ **Zero Dockerfile changes**: Works with existing Dockerfiles without modification
- 🔒 **Network isolation**: Isolates network access for each `RUN` step using CNI (Container Network Interface)
- 🔍 **Audit mode**: Discover dependencies before enforcing restrictions
- 🛡️ **Restrict mode**: Production-ready access control
- 📊 **Detailed logging**: Complete visibility into all network connections during builds

## Quick Start

### Prerequisites

- Docker with BuildKit (buildx plugin)
- GitHub Actions runner with Docker support (for CI/CD usage)
- Docker Compose (for local usage)

### First-Time Setup (Recommended Workflow)

Using buildcage in GitHub Actions involves three workflow steps:

1. Start the buildcage container (runs BuildKit inside a network-controlled environment)
2. Configure Docker Buildx to use the buildcage container as a remote builder
3. Run your build as usual — your Dockerfile and build commands stay the same

#### Step 1: Discover what domains your build needs (Audit Mode)

```yaml
name: Discover Build Dependencies

on: [push]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Start buildcage in audit mode
        id: buildcage
        uses: dash14/buildcage/setup@v1
        with:
          proxy_mode: audit  # Log everything, block nothing

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
        with:
          driver: remote
          endpoint: tcp://localhost:${{ steps.buildcage.outputs.port }}

      - name: Build and discover dependencies
        uses: docker/build-push-action@v6
        with:
          context: .
          push: false  # Set to true to push the built image

      - name: Show what domains were accessed
        if: always()
        uses: dash14/buildcage/report@v1
        with:
          fail_on_blocked: false  # Don't fail, just show the report
```

See the [complete example workflow](.github/workflows/example-audit.yml).

#### Step 2: Check the report

The report action outputs a Job Summary showing every domain your build contacted:

<img src="assets/report-audit-mode.png" alt="Outbound Traffic Report - audit mode" width="556">

Copy these domain names into `allowed_https_domains` or `allowed_http_domains` for Step 3.

#### Step 3: Create your allowlist and switch to restrict mode

```yaml
name: Secure Build

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Start buildcage in restrict mode
        id: buildcage
        uses: dash14/buildcage/setup@v1
        with:
          proxy_mode: restrict  # Block everything except allowed domains
          allowed_https_domains: >-
            registry.npmjs.org,
            fonts.googleapis.com

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
        with:
          driver: remote
          endpoint: tcp://localhost:${{ steps.buildcage.outputs.port }}

      - name: Build with protection
        uses: docker/build-push-action@v6
        with:
          context: .
          push: false  # Set to true to push the built image

      - name: Security report
        if: always()
        uses: dash14/buildcage/report@v1
        # Build fails if any unexpected connections were blocked
```

See the [complete example workflow](.github/workflows/example-restrict.yml).

Your builds are now protected. Any unexpected connections will be blocked and reported.

## Reference

### Setup Action (`dash14/buildcage/setup`)

Starts the buildcage builder container.

```yaml
- name: Start buildcage builder
  id: buildcage
  uses: dash14/buildcage/setup@v1
  with:
    proxy_mode: restrict
    allowed_https_domains: registry.npmjs.org,github.com
```

#### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `buildcage_image` | No | `ghcr.io/<owner>/<repo>` | Docker image name |
| `buildcage_version` | No | `1` | Image tag |
| `proxy_mode` | No | `restrict` | Operation mode (`audit` / `restrict`) |
| `allowed_http_domains` | No | empty | Allowed HTTP domains (comma-separated, without port) |
| `allowed_https_domains` | No | empty | Allowed HTTPS domains (comma-separated, without port) |
| `http_ports` | No | `80` | Comma-separated HTTP listen ports for the proxy |
| `https_ports` | No | `443` | Comma-separated HTTPS listen ports for the proxy |
| `port` | No | `1234` | BuildKit endpoint port on localhost |

**Domain matching patterns**

The following patterns are supported for domain values:

| Pattern | Example | Matches |
|---------|---------|---------|
| Exact domain | `www.example.com` | Only `www.example.com` |
| Prefix wildcard | `*.example.com` | `sub.example.com`, `deep.sub.example.com` (not `example.com` itself) |
| Dot-prefix shorthand | `.example.com` | Both `example.com` and `*.example.com` |
| Suffix wildcard | `example.*` | `example.com`, `example.io`, `example.org`, etc. |

#### Outputs

| Name | Description |
|------|-------------|
| `port` | BuildKit endpoint port |

Pass this port to [`docker/setup-buildx-action`](https://github.com/docker/setup-buildx-action) to use buildcage as a remote builder:

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@v3
  with:
    driver: remote
    endpoint: tcp://localhost:${{ steps.buildcage.outputs.port }}
```

#### Operation Modes

##### Audit Mode (`proxy_mode: audit`)

**When to use:** First-time setup, adding new dependencies, or investigating issues.

**What it does:**
- Allows all HTTP/HTTPS connections
- Logs every domain accessed during the build
- Does NOT block anything

##### Restrict Mode (`proxy_mode: restrict`)

**When to use:** Production builds, CI/CD pipelines, security-critical environments.

**What it does:**
- Allows connections only to domains in `allowed_http_domains` / `allowed_https_domains`
- Blocks all other connections
- Logs allowed and blocked attempts

#### Tips

- Start with audit mode to discover required domains, then switch to restrict mode.
- Separate HTTP and HTTPS domains — some services use different hosts for each protocol.
- Common package registries often use multiple domains (e.g., PyPI uses both `pypi.org` and `files.pythonhosted.org`).
- Some package managers download over plain HTTP (e.g., certain Debian mirrors). Add those domains to `allowed_http_domains` separately:

  ```yaml
  allowed_http_domains: deb.debian.org
  allowed_https_domains: registry.npmjs.org
  ```

- If your build needs to listen on non-standard ports (e.g., an application server on port 8080), add them with `http_ports` / `https_ports`:

  ```yaml
  http_ports: "80,8080"
  https_ports: "443,8443"
  ```

### Report Action (`dash14/buildcage/report`)

Displays communication logs after builds and optionally fails if any BLOCKED connections are found.

```yaml
- name: Show proxy report
  if: always()
  uses: dash14/buildcage/report@v1
```

#### Job Summary

**Audit mode:**

<img src="assets/report-audit-mode.png" alt="Outbound Traffic Report - audit mode" width="556">

Use the domain names shown in the report to create your allowlist for restrict mode.

**Restrict mode:**

<img src="assets/report-restrict-mode.png" alt="Outbound Traffic Report - restrict mode" width="556">

The report step fails if blocked connections are detected, causing the workflow to fail. You can disable this by setting `fail_on_blocked: false`.

#### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `fail_on_blocked` | No | `true` | Fail the step if blocked connections are detected |

---

## Architecture

### For Technical Users

buildcage creates a controlled network environment for your Docker builds:

1. **BuildKit RUN steps run in isolated containers** connected to a private network (CNI)
2. **All DNS queries return the proxy IP** (172.20.0.1), forcing traffic through the proxy
3. **The proxy inspects each request:**
   - HTTPS: Reads the SNI (Server Name Indication) without decrypting
   - HTTP: Reads the Host header
4. **Allowlist check:** If the domain is allowed → connection proceeds. Otherwise → blocked.

**Note:** Base image pulls (`FROM` instructions) are performed by buildkitd itself, which runs outside the isolated network. Only commands in `RUN` steps are subject to network filtering.

**Why this approach?**
- No MITM certificate injection needed
- TLS certificate validation works normally
- Zero modification to your Dockerfile required
- Works with any programming language or package manager
- Cannot inspect encrypted HTTPS payload content (see [Security Considerations](#security-considerations))

### Architecture Diagram

<img src="assets/diagram-architecture.png" alt="buildcage architecture" width="611" height="544">

All containers spawned by BuildKit `RUN` steps are placed on an isolated network (CNI). DNS queries are redirected to the proxy IP, and the proxy checks each request's SNI (HTTPS) or Host header (HTTP) against the allowlist before forwarding or blocking.

---

## Security Considerations

> **Important:** buildcage controls *where* your builds can connect, not *what code* they run. If a malicious package is delivered through a legitimate repository (e.g., a compromised npm package hosted on `registry.npmjs.org`), buildcage cannot detect or prevent it — the connection goes to an allowed domain.
>
> Do not rely on buildcage as your sole supply chain security measure. Use it as one layer in a defense-in-depth strategy — a last line of defense that limits the blast radius of compromised dependencies by restricting their ability to communicate with external servers.

### What buildcage protects against

buildcage blocks outbound connections to domains not on your allowlist during Docker builds. This helps mitigate scenarios such as:

- **Data exfiltration** — prevents build secrets (e.g., environment variables, tokens) from being sent to external servers
- **Command-and-control (C2) communication** — blocks compromised dependencies from phoning home to attacker-controlled servers
- **Unexpected telemetry** — stops analytics, tracking, or other undisclosed network calls that packages may make during installation

### Security Mechanisms

#### Direct IP Address Connections

All connections using direct IP addresses from within RUN steps (e.g., `curl http://1.2.3.4/`) are **blocked by iptables**. All outbound connections must go through the proxy via domain names.

This is intentional — it ensures all traffic can be inspected and logged.

#### DNS-Level Control

- **Full redirect**: Returns the proxy IP for all DNS queries.
- **ECH prevention**: The internal DNS server operates without any upstream resolvers, so DNS HTTPS (type 65) records — required to initiate Encrypted Client Hello (ECH) — are never returned to build containers.

#### HTTP/HTTPS Proxy Control

- **HTTPS**: Determines the target server name by reading the SNI field, without terminating TLS. Certificate validation is unaffected.
- **HTTP**: Domain determination via Host header.
- **Dynamic allowlist**: Controlled via environment variables.

#### Network Isolation

- **CNI configuration**: Places temporary containers from BuildKit RUN steps into isolated-net (buildkit0 bridge, 172.20.0.0/24).
- **iptables**: Drops all FORWARD from buildkit0, also blocks direct access to buildkitd API.
- **Gateway enforcement**: All traffic must go through the proxy on 172.20.0.1.

### Attack Resistance

#### SNI Spoofing

An attacker may attempt to set the SNI field in a TLS ClientHello to an allowed domain while actually trying to reach an unauthorized server.

**Why this is prevented:** The proxy resolves the domain name presented in the SNI field using external DNS and forwards the connection to the resulting IP address. Regardless of what SNI value the client provides, the proxy always connects to the legitimate server for that domain — never to an attacker-controlled server.

#### Encrypted Client Hello (ECH)

TLS 1.3 Encrypted Client Hello (ECH) encrypts the true SNI, which could theoretically bypass SNI-based filtering.

**Why this is prevented:** ECH requires the client to obtain ECHConfig public keys via DNS HTTPS (type 65) records. The internal DNS server has no upstream resolvers and cannot return these records, so build containers can never initiate an ECH handshake.

#### DNS Tunneling

An attacker may attempt to encode data into DNS queries to exfiltrate information or establish communication with external servers.

**Why this is prevented:** The internal DNS server has no upstream resolvers and answers all queries locally. Additionally, iptables rules block direct DNS traffic to any external server. With no path for DNS queries to reach the outside, encoded data has no route to an attacker's infrastructure.

#### Non-TCP Protocol Tunneling (ICMP, UDP, QUIC)

An attacker may attempt to tunnel data using non-TCP protocols such as ICMP echo packets, raw UDP, or QUIC (HTTP/3) to bypass the proxy.

**Why this is prevented:** The iptables FORWARD rule drops all traffic from the isolated network regardless of protocol — not just TCP. Since the proxy only handles TCP-based HTTP and HTTPS connections, there is no exit path for UDP or ICMP traffic. QUIC, which relies on UDP, is also blocked as a result.

#### IPv6 Bypass

An attacker may attempt to use IPv6 to circumvent IPv4-based iptables rules.

**Why this is prevented:** Equivalent ip6tables rules drop all forwarded IPv6 traffic from the isolated network. Additionally, the internal DNS server returns an empty IPv6 address for all queries, effectively disabling IPv6 name resolution within build containers.

#### Alternative DNS Transports (DoH / DoT)

An attacker may attempt to use DNS over HTTPS (DoH) or DNS over TLS (DoT) to bypass the internal DNS server and resolve domains through encrypted channels.

**Why this is prevented:** DoT uses port 853, which the proxy does not listen on — making it unreachable from the isolated network. DoH operates over HTTPS and is therefore subject to the same SNI-based allowlist check as any other HTTPS connection. Only DoH servers hosted on explicitly allowed domains could be reached, and exploiting them would require the same preconditions as domain fronting (the attacker must control infrastructure behind an allowed domain).

### Known Limitations

#### Domain Fronting

buildcage inspects the **SNI (Server Name Indication)** field in HTTPS connections but cannot decrypt the actual request content inside the TLS tunnel. This creates a potential bypass technique called "domain fronting."

**How it works:**

```
Attack flow:
1. ClientHello SNI: allowed.example.com  ← buildcage only sees this → ✅ allowed
2. HTTP Host header: malicious.example.com  ← encrypted, cannot be inspected
3. CDN routes based on Host header → reaches attacker's server
```

For this attack to succeed, the allowed domain and the attack target domain must reside on **the same CDN or hosting infrastructure**.

**Why we don't prevent this:**

To fully defend against domain fronting, the proxy would need to terminate TLS (MITM) and inspect HTTP contents. However, this presents significant challenges:

- **MITM CA certificate generation and management** — The proxy would need to generate TLS certificates for each domain on the fly.
- **CA certificate injection into build containers** — Build containers generated by BuildKit's OCI worker have independent filesystems, making it technically difficult to trust a MITM CA (would require modifications to buildkitd itself).
- **Interference with TLS validation** — Trusting a self-signed CA would affect normal TLS certificate validation within build containers.

Given these implementation costs versus the strict preconditions for the attack (the attacker's server must be on the same infrastructure as the allowed domain), this is treated as an **accepted risk**.

**Mitigation strategies:**

- **Keep allowed domains to a minimum** — Only specify the domains you need in `allowed_http_domains` / `allowed_https_domains`.
- **Be specific with allowed domains** — Avoid broad wildcard CDN domains (e.g., `*.cdn.example.com`) when possible.
- **Use service-specific domains** — Prefer `registry.npmjs.org` over generic CDN wildcard domains.
- **Major CDN countermeasures** — Major CDN providers like CloudFront and Cloudflare have already introduced measures to restrict domain fronting. Consult your CDN provider's documentation for current details.
- **Regular audits** — Periodically run in audit mode to detect anomalies in connection patterns.

---

## FAQ

**Q: Can I host buildcage in my own private repository?**

A: Yes. You can import the repository into your organization and build the Docker image yourself. See the [Self-Hosting Guide](./docs/self-hosting.md) for details.

**Q: Does this slow down my builds?**

A: Minimal impact. The proxy adds negligible latency (<1ms per request). DNS caching and connection pooling keep overhead low.

**Q: Can I use this with multi-stage builds?**

A: Yes! buildcage works seamlessly with multi-stage Dockerfiles.

**Q: Does this work with private package registries?**

A: Yes. Just add your private registry's domain to `allowed_https_domains`.

**Q: What happens if I forget to add a required domain?**

A: In restrict mode, the build will fail with a clear error message. Run in audit mode first to discover all required domains.

**Q: Do I need to clean up the buildcage container?**

A: No. The container is automatically removed when the GitHub Actions job completes.

**Q: Does this protect against malicious code execution?**

A: No. buildcage only controls network access. It doesn't prevent malicious code from running—it prevents that code from communicating with external servers.

## Troubleshooting

If you encounter issues, try reproducing the problem locally to get detailed logs:

1. **Check logs:**
   ```bash
   docker compose logs builder
   ```

2. **Run in audit mode** to understand your build's network behavior:
   ```bash
   make clean
   make run_audit_mode
   docker buildx build --builder buildcage --no-cache -f Dockerfile .
   docker compose logs builder
   ```

3. **Open an issue** at [github.com/dash14/buildcage/issues](https://github.com/dash14/buildcage/issues) with:
   - Your Dockerfile
   - The audit mode report output
   - Full error messages from `docker compose logs builder`

## Development

See the [Development Guide](./docs/development.md) for local usage, testing, viewing logs, and directory structure.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests at [github.com/dash14/buildcage](https://github.com/dash14/buildcage).

## License
Licensed under the MIT License.
See [LICENSE](./LICENSE) file for more details.

## Acknowledgments

buildcage is built on top of:
- [BuildKit](https://github.com/moby/buildkit) - Modern build toolkit
- [nginx](https://nginx.org/) - HTTP proxy
- [dnsmasq](https://thekelleys.org.uk/dnsmasq/doc.html) - DNS server
- [CNI](https://github.com/containernetworking/cni) - Container network interface
