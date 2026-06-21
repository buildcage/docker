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

Buildcage uses [Sigstore](https://sigstore.dev) keyless signing to cryptographically bind each release's Docker image to the CI workflow that built it.

### How it works

**Signing (at release time):** When a release tag is pushed, the `docker-publish.yml` workflow builds and signs the Docker image using a short-lived OIDC identity issued by GitHub Actions. The signature is stored as a **Sigstore Bundle v0.3** attached to the image via the OCI 1.1 Referrers API in GHCR. The bundle contains the signature, a Fulcio leaf certificate embedding the workflow identity, and a Rekor transparency log entry.

**Verification (at action startup, `main` phase):** The setup action verifies the image entirely in-process using `@sigstore/verify`, `@sigstore/tuf`, and `@sigstore/bundle` — no external binary (e.g. cosign) is downloaded or required. Running in the `main` phase ensures `docker/login-action` (if present) has already stored registry credentials before verification begins. The verification flow is:

```
1. Fetch manifest-list digest
       docker buildx imagetools inspect <image>:<tag>
       (uses docker login credentials — supports private packages)
            ↓
2. Fetch registry pull token
       GET https://ghcr.io/token?scope=repository:<repo>:pull
         → logged in (docker/login-action): Basic auth with Docker config credentials
         → not logged in: anonymous request (public packages only)
            ↓
3. Pull Sigstore Bundle from OCI Referrers API
       GET /v2/<repo>/referrers/<digest>  → locate bundle manifest
       GET /v2/<repo>/blobs/<bundleDigest> → fetch bundle JSON
            ↓
4. Cryptographic + identity verification (@sigstore/verify, TUF-backed trust root)
       verifyBundle(bundleJson, {
         certificateIssuer,       ← OIDC issuer enforced cryptographically
         certificateIdentityURI,  ← SAN regexp: workflow URL + ref/version
         certificateOIDs,         ← OID 1.13: Source Repository Digest (SHA pin)
       }, expectedDigest)
            ↓
5. Signed digest assertion (fail-closed)
       Parse DSSE payload → subject[].digest.sha256 (in-toto v1, --new-bundle-format)
                          or critical.image.docker-manifest-digest (legacy simple-signing)
       Must equal the digest fetched in step 1 (strict string equality)
       Mismatch → VERIFY_FAILED (closes the Referrers API attribution gap)
```

For **private self-hosted packages**, place `docker/login-action` before the buildcage setup step in your workflow and ensure the job has `packages: read` permission. Credentials stored by Docker login are picked up automatically.

All identity checks — OIDC issuer, signing workflow, ref/SHA claim, and manifest digest — are enforced inside the single `verifyBundle()` call, equivalent to cosign's `--certificate-oidc-issuer`, `--certificate-identity-regexp`, `--certificate-github-workflow-sha`, and the implicit digest-match that cosign performs against its target image argument.

### Identity matching by reference type

<table>
<thead>
<tr>
<th>How the action is pinned</th>
<th>Identity check</th>
<th>Mechanism</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>@&lt;40-char SHA&gt;</code></td>
<td>Source Repository Digest <strong>strictly equals</strong> the pinned SHA</td>
<td><code>certificateOIDs</code> — Fulcio OID <code>1.3.6.1.4.1.57264.1.13</code>, raw byte match</td>
</tr>
<tr>
<td><code>@v2.1.0</code> (exact version)</td>
<td>SAN matches <code>...@refs/tags/v2\.1\.0(\.|$)</code></td>
<td><code>certificateIdentityURI</code> regexp</td>
</tr>
<tr>
<td><code>@v2</code> (major-floating)</td>
<td>SAN matches <code>...@refs/tags/v2(\.|$)</code></td>
<td><code>certificateIdentityURI</code> regexp</td>
</tr>
<tr>
<td>Branch name or local <code>./setup</code></td>
<td><strong>Hard fail</strong> — pin to a version tag or commit SHA</td>
<td>—</td>
</tr>
</tbody>
</table>

For strongest guarantees, pin to a **commit SHA**:

```yaml
uses: dash14/buildcage/setup@<40-char-sha> # vX.Y.Z
```

The SHA check is the core of tamper detection: it confirms the Docker image was built from exactly the same source tree as the pinned action commit. An image built from a different commit — even if signed — will fail verification.

### What this prevents

An attacker who can push a malicious image to `ghcr.io/dash14/buildcage` without compromising the repository cannot produce a valid Sigstore bundle. The bundle's Fulcio certificate requires a GitHub Actions OIDC token that is only issued during an actual workflow run on the real repository.

This is **one layer of a defense-in-depth strategy**, not a complete guarantee. It reduces the attack surface to the registry layer and forces attackers to compromise the GitHub account or the repository itself — raising the cost significantly and leaving an audit trail in the Rekor transparency log.

The cryptographic binding of the image digest to the exact source commit SHA also serves as an alternative to reproducible builds. The primary purpose of reproducible builds is to establish that a published artifact was produced from a specific source commit; here, that assurance is provided cryptographically by the Sigstore bundle rather than by requiring an independent rebuild to produce a bit-for-bit identical artifact.

### Self-hosting with a private package

When self-hosting Buildcage from a **private** GHCR package, run `docker/login-action` with `packages: read` before this action. Credentials written to Docker's config by the login step are read automatically — no `token` input is required. Public packages are verified without any credentials.

### Known limitations

- **Account compromise**: If the repository owner's GitHub account or the repository itself is compromised, an attacker could trigger the release workflow and produce a legitimately-signed malicious image.
- **Trust in Sigstore infrastructure**: Verification relies on the availability and integrity of the Rekor transparency log and the Fulcio certificate authority. The TUF-backed trust root is fetched at verification time; a network outage will cause the main phase to hard-fail.
- **TOCTOU window**: The manifest digest is fetched before the bundle is pulled. A highly targeted attack that replaces the registry content in the window between these two steps would still succeed — though such an attack requires compromising the registry itself. Note that the subsequent `docker pull` is digest-pinned (`image@sha256:…`), so there is no TOCTOU between verification and the actual image pull; the residual window is limited to between the manifest-digest fetch and the bundle fetch.
- **Development bypass**: `BUILDCAGE_ALLOW_UNVERIFIED=1` skips verification for unverifiable refs (branch names, local `./setup`). This flag is **for local development only** and must never be used in CI or production workflows. See [development.md](./development.md#local-development) for details.
