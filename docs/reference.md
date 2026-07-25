# Reference

## Setup Action (`dash14/buildcage/setup`)

Starts the Buildcage builder container.

```yaml
- name: Start Buildcage builder
  id: buildcage
  uses: dash14/buildcage/setup@bdf40b4677db602b923c622f26ef09a210d2ebd7 # v2.2.4
  with:
    proxy_mode: restrict
    allowed_https_rules: |
      registry.npmjs.org:443
      github.com:443
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `builder_name` | No | `buildcage` | Name of the builder container |
| `proxy_mode` | No | `restrict` | Operation mode (`audit` / `restrict`) |
| `proxy_engine` | No | `transparent` | Network enforcement engine (`transparent` / `explicit`, see [Proxy Engines](#proxy-engines)) |
| `allowed_https_rules` | No | empty | HTTPS allow rules (wildcard or regex, port required) |
| `allowed_http_rules` | No | empty | HTTP allow rules (wildcard or regex, port required) |
| `allowed_ip_rules` | No | empty | IP address allow rules (wildcard or regex, port required) |

### Rule Syntax

| Pattern | Example | Matches |
|---------|---------|---------|
| Exact domain | `example.com:443` | `example.com` on port 443 only |
| Single-level wildcard | `*.example.com:443` | `sub.example.com` on port 443 (not `deep.sub.example.com`) |
| Multi-level wildcard | `**.example.com:443` | `sub.example.com` and `deep.sub.example.com` on port 443 |
| Single-char wildcard | `exampl?.com:443` | `example.com`, `examplx.com` on port 443 |
| Wildcard port | `example.com:*` | `example.com` on any port |
| Regex | `~^custom\.pattern:\d+$` | Matched against `domain:port` |

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

| | `transparent` (default) | `explicit` |
|---|---|---|
| Isolation mechanism | CNI network + DNS redirection | BuildKit native `--proxy-network` (point-to-point network namespace) |
| TLS handling | Not terminated — SNI (HTTPS) / Host header (HTTP) inspected only | Terminated (MITM) via an injected CA — full host **and path** visible |
| Dockerfile / tool changes | None required | None for tools that already respect `HTTP_PROXY`/`HTTPS_PROXY` and trust the system CA store (most OpenSSL-based tools); a tool that bundles its own CA store (e.g. npm) needs an env var or flag pointing it at the system CA store — see [CA Trust for Tools with Their Own CA Store](#ca-trust-for-tools-with-their-own-ca-store) below |
| Enforcement granularity | Domain (and port) | Domain (and port) — same as `transparent`; the decrypted path is visible for logging but isn't matched by `allowed_*_rules` |
| `allowed_ip_rules` enforcement | Raw TCP passthrough — no protocol inspection once `ip:port` matches | Same as domain rules — matched and MITM'd via the BuildKit source policy, not a special-cased passthrough |
| Non-cooperative tools (ignore proxy env vars, or open raw sockets) | Still observed, blocked, and logged — network-level enforcement, no opt-out | Blocked with "network unreachable" — invisible, no trace anywhere in the report |
| Report detail | Allowed / blocked hosts | Allowed / blocked hosts (with full path), plus a per-step "Communication details" breakdown |
| BuildKit provenance / SLSA integration | Not integrated | Integrated into BuildKit's own build output and SLSA provenance |
| Best for | Default choice — works with any tool regardless of proxy-awareness | Cooperative tools, when path-level visibility or provenance integration matters more than catching non-cooperative traffic |

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
  uses: dash14/buildcage/report@bdf40b4677db602b923c622f26ef09a210d2ebd7 # v2.2.4
```

### Job Summary

**Audit mode:**

<img src="../assets/report-audit-mode.png" alt="Outbound Traffic Report - audit mode" width="556">

Use the domain names shown in the report to create your allowlist for restrict mode.

**Restrict mode:**

<img src="../assets/report-restrict-mode.png" alt="Outbound Traffic Report - restrict mode" width="556">

