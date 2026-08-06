# Reference

## Setup Action (`dash14/buildcage/setup`)

Starts the Buildcage builder container.

```yaml
- name: Start Buildcage builder
  uses: dash14/buildcage/setup@f40c162979dc9f095993ad26049b08b2eca77911 # v2.2.5
  with:
    proxy_mode: restrict
    allowed_https_rules: |
      registry.npmjs.org:443
      github.com:443
```

### Parameters

| Parameter             | Required | Default       | Description                                                                                                                                                                                                                                              |
| --------------------- | -------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `builder_name`        | No       | `buildcage`   | Name of the builder container                                                                                                                                                                                                                            |
| `proxy_mode`          | No       | `restrict`    | Operation mode (`audit` / `restrict`)                                                                                                                                                                                                                    |
| `proxy_engine`        | No       | `transparent` | Network enforcement engine (`transparent` / `explicit`, see [Proxy Engines](#proxy-engines))                                                                                                                                                             |
| `allowed_https_rules` | No       | empty         | HTTPS allow rules (wildcard or regex, port required)                                                                                                                                                                                                     |
| `allowed_http_rules`  | No       | empty         | HTTP allow rules (wildcard or regex, port required)                                                                                                                                                                                                      |
| `allowed_ip_rules`    | No       | empty         | IP address allow rules (wildcard or regex, port required)                                                                                                                                                                                                |
| `known_blocked_rules` | No       | empty         | Domains expected to be blocked intentionally (wildcard or regex, port required); blocked connections matching these don't fail the `report` step even when `fail_on_blocked` is `true` — see [Report Action](#report-action-dash14buildcagereport) below |

### Rule Syntax

| Pattern               | Example                  | Matches                                                    |
| --------------------- | ------------------------ | ---------------------------------------------------------- |
| Exact domain          | `example.com:443`        | `example.com` on port 443 only                             |
| Single-level wildcard | `*.example.com:443`      | `sub.example.com` on port 443 (not `deep.sub.example.com`) |
| Multi-level wildcard  | `**.example.com:443`     | `sub.example.com` and `deep.sub.example.com` on port 443   |
| Single-char wildcard  | `exampl?.com:443`        | `example.com`, `examplx.com` on port 443                   |
| Wildcard port         | `example.com:*`          | `example.com` on any port                                  |
| Regex                 | `~^custom\.pattern:\d+$` | Matched against `domain:port`                              |

IP address rules (e.g., `192.168.1.1:443`) use the same syntax but go in `allowed_ip_rules`.

For detailed syntax, see [Rule Syntax](./rules.md).

### Connecting Buildx

Pass the container name to [`docker/setup-buildx-action`](https://github.com/docker/setup-buildx-action) to use Buildcage as a remote builder. The `endpoint` must match the `builder_name` parameter (default: `buildcage`):

```yaml
- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0
  with:
    driver: remote
    endpoint: docker-container://buildcage
```

### Operation Modes

Set the `proxy_mode` parameter to control how Buildcage handles outbound connections:

<table>
<thead>
<tr><th><code>proxy_mode</code></th><th>When to use</th><th>Behavior</th></tr>
</thead>
<tbody>
<tr>
<td><code>audit</code></td>
<td>First-time setup, adding new dependencies, or investigating issues</td>
<td><ul><li>Allows all connections the active engine can observe — each engine still rejects what it can't classify, on its own terms (see Proxy Engines below)</li><li>Logs every domain accessed during the build</li></ul></td>
</tr>
<tr>
<td><code>restrict</code></td>
<td>Production builds, CI/CD pipelines, security-critical environments</td>
<td><ul><li>Allows connections only to domains in <code>allowed_http_rules</code> / <code>allowed_https_rules</code></li><li>Blocks all other connections</li><li>Logs allowed and blocked attempts</li></ul></td>
</tr>
</tbody>
</table>

See the [audit mode](../.github/workflows/example-audit.yml) and
[restrict mode](../.github/workflows/example-restrict.yml) example workflows for each in full.

### Proxy Engines

`proxy_engine` selects how Buildcage intercepts and enforces traffic. Two engines are available:

- **`transparent`** (default): a transparent proxy — traffic is intercepted at the network level, with no proxy configuration or CA trust needed inside the build
- **`explicit`**: BuildKit's native `--proxy-network` — injects `HTTP_PROXY`/`HTTPS_PROXY` and a CA certificate, then MITMs the traffic to inspect requests directly

It's independent of `proxy_mode` (audit/restrict): either engine works with either mode, and both
use identical `allowed_https_rules` / `allowed_http_rules` / `allowed_ip_rules` syntax.

|                                                                    | `transparent` (default)                                                     | `explicit`                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Isolation mechanism                                                | CNI network + DNS redirection                                               | BuildKit native `--proxy-network` (point-to-point network namespace)                                                                                                                                                                                                                                                                       |
| TLS handling                                                       | Not terminated — SNI (HTTPS) / Host header (HTTP) inspected only            | Terminated (MITM) via an injected CA — full host **and path** visible                                                                                                                                                                                                                                                                      |
| Dockerfile / tool changes                                          | None required                                                               | None for tools that already respect `HTTP_PROXY`/`HTTPS_PROXY` and trust the system CA store (most OpenSSL-based tools); a tool that bundles its own CA store (e.g. npm) needs an env var or flag pointing it at the system CA store — see [CA Trust for Tools with Their Own CA Store](#ca-trust-for-tools-with-their-own-ca-store) below |
| Enforcement granularity                                            | Domain (and port)                                                           | Domain (and port) — same as `transparent`; the decrypted path is visible for logging but isn't matched by `allowed_*_rules`                                                                                                                                                                                                                |
| `allowed_ip_rules` enforcement                                     | Raw TCP passthrough — no protocol inspection once `ip:port` matches         | Same as domain rules — matched and MITM'd via the BuildKit source policy, not a special-cased passthrough                                                                                                                                                                                                                                  |
| Non-cooperative tools (ignore proxy env vars, or open raw sockets) | Still observed, blocked, and logged — network-level enforcement, no opt-out | Blocked with "network unreachable" — invisible, no trace anywhere in the report                                                                                                                                                                                                                                                            |
| Report detail                                                      | Allowed / blocked hosts                                                     | Allowed / blocked hosts (with full path), plus a per-step "Communication details" breakdown                                                                                                                                                                                                                                                |
| BuildKit provenance / SLSA integration                             | Not integrated                                                              | Integrated into BuildKit's own build output and SLSA provenance                                                                                                                                                                                                                                                                            |
| Best for                                                           | Default choice — works with any tool regardless of proxy-awareness          | Cooperative tools, when path-level visibility or provenance integration matters more than catching non-cooperative traffic                                                                                                                                                                                                                 |

`transparent` enforces at the network layer regardless of whether a tool cooperates, so every
connection attempt is observed and recorded — this is why it's the default. Use `explicit` if you
need full URL/path-level visibility integrated into BuildKit's own build output and SLSA provenance,
and your build's tools are known to respect `HTTP_PROXY`/`HTTPS_PROXY`. See
[Explicit Proxy Engine](./security.md#explicit-proxy-engine) for the full technical detail. See
the [complete example workflow](../.github/workflows/example-explicit.yml) for a working
`explicit` engine setup, including the CA trust workaround below.

#### CA Trust for Tools with Their Own CA Store

Under `proxy_engine: explicit`, BuildKit injects its generated CA directly into the container's own
system CA bundle file, so tools that consult that file the normal way (most tools built on OpenSSL —
`curl`, `git`, Go binaries, etc.) already trust it with no configuration. A tool that instead bundles
its own separate CA store ignores that file entirely and still fails with a TLS/certificate error,
even though `HTTP_PROXY`/`HTTPS_PROXY` are set correctly.

**npm** is the common case — point it at the system CA store BuildKit already patched, either inline
on the command that needs it:

```dockerfile
RUN NODE_USE_SYSTEM_CA=1 npm install
```

or once per stage if it runs npm more than once:

```dockerfile
FROM node:22-alpine
ARG NODE_USE_SYSTEM_CA=1
RUN npm install
RUN npm run build
```

If a different tool fails the same way — a `RUN` step that works under `transparent` (or without
Buildcage at all) but fails with a TLS/certificate error under `explicit` — check that tool's own
documentation for an equivalent setting; this is specific to tools that maintain their own CA store
rather than consulting the system one.

### Usage Notes

- Start with audit mode to discover required domains, then switch to restrict mode.
- Separate HTTP and HTTPS domains — some services use different hosts for each protocol.
- Common package registries often use multiple domains (e.g., PyPI uses both `pypi.org` and `files.pythonhosted.org`).
- Some package managers download over plain HTTP (e.g., certain Debian mirrors). Add those domains to `allowed_http_rules` separately:

  ```yaml
  allowed_http_rules: deb.debian.org:80
  allowed_https_rules: registry.npmjs.org:443
  ```

> [!NOTE]
> The Docker image is always pulled from `ghcr.io/<action-owner>/<action-repo>` and its
> build provenance is cryptographically verified (keyless signature) before the image is pulled.
> External image overrides are not supported to preserve this guarantee. For best security, pin the
> action to a commit SHA: `uses: dash14/buildcage/setup@<40-char-sha> # vX.Y.Z`
>
> Self-hosting with a custom image requires forking the repository. See the [Self-Hosting Guide](./self-hosting.md).
> If the action package is private (self-hosted in a private repository), run
> [`docker/login-action`](https://github.com/docker/login-action) with `packages: read` before this
> action — credentials stored by Docker are picked up automatically.

---

## Report Action (`dash14/buildcage/report`)

Displays communication logs after builds and optionally fails if any BLOCKED connections are found.

```yaml
- name: Show proxy report
  if: always()
  uses: dash14/buildcage/report@f40c162979dc9f095993ad26049b08b2eca77911 # v2.2.5
```

### Job Summary

**Audit mode:**

<img src="../assets/report-audit-mode.png" alt="Outbound Traffic Report - audit mode" width="556">

Use the domain names shown in the report to create your allowlist for restrict mode.

**Restrict mode:**

<img src="../assets/report-restrict-mode.png" alt="Outbound Traffic Report - restrict mode" width="556">

In restrict mode, the report step fails if blocked connections are detected, causing the workflow to fail. You can disable this by setting `fail_on_blocked: false`. In audit mode, blocked connections (e.g., protocol errors) are reported but never cause the step to fail.

If some blocked connections are expected — a known-noisy dependency, a domain you're deliberately
keeping off the allowlist to confirm it stays blocked — list them in `setup`'s `known_blocked_rules`
input (same syntax as `allowed_https_rules`, see [Rule Syntax](./rules.md)). When every blocked
connection matches `known_blocked_rules`, the step no longer fails even with `fail_on_blocked: true`,
and a `::notice::` is emitted instead of `::error::`; any other, unmatched blocked connection still
fails the step as before. Once `known_blocked_rules` is set, the Job Summary's Blocked Hosts table
gains an extra **Expected** column (✅) marking the matched rows.

### Parameters

| Parameter         | Required | Default     | Description                                                                                   |
| ----------------- | -------- | ----------- | --------------------------------------------------------------------------------------------- |
| `builder_name`    | No       | `buildcage` | Name of the builder container                                                                 |
| `fail_on_blocked` | No       | `true`      | Fail the step if blocked connections are detected (restrict mode only; ignored in audit mode) |
