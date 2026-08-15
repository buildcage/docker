# Explicit Proxy Engine (experimental)

> [!WARNING]
> `explicit` is an **experimental** engine. Its underlying BuildKit feature (`--proxy-network`) is
> still maturing, and it has structural limitations not present in the `transparent` engine — read
> this page before relying on it. `transparent` remains the default and recommended engine.

`proxy_engine` selects how Buildcage intercepts and enforces traffic. It is independent of
`proxy_mode`: either engine works with either mode, and both use the same
[rule syntax](../README.md#rule-syntax).

- **`transparent`** (default): traffic is intercepted at the network level, with no proxy
  configuration or CA trust needed inside the build
- **`explicit`**: BuildKit's native `--proxy-network` — injects `HTTP_PROXY`/`HTTPS_PROXY` and a CA
  certificate, then MITMs the traffic to inspect requests directly

```yaml
- name: Start Buildcage
  uses: buildcage/docker@567c77b193bcb93d3a534e3bf1481e2543bb9811 # v3.0.1
  with:
    proxy_engine: explicit
    proxy_mode: restrict
    allowed_https_rules: |
      registry.npmjs.org:443
```

Everything else in the workflow is unchanged — see the
[complete example workflow](../.github/workflows/example-explicit.yml).

## Comparison

|                                                                    | `transparent` (default)                                                     | `explicit`                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Isolation mechanism                                                | CNI network + DNS redirection                                               | BuildKit native `--proxy-network` (point-to-point network namespace)                                                                                                                                                                       |
| TLS handling                                                       | Not terminated — SNI (HTTPS) / Host header (HTTP) inspected only            | Terminated (MITM) via an injected CA — full host **and path** visible                                                                                                                                                                      |
| Dockerfile / tool changes                                          | None required                                                               | None for tools that respect `HTTP_PROXY`/`HTTPS_PROXY` and trust the system CA store; a tool bundling its own CA store (e.g. npm) needs a flag pointing it at the system one — see [CA trust](#ca-trust-for-tools-with-their-own-ca-store) |
| Enforcement granularity                                            | Domain (and port)                                                           | Domain (and port) — the decrypted path is visible for logging but isn't matched by `allowed_*_rules`                                                                                                                                       |
| `allowed_ip_rules` enforcement                                     | Raw TCP passthrough — no protocol inspection once `ip:port` matches         | Same as domain rules — matched via the BuildKit source policy, not a special-cased passthrough                                                                                                                                             |
| Non-cooperative tools (ignore proxy env vars, or open raw sockets) | Still observed, blocked, and logged — network-level enforcement, no opt-out | Blocked with "network unreachable" — invisible, no trace anywhere in the report                                                                                                                                                            |
| Report detail                                                      | Allowed / blocked hosts                                                     | Allowed / blocked hosts (with full path), plus a per-step "Communication details" breakdown                                                                                                                                                |
| BuildKit provenance / SLSA integration                             | Not integrated                                                              | Integrated into BuildKit's own build output and SLSA provenance                                                                                                                                                                            |
| Best for                                                           | Default choice — works with any tool regardless of proxy-awareness          | Cooperative tools, when path-level visibility or provenance integration matters more than catching non-cooperative traffic                                                                                                                 |

`transparent` enforces at the network layer whether or not a tool cooperates, so every connection
attempt is observed and recorded — this is why it is the default. Use `explicit` when you need
URL/path-level visibility in BuildKit's own build output and SLSA provenance, and your build's tools
are known to respect `HTTP_PROXY`/`HTTPS_PROXY`.

## CA trust for tools with their own CA store

Under `proxy_engine: explicit`, BuildKit injects its generated CA into the container's system CA
bundle, so tools that consult that file the normal way (most tools built on OpenSSL — `curl`, `git`,
Go binaries) already trust it with no configuration. A tool that bundles its own separate CA store
ignores that file and still fails with a TLS/certificate error, even though the proxy variables are
set correctly.

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

If a different tool fails the same way — a `RUN` step that works under `transparent` but fails with a
TLS/certificate error under `explicit` — check that tool's documentation for an equivalent setting.

## Further reading

- [Explicit Proxy Engine](./security.md#explicit-proxy-engine) in Security Details — architecture,
  source-policy compilation, and coverage/visibility limits
- [Explicit Engine Internals](./development.md#explicit-engine-internals) in the Development Guide —
  the supervisor binary, gRPC interception, and policy compilation