In restrict mode, the report step fails if blocked connections are detected, causing the workflow to fail. You can disable this by setting `fail_on_blocked: false`. In audit mode, blocked connections (e.g., protocol errors) are reported but never cause the step to fail.

If some blocked connections are expected — a known-noisy dependency, a domain you're deliberately
keeping off the allowlist to confirm it stays blocked — list them in `known_blocked_rules` (same
syntax as `allowed_https_rules`, see [Rule Syntax](./rules.md)). When every blocked connection
matches `known_blocked_rules`, the step no longer fails even with `fail_on_blocked: true`, and a
`::notice::` is emitted instead of `::error::`; any other, unmatched blocked connection still fails
the step as before. Once `known_blocked_rules` is set, the Job Summary's Blocked Hosts table gains
an extra **Expected** column (✅) marking the matched rows.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `builder_name` | No | `buildcage` | Name of the builder container |
| `fail_on_blocked` | No | `true` | Fail the step if blocked connections are detected (restrict mode only; ignored in audit mode) |
| `known_blocked_rules` | No | empty | Domains expected to be blocked intentionally (wildcard or regex, port required); blocked connections matching these don't fail the step even when `fail_on_blocked` is `true` |

---

## Run Action (`dash14/buildcage/run`)

> [!WARNING]
> `run` is an **experimental** action — see
> [Known Limitations](./security.md#known-limitations-1) in Security Details before relying on it.

Runs an arbitrary command — not just a Docker build — with the same outbound network isolation as
the `setup`/`report` actions provide for `RUN` steps. Useful for `run:` steps that install
dependencies, run tests, or execute build scripts directly on the runner, outside of any Docker
build.

```yaml
- name: Run tests with outbound network isolation
  uses: dash14/buildcage/run@bdf40b4677db602b923c622f26ef09a210d2ebd7 # v2.2.4
  with:
    proxy_mode: restrict
    allowed_https_rules: registry.npmjs.org:443
    run: |
      npm install
      npm test
```

Each `run` step is self-contained: it starts its own throwaway proxy container, runs `run`
inside the isolated sandbox, appends a report section to the Job Summary, and stops the proxy
container again — all within that one step. Using `run` multiple times in the same job starts
a fresh proxy container each time, so different steps can use different allowlists. This is also
safe when those steps run truly concurrently via GitHub Actions' `background`/`wait`/`wait-all`/
`parallel` step keywords — each step's proxy container, network, and Compose project are all
namespaced by the same per-step random suffix, so concurrent steps never recreate or tear down
each other's containers.

In `audit` mode, the Job Summary also includes a ready-to-paste `restrict` mode example — a
`run` step with `proxy_mode: restrict` and allowlist rules generated from the hosts observed
during the audited run — mirroring the same example the `report` action generates for
`setup`/`report` workflows.

See the [restrict mode](../.github/workflows/example-run-restrict.yml) and
[audit mode](../.github/workflows/example-run-audit.yml) example workflows for each in full.

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `run` | Yes | — | Command(s) to run inside the isolated sandbox (multi-line supported, like a workflow `run:` step) |
| `proxy_mode` | No | `restrict` | Operation mode (`audit` / `restrict`) |
| `allowed_https_rules` | No | empty | HTTPS allow rules (wildcard or regex, port required) |
| `allowed_http_rules` | No | empty | HTTP allow rules (wildcard or regex, port required) |
| `allowed_ip_rules` | No | empty | IP address allow rules (wildcard or regex, port required) |
| `fail_on_blocked` | No | `true` | Fail the step if blocked connections are detected (restrict mode only; ignored in audit mode) |
| `known_blocked_rules` | No | empty | Domains expected to be blocked intentionally (wildcard or regex, port required); blocked connections matching these don't fail the step even when `fail_on_blocked` is `true` |
| `writable` | No | empty | Additional writable directories (newline-separated), on top of `$GITHUB_WORKSPACE`, `$HOME`, `/tmp`, and `$RUNNER_TEMP` — see [Filesystem Access](#filesystem-access) below |
| `label` | No | empty | Label appended to this step's Job Summary heading, e.g. `npm install` — useful to tell steps apart when `run` is used more than once in the same job |

Rule syntax is identical to `setup`'s — see [Rule Syntax](#rule-syntax) above. `known_blocked_rules`
uses this same syntax; see the [Report Action](#report-action-dash14buildcagereport) section above
for its exact semantics, which applies here too.

### Passing Values to `run`

Use the step's own `env:` (not a `with:` input) to pass values into `run` — exactly like a native
`run:` step. `run` forwards its whole process environment into the isolated command, so
anything set via `env:` is available there too:

```yaml
- uses: dash14/buildcage/run@bdf40b4677db602b923c622f26ef09a210d2ebd7 # v2.2.4
  env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  with:
    run: |
      echo "Building for: $PR_TITLE"
      npm test
```

Avoid interpolating `${{ }}` expressions directly into `run` itself (e.g. `run: echo "${{
github.event.pull_request.title }}"`) — GitHub substitutes them into the script text before any
shell runs, so an attacker-controlled value (a PR title, branch name, issue body, etc.) can inject
arbitrary commands. Passing the same value through `env:` instead means it reaches the isolated
command as a single environment variable, never interpreted as shell syntax. This is the same
[script injection guidance](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections)
GitHub gives for any workflow, and applies to this action's `run` input exactly as it would to a
native `run:` step.

### How It Works

`run` reuses the same isolation technology as the `transparent` engine (iptables redirect, DNS
redirect, SNI/Host-based allowlist proxy) but applies it to the runner host itself instead of a
BuildKit `RUN` step:

1. A throwaway proxy container starts (no `buildkitd` — just the iptables, DNS, and HAProxy pieces
   from `transparent` mode).
2. The `run` command executes directly on the runner host inside a fresh network/PID/mount/UTS/
   IPC/cgroup namespace, connected to the proxy container's own netns by a dedicated veth pair (no
   bridge — always a 1:1 connection) — the same network-level enforcement `transparent` mode gives
   Docker `RUN` steps.
3. Before executing `run`, all capabilities are dropped, `no_new_privileges` is set, and
   supplementary groups (e.g. `docker`) are cleared — the isolated command cannot re-escalate
   privileges, touch the Docker socket, or reconfigure networking, even if it runs as the same
   user/UID as the runner (kept unchanged so `actions/setup-node`-installed toolchains,
   `$GITHUB_WORKSPACE` ownership, and `$HOME`-based caches keep working normally).
   PID namespace isolation also means the isolated command structurally cannot `ptrace` or read
   `/proc/<pid>/mem` for the Actions runner process itself — the kernel forbids reaching into a
   parent PID namespace regardless of capabilities.

### Filesystem Access

Only `$GITHUB_WORKSPACE`, `$HOME`, `/tmp`, and `$RUNNER_TEMP` are writable by default — every other
path is remounted read-only for the duration of the `run` command. This closes off using the
filesystem to plant a payload for a later, non-sandboxed step in the same job (e.g. rewriting a
binary earlier on `$PATH`); it doesn't restrict what the command can *read* (see
[Known Limitations](./security.md#run-action) in Security Details).

If `run` needs to write somewhere else — a tool-specific cache directory, for example — list it
under `writable`:

```yaml
- uses: dash14/buildcage/run@bdf40b4677db602b923c622f26ef09a210d2ebd7 # v2.2.4
  with:
    writable: |
      /opt/some-tool/cache
    run: some-tool build
```

To disable the read-only restriction entirely, set `writable` to `/`:

```yaml
    writable: /
```

> [!NOTE]
> `run` sets up its isolation directly on the runner host (via `sudo -n`), so it requires a
> Linux runner with passwordless `sudo` and a working Docker installation — both are the default on
> GitHub-hosted `ubuntu-*` runners, but lightweight images such as `ubuntu-slim` (a Docker client
> with no daemon) are not supported. It applies a seccomp filter derived from Docker's own default
> profile; it does not apply an AppArmor/SELinux profile or Landlock rules. See
> [Security Details](./security.md#run-action) for the full threat model and known limitations.
