# Security Details

This document explains, from a user's perspective, how Buildcage enforces network isolation during
Docker builds: what's inspected, what's blocked, what attacks are resisted, and what's visible in the
report. For implementation internals (the supervisor binary, RPC plumbing, log parsing), see the
[Development Guide](./development.md).

For a high-level overview, see [buildcage.github.io](https://buildcage.github.io/); for how to
configure the action, see the [README](../README.md).

## Transparent Proxy Engine (default)

### Architecture

<img src="../assets/diagram-architecture-transparent.png" alt="Transparent proxy engine architecture" width="611" height="490">

All containers spawned by BuildKit `RUN` steps are placed on an isolated network (CNI). Only **TCP** is intercepted — non-TCP protocols never reach the proxy at all (see [Non-TCP Protocol Tunneling](#non-tcp-protocol-tunneling-icmp-udp-quic)). DNS queries resolve to the proxy IP, and the proxy checks each request's SNI (HTTPS) or Host header (HTTP) against the allowlist before forwarding or blocking; direct-IP connections take a third, uninspected path (see below).

1. **BuildKit RUN steps run in isolated containers** connected to a private network (CNI)
2. **All TCP traffic is redirected to the proxy** via an iptables NAT rule — regardless of destination, so both DNS-resolved and direct-IP connections reach it; all other protocols (UDP, ICMP, etc.) are dropped before they ever reach the proxy
3. **All DNS queries return the proxy IP** (172.20.0.1), which is what lets the proxy classify DNS-resolved connections by SNI/Host header below
4. **The proxy classifies each TCP connection into one of three paths:**
   - HTTPS (DNS-resolved, TLS ClientHello seen): reads the SNI (Server Name Indication) without decrypting
   - HTTP (DNS-resolved, non-TLS): reads the Host header
   - Direct IP (connection target bypassed DNS): no content inspection at all — see [Direct IP Address Connections](#direct-ip-address-connections)
5. **Allowlist check:** If the domain (HTTPS/HTTP) or IP:port (direct IP) is allowed → connection proceeds. Otherwise → blocked.

**Note:** Base image pulls (`FROM` instructions) are performed by buildkitd itself, which runs outside the isolated network. Only commands in `RUN` steps are subject to network filtering.

**Why this approach?**

- No MITM certificate injection needed
- TLS certificate validation works normally
- Zero modification to your Dockerfile required
- Works with any programming language or package manager
- Cannot inspect encrypted HTTPS payload content (see [Known Limitations](#known-limitations))

### Security Mechanisms

#### Network Isolation

- **CNI configuration**: Places temporary containers from BuildKit RUN steps into isolated-net (buildkit0 bridge, 172.20.0.0/24).
- **iptables**: A `PREROUTING REDIRECT` rule sends all **TCP** traffic from buildkit0 to the proxy, regardless of destination. A separate `FORWARD` rule then drops everything else from buildkit0 — every non-TCP protocol, and any TCP that somehow bypasses the redirect — so only TCP ever reaches the proxy; also blocks direct access to buildkitd API.
- **Gateway enforcement**: All TCP traffic is redirected to the proxy process; non-TCP traffic never reaches it at all (dropped by the `FORWARD` rule above).

#### DNS-Level Control

- **Universal DNS redirect**: All domain name queries return the proxy IP (172.20.0.1), which lets the proxy classify TCP connections that go through DNS by SNI/Host header (see [Architecture](#architecture)). This is separate from the TCP redirect above — direct-IP connections skip DNS but still reach the proxy via the iptables redirect.
- **ECH prevention**: The internal DNS server operates without any upstream resolvers, so DNS HTTPS (type 65) records — required to initiate Encrypted Client Hello (ECH) — are never returned to build containers.

#### HTTP/HTTPS Proxy Control

- **HTTPS**: Determines the target server name by reading the SNI field, without terminating TLS. Certificate validation is unaffected.
- **HTTP**: Determines the target domain by inspecting the Host header, then checks it against the allowlist.
- **Dynamic allowlist**: Controlled via `allowed_https_rules`, `allowed_http_rules`, and `allowed_ip_rules` environment variables.
- **Missing Host header rejection**: HTTP requests without a valid Host header are rejected with HTTP 400, preventing requests that cannot be checked against the allowlist.

#### Direct IP Address Connections

- **Traffic redirection**: All TCP traffic from the isolated network is redirected to HAProxy via an iptables `PREROUTING REDIRECT` rule.
- **IP allowlist check**: Connections to raw IP addresses (e.g., `curl http://1.2.3.4/`) are checked against `allowed_ip_rules`, matched as `ip:port`. If no `allowed_ip_rules` are configured, all direct IP connections are blocked.
- **No content inspection**: Unlike the HTTPS/HTTP paths, a matched direct-IP connection is passed through as a raw TCP stream — its protocol is never checked. Once an `ip:port` pair is allowlisted, any TCP-based protocol can use that path, not just HTTP/HTTPS. Prefer domain-based rules (`allowed_https_rules` / `allowed_http_rules`) when possible; reserve `allowed_ip_rules` for destinations that genuinely have no stable hostname.

### Attack Resistance

Buildcage's architecture defends against the following attack vectors.

#### SNI Spoofing

An attacker may attempt to set the SNI field in a TLS ClientHello to an allowed domain while actually trying to reach an unauthorized server.

**Why this is prevented:** The proxy resolves the domain name presented in the SNI field using external DNS and forwards the connection to the resulting IP address. Regardless of what SNI value the client provides, the proxy always connects to the legitimate server for that domain — never to an attacker-controlled server.

#### Encrypted Client Hello (ECH)

TLS 1.3 Encrypted Client Hello (ECH) encrypts the true SNI, which could theoretically bypass SNI-based filtering.

**Why this is prevented:** ECH requires the client to obtain ECHConfig public keys via DNS HTTPS (type 65) records. The internal DNS server has no upstream resolvers and cannot return these records, so build containers can never initiate an ECH handshake.

#### DNS Tunneling

An attacker may attempt to encode data into DNS queries to exfiltrate information or establish communication with external servers.

**Why this is prevented:** The internal DNS server has no upstream resolvers and answers all queries locally. Additionally, all forwarded traffic from the isolated network is dropped by iptables — including any attempt to reach external DNS servers directly. With no path for DNS queries to reach the outside, encoded data has no route to an attacker's infrastructure.

#### Non-TCP Protocol Tunneling (ICMP, UDP, QUIC)

An attacker may attempt to tunnel data using non-TCP protocols such as ICMP echo packets, raw UDP, or QUIC (HTTP/3) to bypass the proxy.

**Why this is prevented:** The iptables FORWARD rule drops all traffic from the isolated network regardless of protocol — not just TCP. Since the proxy only handles TCP (HTTP, HTTPS, and allowlisted direct-IP connections — see [Architecture](#architecture)), there is no exit path for UDP or ICMP traffic. QUIC, which relies on UDP, is also blocked as a result.

#### IPv6 Bypass

An attacker may attempt to use IPv6 to circumvent IPv4-based iptables rules.

**Why this is prevented:** Equivalent ip6tables rules drop all forwarded IPv6 traffic from the isolated network. Additionally, the internal DNS server returns the IPv6 unspecified address (::) for all queries, effectively disabling IPv6 name resolution within build containers, and the proxy resolves allowed domains over IPv4 only — so even an allowed domain is never reached over IPv6. The ip6tables rule is skipped only when the kernel has no IPv6 support at all (no `/proc/net/if_inet6`), in which case no IPv6 traffic can occur regardless; if IPv6 support is present, applying the rule is mandatory and startup fails closed if it can't be applied, rather than silently leaving IPv6 unfiltered.

#### Alternative DNS Transports (DoH / DoT)

An attacker may attempt to use DNS over HTTPS (DoH) or DNS over TLS (DoT) to bypass the internal DNS server and resolve domains through encrypted channels.

**Why this is prevented:** DoT uses port 853, which the proxy does not listen on — making it unreachable from the isolated network. DoH operates over HTTPS and is therefore subject to the same SNI-based allowlist check as any other HTTPS connection. Only DoH servers hosted on explicitly allowed domains could be reached, and exploiting them would require the same preconditions as domain fronting (the attacker must control infrastructure behind an allowed domain).

### Known Limitations

#### Domain Fronting

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

## Hardening

An allowlist decides which destinations a build can reach. It works on domain names, so it cannot
tell a legitimate use of an allowed destination from an abusive one. Anything leaving through a
service you had to allow anyway still leaves. That is a structural limit, not something a better
rule set fixes.

What it does stop is narrower. Traffic to a destination that is not on the list does not go out, and
infrastructure an attacker set up is normally not on it, because the build has no reason to reach
it. That is also the hardest kind of leak to find afterwards, which is why closing it is worth doing
even though the rest stays open.

An attacker who sends the same data through a service the build already uses stays inside the limit
above. The rest of this section is about making that set of services smaller. Buildcage runs against
your Dockerfile as it is, and an allowlist generated from an audit run already blocks every
destination the audit did not record. Weigh what follows against what the build has access to.

### Keep each rule as narrow as it can be

An audit run only ever emits the exact `host:port` pairs it observed. Wildcards and `:*` ports come
from broadening a rule by hand, and each one covers destinations the build never asked for. Where a
broad rule exists, it is worth checking whether the build can be changed instead.

Pay particular attention to general-purpose destinations: a gist host, object storage, or an API
that can create repositories. They accept uploads as readily as they serve downloads, which is what
makes them useful for sending data out.

### Reduce what has to be reachable

A package registry is usually the one entry a build cannot do without, and the fetch has to happen
inside the build. What can change is which registry. A mirror configured as a read-only
pull-through cache serves upstream packages on demand and accepts no publishes, so nothing can be
uploaded to the destination on your allowlist. Running one is a bigger commitment than anything
else in this section.

### Keep the rest of your supply chain practice

Pinning versions, lockfiles, review, least-privilege tokens, and a dependency cooldown each cover
something an allowlist does not. Pinning base images by digest belongs here too: `FROM`
instructions are resolved by buildkitd itself, which is not on the isolated network, so image pulls
are never filtered (see [Architecture](#architecture)). Buildcage is one layer among them, not a
replacement for any.

## Inspect Proxy Engine

> [!WARNING]
> `inspect` is an **experimental** engine. It terminates TLS inside the cage, so a tool that pins a
> certificate or ships its own trust store will not work under it.
> `transparent` remains the default and recommended engine.

`inspect` uses the same network layout as `transparent`: a CNI bridge per `RUN` step, all TCP
redirected to one listener, everything else dropped. What differs is what the proxy can see. It
terminates TLS with a CA injected into the step for the life of that step only, so a rule can name a
method and a URL path, and every request is recorded with its full URL whether it was allowed or
refused.

Three properties carry the enforcement, and each is worth knowing before relying on the engine:

- **The destination is resolved by the proxy, never chosen by the build, and only once a request has
  already passed the rules.** A forged `Host`, a doctored `/etc/hosts` or a `Host` naming one host
  while the connection aims at another all reach the address the proxy resolved. A request the rules
  were always going to refuse never triggers that resolution at all.
- **A resolved name may not land on an internal address.** An allowlisted name that resolves to
  loopback, link-local, CGNAT, the IETF protocol block or the proxy itself is refused, so a name
  under an attacker's control cannot turn the proxy into a route to cloud metadata.
- **The build's own DNS resolver never forwards a query, allowed or not.** Every name it looks up is
  answered locally with the proxy's own address, so a lookup alone — even one the build never
  connects on — cannot be used as an exfiltration channel, and a path or method paired with a wide
  host does not change that: DNS has no notion of either, so nothing about them can narrow what the
  resolver would otherwise leak. Getting a name's real address is the proxy's own job, done after the
  rules already decided, never the resolver's.

For the rule syntax, the full behaviour table, the report format and the limitations, see
[Inspect Proxy Engine](./inspect-engine.md).

## Explicit Proxy Engine

> [!WARNING]
> `explicit` is **deprecated**. It still works and existing workflows keep running, but it receives
> no further development, and it has structural limitations not present in the `transparent` engine:
> see [Coverage and Visibility](#coverage-and-visibility) below. For request-level enforcement, use
> [`inspect`](#inspect-proxy-engine) instead. `transparent` remains the default and recommended
> engine.

For how to enable it, how it compares with `transparent`, and the CA-trust workaround, see
[Explicit Proxy Engine](./explicit-engine.md). This section covers the architecture and threat
model.

### Architecture

<img src="../assets/diagram-architecture-explicit.png" alt="Explicit proxy engine architecture" width="611" height="454">

`proxy_engine: explicit` uses BuildKit's native `--proxy-network` (available since moby/buildkit
v0.31.0) instead of the CNI/DNS-redirect/HAProxy stack described in
[Transparent Proxy Engine](#transparent-proxy-engine-default). Each `RUN` step is isolated into its
own private point-to-point network namespace whose only reachable peer is buildkitd's built-in MITM
proxy. `HTTP_PROXY`/`HTTPS_PROXY` and a generated CA certificate are injected into the step
automatically — no Dockerfile changes needed for tools that already respect these standard variables.
The proxy decrypts the traffic and checks the host against a BuildKit
[source policy](https://github.com/moby/buildkit/blob/master/docs/proxy.md) compiled from your
allowlist — the exact same `allowed_https_rules` / `allowed_http_rules` / `allowed_ip_rules` syntax as
`transparent` mode (see [Rule syntax](../README.md#rule-syntax)). Enforcement is domain (and port) granularity, same
as `transparent` — the generated policy always allows any path once the host matches, since the rule
syntax has no path component. The decrypted path is still visible, so it shows up in the report and
BuildKit's own build output even though it isn't used to allow or deny the request. `allowed_ip_rules`
entries are compiled into the same kind of policy rule as domain rules (matched as an `https`/`http`
identifier) — unlike `transparent` mode, there's no raw, uninspected TCP passthrough for IP-based
rules here.

If the build client already sets its own **static** source policy (e.g. via
`EXPERIMENTAL_BUILDKIT_SOURCE_POLICY`, which `docker buildx build` reads unconditionally), buildcage
merges its own rules in last, so a client-supplied policy can never widen access beyond your
allowlist. A separate **dynamic**, session-based policy mechanism (`docker buildx build
--policy=...`) is left untouched and applies as an additional condition alongside buildcage's policy.

For how the supervisor binary, gRPC interception, and policy compilation work internally, see
[Explicit Engine Internals](./development.md#explicit-engine-internals) in the Development Guide.

### Coverage and Visibility

| Traffic                                        | Allowed                                                                                                                            | Denied                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `RUN` step, proxy-aware tool                   | Logged per-step in the report's "Communication details"                                                                            | Logged in a flat `DENIED` list (no per-step attribution; whole-second timestamps)            |
| `RUN` step, non-cooperative tool or raw socket | — (immediate "network unreachable"; **no trace anywhere** — not in the build log, the report, or provenance)                       | Identical — the request never reaches the proxy, so allowed and denied are indistinguishable |
| `ADD <url>`                                    | Not tracked by the report — the URL is developer-specified in the Dockerfile, already an intentional, reviewable part of the build | Aborts the entire build immediately at LLB load time; logged the same way as a denied `RUN`  |
| `FROM` / git contexts                          | Unaffected — buildcage's policy only ever matches `http(s)://` sources                                                             | Unaffected                                                                                   |

The key structural difference from `transparent` mode: there, a non-cooperative process still reaches
the CNI bridge and is observed, blocked, and logged. Under `explicit`, each `RUN` step's network
namespace has no broader network to route through, so that traffic leaves no trace at all — a
structural trade-off for gaining full path-level visibility and BuildKit-native provenance
integration.

For exactly how the `report` action extracts allowed/denied data from buildkitd's own logs, see
[Viewing Logs](./development.md#viewing-logs) in the Development Guide.

## Trusting the Buildcage Image

Buildcage is a security tool — so it's fair to ask: _how do you trust Buildcage itself?_

The upstream image is verified at action startup via Sigstore: the signature cryptographically binds
the published image to the exact source commit SHA, so a tampered or substituted image fails
verification before use.

**Using the upstream image**

The simplest option. Pin to a commit SHA (or version tag) and update on your own schedule — the
Sigstore verification ensures you are always running exactly what was built from that commit.

**Self-hosting**

If you need to keep build infrastructure private or control exactly which version is deployed, you can
fork the repository and build the Docker image within your own infrastructure. See the
[Self-Hosting Guide](./self-hosting.md).

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
<td><code>@v2.2.0</code> (exact version)</td>
<td>SAN matches <code>...@refs/tags/v2\.2\.0(\.|$)</code></td>
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
uses: buildcage/docker@<40-char-sha> # vX.Y.Z
```

The SHA check is the core of tamper detection: it confirms the Docker image was built from exactly the same source tree as the pinned action commit. An image built from a different commit — even if signed — will fail verification.

### What this prevents

An attacker who can push a malicious image to `ghcr.io/buildcage/docker` without compromising the repository cannot produce a valid Sigstore bundle. The bundle's Fulcio certificate requires a GitHub Actions OIDC token that is only issued during an actual workflow run on the real repository.

This is **one layer of a defense-in-depth strategy**, not a complete guarantee. It reduces the attack surface to the registry layer and forces attackers to compromise the GitHub account or the repository itself — raising the cost significantly and leaving an audit trail in the Rekor transparency log.

The binding of the image digest to the exact source commit SHA also serves as an alternative to reproducible builds: it establishes that the published artifact was produced from a specific source commit without requiring an independent rebuild.

### Verification Limitations

Verification establishes where the image came from. Here is what it leaves uncovered.

- **A signature says who built the image, not what the code does.** It attests that this
  repository's release workflow built it from the pinned commit — a release published by someone who
  has taken over that identity verifies just as cleanly as a legitimate one. Two things limit the
  damage: with a commit-SHA pin, a newly published release cannot reach your workflow until you
  change the pin yourself, and every signature is recorded in the Rekor transparency log, so an
  unintended release is discoverable after the fact.

- **Sigstore has to be reachable.** Verification depends on the Rekor transparency log and the
  Fulcio CA, and fetches the TUF trust root at verification time. An outage there fails the action
  rather than skipping the check.

- **The registry decides which signed image gets verified.** Resolving the tag yields a manifest
  digest, and everything after that is bound to it: the bundle is fetched by digest, the verified
  signature must cover that same digest, and the `docker pull` is digest-pinned. Content substituted
  at any point after the tag lookup therefore makes verification **fail** rather than falsely pass —
  there is no time-of-check/time-of-use gap. What remains is the tag lookup itself: an attacker with
  write access to the registry could repoint the tag, but only at an image genuinely signed for the
  same pinned commit — in practice, another image from that same release.

- **A build-time test hook exists, but not in what you run.**
  `BUILDCAGE_BUILD_TEST_HOOKS=1 vp run build` produces a `dist/` where a `BUILDCAGE_LOCAL_IMAGE_REF`
  override can point the action at an unpublished image, used only by this repo's own CI and local
  development. Tree-shaking drops that module out of every normal build, and a CI check inspects the
  published `dist/` to confirm it never reads the flag — so no `env:` a consumer sets can reach it.
  See [development.md](./development.md#local-development).

- **Another step in the same job can tamper with the container (out of scope by design).**
  Buildcage's threat model is malicious code _inside_ a `RUN` step. An untrusted step elsewhere in
  the same job is not: running between `setup` and `report`, it can reach the proxy container
  through `docker exec`/`docker cp` — or the host filesystem directly, on a passwordless-sudo
  runner — and rewrite its traffic log or the script `report` executes. Sigstore proves the image
  was genuine at startup, not that nothing touched it afterwards.

  `report` does refuse to pass a log carrying no trace of a real proxy run, which catches wholesale
  erasure but not a format-aware forgery. The effective defense is procedural: don't place an
  untrusted step between `setup` and `report`.
