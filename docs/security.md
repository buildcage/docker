# Security Details

This document explains, from a user's perspective, how Buildcage enforces network isolation during
Docker builds: what's inspected, what's blocked, what attacks are resisted, and what's visible in
the report. For implementation internals (the supervisor binary, RPC plumbing, log parsing), see the
[Development Guide](./development.md).

For a high-level overview, see [buildcage.github.io](https://buildcage.github.io/); for how to
configure the action, see the [README](../README.md).

## Contents

- [Inspect Proxy Engine](#inspect-proxy-engine)
- [Universal Proxy Engine](#universal-proxy-engine)
- [Explicit Proxy Engine](#explicit-proxy-engine) (deprecated)
- [What buildkitd fetches itself](#what-buildkitd-fetches-itself)
- [What the builder container runs with](#what-the-builder-container-runs-with)
- [Hardening](#hardening)
- [Image Provenance Verification](#image-provenance-verification)

## Inspect Proxy Engine

### How it intercepts traffic

<img src="../assets/diagram-architecture-inspect.png" alt="Inspect proxy engine architecture" width="611" height="796">

`inspect` uses the same network layout as `universal`: a CNI bridge per `RUN` step, all TCP
redirected to one listener, everything else dropped (see
[How it sees traffic](#how-it-sees-traffic) under Universal, below). What differs is that it
terminates TLS instead of only reading the SNI, so a rule can check the method and the full URL
rather than only the destination.

Two components, plus a wrapper around runc:

- **HAProxy** does the inspecting. One listener takes both TLS and plaintext, told apart by the
  first bytes of the connection (`req.ssl_hello_type`), so an audit run records everything without
  being configured for it first. It resolves the requested name itself and connects there
  (`do-resolve` then `set-dst`), only once a request has already passed the rules, so where a
  connection ends up is never the build's choice, and a name a request would be refused for never
  triggers a real DNS query. It also resolves `..` in the path before the rules see it
  (`normalize-uri`), so a rule cannot be walked out of.
- **CoreDNS** never resolves a name for real, allowed or not (see
  [What it actually stops](#what-it-actually-stops) below). It only decides what gets logged as
  allowed or denied, on a regex rather than a domain suffix, which is what lets a rule like
  `abc*.amazonaws.com` be logged accurately instead of collapsing to everything under
  `amazonaws.com`.
- **`buildcage-runc`** wraps BuildKit's own `buildkit-runc`. For the subcommands that carry a
  bundle it makes the step trust the proxy's CA by bind-mounting a scratch copy of the CA store over
  the step's own view of it, writing back to the real one only if the step actually changed it, so a
  step that never touches its CA store leaves no trace of the injection in the image layers. The CA
  also goes into the distribution's anchor directory, so a step that rebuilds its own bundle keeps
  trusting it; the anchor, the directory written for it, and whatever the rebuild left beside the
  bundle are all taken back out. Injection happens at exec time, never touches LLB, and so cannot
  affect a cache key.

Like `universal`, this engine governs `RUN` step traffic only: its iptables rule redirects what
arrives on the CNI bridge. buildkitd's own egress is left alone, so `FROM`, `ADD <url>`, git
contexts and the `# syntax=` frontend are all unaffected: see
[What buildkitd fetches itself](#what-buildkitd-fetches-itself).

### How a request is handled

```
                        ┌─────────────────────────────────────────┐
   build ──redirect──▶  │ detect (mode tcp)                       │
                        │   first bytes: handshake or plain?      │
                        └───┬──────────────┬──────────────┬───────┘
                            │              │              │
              ip/tls rule   │      TLS     │    plaintext │
                            ▼              ▼              ▼
                     ┌────────────┐  ┌──────────┐  ┌──────────┐
                     │ passthrough│  │ https_in │  │ http_in  │
                     │  mode tcp  │  │ TLS ter- │  │          │
                     │  undecryp- │  │ minated, │  │          │
                     │  ted       │  │ cert per │  │          │
                     └─────┬──────┘  │ SNI      │  └────┬─────┘
                           │         └────┬─────┘       │
                           │              │             │
                           │      normalize the path    │
                           │      resolve the name here │
                           │      match host/path/method│
                           │              │             │
                           ▼              ▼             ▼
                        origin      origin (TLS,   origin
                                    cert checked)
```

A certificate is generated from the SNI alone, so a refused destination is never contacted: the only
path that reaches an origin is the backend, after a request has already passed the rules. The
origin's own certificate is checked on that same connection.

What each kind of rule decides, and what stays undecrypted:

| Rule                  | What it permits                            | Decided by           | Decrypted |
| --------------------- | ------------------------------------------ | -------------------- | --------- |
| `allowed_https_rules` | any method and path on the host, over TLS  | Host header          | yes       |
| `allowed_http_rules`  | any method and path on the host, plaintext | Host header          | n/a       |
| `allowed_url_rules`   | the named methods on matching URLs         | Host header and path | yes       |
| `allowed_tls_rules`   | TLS to the named host and port             | SNI and port         | **no**    |
| `allowed_ip_rules`    | TCP to the address and port, any protocol  | address and port     | **no**    |

### What it actually stops

- **The destination is resolved by the proxy, never chosen by the build, and only after a request
  has already passed the rules.** A forged `Host`, a doctored `/etc/hosts`, or a `Host` naming one
  host while the connection aims at another all reach the address the proxy itself resolved, not
  the one the build chose. Destination spoofing is removed rather than merely detected.
- **A resolved name may not land on an internal address.** An allowlisted name that resolves to
  loopback, link-local (AWS/GCP/Azure IMDS), CGNAT (Alibaba IMDS), the IETF protocol block (Oracle
  IMDS), the proxy's own address, or **an address the runner itself holds** is refused with 403, so
  a name under an attacker's control (or DNS for an allowlisted domain that has been compromised)
  cannot turn the proxy into a route to cloud metadata or back to the runner. The rest of RFC1918 is
  deliberately exempt: a name pointing at an internal mirror is a real, intended setup. An address
  named directly in a rule is exempt too, having been asked for rather than arrived at.

  The list comes from two places, because neither sees all of it: the action reads the runner's
  interfaces before starting the builder, and the engine adds the gateway of the network Docker then
  put it on, which did not exist when the action looked. Both halves are needed. A published
  container port is DNAT'd, so it answers on every address the runner holds; guarding only the
  gateway would leave `docker0` as an equivalent way in, and guarding only what the action saw
  would leave the gateway itself open.

  Three consequences worth knowing:

  - If the runner is itself a container (Docker-in-Docker), only that container's addresses are
    visible, not the real host's.
  - **An internal mirror running on the runner itself is no longer reachable by name.** Name it with
    `allowed_ip_rules` instead, which never goes through this guard. The same applies to a public
    name that resolves to the runner's own public address, which a self-hosted runner may well have:
    it is refused as `internal-address` like any other, and `allowed_ip_rules` is the way through.
  - An address the runner gains _after_ the builder starts is not covered, the list being read once
    at startup.

  This guard is about a _name_ landing somewhere it never should. It has nothing to do with, and
  never restricts, a rule whose host is itself a literal address (an `https`/`http` rule that names
  one directly, or a `Host` header the request sent as a bare IP): reaching that connection already
  required a rule to match the address as sent, so nothing was arrived at that wasn't first asked
  for. Direct access to a cloud metadata endpoint this way, the normal way any AWS/GCP/Azure CLI or
  SDK reaches it, is not something this guard is meant to stop; `allowed_ip_rules` is the intended,
  always-uninspected path for it (see below).

- **The resolver never forwards a query, allowed or not.** Every name is answered locally with the
  proxy's own address, so a lookup alone, even one the build never connects on, cannot be used as an
  exfiltration channel (`SECRET-DATA.attacker.example` would otherwise reach an attacker's own
  nameserver the moment it was forwarded). A name outside the allowlist is answered the same way
  rather than with NXDOMAIN, so the request that follows is recorded with its URL, query string
  included, before it is refused. Reverse lookups are the one exception: nothing inside the cage has
  a name to give back, and no rule can name an address backwards, so `PTR` is answered `NXDOMAIN`
  and the lookup is recorded in the resolver log without being reported as allowed or blocked. That
  covers a name that really is an address backwards and nothing else: `SECRET-DATA.in-addr.arpa` is
  answered, refused and reported exactly like any other name.
- **No discovery record is ever returned, so a build reaches the name a rule allowed.** Having no
  upstream, the resolver has nothing to answer an `SRV`, `TXT`, `TLSA` or `URI` query with, and an
  empty answer is what the great majority of names return for these anyway. This is load-bearing
  rather than incidental: `_http._tcp.deb.debian.org` really does carry an `SRV` record pointing
  at `debian.map.fastlydns.net`, and a build that followed it would connect to a name no allowlist
  mentions. A lookup for `_service._proto.<name>` is recorded under a verb of its own and reported
  in the timeline rather than as blocked, since no rule can permit one. That covers names really
  shaped like a service name, under a host the rules allow, asked for as one of the four types
  defined at such a name. Everything else is answered, refused and reported exactly like any other
  name, an unrecognised type included. A client that cannot fall back, such as a `mongodb+srv://`
  connection string, does not work inside the cage;
  see [Service discovery](../README.md#service-discovery).
- **A wide host rule paired with a narrow path or method does not narrow the DNS side.** DNS has no
  notion of a path, so a name under an allowed `*.example.com` is logged as allowed the moment it is
  looked up, before any path is known. The request that follows is still refused and still never
  reaches an origin; only the log line, not the outcome, reflects the host-only nature of that
  decision. Real resolution happens exactly once, in HAProxy, strictly after a request has passed
  the full rule check, which is an invariant rather than an optimisation: reversed, `do-resolve`
  would itself become the live exfiltration channel CoreDNS is built to avoid being. See
  [Rule syntax](./reference.md#rule-syntax) for how to write a host pattern that doesn't widen this
  more than intended.
- **The path is normalized, and traversal encodings are rejected outright.** `..`, `%2e%2e`,
  `..%2f`, a raw backslash, and `..%5c` are all refused rather than resolved, so a rule cannot be
  walked out of.

### Attempts to get around it

| What the build does                                     | What happens                                                                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Asks for any name, on or off the allowlist              | Answered locally with the proxy's own address; the query is never forwarded, allowed or not                                                                                                     |
| Requests a host no rule covers                          | **403**, recorded with its URL, origin never contacted                                                                                                                                          |
| Requests a path or method no rule covers                | **403**, recorded with its URL                                                                                                                                                                  |
| Walks out of an allowed path with `..`                  | **403**: the path is normalised before the rules see it                                                                                                                                         |
| Encodes the traversal as `%2e%2e` or `..%2f`            | **403**: decoding happens first, and what no normaliser can strip is refused outright                                                                                                           |
| Uses a backslash, raw or `%5c`, to climb                | **403**: the URL standard treats `\` as `/` for http(s), so a raw backslash is refused outright and `..%5c` like `..%2f`                                                                        |
| Sends an allowed name while aiming elsewhere            | Reaches the address the proxy resolved, not the one the build chose                                                                                                                             |
| Puts an address in the Host header                      | Taken as the destination only if a rule names it; the rules decide either way                                                                                                                   |
| Points `/etc/hosts` at an address of its choosing       | Same: the build's own address is discarded                                                                                                                                                      |
| Allowlists a name that resolves to an internal address  | **403**: the resolved address is refused if it is loopback, link-local, the proxy itself, an address the runner holds, or another never-public range                                            |
| Reaches an allowed host presenting a wrong certificate  | **503**: the origin's certificate is checked when the proxy connects                                                                                                                            |
| Speaks a protocol that is not TLS on any port           | Classified by its first bytes, so it is parsed as HTTP if it is HTTP                                                                                                                            |
| Ignores the proxy variables entirely                    | No effect: interception is at the network level, not opt-in                                                                                                                                     |
| Floods the proxy logs until earlier entries rotate away | A log that no longer starts where a real run does is not accepted as a complete record: the step fails under `restrict` with `fail_on_blocked` (the default), and is annotated otherwise        |
| Sends a URL longer than a log line                      | The line is sized for the longest request the proxy accepts, so the whole URL is recorded; a line that arrives unreadable anyway is counted and the report is not accepted as a complete record |

### What it can't do

- **TLS is terminated**, so a tool that pins a certificate, or ships its own trust store instead of
  reading the common CA-trust environment variables, will not work. The JVM (Java, Kotlin, Scala)
  is the common case. Use `universal` for those, and see
  [Limitations](../README.md#limitations) for the rest of the compatibility picture.
- **`audit` is not a passive observer here.** TLS is terminated in both modes, so a tool that cannot
  accept the CA fails under `audit` exactly as it would under `restrict`. What `audit` drops is the
  rule ACLs, not the interception: `set-dst` and the origin certificate check stay, because neither
  can be dropped honestly.

  The internal-address guard above stays active in `audit` too, unconditionally: a name resolving
  to cloud metadata isn't traffic `audit` needs to observe, since nothing legitimate depends on that
  specific resolved address. A literal-IP request, such as a build calling a metadata endpoint
  directly, is unaffected by this guard in either mode: blocking it would only hide real
  information about what the build needs, without closing anything DNS could have redirected.

- **`allowed_tls_rules` and `allowed_ip_rules` stay uninspected by design.** Each is recorded with a
  byte count and nothing more, since neither carries a name the proxy can re-terminate TLS for.
- **Query strings are kept in the log**, since that is also where an exfiltration payload would go.
  The report is the exception, see [Credentials in a URL](#credentials-in-a-url) below.
- **UDP is dropped**, so QUIC and HTTP/3 fall back to TCP or fail. Port 53 to the gateway is the one
  exception, which is the resolver. ICMP is dropped too.
- **No SLSA provenance.** BuildKit's own `--proxy-network` (used by `explicit`) records every URL it
  fetched, with a digest, as a SLSA provenance material; this engine doesn't use that mechanism, so
  there's no way to attach one without modifying BuildKit itself. The traffic artifact (see
  [Report action](../README.md#report-action)) carries URL, method, status and size as an
  observation record, but no content digest.

### Credentials in a URL

**Communication details** and the job log print the URL of every request, so a credential written
into a query string reaches everyone who can read the run. GitHub masks the values it knows as
workflow secrets, which leaves the ones it does not: a presigned URL's signature, a token minted
during the build, or a secret whose URL-encoded form no longer matches what was registered.

The value of a query parameter named `access_token`, `api_key`, `apikey`, `auth`, `client_secret`,
`code`, `id_token`, `key`, `password`, `private_token`, `refresh_token`, `secret`, `sig`,
`signature`, `token`, `x-amz-security-token`, `x-amz-signature` or `x-goog-signature` is therefore
replaced, whatever its case:

```
✅ 00:04.212: GET https://cdn.example.com/x.tar.gz?X-Amz-Signature=***&X-Amz-Expires=3600 -> 200 (4.1MB)
🚫 00:05.003: POST https://evil.example.com/?d=BASE64PAYLOAD -> not-allowed
```

Everything else is printed as it was sent, parameter names included, so most of what a refused
request tried to send is still there. Three things this does not cover: a credential in the path,
which `allowed_url_rules` is written against and so cannot be hidden; one in a parameter the list
does not name; and the [`explicit` engine](./explicit-engine.md), which is deprecated and prints its
own URLs unchanged. It also replaces an exfiltration payload the sender happened to name `code` or
`key`, so **read a suspected attempt out of the
[traffic artifact](./reference.md#traffic-artifact)**, which keeps every value verbatim, rather than
out of the summary.

An `allowed_url_rules` block suggested by an audit run never carries a query at all: rules match on
the path, and a recorded query is as likely to hold a one-off token as anything reusable.

## Universal Proxy Engine

### How it sees traffic

The default engine, and the one to fall back to when something in the build cannot accept the
`inspect` engine's CA. It decrypts nothing: HAProxy classifies each connection by what it can read
at the front of it, then checks that against the allowlist.

<img src="../assets/diagram-architecture-universal.png" alt="Universal proxy engine architecture" width="611" height="490">

Every container BuildKit spawns for a `RUN` step is placed on an isolated CNI network (the
`buildcage0` bridge, 172.20.0.0/24). An iptables `PREROUTING REDIRECT` rule sends all TCP from that
bridge to the proxy whatever its destination, so DNS-resolved and direct-IP connections both arrive
there, and a `FORWARD` rule drops everything else, so no other protocol has a way out and
buildkitd's own API is unreachable from a step. An `INPUT` rule likewise restricts the proxy's own
listening port to that same bridge, so nothing else on the container's network can reach it.

- **HTTPS**: the SNI from the TLS ClientHello, read without terminating the connection, so the build
  validates the origin's own certificate itself. Checked against `allowed_https_rules`.
- **HTTP**: the `Host` header, checked against `allowed_http_rules`. A request carrying none is
  refused with 400, since there is nothing to check it against.
- **A connection to a bare address**: nothing at all. It skipped DNS, so there is no name to read.
  It is matched against `allowed_ip_rules` as `ip:port` and, when nothing matches, refused.

dnsmasq answers every query with the proxy's own address (`address=/#/172.20.0.1`) and has no
upstream at all (`no-resolv`), which is both what puts a name-based connection in front of the proxy
and what keeps a DNS query from becoming an exfiltration channel. Once a request has passed the
rules, HAProxy resolves the name itself and rewrites the destination to the result (`set-dst`), so
the build's own choice of address is discarded here as well.

Nothing in the build has to trust an injected CA or be told about a proxy, which is what lets this
engine cover any language or package manager, a pinned certificate included, with no Dockerfile change.

Like `inspect`, this engine governs `RUN` step traffic only. buildkitd is not on the isolated
network, so what it fetches for itself is never filtered: see
[What buildkitd fetches itself](#what-buildkitd-fetches-itself).

### What it stops

- **Where a connection ends up is not the build's choice.** The proxy resolves the name it read from
  the SNI or the `Host` header and connects to that address, so a request that was allowed for a
  name always reaches the server that name belongs to.
- **A resolved name may not land on an internal address.** The same guard as
  [`inspect`](#inspect-proxy-engine)'s (see [What it actually stops](#what-it-actually-stops)):
  loopback, link-local, CGNAT, the IETF protocol block, the proxy's own address, and the runner's
  own addresses are all refused (`internal-address` in the report). Unlike `inspect`, there's no literal-address exemption to carve
  out here, since a connection to a bare address never reaches this guard at all: it skips DNS and
  `do-resolve` entirely on a separate code path; `allowed_ip_rules` is the always-uninspected path for
  a destination named directly.
- **DNS never leaves the job.** The internal resolver has no upstream and answers every query
  locally, so a name carrying data in its labels reaches nobody. The iptables rules leave no path to
  an outside resolver either.
- **Encrypted Client Hello does not change which name is matched.** ECH conceals the inner name,
  but the outer SNI is what a rule matches and what the proxy resolves and connects to, so an ECH
  handshake reaches the outer name's server or nothing at all. Hiding a target behind an allowed
  outer name is the [domain fronting](#what-it-cant-see) case below, not a way past the allowlist.
  A build also has to bring its own ECHConfig keys: the resolver has no upstream, so the DNS HTTPS
  (type 65) record that normally carries them is never returned.
- **Nothing but TCP gets out.** Everything else is dropped before it reaches the proxy, so ICMP, raw
  UDP and QUIC have no exit path at all.
- **IPv6 is not a way around any of this.** Equivalent ip6tables rules drop forwarded IPv6, the
  resolver answers with the unspecified address (`::`) for every query, and the proxy reaches
  allowed names over IPv4 only. That last part is stated in the config (`dns-accept-family ipv4`)
  rather than left to HAProxy's default, which decides from the runner's own IPv6 default route and
  would make what a name resolves to differ between runners. What it costs is that an allowed name
  with AAAA records and no A record never resolves here: it is refused on every attempt, in `audit`
  too, reported as `dns-failed`, and no rule can clear it.

### Attempts to bypass it

| What the build does                                    | What happens                                                                                                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sets an allowed name in the SNI while aiming elsewhere | Reaches the server the proxy resolved that name to, not the one the build chose                                                                                                          |
| Allowlists a name that resolves to an internal address | Refused: the resolved address is checked and rejected if it is loopback, link-local, the proxy itself, an address the runner holds, or another never-public range, in `audit` too        |
| Uses ECH to conceal the real SNI                       | Reaches whatever the outer SNI resolved to, and that outer name still has to be allowed; the type 65 record carrying ECHConfig is never returned either                                  |
| Encodes data into DNS queries                          | Answered locally and never forwarded; an outside resolver is unreachable                                                                                                                 |
| Tunnels over ICMP, raw UDP, or QUIC                    | Dropped before the proxy; only TCP is redirected to it                                                                                                                                   |
| Falls back to IPv6                                     | Forwarded IPv6 is dropped, lookups answer `::`, and the proxy connects over IPv4                                                                                                         |
| Uses DNS over TLS or DNS over HTTPS                    | Redirected to the proxy like any other TCP and checked on its SNI, so an outside resolver is reachable only if its own host and port are allowlisted                                     |
| Connects to a raw address                              | Checked against `allowed_ip_rules`, and refused when nothing matches                                                                                                                     |
| Ignores the proxy variables entirely                   | No effect; interception is at the network level, not opt-in                                                                                                                              |
| Floods the proxy log until earlier entries rotate away | A log that no longer starts where a real run does is not accepted as a complete record: the step fails under `restrict` with `fail_on_blocked` (the default), and is annotated otherwise |
| Sends a name longer than a log line                    | The line is sized well past the longest name DNS allows; a line that arrives unreadable anyway is counted and the report is not accepted as a complete record                            |

### What it can't see

**Nothing inside the tunnel is visible.** A rule reaches as far as a host and a port. The method and
the path travel inside TLS, so neither can be enforced, and neither appears in the report.
[`inspect`](#inspect-proxy-engine) is what reads them.

**An allowlisted address is an uninspected pipe.** Unlike the HTTPS and HTTP paths, a matched
direct-IP connection is passed through as a raw TCP stream and its protocol is never checked. Once
an `ip:port` pair is allowlisted, any TCP-based protocol can use that path. Prefer domain rules
(`allowed_https_rules` / `allowed_http_rules`), and keep `allowed_ip_rules` for destinations that
genuinely have no stable hostname.

**Domain fronting.** This engine reads the SNI but cannot decrypt what follows, and the `Host`
header that would reveal the real target is inside the tunnel:

```
1. ClientHello SNI: allowed.example.com     ← all Buildcage sees → allowed
2. HTTP Host header: malicious.example.com  ← encrypted, not inspectable
3. The CDN routes on the Host header        → reaches the attacker's server
```

For this to work, the allowed domain and the target domain have to sit on the same CDN or hosting
infrastructure. Closing the gap needs the proxy to terminate TLS and read that header, which is what
[`inspect`](#inspect-proxy-engine) does: `allowed_url_rules` matches on the real `Host`, so a
fronted request lands outside any host rule it was written for.

Staying on `universal`, what narrows it:

- **Allow as few domains as possible.** Every extra host is another place a fronted request could
  hide.
- **Avoid broad CDN wildcards** such as `*.cdn.example.com`, and prefer a service's own domain:
  `registry.npmjs.org` over a shared CDN host.
- **Check your CDN's position.** Major providers including CloudFront and Cloudflare have
  introduced measures restricting domain fronting; consult your provider's documentation for what
  applies today.
- **Re-run [audit mode](../README.md#operation-modes) periodically** to notice a connection pattern
  that has changed.

## Explicit Proxy Engine

> [!WARNING]
> `explicit` is **deprecated**. It still works and existing workflows keep running, but it receives
> no further development, and it has structural limitations not present in `universal` or `inspect`:
> see [Coverage and Visibility](#coverage-and-visibility) below. For request-level enforcement, use
> [`inspect`](#inspect-proxy-engine) instead.

For how to enable it, how it compares with `universal`, and the CA-trust workaround, see
[Explicit Proxy Engine](./explicit-engine.md). This section covers the architecture and threat
model.

### Architecture

<img src="../assets/diagram-architecture-explicit.png" alt="Explicit proxy engine architecture" width="611" height="454">

`proxy_engine: explicit` uses BuildKit's native `--proxy-network` (available since moby/buildkit
v0.31.0) instead of the CNI/DNS-redirect/HAProxy stack described in
[Universal Proxy Engine](#universal-proxy-engine). Each `RUN` step is isolated into its own private
point-to-point network namespace whose only reachable peer is buildkitd's built-in MITM proxy.
`HTTP_PROXY`/`HTTPS_PROXY` and a generated CA certificate are injected into the step automatically,
so no Dockerfile change is needed for a tool that already respects these standard variables. The
proxy decrypts the traffic and checks the host against a BuildKit
[source policy](https://github.com/moby/buildkit/blob/master/docs/proxy.md) compiled from your
allowlist, written in the same `allowed_https_rules` / `allowed_http_rules` / `allowed_ip_rules`
syntax as `universal` (see [Rule syntax](./reference.md#rule-syntax)). Enforcement is at domain (and
port) granularity, the same as `universal`: the generated policy always allows any path once the
host matches, since the rule syntax has no path component. The decrypted path is still visible, so
it shows up in the report and BuildKit's own build output even though it isn't used to allow or deny
the request. `allowed_ip_rules` entries are compiled into the same kind of policy rule as domain
rules (matched as an `https`/`http` identifier), so unlike `universal`, there is no raw, uninspected
TCP passthrough for IP-based rules here.

If the build client already sets its own **static** source policy (e.g. via
`EXPERIMENTAL_BUILDKIT_SOURCE_POLICY`, which `docker buildx build` reads unconditionally), buildcage
merges its own rules in last, so a client-supplied policy can never widen access beyond your
allowlist. A separate **dynamic**, session-based policy mechanism (`docker buildx build
--policy=...`) is left untouched and applies as an additional condition alongside buildcage's policy.

For how the supervisor binary, gRPC interception, and policy compilation work internally, see
[Explicit Engine Internals](./development.md#explicit-engine-internals) in the Development Guide.

### Coverage and Visibility

| Traffic                                        | Allowed                                                                                                                           | Denied                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `RUN` step, proxy-aware tool                   | Logged per-step in the report's "Communication details"                                                                           | Logged in a flat `DENIED` list (no per-step attribution; whole-second timestamps)           |
| `RUN` step, non-cooperative tool or raw socket | Immediate "network unreachable", with **no trace anywhere**: not in the build log, the report, or provenance                      | Identical; the request never reaches the proxy, so allowed and denied are indistinguishable |
| `ADD <url>`                                    | Not tracked by the report: the URL is developer-specified in the Dockerfile, already an intentional, reviewable part of the build | Aborts the entire build immediately at LLB load time; logged the same way as a denied `RUN` |
| `FROM` / git contexts / `# syntax=` frontends  | Unaffected: buildcage's policy only ever matches `http(s)://` sources                                                             | Unaffected                                                                                  |

The key structural difference from `universal`: there, a non-cooperative process still reaches the
CNI bridge and is observed, blocked, and logged. Under `explicit`, each `RUN` step's network
namespace has no broader network to route through, so that traffic leaves no trace at all. That is
the trade-off for full path-level visibility and BuildKit-native provenance integration.

For exactly how the `report` action extracts allowed/denied data from buildkitd's own logs, see
[Viewing Logs](./development.md#viewing-logs) in the Development Guide.

## What buildkitd fetches itself

Every engine intercepts `RUN` step traffic and nothing else. buildkitd is not on the isolated
network: it sits on the builder container's own network, so what the daemon fetches never reaches
the proxy. None of it appears in the report, and `fail_on_blocked` never fires for it.

What the daemon fetches:

- **`FROM`** (`docker-image://`), including every stage's base image and any image named in
  `COPY --from=`.
- **`ADD <url>`**, the HTTP source. The URL is `ARG`-expanded, so a build argument can end up in it.
- **git contexts and git sources**, whether the context itself or a `FROM`/`ADD` naming a repository.
- **The frontend image a `# syntax=` directive names**, and whatever that frontend then asks
  buildkitd to fetch through the gateway API. This is the broadest of the four: a frontend produces
  the LLB the daemon runs, so it can read a step's output back and fetch on the daemon's behalf.

`explicit` is the one partial exception: its BuildKit source policy matches `http(s)://` sources, so
`ADD <url>` is enforced there (see [Coverage and Visibility](#coverage-and-visibility) above). Image
and git sources stay unaffected on every engine.

This is a scope decision, not a gap left open. All four are destinations a developer writes into the
Dockerfile, so they are reviewable source, and they are resolved before any step runs. What Buildcage
governs is the code that runs _inside_ a `RUN` step: a dependency's `postinstall`, a build script, a
compiler plugin, none of which the Dockerfile author reviewed. Someone who can edit the Dockerfile
is outside that model, as is an untrusted step elsewhere in the same job (see
[Verification Limitations](#verification-limitations)).

What covers this instead is ordinary supply chain practice: reviewing the Dockerfile, pinning base
images by digest, and pinning the `# syntax=` frontend to a digest rather than a floating tag. See
[Keep the rest of your supply chain practice](#keep-the-rest-of-your-supply-chain-practice) below.

## What the builder container runs with

A builder has to mount, create namespaces and manage cgroups, which is why the one
`docker/setup-buildx-action` starts runs `--privileged`. Buildcage's does not. Against that
container it is narrower on every axis but one; against a container started with no options at all
it widens two.

- **`SYS_ADMIN`, `NET_ADMIN` and `SYS_PTRACE`, on top of Docker's default set.** The BuildKit OCI
  worker mounts, creates namespaces and manages a cgroup for each `RUN` step. `NET_ADMIN` covers
  iptables and the CNI bridge under `universal` and `inspect`, and the proxy-network veth and netns
  under `explicit`. runc reads `/proc/PID/ns/mnt` to set a step's mount namespace up.
- **Seccomp is Docker's own default profile**, where `privileged` switches filtering off entirely.
  That profile already permits `mount`, `umount2`, `unshare`, `setns` and `clone` to a
  `CAP_SYS_ADMIN` holder, so the only additions are the two things it refuses at every capability
  and runc still needs: `pivot_root`, and the three `keyctl` operations runc performs per step.
  Everything outside the allowlist stays refused, including syscalls added to the kernel after the
  profile was written.
- **AppArmor is unconfined, as it also is under `privileged`.** `docker-default` refuses every
  `mount` regardless of capabilities, so it cannot coexist with the `SYS_ADMIN` above, and a
  replacement profile would have to be loaded into the host kernel, which an action cannot do
  portably.
- **The cgroup tree it can write is its own.** The container asks for a private cgroup namespace
  explicitly rather than relying on the daemon's default, and remounts that namespace's
  `/sys/fs/cgroup` read-write at startup, so the host's cgroup tree is neither visible nor writable.
  `privileged` would expose the host's `/proc` and `/sys` as well. This is what makes a cgroup v2
  host a requirement: under v1 the per-controller mounts cannot be reached that way, and startup
  fails naming that rather than leaving an opaque failure at the first `RUN` step. Every
  GitHub-hosted runner is v2.
- **No Docker socket, no workspace mount, and devices refused by the device cgroup.** The first two
  are simply never given; the third is what `privileged` would undo, since it allows every device
  outright. The device cgroup is a filter rather than an absence, and lifting it takes
  `CAP_SYS_ADMIN` in the builder itself, which is a question only for a `RUN` step that has already
  broken out of runc. Seccomp cannot settle that question: BuildKit's runc manages a device filter
  for each `RUN` step, so the builder needs the calls that manage one. A step still confined by runc
  never reaches this layer at all.

## Hardening

An allowlist decides which destinations a build can reach. It works on domain names, so it cannot
tell a legitimate use of an allowed destination from an abusive one. Anything leaving through a
service you had to allow anyway still leaves. That is a structural limit, not something a better
rule set fixes.

What it does stop is narrower. Traffic a `RUN` step sends to a destination that is not on the list
does not go out, and infrastructure an attacker set up is normally not on it, because the build has
no reason to reach it. That is also the hardest kind of leak to find afterwards, which is why
closing it is worth doing even though the rest stays open. What buildkitd fetches for itself is
outside this entirely, as [the previous section](#what-buildkitd-fetches-itself) describes.

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
something an allowlist does not. Pinning by digest belongs here too, for base images and for a
`# syntax=` frontend alike: buildkitd resolves both itself, off the isolated network, so neither is
filtered (see [What buildkitd fetches itself](#what-buildkitd-fetches-itself)). Buildcage is one
layer among them, not a replacement for any.

## Image Provenance Verification

Buildcage decides what the build can reach, so it is fair to ask what says the Buildcage image is
the one this repository published.

Each release's image is bound to the CI workflow that built it by [Sigstore](https://sigstore.dev)
keyless signing, and the setup action verifies that binding at startup. The signature covers the
exact source commit SHA, so a tampered or substituted image fails verification before it is used.
Pin to a commit SHA (or a version tag) and update on your own schedule: verification is what
confirms you are running exactly what was built from that commit.

### How it works

**Signing (at release time):** when a release tag is pushed, the `docker-publish.yml` workflow
builds and signs the Docker image using a short-lived OIDC identity issued by GitHub Actions. The
signature is stored as a **Sigstore Bundle v0.3** attached to the image via the OCI 1.1 Referrers
API in GHCR. The bundle holds the signature, a Fulcio leaf certificate embedding the workflow
identity, and a Rekor transparency log entry.

Between building and signing, the workflow builds through the image it just pushed: on both
architectures and for the `universal` and `inspect` engines, the setup action starts that exact
digest as the builder and a `RUN` step has to reach an allowed host and fail to reach one outside
the rules. An image that fails there is never signed, and an unsigned image is one the setup action
refuses. `explicit` is deprecated and goes unexercised, though signing it still waits on the engines
that are.

**Verification (at action startup, `main` phase):** the setup action verifies the image entirely
in-process using `@sigstore/verify`, `@sigstore/tuf` and `@sigstore/bundle`. No external binary
(cosign, for instance) is downloaded or required. Running in the `main` phase means
`docker/login-action`, if present, has already stored registry credentials before verification
begins. The flow:

```
1. Fetch manifest-list digest
       docker buildx imagetools inspect <image>:<tag>
       (uses docker login credentials, so private packages work)
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
            ↓
6. Proxy engine assertion (fail-closed)
       GET the verified image's config blob → org.opencontainers.image.version
       Its engine suffix must name the engine this run asked for
       Mismatch → VERIFY_FAILED (the signature covers the digest, not the tag)
```

Every identity check (OIDC issuer, signing workflow, ref/SHA claim, manifest digest) is enforced
inside the single `verifyBundle()` call, equivalent to cosign's `--certificate-oidc-issuer`,
`--certificate-identity-regexp` and `--certificate-github-workflow-sha`, plus the implicit
digest-match cosign performs against its target image argument.

### Identity matching by reference type

| How the action is pinned       | Identity check                                              | Mechanism                                                              |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@<40-char SHA>`               | Source Repository Digest **strictly equals** the pinned SHA | `certificateOIDs`: Fulcio OID `1.3.6.1.4.1.57264.1.13`, raw byte match |
| `@v2.2.0` (exact version)      | SAN matches `...@refs/tags/v2\.2\.0(\.\|$)`                 | `certificateIdentityURI` regexp                                        |
| `@v2` (major-floating)         | SAN matches `...@refs/tags/v2(\.\|$)`                       | `certificateIdentityURI` regexp                                        |
| A branch name, or a local path | **Hard fail**: pin to a version tag or commit SHA           |                                                                        |

For the strongest guarantee, pin to a **commit SHA**:

```yaml
uses: buildcage/docker@<40-char-sha> # vX.Y.Z
```

The SHA check is the core of tamper detection: it confirms the Docker image was built from exactly
the same source tree as the pinned action commit. An image built from a different commit fails
verification even if it is signed.

### What this prevents

An attacker who can push a malicious image to `ghcr.io/buildcage/docker` without compromising the
repository cannot produce a valid Sigstore bundle. The bundle's Fulcio certificate requires a GitHub
Actions OIDC token that is only issued during an actual workflow run on the real repository.

This is **one layer of a defense-in-depth strategy**, not a complete guarantee. It reduces the
attack surface to the registry layer and forces an attacker to compromise the GitHub account or the
repository itself, which raises the cost and leaves an audit trail in the Rekor transparency log.

Binding the image digest to the exact source commit SHA also serves as an alternative to
reproducible builds: it establishes that the published artifact was produced from a specific source
commit without requiring an independent rebuild.

### Verification Limitations

Verification establishes where the image came from. Here is what it leaves uncovered.

- **The build before signing is a smoke test, not the test suite.** It proves the released image
  starts and enforces on a single allowed and a single refused host, per engine and per
  architecture. The scenario coverage in `test/` runs against an image built from the branch, and
  the parts of it that need the fixture origin cannot run against a released image at all: trusting
  that origin's self-signed certificate takes a `BUILDCAGE_TEST_HOOKS` (`inspect`) or
  `BUILDKIT_PROXY_BUILD_TAGS` (`explicit`) build, which a released image is not.

- **A signature says who built the image, not what the code does.** It attests that this
  repository's release workflow built it from the pinned commit, and a release published by someone
  who has taken over that identity verifies just as cleanly as a legitimate one. Two things limit
  the damage: with a commit-SHA pin, a newly published release cannot reach your workflow until you
  change the pin yourself, and every signature is recorded in the Rekor transparency log, so an
  unintended release is discoverable after the fact.

- **Sigstore has to be reachable.** Verification depends on the Rekor transparency log and the
  Fulcio CA, and fetches the TUF trust root at verification time. An outage there fails the action
  rather than skipping the check.

- **The registry decides which signed image gets verified.** Resolving the tag yields a manifest
  digest, and everything after that is bound to it: the bundle is fetched by digest, the verified
  signature must cover that same digest, and the `docker pull` is digest-pinned. Content substituted
  at any point after the tag lookup therefore makes verification **fail** rather than falsely pass,
  leaving no time-of-check/time-of-use gap. What remains is the tag lookup itself: an attacker with
  write access to the registry could repoint the tag, but only at an image this repository's release
  workflow genuinely signed.

  That leaves one engine's image substitutable for another's from the same release, which the
  identity cannot tell apart. Step 6 above is what does: a `-inspect` tag pointed at the same
  release's `universal` image fails, instead of quietly running without URL and TLS enforcement.

- **A floating tag is a pointer someone else moves.** Under `@v3` or `@v3.2` the signing identity
  accepts any release in that series, so the tag can also be moved back to an older one. Pinning a
  commit SHA is what puts you in charge of when you move, and it is the reason to prefer it: the
  registry tag and the git tag behind `@v3` are both writable by whoever publishes releases.

- **A build-time test hook exists, but not in what you run.**
  `BUILDCAGE_BUILD_TEST_HOOKS=1 vp run build` produces a `dist/` where a `BUILDCAGE_LOCAL_IMAGE_REF`
  override can point the action at an unpublished image, used only by this repo's own CI and local
  development. Tree-shaking drops that module out of every normal build, and a CI check inspects the
  published `dist/` to confirm it never reads the flag, so no `env:` a consumer sets can reach it.
  See [development.md](./development.md#local-development).

- **Another step in the same job can tamper with the container (out of scope by design).**
  Buildcage's threat model is malicious code _inside_ a `RUN` step. An untrusted step elsewhere in
  the same job is not: running between `setup` and `report`, it can reach the proxy container
  through `docker exec`/`docker cp`, or the host filesystem directly on a passwordless-sudo runner,
  and rewrite its traffic log. Sigstore proves the image was genuine at startup, not that nothing
  touched it afterwards. The script `report` runs is not part of that gap: it comes from the image,
  not from the container.

  `report` does refuse to pass a log that doesn't start where a real proxy run would, which catches
  wholesale erasure, and a build flooding the proxy's logs until their earliest entries rotate out,
  and it counts any line that announces itself as the proxy's own yet cannot be read, but not a
  format-aware forgery. A build large enough to genuinely outgrow the log's 100 MB
  rotation budget trips the same check, for the same reason: its earliest traffic really is gone.
  Against tampering the effective defense is procedural: don't place an untrusted step between
  `setup` and `report`.
