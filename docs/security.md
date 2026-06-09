# Security Details

This document provides in-depth technical details on how Buildcage enforces network isolation during Docker builds.

For a high-level overview, see the [Security Considerations](../README.md#security-considerations) section in the README.

## Security Mechanisms

### Network Isolation

- **CNI configuration**: Places temporary containers from BuildKit RUN steps into isolated-net (buildkit0 bridge, 172.20.0.0/24).
- **iptables**: Drops all FORWARD from buildkit0, also blocks direct access to buildkitd API.
- **Gateway enforcement**: All traffic must go through the proxy on 172.20.0.1.

### DNS-Level Control

- **Universal DNS redirect**: All domain name queries return the proxy IP (172.20.0.1), forcing all traffic through the proxy regardless of the requested domain.
- **ECH prevention**: The internal DNS server operates without any upstream resolvers, so DNS HTTPS (type 65) records — required to initiate Encrypted Client Hello (ECH) — are never returned to build containers.

### HTTP/HTTPS Proxy Control

- **HTTPS**: Determines the target server name by reading the SNI field, without terminating TLS. Certificate validation is unaffected.
- **HTTP**: Determines the target domain by inspecting the Host header, then checks it against the allowlist.
- **Dynamic allowlist**: Controlled via `allowed_https_rules`, `allowed_http_rules`, and `allowed_ip_rules` environment variables.
- **Missing Host header rejection**: HTTP requests without a valid Host header are rejected with HTTP 400, preventing requests that cannot be checked against the allowlist.

### Direct IP Address Connections

- **Traffic redirection**: All TCP traffic from the isolated network is redirected to HAProxy via an iptables `PREROUTING REDIRECT` rule.
- **IP allowlist check**: Connections to raw IP addresses (e.g., `curl http://1.2.3.4/`) are checked against `allowed_ip_rules`. If no `allowed_ip_rules` are configured, all direct IP connections are blocked.

## Attack Resistance

Buildcage's architecture defends against the following attack vectors.

### SNI Spoofing

An attacker may attempt to set the SNI field in a TLS ClientHello to an allowed domain while actually trying to reach an unauthorized server.

**Why this is prevented:** The proxy resolves the domain name presented in the SNI field using external DNS and forwards the connection to the resulting IP address. Regardless of what SNI value the client provides, the proxy always connects to the legitimate server for that domain — never to an attacker-controlled server.

### Encrypted Client Hello (ECH)

TLS 1.3 Encrypted Client Hello (ECH) encrypts the true SNI, which could theoretically bypass SNI-based filtering.

**Why this is prevented:** ECH requires the client to obtain ECHConfig public keys via DNS HTTPS (type 65) records. The internal DNS server has no upstream resolvers and cannot return these records, so build containers can never initiate an ECH handshake.

### DNS Tunneling

An attacker may attempt to encode data into DNS queries to exfiltrate information or establish communication with external servers.

**Why this is prevented:** The internal DNS server has no upstream resolvers and answers all queries locally. Additionally, all forwarded traffic from the isolated network is dropped by iptables — including any attempt to reach external DNS servers directly. With no path for DNS queries to reach the outside, encoded data has no route to an attacker's infrastructure.

### Non-TCP Protocol Tunneling (ICMP, UDP, QUIC)

An attacker may attempt to tunnel data using non-TCP protocols such as ICMP echo packets, raw UDP, or QUIC (HTTP/3) to bypass the proxy.

**Why this is prevented:** The iptables FORWARD rule drops all traffic from the isolated network regardless of protocol — not just TCP. Since the proxy only handles TCP-based HTTP and HTTPS connections, there is no exit path for UDP or ICMP traffic. QUIC, which relies on UDP, is also blocked as a result.

### IPv6 Bypass

An attacker may attempt to use IPv6 to circumvent IPv4-based iptables rules.

**Why this is prevented:** Equivalent ip6tables rules drop all forwarded IPv6 traffic from the isolated network. Additionally, the internal DNS server returns the IPv6 unspecified address (::) for all queries, effectively disabling IPv6 name resolution within build containers.

### Alternative DNS Transports (DoH / DoT)

An attacker may attempt to use DNS over HTTPS (DoH) or DNS over TLS (DoT) to bypass the internal DNS server and resolve domains through encrypted channels.

**Why this is prevented:** DoT uses port 853, which the proxy does not listen on — making it unreachable from the isolated network. DoH operates over HTTPS and is therefore subject to the same SNI-based allowlist check as any other HTTPS connection. Only DoH servers hosted on explicitly allowed domains could be reached, and exploiting them would require the same preconditions as domain fronting (the attacker must control infrastructure behind an allowed domain).

## Known Limitations

### Domain Fronting

Buildcage inspects the **SNI (Server Name Indication)** field in HTTPS connections but cannot decrypt the actual request content inside the TLS tunnel. This creates a potential bypass technique called "domain fronting."

**How it works:**

```
Attack flow:
1. ClientHello SNI: allowed.example.com  ← Buildcage only sees this → ✅ allowed
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

- **Keep allowed domains to a minimum** — Only specify the domains you need in `allowed_http_rules` / `allowed_https_rules`.
- **Be specific with allowed domains** — Avoid broad wildcard CDN domains (e.g., `*.cdn.example.com`) when possible.
- **Use service-specific domains** — Prefer `registry.npmjs.org` over generic CDN wildcard domains.
- **Major CDN countermeasures** — Major CDN providers like CloudFront and Cloudflare have already introduced measures to restrict domain fronting. Consult your CDN provider's documentation for current details.
- **Regular audits** — Periodically run in [audit mode](../README.md#operation-modes) to detect anomalies in connection patterns.

## Image Provenance Verification

Buildcage uses [cosign](https://github.com/sigstore/cosign) keyless signing to cryptographically bind each release's Docker image to the CI workflow that built it.

### How it works

When a release tag is pushed, the `docker-publish.yml` workflow builds and signs the Docker image using a short-lived OIDC identity issued by GitHub Actions. The signature is stored transparently in the [Rekor](https://docs.sigstore.dev/logging/overview/) public ledger.

When the setup action runs, it:

1. Inspects the manifest list digest (no pull required).
2. Verifies the cosign signature against the expected workflow identity.
3. Pulls the image by digest — the same bytes that were verified — eliminating any window between verification and pull.

### What this prevents

An attacker who can push a malicious image to `ghcr.io/dash14/buildcage` without compromising the repository cannot produce a valid cosign signature. The signature requires a GitHub Actions OIDC token that is only issued during an actual workflow run on the real repository.

This is **one layer of a defense-in-depth strategy**, not a complete guarantee. It reduces the attack surface to the registry layer and forces attackers to compromise the GitHub account or the repository itself — raising the cost significantly and leaving an audit trail in the Rekor transparency log.

### Verification scope by reference type

| How the action is pinned | Verification |
|---|---|
| `@<40-char SHA>` (commit SHA) | Confirms the `docker-publish.yml` workflow at exactly that commit SHA signed the image |
| `@v2.1.1` (version tag) | Confirms the `docker-publish.yml` workflow on tag `refs/tags/v2.1.1` signed the image |
| `@v2` (floating major tag) | Confirms a `docker-publish.yml` workflow run on any v2 release signed the image |
| Branch name or local `./setup` | Skipped (no corresponding release signature exists) |

For strongest guarantees, pin the action to a **commit SHA**:

```yaml
uses: dash14/buildcage/setup@<40-char-sha> # vX.Y.Z
```

### Known limitations

- **Account compromise**: If the repository owner's GitHub account or the repository itself is compromised, an attacker could trigger the release workflow and produce a legitimately-signed malicious image.
- **Build non-reproducibility**: Buildcage does not currently publish reproducible builds, so the signed image cannot be independently rebuilt from source.
- **Trust in Sigstore infrastructure**: Verification relies on the availability and integrity of the Rekor transparency log and the Fulcio certificate authority.
- **Post-signature registry tampering**: The digest verified by cosign and used for the pull is fetched at action runtime. A highly targeted attack that replaces the registry content in the window between `cosign verify` and the digest resolution would still succeed — though such an attack requires compromising the registry itself.
