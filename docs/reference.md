# Reference

This page holds every input of both actions, the rule grammar in full, and what the report and the
traffic artifact contain. The [README](../README.md) covers what Buildcage does and how to adopt it,
and links here for the details.

## Contents

- [Setup action inputs](#setup-action-inputs)
- [Operation modes](#operation-modes)
- [Rule syntax](#rule-syntax)
- [Report action inputs](#report-action-inputs)
- [Blocked service names](#blocked-service-names)
- [Requests that never arrived whole](#requests-that-never-arrived-whole)
- [Connections that failed](#connections-that-failed)
- [Traffic artifact](#traffic-artifact)
- [CA trust variables](#ca-trust-variables)

## Setup action inputs

`buildcage/docker` starts the builder. Every input is optional.

| Input                | Default     | Description                                                                                                     |
| -------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `builder_name`       | `buildcage` | Name of the builder container. The Buildx `endpoint` has to match it.                                           |
| `proxy_mode`         | `restrict`  | `audit` or `restrict`. See [Operation modes](#operation-modes).                                                 |
| `proxy_engine`       | `inspect`   | `inspect` or `universal`. See [Engines](../README.md#engines).                                                  |
| `fail_on_ca_residue` | `true`      | `inspect` only. `false` turns a copy of the CA left in the image into a warning. See [CA residue](#ca-residue). |

```yaml
- uses: buildcage/docker@e97cf73f1ca5094c62968f6e8617bde0948deb3d # v4.0.0
  with:
    builder_name: buildcage
    proxy_mode: restrict
    proxy_engine: inspect
```

On a self-hosted runner that runs several jobs at once, give each job its own `builder_name`. The
name is what identifies the builder's containers, so two concurrent jobs sharing it tear down each
other's builder. The report action needs the same name. A GitHub-hosted runner gets a VM per job, so
the default is fine there.

### Rule inputs

All of these are empty by default, and all of them are additive: a connection is allowed when any
rule in any input matches. Which ones apply depends on the engine.

| Input                 | `inspect` | `universal` | What one rule matches                                                                                                      |
| --------------------- | :-------: | :---------: | -------------------------------------------------------------------------------------------------------------------------- |
| `allowed_url_rules`   |    ✅     |      -      | A method and a URL: `GET https://registry.npmjs.org/**`                                                                    |
| `allowed_https_rules` |    ✅     |     ✅      | A host and port reached over HTTPS: `registry.npmjs.org:443`                                                               |
| `allowed_http_rules`  |    ✅     |     ✅      | A host and port reached over plain HTTP: `deb.debian.org:80`                                                               |
| `allowed_ip_rules`    |    ✅     |     ✅      | An address and port, for connections made without DNS: `192.168.1.1:443`                                                   |
| `allowed_tls_rules`   |    ✅     |      -      | A TLS destination to pass through undecrypted, judged on SNI: `db.example.com:5432`                                        |
| `known_blocked_rules` |    ✅     |     ✅      | A host, or (on `inspect`) a method and URL, expected to be blocked, so it doesn't fail the [report](#report-action-inputs) |

Under `inspect`, `allowed_https_rules` and `allowed_http_rules` still work and are kept for
compatibility, but `allowed_url_rules` covers them: a host rule is the same as a URL rule with any
method and any path.

Setting a rule the engine can't act on is caught before the build starts: `restrict` fails, since a
rule that looks like it protects the build but cannot be enforced is worse than none, and `audit`
warns and ignores it.

## Operation modes

| `proxy_mode` | What it does                                                      | When to use it                                             |
| ------------ | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| `audit`      | Logs every destination the build reaches and blocks nothing       | First setup, adding a dependency, investigating a failure  |
| `restrict`   | Allows only what the rules match, blocks and logs everything else | Everyday builds, CI/CD pipelines, security-critical builds |

`audit` allows what the active engine can classify. A connection it cannot classify, such as an HTTP
request carrying no `Host` header, is still refused, on each engine's own terms.

Because `audit` enforces nothing, the `allowed_*_rules` have no effect in it; you write them when
you move to `restrict`. Any other `proxy_mode` value, a differently cased one included, fails the
setup.

`audit` is not a passive observer under `inspect`: TLS is terminated in both modes, and what `audit`
drops is the rule ACLs, not the interception. A tool that cannot accept the injected CA fails under
`audit` exactly as it would under `restrict`.

If you forget a domain the build needs, `restrict` blocks it and the report step fails with the
destination named, which is why it is worth running `audit` first.

## Rule syntax

`allowed_url_rules` and `allowed_tls_rules` need `proxy_engine: inspect`. The host rules work with
either engine.

### URL rules: `allowed_url_rules`

A rule is a method list, a space, then a URL pattern. Because a rule contains a space, this input is
newline-separated. The method is required, so a rule always states what it permits. A `#` at the
start of a line, or after whitespace, begins a comment that runs to the end of the line, and a blank
line is ignored, which helps once the list gets long. A `#` with no space before it is not a
comment: since `#` never legitimately appears in a rule (it is part of no host or URL, and a
fragment never travels with a request), it is reported as a mistake rather than silently trimmed.

```yaml
allowed_url_rules: |
  # apt
  GET http://deb.debian.org/**
  GET http://security.debian.org/**

  # npm: fetch packages, and the audit endpoint it posts to
  GET https://registry.npmjs.org/**
  POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk

  # pip: one registry, two domains
  GET https://pypi.org/simple/**
  GET https://files.pythonhosted.org/packages/**

  # a private registry, on a non-default port
  GET|HEAD https://registry.internal.example.com:8443/**

  # anything at all on one internal host
  * https://tools.internal.example.com
```

Methods are separated by `|` or `,`, and `*` means any method. The port may be left out when it is
the scheme's default, and a pattern with no path allows any path on that host. A `#` fragment is
refused: it never travels with a request, so a rule carrying one could only match nothing. So is a
query string (a `?` followed by text holding `=` or `&`), since a rule matches the path alone and
the query is never compared, and a user name before an `@` in the host, which no request's Host
carries.

| Pattern | In a domain                                       | In a path                     |
| ------- | ------------------------------------------------- | ----------------------------- |
| `**`    | crosses dots                                      | crosses `/`                   |
| `*`     | one or more, not crossing a dot                   | one or more, not crossing `/` |
| `?`     | one character                                     | one character                 |
| `~`     | raw regex, split into a host half and a path half |                               |

In a URL rule a wildcard may sit among literal text, inside a domain label or a path segment. Host
rules don't allow that:

```yaml
allowed_url_rules: |
  GET https://abc*.amazonaws.com/**
  GET https://example.com/pkg-*/**
```

A path or method never narrows what a wildcard _host_ resolves. See
[Inspect Proxy Engine](./security.md#inspect-proxy-engine) for why, and for how to write a host
pattern that doesn't widen more than intended.

A rule may name an address rather than a name. Nothing is loosened by that: the rules still match
against the `Host` header and still decide, and an address reached this way stays inspected, so
method and path rules apply to it. Over HTTPS the origin's certificate has to be valid for the
address, which needs an IP SAN, so in practice an address is a plaintext or a passthrough
destination.

### Host rules: `allowed_https_rules`, `allowed_http_rules`, `allowed_ip_rules`, `known_blocked_rules`

`allowed_https_rules`, `allowed_http_rules` and `allowed_ip_rules` share one syntax; rules are
separated by whitespace, so one per line reads best. A host rule is equivalent to a URL rule with any
method and any path. `known_blocked_rules` extends this syntax and is newline-separated, since a line
there can also be a URL rule; see [Blocked rules](#blocked-rules-known_blocked_rules).

```yaml
allowed_https_rules: |
  registry.npmjs.org:443
  repo.maven.apache.org:443
  *.internal.example.com:443
  registry.internal.example.com:8443

allowed_http_rules: |
  deb.debian.org:80
  security.debian.org:80
```

#### Wildcards

| Pattern | Matches                                                     | Example                                                                  |
| ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `*`     | One or more characters **excluding** dots (single label)    | `*.example.com` matches `sub.example.com` but not `deep.sub.example.com` |
| `**`    | One or more characters **including** dots (multiple labels) | `**.example.com` matches `sub.example.com` and `deep.sub.example.com`    |
| `?`     | A single character excluding dots                           | `exampl?.com` matches `example.com`, `examplx.com`                       |

A label that contains `*` has to be exactly `*` or `**`. `abc*.example.com` is rejected here; only
[`allowed_url_rules`](#url-rules-allowed_url_rules) takes a wildcard in the middle of a label.

Besides the wildcards, a label holds letters, digits, `-` and `_`, and nothing else. Write an
internationalized name in its punycode form (`xn--mnchen-3ya.de`, not `münchen.de`), the form a
connection carries. A leading, trailing or doubled dot is refused.

`**` alone matches an address too: under `**:443`, a request that reaches the proxy through a name
with `Host: 10.0.0.5` goes to that private address (see
[A name may not resolve inward](./security.md#a-name-may-not-resolve-inward)). A connection straight
to an address goes by `allowed_ip_rules` only.

#### Ports

A port is required on every rule.

| Rule                 | Matches                                                       |
| -------------------- | ------------------------------------------------------------- |
| `example.com:443`    | `example.com` on port 443 only                                |
| `*.example.com:8443` | Any single-level subdomain of `example.com` on port 8443 only |
| `example.com:*`      | `example.com` on any port                                     |

`known_blocked_rules` is the exception: a host rule there that names no port is read as `:*`. It is
matched against rows of the report rather than against connections, and a row for a name the
resolver refused has no port at all, nothing having been connected to. `telemetry.example.com` and
`telemetry.example.com:*` are the same rule.

### Blocked rules: `known_blocked_rules`

`known_blocked_rules` lists traffic that is expected to be blocked, so a build isn't failed over a
refusal you already know about (see [Report action inputs](#report-action-inputs)). It does not
allow anything: the traffic stays blocked. That is the point for a telemetry endpoint you want
refused but not treated as an error, where allowing it would let the request through.

Unlike the allow inputs it is newline-separated, one rule per line, because a line can be either
form:

- a **host rule** (`host:port`, the syntax above), which works on either engine; and
- a **URL rule** (a method and a URL, the [`allowed_url_rules`](#url-rules-allowed_url_rules)
  syntax), which needs `proxy_engine: inspect`, the only engine that sees a method or a path.

```yaml
known_blocked_rules: |
  # host rules: acknowledge every port on a name, or a specific one
  telemetry.example.com
  *.metrics.example.com:443

  # URL rules (inspect only): acknowledge one endpoint on an otherwise-allowed host
  POST https://api.example.com/telemetry
  * https://noisy.example.com/health
```

A URL rule marks only requests that carry the method and path it names, so it acknowledges one
endpoint on a host while any other blocked request to the same host still fails the step. A
host-level refusal — a name the resolver refused, or a connection blocked before any request was
read — carries no method or path, so it is matched by a host rule, never a URL rule. Port handling
follows each form: a host rule with no port reads as `:*`, a URL rule with no port as the scheme's
default (`443`/`80`), exactly as in the allow inputs.

Because a URL rule matches nothing on an engine that never sees a method or a path, a URL line under
`proxy_engine: universal` is refused in `restrict` mode and warned about in `audit`, the same split
`allowed_url_rules` gets. A host line works on every engine.

> **Migrating from v3.** `known_blocked_rules` was whitespace-separated, so several host rules could
> share a line. It is now newline-separated: put each rule on its own line.

### IP addresses: `allowed_ip_rules`

Connections made straight to an address never go through DNS, so they are allowed separately from
any domain. IPv4 only, and what a rule may hold depends on the engine:

| Engine      | A rule can be                                               | It cannot be       |
| ----------- | ----------------------------------------------------------- | ------------------ |
| `inspect`   | An address, a CIDR block (`10.0.0.0/8:443`), or a `~` regex | A wildcard pattern |
| `universal` | An address, a wildcard, or a `~` regex                      | A CIDR block       |

```yaml
# inspect
allowed_ip_rules: |
  192.168.1.10:443
  10.0.0.0/8:443
  ~^172\.16\.\d+\.\d+:5432$

# universal
allowed_ip_rules: |
  192.168.1.10:443
  192.168.1.*:443
```

A rule is matched against the address the connection goes to, never a name the connection carries,
so a rule naming a host is refused at setup, and so is a form the engine cannot match (a wildcard
on `inspect`, a CIDR block on `universal`): `restrict` fails and `audit` warns. A range that covers
the proxy's own address, which every name resolves to inside the cage, still leaves a connection
made through a name to the domain rules. Either way the connection is tunnelled without
inspection: once an `ip:port` pair is allowed, any TCP-based protocol can use that path. Prefer a
domain rule where the destination has a stable name.

### TLS passthrough: `allowed_tls_rules`

For TLS traffic that isn't HTTPS, and for HTTPS that must not be decrypted. The SNI and port are
checked and the connection passes through undecrypted, so the build validates the origin's own
certificate:

```yaml
allowed_tls_rules: |
  db.example.com:5432
  repo.maven.apache.org:443
```

A host rule input is split on whitespace, so a rule per line and a group of rules on one line both
work. Comments follow the same rule as [`allowed_url_rules`](#url-rules-allowed_url_rules): a `#` at
the start of a line, or after whitespace, runs to the end of the line, and a `#` with no space
before it is reported as a mistake rather than silently trimmed, since `#` is part of no host. The
second rule above is the shape to use for a JVM build whose keystore Buildcage cannot inject into
(one sealed with a password other than the JDK default); a JVM already
in the base image otherwise trusts the injected CA without a passthrough.

### Regular expressions

Prefix a rule with `~` to use a regular expression. A host rule's pattern is matched against
`domain:port` as one expression, so the port is part of the pattern and can be a regex itself. It
cannot be left out: either engine refuses a `~` host rule with no `:` in it, since what the pattern
is matched against always carries the port.

| Rule                              | Effect                                                     |
| --------------------------------- | ---------------------------------------------------------- |
| `~^example\.com:443$`             | Matches `example.com` on port 443 only                     |
| `~^example\.com:\d+$`             | Matches `example.com` on any port                          |
| `~^.*\.example\.com:(443\|8443)$` | Matches any subdomain of `example.com` on port 443 or 8443 |
| `~^192\.168\.1\.\d+:80$`          | Matches a range of IP addresses (in `allowed_ip_rules`)    |

`^` and `$` are added where they are missing, so a pattern always covers the whole `domain:port`. An
IPv6 address is refused here as everywhere else in the rule syntax. A host name matches in any case,
as it does in a wildcard rule. The host part may not contain `'`, a backtick, `{$` or `{%`: no host
name does, and the resolver's configuration has no way to quote them.

The host part of a pattern also decides which names the build's resolver answers as allowed, and
the resolver matches it with RE2. Lookaround (`(?=`, `(?!`, `(?<=`, `(?<!`) and backreferences are
therefore refused there, in a URL rule's host half as well.

Setup checks a pattern with JavaScript's regular expressions, but the proxy runs it with PCRE2.
Syntax only JavaScript accepts, such as `\u0041` or `[\d-z]`, passes setup and then stops the proxy
from starting.

In `allowed_url_rules` a `~` expression covers the URL, and is split at the first `/` after `://`:
everything before that `/` is matched against the host, everything from it onward against the path.
The scheme before `://` must be written `https`, `http` or `https?`, the last covering both; any
other spelling is refused, since the scheme decides which listener the rule is enforced on.

```yaml
allowed_url_rules: |
  # host half: example\.com   path half: /pub/.*$
  GET ~^https://example\.com/pub/.*$

  # the host half's port pattern can be any regex
  GET ~^https://example\.com:(443|8443)/.*$
  GET ~^https://example\.com:\d+/.*$

  # either scheme, each on its own default port
  GET ~^https?://example\.com/pub/.*$
```

Leave the port out and the rule matches the scheme's default port only, 443 for `https` and 80 for
`http`; there is no implicit any-port, so write `example\.com:.*` to allow more.

A top-level `|` is not supported in either a host rule or a URL rule. The anchors would bind to one
branch each, and a URL rule's two halves are compiled separately, so a choice spanning them has no
meaning.
Keep the `|` inside a group, or write one rule per alternative:

```yaml
# not supported
allowed_url_rules: |
  GET ~^https://a\.example\.com/x$|^https://b\.example\.com/y$

# supported
allowed_url_rules: |
  GET ~^https://(a|b)\.example\.com/x$
  GET ~^https://a\.example\.com/x$
  GET ~^https://b\.example\.com/y$
```

A group cannot straddle the `/` the rule is split at either. A rule the split cannot handle is
refused with an error naming what to write instead.

## Report action inputs

`buildcage/docker/report` reads the builder's communication log, writes the Job Summary, and
optionally fails the job when blocked connections are found. Every input is optional.

| Input                             | Default     | Description                                                                                     |
| --------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `builder_name`                    | `buildcage` | Name of the builder container                                                                   |
| `fail_on_blocked`                 | `true`      | Fail the step if blocked connections are detected (restrict mode only; ignored in audit mode)   |
| `upload_traffic_artifact`         | `false`     | Upload the observed traffic as a JSON artifact named `buildcage-traffic`; both engines write it |
| `traffic_artifact_retention_days` | empty       | How long to keep that artifact, in days; empty uses the repository's own default                |

In restrict mode the step fails when blocked connections are detected, and the workflow fails with
it.
In audit mode, blocked connections (protocol errors, for instance) are reported but never fail the
step.

When every blocked connection matches a `known_blocked_rules` rule, the step no longer fails even
with `fail_on_blocked: true`, and a `::notice::` is emitted instead of `::error::`; any unmatched
blocked connection still fails the step. Matching is per request, so a row that counts several
requests to one host is Expected only when a rule accounts for every one of them: a URL rule that
names one endpoint leaves the host's other blocked requests to fail the step. Once
`known_blocked_rules` is set, the Blocked Hosts table gains an **Expected** column (✅) on the
matched rows.

Under `inspect` the matched rows are also folded into one row per rule, named after
the rule and counting the hosts behind it (`*.example.com:* (12 hosts)`), below the rows nothing
matched. A rule covering noisy traffic then costs the table one line however many hosts it names,
which matters most when the noise puts its payload in the name itself and every request brings a new
long hostname. The individual hosts stay in **Communication details**, so `universal`, whose report
has no such section, folds nothing.

A name the build looked up and never connected to gets a row of its own, with `DNS` as the rule kind
and no port (folded like any other row when a `known_blocked_rules` rule matches it). Under
`inspect` that is the only trace of a name the build reached for and did not use, which is how a
rule wider than the build needs shows up. A name that was connected to has no such row: the request
is already there.

## Blocked service names

A row whose reason is `dns-service-not-allowed` is a service-discovery name,
`_mongodb._tcp.cluster0.x.mongodb.net` and the like. **Neither way of clearing it makes the record
resolve.** Buildcage's resolver serves no discovery record at all (see
[Service discovery](../README.md#service-discovery)), so the answer stays empty whatever you write;
what changes is only whether the row fails the step.

1. **Allow the host the name belongs to** (`cluster0.x.mongodb.net`). The lookup is then reported as
   `discovery` instead and leaves the table, and the build may connect to that host. This is the
   useful one whenever the build was trying to reach the service.
2. **List the service name in `known_blocked_rules`** (`_mongodb._tcp.cluster0.x.mongodb.net:*`).
   The row is marked Expected, folded under that rule, and stops failing the step. Nothing else
   changes, and the host stays unreachable.

Naming the service name in an `allowed_*` rule also clears the row, but it is the misleading option:
it reads as permission to reach something that nothing can connect to, and the record still does not
resolve.

## Requests that never arrived whole

Under `inspect`, a connection can end before a whole request has arrived. What the report does with
one turns on who ended it: a client that walks away decided nothing, while bytes Buildcage refused to
read as a request are a refusal like any other.

Whichever it was, the host is the name from the handshake's SNI. Without one, the address the
connection was sent to stands in, and the row's rule type reads `IP`: an address the build wrote out
itself is one only `allowed_ip_rules` could have passed through. The exception is Buildcage's own
address, where every name-based connection lands because the resolver answers each name with it.
That address names nothing, so the host reads `(unknown)`. The address is recorded either way, in
the `destination` field of the [traffic artifact](#traffic-artifact).

A row carries no method or URL where no request line ever parsed. `missing-host-header` is the
exception: that one did parse, so it keeps the method and the path it asked for. Its URL is built
around the same host as the row, as HTTP itself does for a request with no `Host` (RFC 9112 §3.3),
with the port where it is not the scheme's default.

### The ones nobody decided

A connection the client ended before it sent a whole request reached no rule and no origin, so it is
in neither host table. **Communication details** shows it with ⚠️ and how it ended:

```
⚠️ 00:09.123: HTTPS untrusted-ca.example.com:443 -> client-aborted
⚠️ 00:11.407: HTTPS untrusted-ca.example.com:443 -> client-timeout
```

| Reason           | What happened                                                                   |
| ---------------- | ------------------------------------------------------------------------------- |
| `client-aborted` | the client finished the TLS handshake and then closed without sending a request |
| `client-timeout` | it held the connection open instead, until the timeout expired                  |

The commonest cause is a container with no `ca-certificates`: the client cannot verify the
certificate the `inspect` engine signs with, so every HTTPS request to that host ends at the
handshake before a request arrives. The build's own output says so first, as a certificate
verification error; installing `ca-certificates`, or otherwise letting the client trust the CA, is
what lets the requests through. An `allowed_https_rules` entry changes nothing, the host having
resolved and been dialled already.

A close like this is shown only where its host completed no other connection. Where the same host
also completed one, the close is a keepalive pool cleaning up after its work rather than a failure,
so it is left out of Communication details as noise. The raw [traffic artifact](#traffic-artifact)
keeps every one either way. Neither kind fails the step, not even with `fail_on_blocked: true`: no
rule refused it, so `known_blocked_rules` has nothing to match, and nothing reached an origin. A
`::warning::` annotation gives the count of those shown.

### The ones Buildcage refused

These are refusals: they are in **🚫 Blocked Hosts**, counted in the blocked-connections annotation,
and they fail the step under `fail_on_blocked: true` like any other refused connection.

```
🚫 00:14.002: GET http://10.0.0.9/pkg.tgz?token=*** -> missing-host-header
🚫 00:15.880: HTTP (unknown):5432 -> bad-request
🚫 00:16.204: TCP 10.0.0.9:5432 -> bad-request
```

| Reason                | What happened                                                          |
| --------------------- | ---------------------------------------------------------------------- |
| `bad-request`         | the build sent bytes that could not be read as an HTTP request at all  |
| `missing-host-header` | a request parsed, and carried no `Host` for a rule to match or resolve |

`bad-request` is most often a protocol that is not HTTP at all, a database or `git://` connection to
a port no `allowed_ip_rules` or `allowed_tls_rules` entry covers: anything that is not a TLS
handshake is handed to the plain-HTTP stage, which reads it as a request and refuses it. Both are
refused in `audit` mode too, as the same check is under `universal`, since a request naming no host
has nothing to connect to whatever the rules say.

What clears one is a rule, though not a host rule. For traffic that is not HTTP, add the port to
`allowed_ip_rules` or the name to `allowed_tls_rules`, and the connection is passed through
undecrypted instead of being read as a request. `known_blocked_rules` can mark a row whose host is a
name from the SNI or an address; a row reading `(unknown)` names nothing a rule can be written
against, so the passthrough rule is the only way to clear that one.

## Connections that failed

A request no rule refused can still come to nothing: the origin answers nothing usable, breaks off
mid-transfer, or its name resolves nowhere. The report tables those apart from what the rules did
refuse, under **⚠️ Failed Connections**. Under `inspect`, **Communication details** shows each with
⚠️ too:

```
⚠️ 00:12.004: GET https://registry.npmjs.org/big.tgz -> origin-aborted
⚠️ 00:13.771: GET https://mirror.example.com/index -> origin-no-response
```

| Reason               | What happened                                                         |
| -------------------- | --------------------------------------------------------------------- |
| `origin-no-response` | the connection was made, and no usable response headers came back     |
| `origin-aborted`     | the response started and the transfer was cut short                   |
| `dns-failed`         | the name resolved nowhere upstream, no rule having refused it         |
| `origin-unreachable` | a connection carrying no certificate of Buildcage's could not be made |

What the first two have in common is a connection that completed, which is where the origin's
certificate was checked: whatever went wrong afterwards went wrong with an origin Buildcage had
authenticated. `dns-failed` never reached a connection, and neither a plaintext request nor a
passthrough has a certificate of Buildcage's behind it: the first is carried as it was sent, the
second is relayed for the build to judge rather than decrypted.

`universal` writes its decision before the connection is made and never sees what became of it, so
`dns-failed` is the only one of the four it can report. `audit` reports them the same way, though
nothing there was allowed by a rule either: what the table says is that the rules are not what
stopped these.

**A connection Buildcage never completed is not here.** It is a refusal, it is in Blocked Hosts, and
it does fail the step:

| Reason                  | What happened                                                            |
| ----------------------- | ------------------------------------------------------------------------ |
| `origin-untrusted`      | the origin's certificate was presented and Buildcage would not accept it |
| `origin-connect-failed` | the connection never completed, so no certificate was ever accepted      |

`origin-untrusted` is the plain case: a forged certificate, an expired one, or an origin speaking no
TLS at all. `origin-connect-failed` is the one that looks like an outage and cannot be shown to be
one. HAProxy retries a failed connection, and the TLS error it reports belongs to the last attempt
alone, so an impostor whose certificate is refused on one attempt leaves no trace once a later
attempt fails at TCP. The report does not claim to tell that from an origin that is simply down: a
connection it never completed is one whose origin it never authenticated. See
[Attempts to get around it](./security.md#attempts-to-get-around-it).

A host that is flaky rather than hostile is cleared the way any expected refusal is, by listing it
in `known_blocked_rules`.

None of the four fails the step, not even with `fail_on_blocked: true`, and a `::notice::` gives the
count. No rule refused them, so no rule can clear them either: `known_blocked_rules` has nothing to
match, and an `allowed_*` entry changes nothing. What clears one is the origin coming back, or the
build reaching for something that is up.

A blocked `DNS` row for the same name means something else entirely: that one is Buildcage's own
resolver saying no rule allows the name, and it does fail the step.

## Traffic artifact

`upload_traffic_artifact: true` uploads the report's timeline as a `traffic.json` inside an artifact
named `buildcage-traffic` (`buildcage-traffic-<builder_name>` when the builder is not the default
one). It carries every name lookup, including the ones the summary folds into the request that
followed them, and service-discovery lookups with the record type that was asked for. `universal`
never sees a method or a URL, so this input only does anything under `inspect`.

| Field         | Always | Notes                                                                                    |
| ------------- | ------ | ---------------------------------------------------------------------------------------- |
| `time`        | yes    | ISO 8601 UTC                                                                             |
| `elapsed`     |        | since the proxy started, fixed `HH:MM:SS.mmm`                                            |
| `action`      | yes    | `allow`, `block`, `audit` when nothing was enforced, `discovery`, `incomplete`, `failed` |
| `protocol`    | yes    | `https`, `http`, `tls`, `tcp`, `dns`                                                     |
| `host`        | yes    | the name asked for, the address when there was none, or `(unknown)`                      |
| `port`        |        | absent for `dns`, which connects to nothing                                              |
| `queryType`   |        | the record asked for; `discovery` rows and refused service names                         |
| `method`      |        | `http` and `https`, and `tcp` for a request with no `Host` sent to an address            |
| `url`         |        | as `method`; verbatim, unlike the summary's                                              |
| `status`      |        | only when something answered                                                             |
| `bytes`       |        | absent for a refusal and for `dns`                                                       |
| `reason`      |        | only when `action` is `block`, `incomplete` or `failed`                                  |
| `destination` |        | the address it actually resolved to; absent for `dns`                                    |

A field is absent because it does not apply, never because it was zero: a refusal has no status
because nothing answered, and a passthrough none because nothing was decrypted. Filter on `action`.
The artifact is uploaded even when the build fails, since a failing run is when it is most wanted.

```json
[
  {
    "time": "2026-09-02T04:11:07.512Z",
    "elapsed": "00:00:00.512",
    "action": "allow",
    "protocol": "https",
    "host": "registry.npmjs.org",
    "port": 443,
    "method": "GET",
    "url": "https://registry.npmjs.org/express",
    "status": 200,
    "bytes": 102300,
    "destination": "104.16.0.35"
  },
  {
    "time": "2026-09-02T04:11:08.048Z",
    "elapsed": "00:00:01.048",
    "action": "block",
    "protocol": "dns",
    "host": "secret-data.attacker.example",
    "reason": "dns-not-allowed"
  },
  {
    "time": "2026-09-02T04:11:08.390Z",
    "elapsed": "00:00:01.390",
    "action": "block",
    "protocol": "https",
    "host": "registry.npmjs.org",
    "port": 443,
    "method": "POST",
    "url": "https://registry.npmjs.org/express/-rev/1-abc",
    "reason": "not-allowed"
  }
]
```

Query strings are kept verbatim here, since that is also where an exfiltration payload would go. The
Job Summary is the exception: it replaces credential query parameters, see
[Credentials in a URL](./security.md#credentials-in-a-url).

## CA trust variables

`proxy_engine: inspect` terminates TLS and re-signs it with a CA generated for the build, so the
build has to trust that CA. The CA is valid for two days from when the proxy starts and carries a
random `serialNumber` in its subject, so no two runs share one. The wrapper around runc sets these
variables as each `RUN` step starts. If a variable is already set, by the base image or by the
Dockerfile, Buildcage appends the CA to whatever file it already points at rather than redirecting
the variable elsewhere. Otherwise, where it points depends on whether the step has a system CA
store:

| Variable              | Read by                                                                   | If unset, with a store                           | If unset, with no store     |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------- |
| `NODE_EXTRA_CA_CERTS` | Node.js                                                                   | Additive: pointed at a file holding only this CA | same, store or no store     |
| `DENO_CERT`           | Deno                                                                      | Additive: pointed at a file holding only this CA | same, store or no store     |
| `CURL_CA_BUNDLE`      | curl                                                                      | Left unset; curl already reads the system store  | proxy-CA-only fallback file |
| `REQUESTS_CA_BUNDLE`  | Python `requests`                                                         | Replaces the bundle: pointed at the system store | proxy-CA-only fallback file |
| `PIP_CERT`            | pip                                                                       | Replaces the bundle: pointed at the system store | proxy-CA-only fallback file |
| `SSL_CERT_FILE`       | OpenSSL, and anything reading it (Go, Ruby, Rust's `rustls-native-certs`) | Replaces the bundle: pointed at the system store | proxy-CA-only fallback file |

Chromium reads none of these, only its compiled-in root store and the NSS database in `$HOME`.
Every Chromium version reads `~/.pki/nssdb` when it exists, so that path is covered for the step
with a database holding only this CA, owned by the step's user. `HOME` comes from the step's
environment, or from the image's `/etc/passwd` when that is empty, as runc does.

Neither the CA nor these variables are left in the image layers, and injection happens at exec time,
so it cannot affect a cache key. [Limitations](../README.md#limitations) covers what this can't
reach, and what a step can't do to its CA store while it is mounted.

### CA residue

Two things fail the build by default, naming the file and pointing at `fail_on_ca_residue`:

- a copy of the CA the wrapper finds in the step's layer but cannot take out, such as one inside a
  binary, an uncompressed archive or a re-wrapped PEM (see [Limitations](../README.md#limitations))
- a write to the NSS database bound over Chromium's for the step

With `fail_on_ca_residue: false` both only warn: the copy stays in the image, and the write is
discarded. A layer the wrapper could not read back or restore fails the build either way.

The CA is valid for two days and unique to the run, so a copy left in an image trusts only a proxy
that no longer exists. It still shows the image was built behind Buildcage.
