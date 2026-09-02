# Buildcage for Docker

![Buildcage](./assets/banner.png)

[![GitHub](https://img.shields.io/badge/GitHub-buildcage%2Fdocker-blue?logo=github)](https://github.com/buildcage/docker)
[![Marketplace](https://img.shields.io/badge/marketplace-Buildcage%20for%20Docker-blue?logo=github)](https://github.com/marketplace/actions/buildcage-for-docker)
![version](https://img.shields.io/github/v/release/buildcage/docker)
![build](https://img.shields.io/github/actions/workflow/status/buildcage/docker/docker-publish.yml)
![test](https://img.shields.io/github/actions/workflow/status/buildcage/docker/test-e2e.yml?label=test)
![license](https://img.shields.io/github/license/buildcage/docker)

GitHub Action that restricts outbound network access during `docker build` to an allowlist of
domains. Every `RUN` step is isolated, with no Dockerfile changes, no proxy configuration, and no
certificates to install — it works with any language or package manager.

See [buildcage.github.io](https://buildcage.github.io/) for what it does and why. To isolate a
workflow `run:` step rather than a Docker build, use
[Buildcage for `run:` Steps](https://github.com/buildcage/isolated-run).

## Contents

- [Usage](#usage)
- [Inputs](#inputs)
- [Operation modes](#operation-modes)
- [Rule syntax](#rule-syntax)
- [Proxy engines](#proxy-engines)
- [Report action](#report-action)
- [Scope](#scope)
- [Hardening](#hardening)
- [Documentation](#documentation)

## Usage

Start the builder, point Docker Buildx at it as a remote driver, then build as usual. Run once in
[`audit`](#operation-modes) mode to discover what your build reaches, then switch to `restrict`.

### 1. Discover what your build reaches

```yaml
- name: Start Buildcage in audit mode
  uses: buildcage/docker@806c35dcae3da9f5f5914e7c6086fde53f9cb24a # v3.1.5
  with:
    proxy_mode: audit # Log every destination, block nothing

- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0
  with:
    driver: remote
    endpoint: docker-container://buildcage

- name: Build
  uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7.3.0
  with:
    context: .

- name: Show Buildcage report
  if: always()
  uses: buildcage/docker/report@806c35dcae3da9f5f5914e7c6086fde53f9cb24a # v3.1.5
```

The [report action](#report-action) writes every destination the build contacted to the Job Summary:

<img src="assets/report-audit-mode.png" alt="Outbound Traffic Report - audit mode" width="556">

Its **Switch to restrict mode** section contains the allowlist already filled in from those hosts.

### 2. Enforce the allowlist

```yaml
- name: Start Buildcage in restrict mode
  uses: buildcage/docker@806c35dcae3da9f5f5914e7c6086fde53f9cb24a # v3.1.5
  with:
    proxy_mode: restrict # Block every destination except the ones you allow
    allowed_https_rules: |
      registry.npmjs.org:443
      fonts.googleapis.com:443
```

Anything outside the allowlist is now blocked, and the report step fails the job with the host named:

<img src="assets/report-restrict-mode.png" alt="Outbound Traffic Report - restrict mode" width="556">

The rest of the workflow is unchanged. Complete workflows:
[audit](.github/workflows/example-audit.yml) ·
[restrict](.github/workflows/example-restrict.yml).

### Notes

- The `endpoint` must match the `builder_name` input (default: `buildcage`).
- Multi-stage Dockerfiles work unchanged — Buildcage doesn't fork or patch BuildKit, it only wires
  up how build traffic is routed.
- Private registries work like any other host: add the domain to `allowed_https_rules`.
- HTTP and HTTPS have separate inputs — some package managers still download over plain HTTP
  (e.g. certain Debian mirrors), and those hosts go in `allowed_http_rules`:

  ```yaml
  allowed_http_rules: deb.debian.org:80
  allowed_https_rules: registry.npmjs.org:443
  ```

- One registry often needs several domains. PyPI, for example, uses both `pypi.org` and
  `files.pythonhosted.org` — the audit report lists every one of them, so start from that.

## Inputs

| Input                 | Required | Default     | Description                                                                                                                                                                               |
| --------------------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builder_name`        | No       | `buildcage` | Name of the builder container                                                                                                                                                             |
| `proxy_mode`          | No       | `restrict`  | Operation mode (`audit` / `restrict`, see [Operation modes](#operation-modes))                                                                                                            |
| `proxy_engine`        | No       | `universal` | Network enforcement engine (`universal`, the experimental `inspect`, or the deprecated `explicit` — see [Proxy engines](#proxy-engines))                                                  |
| `allowed_https_rules` | No       | empty       | HTTPS allow rules (wildcard or regex, port required)                                                                                                                                      |
| `allowed_http_rules`  | No       | empty       | HTTP allow rules (wildcard or regex, port required)                                                                                                                                       |
| `allowed_ip_rules`    | No       | empty       | IP address allow rules (wildcard or regex, port required)                                                                                                                                 |
| `known_blocked_rules` | No       | empty       | Domains expected to be blocked intentionally; blocked connections matching these don't fail the `report` step even when `fail_on_blocked` is `true` — see [Report action](#report-action) |

## Operation modes

<table>
<thead>
<tr><th><code>proxy_mode</code></th><th>When to use</th><th>Behavior</th></tr>
</thead>
<tbody>
<tr>
<td><code>audit</code></td>
<td>First-time setup, adding new dependencies, or investigating issues</td>
<td><ul><li>Allows all connections the active engine can observe — each engine still rejects what it can't classify, on its own terms (see <a href="#proxy-engines">Proxy engines</a>)</li><li>Logs every domain accessed during the build</li></ul></td>
</tr>
<tr>
<td><code>restrict</code></td>
<td>Production builds, CI/CD pipelines, security-critical environments</td>
<td><ul><li>Allows connections only to domains in <code>allowed_http_rules</code> / <code>allowed_https_rules</code></li><li>Blocks all other connections</li><li>Logs allowed and blocked attempts</li></ul></td>
</tr>
</tbody>
</table>

If you forget a domain that the build needs, `restrict` blocks it and the report step fails with the
host named, so run in `audit` first to collect the full list.

## Rule syntax

`allowed_https_rules`, `allowed_http_rules`, `allowed_ip_rules`, and `known_blocked_rules` all share
the syntax below. Rules are separated by whitespace — spaces, tabs, or newlines.

```yaml
# These are equivalent:
allowed_https_rules: "a.com:443 b.com:443"
allowed_https_rules: |
  a.com:443
  b.com:443
```

### Wildcards

| Pattern | Matches                                                     | Example                                                                  |
| ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `*`     | One or more characters **excluding** dots (single label)    | `*.example.com` matches `sub.example.com` but not `deep.sub.example.com` |
| `**`    | One or more characters **including** dots (multiple labels) | `**.example.com` matches `sub.example.com` and `deep.sub.example.com`    |
| `?`     | A single character excluding dots                           | `exampl?.com` matches `example.com`, `examplx.com`                       |

### Ports

A port is required on every rule.

| Rule                 | Matches                                                       |
| -------------------- | ------------------------------------------------------------- |
| `example.com:443`    | `example.com` on port 443 only                                |
| `*.example.com:8443` | Any single-level subdomain of `example.com` on port 8443 only |
| `example.com:*`      | `example.com` on any port                                     |

### IP addresses

Direct IP access bypasses DNS resolution, so it is handled separately: put those rules in
`allowed_ip_rules`. CIDR notation is not supported.

| Rule              | Matches                        |
| ----------------- | ------------------------------ |
| `192.168.1.1:443` | `192.168.1.1` on port 443 only |
| `10.0.0.1:8080`   | `10.0.0.1` on port 8080 only   |

### Regular expressions

Prefix a rule with `~` to use a regular expression, matched against `domain:port`. Include a port
pattern if you want to restrict by port — a range of addresses can be matched this way.

| Rule                              | Effect                                                     |
| --------------------------------- | ---------------------------------------------------------- |
| `~^example\.com:443$`             | Matches `example.com` on port 443 only                     |
| `~^example\.com:\d+$`             | Matches `example.com` on any port                          |
| `~^.*\.example\.com:(443\|8443)$` | Matches any subdomain of `example.com` on port 443 or 8443 |
| `~^192\.168\.1\.\d+:80$`          | Matches a range of IP addresses (in `allowed_ip_rules`)    |

### Together

```yaml
with:
  proxy_mode: restrict

  allowed_https_rules: |
    registry.npmjs.org:443
    *.githubusercontent.com:443
    ~^.*\.example\.com:443$

  allowed_http_rules: |
    deb.debian.org:80

  allowed_ip_rules: |
    192.168.1.1:443
```

## Proxy engines

`proxy_engine` selects how Buildcage intercepts and enforces traffic. The default, `universal`,
intercepts at the network level and needs no proxy configuration or CA trust inside the build — it
works with any tool whether or not the tool is proxy-aware, which is why it is the default, and why
it is the one to fall back to for a tool `inspect` can't be used with (certificate pinning, a JVM's
own truststore, etc.). `proxy_engine: transparent` is accepted as an alias for `universal` —
`transparent` was this engine's name before `inspect` existed, kept working permanently for
backward compatibility.

`proxy_engine: inspect` is an **experimental** alternative that terminates TLS inside the cage and
re-signs it with a CA the build is made to trust. That is what lets a rule name a method and a URL
path rather than only a host, so fetching a package can be allowed while publishing one is refused.
Every request is recorded with its full URL, refused ones included. In exchange, a tool that pins a
certificate or ships its own trust store will not work under it. See
[Inspect Proxy Engine](./docs/inspect-engine.md) for the rule syntax, the report it produces, and
its limitations.

`proxy_engine: explicit` is **deprecated**. It still works, so existing workflows keep running, but
it receives no further development. See [Explicit Proxy Engine](./docs/explicit-engine.md).

## Report action

`buildcage/docker/report` reads the builder's communication log, writes the Job Summary, and
optionally fails the job when blocked connections are found.

```yaml
- name: Show Buildcage report
  if: always()
  uses: buildcage/docker/report@806c35dcae3da9f5f5914e7c6086fde53f9cb24a # v3.1.5
```

| Input             | Required | Default     | Description                                                                                   |
| ----------------- | -------- | ----------- | --------------------------------------------------------------------------------------------- |
| `builder_name`    | No       | `buildcage` | Name of the builder container                                                                 |
| `fail_on_blocked` | No       | `true`      | Fail the step if blocked connections are detected (restrict mode only; ignored in audit mode) |

In restrict mode the step fails when blocked connections are detected, failing the workflow with it.
In audit mode, blocked connections (protocol errors, for instance) are reported but never fail the
step.

If some blocked connections are expected — a known-noisy dependency, or a domain you are deliberately
keeping off the allowlist to confirm it stays blocked — list them in the setup action's
`known_blocked_rules` input. When every blocked connection matches, the step no longer fails even
with `fail_on_blocked: true`, and a `::notice::` is emitted instead of `::error::`; any unmatched
blocked connection still fails the step. Once `known_blocked_rules` is set, the Blocked Hosts table
gains an **Expected** column (✅) marking the matched rows.

## Scope

Buildcage controls _where_ your build can connect, not _what code_ it runs. A malicious package
delivered through an allowed domain still runs. Use it as one layer in a defense-in-depth strategy —
a last line of defense so that if something slips through your other measures, at least it can't
call home. See [Security Details](./docs/security.md) for the full threat model.

## Hardening

An allowlist works on domain names, so it cannot stop anything leaving through a service you had to
allow anyway. That is a structural limit. What it does stop is traffic to a destination that is not
on the list, and infrastructure an attacker set up is normally not on it, because the build has no
reason to reach it. That is also the hardest kind of leak to find afterwards.

Buildcage runs against your Dockerfile as it is, and an allowlist generated from an audit run
already blocks every destination the audit did not record. Whether to go further depends on what the
build has access to. [Hardening](./docs/security.md#hardening) is what to look at when it holds
credentials, personal data, or source you do not publish.

## Documentation

| Doc                                                | What's in it                                             |
| -------------------------------------------------- | -------------------------------------------------------- |
| [Inspect Proxy Engine](./docs/inspect-engine.md)   | The experimental `proxy_engine: inspect` in full         |
| [Explicit Proxy Engine](./docs/explicit-engine.md) | The deprecated `proxy_engine: explicit` in full          |
| [Security Details](./docs/security.md)             | Architecture, attack resistance, and known limitations   |
| [Development Guide](./docs/development.md)         | Local usage, testing, logs, and implementation internals |

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests at [github.com/buildcage/docker](https://github.com/buildcage/docker).

## Show Your Support

Knowing that this project is useful to others gives me the motivation to keep working on it.
If you find Buildcage helpful, please consider giving it a star ⭐ on GitHub!

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. The authors and contributors are not liable for any damages, losses, or security incidents arising from the use of this software. Use at your own risk.

## License

The Buildcage source code is licensed under the MIT License. See [LICENSE](./LICENSE) file for details.

The Docker image includes third-party components under their own licenses (GPL, Apache 2.0, ISC, etc.). See [THIRD_PARTY_LICENSES](./THIRD_PARTY_LICENSES) for the full list.
