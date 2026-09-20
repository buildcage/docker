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
- [Connections that sent no request](#connections-that-sent-no-request)
- [Traffic artifact](#traffic-artifact)
- [CA trust variables](#ca-trust-variables)

## Setup action inputs

`buildcage/docker` starts the builder. Every input is optional.

| Input          | Default     | Description                                                           |
| -------------- | ----------- | --------------------------------------------------------------------- |
| `builder_name` | `buildcage` | Name of the builder container. The Buildx `endpoint` has to match it. |
| `proxy_mode`   | `restrict`  | `audit` or `restrict`. See [Operation modes](#operation-modes).       |
| `proxy_engine` | `universal` | `inspect` or `universal`. See [Engines](../README.md#engines).        |

```yaml
- uses: buildcage/docker@d6f130e3476121607affc037e1c56fafb48ea897 # v3.2.1
  with:
    builder_name: buildcage
    proxy_mode: restrict
    proxy_engine: inspect
```

`transparent` is accepted as an alias for `universal`, the name it had before `inspect` existed.
`explicit` selects BuildKit's own native `--proxy-network`, which is deprecated; see
[Explicit Proxy Engine](./explicit-engine.md).

On a self-hosted runner that runs several jobs at once, give each job its own `builder_name`. The
name is what identifies the builder's containers, so two concurrent jobs sharing it tear down each
other's builder. The report action needs the same name. A GitHub-hosted runner gets a VM per job, so
the default is fine there.

### Rule inputs

All of these are empty by default, and all of them are additive: a connection is allowed when any
rule in any input matches. Which ones apply depends on the engine.

| Input                 | `inspect` | `universal` | What one rule matches                                                                 |
| --------------------- | :-------: | :---------: | ------------------------------------------------------------------------------------- |
| `allowed_url_rules`   |    ✅     |      -      | A method and a URL: `GET https://registry.npmjs.org/**`                               |
| `allowed_https_rules` |    ✅     |     ✅      | A host and port reached over HTTPS: `registry.npmjs.org:443`                          |
| `allowed_http_rules`  |    ✅     |     ✅      | A host and port reached over plain HTTP: `deb.debian.org:80`                          |
| `allowed_ip_rules`    |    ✅     |     ✅      | An address and port, for connections made without DNS: `192.168.1.1:443`              |
| `allowed_tls_rules`   |    ✅     |      -      | A TLS destination to pass through undecrypted, judged on SNI: `db.example.com:5432`   |
| `known_blocked_rules` |    ✅     |     ✅      | A host expected to be blocked, so it doesn't fail the [report](#report-action-inputs) |

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
newline-separated. The method is required, so a rule always states what it permits. A blank line, or
a line starting with `#`, is ignored, which helps once the list gets long.

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
refused: it never travels with a request, so a rule carrying one could only match nothing.

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

These four share one syntax. Rules are separated by whitespace, so one per line reads best. A host
rule is equivalent to a URL rule with any method and any path.

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

#### Ports

A port is required on every rule.

| Rule                 | Matches                                                       |
| -------------------- | ------------------------------------------------------------- |
| `example.com:443`    | `example.com` on port 443 only                                |
| `*.example.com:8443` | Any single-level subdomain of `example.com` on port 8443 only |
| `example.com:*`      | `example.com` on any port                                     |

`known_blocked_rules` is the exception: a rule there that names no port is read as `:*`. It is
matched against rows of the report rather than against connections, and a row for a name the
resolver refused has no port at all, nothing having been connected to. `telemetry.example.com` and
`telemetry.example.com:*` are the same rule.

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

Either way the connection is tunnelled without inspection: once an `ip:port` pair is allowed, any
TCP-based protocol can use that path. Prefer a domain rule where the destination has a stable name.

### TLS passthrough: `allowed_tls_rules`

For TLS traffic that isn't HTTPS, and for HTTPS that must not be decrypted. The SNI and port are
checked and the connection passes through undecrypted, so the build validates the origin's own
certificate:

```yaml
allowed_tls_rules: |
  db.example.com:5432
  repo.maven.apache.org:443
```

A host rule input is split on whitespace and has no comment syntax, so `#` cannot be used inside one
the way [`allowed_url_rules`](#url-rules-allowed_url_rules) allows. The second rule above is the
shape to use for a JVM build, which won't trust the injected CA.

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
IPv6 address is refused here as everywhere else in the rule syntax.

In `allowed_url_rules` a `~` expression covers the URL, and is split at the first `/` after `://`:
everything before that `/` is matched against the host, everything from it onward against the path.

```yaml
allowed_url_rules: |
  # host half: example\.com   path half: /pub/.*$
  GET ~^https://example\.com/pub/.*$

  # the host half's port pattern can be any regex
  GET ~^https://example\.com:(443|8443)/.*$
  GET ~^https://example\.com:\d+/.*$
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

| Input                             | Default     | Description                                                                                   |
| --------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `builder_name`                    | `buildcage` | Name of the builder container                                                                 |
| `fail_on_blocked`                 | `true`      | Fail the step if blocked connections are detected (restrict mode only; ignored in audit mode) |
| `upload_traffic_artifact`         | `false`     | Upload the observed traffic as a JSON artifact named `buildcage-traffic`, `inspect` only      |
| `traffic_artifact_retention_days` | empty       | How long to keep that artifact, in days; empty uses the repository's own default              |

In restrict mode the step fails when blocked connections are detected, and the workflow fails with
it.
In audit mode, blocked connections (protocol errors, for instance) are reported but never fail the
step.

When every blocked connection matches a `known_blocked_rules` rule, the step no longer fails even
with `fail_on_blocked: true`, and a `::notice::` is emitted instead of `::error::`; any unmatched
blocked connection still fails the step. Once `known_blocked_rules` is set, the Blocked Hosts table
gains an **Expected** column (✅) on the matched rows.

Under `inspect` and `explicit` the matched rows are also folded into one row per rule, named after
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

## Connections that sent no request

Under `inspect`, a client can finish the TLS handshake and then close without sending a request. The
commonest cause is a container with no `ca-certificates` installed: the client cannot verify the
certificate Buildcage signs and gives up at that point. **Communication details** shows it as

```
⚠️ 00:09.123: HTTPS untrusted-ca.example.com:443 -> client-aborted
```

with `client-timeout` in place of `client-aborted` when the client held the connection open instead
of closing it. The host is the name from the handshake's SNI, and there is no method or URL because
none was ever sent.

Such a row is in neither host table and never fails the step: no rule refused it, and no rule can
clear it either. Nothing left the proxy, so allowing the host changes nothing about the row: fix the
client instead, by installing `ca-certificates` or whatever else kept it from trusting the CA. If
the host is one the build does need, its name usually also appears as a blocked `DNS` row, which is
the row to act on.

## Traffic artifact

`upload_traffic_artifact: true` uploads the report's timeline as a `traffic.json` inside an artifact
named `buildcage-traffic` (`buildcage-traffic-<builder_name>` when the builder is not the default
one). It carries every name lookup, including the ones the summary folds into the request that
followed them, and service-discovery lookups with the record type that was asked for. `universal`
never sees a method or a URL, so this input only does anything under `inspect`.

| Field         | Always | Notes                                                                       |
| ------------- | ------ | --------------------------------------------------------------------------- |
| `time`        | yes    | ISO 8601 UTC                                                                |
| `elapsed`     |        | since the proxy started, fixed `HH:MM:SS.mmm`                               |
| `action`      | yes    | `allow`, `block`, `audit` when nothing was enforced, `discovery`, `aborted` |
| `protocol`    | yes    | `https`, `http`, `tls`, `tcp`, `dns`                                        |
| `host`        | yes    | the name asked for, or the address when there was none                      |
| `port`        |        | absent for `dns`, which connects to nothing                                 |
| `queryType`   |        | the record asked for; `discovery` rows and refused service names            |
| `method`      |        | `http` and `https` only                                                     |
| `url`         |        | `http` and `https` only; verbatim, unlike the summary's                     |
| `status`      |        | only when something answered                                                |
| `bytes`       |        | absent for a refusal and for `dns`                                          |
| `reason`      |        | only when `action` is `block` or `aborted`                                  |
| `destination` |        | the address it actually resolved to; absent for `dns`                       |

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
build has to trust that CA. The wrapper around runc sets these variables as each `RUN` step starts.
If a variable is already set, by the base image or by the Dockerfile, Buildcage appends the CA to
whatever file it already points at rather than redirecting the variable elsewhere. Otherwise:

| Variable              | Read by                                                                                                                              | If unset                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `NODE_EXTRA_CA_CERTS` | Node.js                                                                                                                              | Additive: pointed at a file holding only this CA |
| `DENO_CERT`           | Deno                                                                                                                                 | Additive: pointed at a file holding only this CA |
| `CURL_CA_BUNDLE`      | curl                                                                                                                                 | Replaces the bundle: pointed at the system store |
| `REQUESTS_CA_BUNDLE`  | Python `requests`                                                                                                                    | Replaces the bundle: pointed at the system store |
| `PIP_CERT`            | pip                                                                                                                                  | Replaces the bundle: pointed at the system store |
| `SSL_CERT_FILE`       | OpenSSL, and anything linked against it (Go, Ruby, Rust's `rustls-native-certs`). Not GnuTLS, so Debian's wget and git never read it | Replaces the bundle: pointed at the system store |

### Steps with no CA store of their own

An image that ships no CA store (`scratch`, distroless, `ubi*-micro`, or `debian:*-slim` before
`ca-certificates` is installed) gets one written for it as the step starts, holding the build's CA,
at every path a distribution is known to use. Which path a given tool reads was decided when it was
compiled, and plenty of tools read one without consulting any of the variables above: Debian's wget
and git are GnuTLS-linked and do exactly that.

The CA also goes into each distribution's anchor directory
(`/usr/local/share/ca-certificates`, `/etc/pki/ca-trust/source/anchors`, `/etc/pki/trust/anchors`).
That is what keeps a step that installs `ca-certificates` partway through from losing the CA when
`update-ca-certificates` rebuilds the bundle, and on RHEL it is how GnuTLS sees the CA at all, since
p11-kit reads the directory rather than a bundle.

Neither the CA nor these variables are left in the image layers: the files, the directories written
for them, and anything a rebuilt bundle left pointing at them are removed when the step ends, and a
bundle the step turned into a real store of its own keeps everything except the CA. Injection
happens at exec time, so it cannot affect a cache key. [Limitations](../README.md#limitations)
covers what this can't reach, and what a step can't do to its CA store while it is mounted.
