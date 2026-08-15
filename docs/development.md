# Development Guide

This document covers local development, testing, and the project structure of Buildcage.

## Local Usage

You can run Buildcage locally without GitHub Actions using Docker Compose and Make.

> GitHub Actions inputs use lowercase names (e.g., `proxy_mode`), while environment variables for local usage use uppercase (e.g., `PROXY_MODE`).

### Starting the Builder

There's one `setup_buildkit_{engine}_{mode}` target per (`transparent`, `explicit`) x (`audit`, `restrict`)
combination:

```bash
make setup_buildkit_transparent_audit
make setup_buildkit_transparent_restrict
make setup_buildkit_explicit_audit
make setup_buildkit_explicit_restrict
```

**Start with custom domains** (restrict mode only):

```bash
ALLOWED_HTTPS_RULES="github.com:443 npmjs.org:443 example.com:443" make setup_buildkit_transparent_restrict
```

The `explicit_*` targets use BuildKit's native `--proxy-network` instead of the CNI/DNS-redirect/HAProxy
stack (see [Proxy engines](../README.md#proxy-engines)). `PROXY_ENGINE=explicit` selects
`docker/explicit/Dockerfile` at build time (see `compose.yaml`'s
`build.dockerfile: docker/${PROXY_ENGINE:-transparent}/Dockerfile`); the `transparent_*` targets build
`docker/transparent/Dockerfile` exactly as before.

### End-to-End Workflow

```bash
# 1. Start Buildcage
make setup_buildkit_transparent_audit

# 2. Build
docker buildx build --builder buildcage --progress=plain -f Dockerfile .

# 3. View report
make report_buildkit

# 4. Clean up
make clean_buildkit
```

`make report_buildkit` runs `node report/src/main.ts` with the same `COMPOSE_PROJECT_NAME`/`BUILDCAGE_BUILD_TEST_HOOKS`
override the `setup_buildkit_*`/`clean_buildkit` targets use (see the pattern rule near the top of the
Makefile) — running `node report/src/main.ts` directly, without going through `make`, won't find the running
builder container. Raw builder logs are also available via `docker compose logs builder`.

## Testing

Each `setup_buildkit_{engine}_{mode}` target has a matching
`test_integration_buildkit_{engine}_{mode}` target (start → build the matching
`test/Dockerfile.*` → verify → clean up):

```bash
make test_integration_buildkit_transparent_audit
make test_integration_buildkit_transparent_restrict
make test_integration_buildkit_explicit_audit
make test_integration_buildkit_explicit_restrict
```

## Formatting & Linting

Formatting, linting, and type-aware linting are handled by [vp (Vite+)](https://viteplus.dev/),
installed globally on your machine like `pnpm`/`corepack` rather than through `pnpm exec`:

```bash
curl -fsSL https://vite.plus | bash   # macOS/Linux
# Windows: irm https://viteplus.dev/install.ps1 | iex
```

The project pins its own toolchain version via the `vite-plus` devDependency in `package.json`
(the same way `packageManager` pins `pnpm`) — the globally installed `vp` binary detects and
delegates to that pinned version automatically, so plain `vp ...` commands are reproducible
without going through `pnpm exec`. This was verified against `vp v0.2.7` / local `vite-plus
v0.2.5`; if a much newer `vp` behaves differently, that's the version to compare against.

```bash
vp check       # format + lint + type-aware lint (read-only; what CI runs)
vp check --fix # same, but auto-fixes format/lint issues in place
vp lint --fix
vp fmt --write
```

`pnpm typecheck` (`tsc`) remains the authoritative full type check; `vp check`'s type-aware
linting (via `oxlint-tsgolint`) catches a subset of type-driven issues fast but doesn't replace it.

Running `vp install` (in place of `pnpm install`) automatically sets up a pre-commit hook — via
the `prepare` script — that formats and lints your staged files (`vite.config.ts`'s `staged`
config) before each commit, auto-fixing and re-staging what it can. To skip it in an emergency
(not recommended — CI runs the same check and will fail if you rely on this):

```bash
git commit --no-verify
```

## Explicit Engine Internals

This section covers how `proxy_engine: explicit` is implemented internally. For the user-facing
behavior — what's enforced, what's visible in the report — see
[Explicit Proxy Engine](./security.md#explicit-proxy-engine) in Security Details.

- A small statically-linked Go binary (`docker/explicit/buildkit-proxy/`) is the image's entrypoint
  (PID 1) and directly supervises the real `buildkitd` as a child process. `RUN` steps are isolated
  into their own point-to-point network namespace by `proxyNetwork = true`, built directly on
  netlink/veth rather than CNI.
- At startup, the binary: writes `/etc/resolv.conf` from `EXTERNAL_RESOLVER` if that variable is
  set (otherwise the container's own resolv.conf, e.g. Docker's embedded DNS, is left untouched);
  runs a QuickJS script that compiles `allowed_https_rules` / `allowed_http_rules` /
  `allowed_ip_rules` (the exact same syntax as `transparent` mode — see
  [Rule syntax](../README.md#rule-syntax)) into a BuildKit
  [source policy](https://github.com/moby/buildkit/blob/master/docs/proxy.md); starts `buildkitd`
  with `proxyNetwork = true` bound to an internal Unix socket; and starts its own gRPC listener on
  the socket path Buildx actually connects to.
- That gRPC listener sits in front of the real `buildkitd` control socket. It intercepts only the
  `Solve` RPC to inject the compiled source policy, and transparently relays every other RPC
  (`Session`, `Status`, `DiskUsage`, etc.) to the real daemon without decoding it — so future
  BuildKit versions that add new RPCs are automatically supported.
- If the build client has already set a **static** source policy on the request — e.g. via the
  `EXPERIMENTAL_BUILDKIT_SOURCE_POLICY` environment variable, which `docker buildx build` reads
  unconditionally — buildcage **merges** it with its own policy rather than rejecting the build,
  placing its own rules last so they always have the final say for every `http(s)` source: a
  client-supplied policy can never widen access beyond `allowed_https_rules` / `allowed_http_rules` /
  `allowed_ip_rules`. For any other scheme (`docker-image://`, `git://`, etc.) buildcage's rules
  never match, so the client's rules apply unmodified — buildcage only ever governs what it was
  configured to govern. A **dynamic**, session-based policy (`docker buildx build --policy=...`,
  `docker/buildx`'s own Rego policy feature) is a separate mechanism and is left untouched; it
  applies as an additional condition alongside buildcage's (merged) policy.

## Local Development

### Local testing of the setup/report actions

Sigstore verification requires a real, published GHCR image, so the setup action normally can't
run against an unpublished branch or local changes. This repo's own CI (`test_action` job in
`.github/workflows/test-e2e.yml`) tests the real `setup`/`report` actions end-to-end against a
locally built image instead, via a build-time-gated mechanism: `BUILDCAGE_BUILD_TEST_HOOKS=1 pnpm
build` compiles `dist/main.cjs` where the `BUILDCAGE_LOCAL_IMAGE_REF` override is reachable.
The override logic lives in its own module (`src/core/lib/provenance/local-image-override.ts`), loaded
only via a dynamic `import()` gated by that build-time flag. Without the flag (i.e. every
normal/committed build), rolldown's own module-graph tree-shaking excludes that entire file from
the bundle — it's physically absent, not just unreachable. A CI check (`unit_test` job)
additionally confirms a normal build never contains a live runtime read of
`BUILDCAGE_BUILD_TEST_HOOKS` in `dist`, guarding against a future refactor silently breaking
that guarantee.

To exercise it locally:

1. Build the image: `docker compose build` (set `PROXY_ENGINE` to select the engine).
2. `BUILDCAGE_BUILD_TEST_HOOKS=1 pnpm build`
3. Run it with `BUILDCAGE_LOCAL_IMAGE_REF=<image ref from step 1>` set (e.g. via `act`, or by
   invoking `node dist/main.cjs` directly with the relevant `INPUT_*` env vars). Never commit
   a `dist/main.cjs` built this way — run `pnpm build` again (without the flag) before committing.

See [security.md](./security.md#verification-limitations) for more details.

## Viewing Logs

```bash
# All communication logs
docker compose logs builder

# Real-time log monitoring
docker compose logs -f builder
```

**Log format:**

```
[28/Feb/2026:10:15:30 +0000] buildcage [ALLOWED] "github.com:443" -
[28/Feb/2026:10:15:31 +0000] buildcage [BLOCKED] "malicious.com:443" not-allowed
[28/Feb/2026:10:15:32 +0000] buildcage [AUDIT] "npmjs.org:80" -
```

Fields: `[timestamp] buildcage [status] "domain:port" reason`

**In `proxy_engine: explicit`**, there is no HAProxy log — instead, denied requests end up in
buildkitd's own debug log at `/var/log/buildkitd/current` inside the container, logged by BuildKit's
source-policy engine. Allowed/audited requests are _not_ read from this log file: BuildKit's own
"proxy network requests:" build output only ends up there if buildkitd runs with
`BUILDKIT_DEBUG_EXEC_OUTPUT=1`, which also mirrors every RUN step's own console output into the same
log. That data is instead fetched via `buildctl debug logs --progress=rawjson`, described below,
which needs no such flag. `report-action.js` — the runner-side report generator baked into each
engine's image and `docker cp`'d out fresh by the `report` action on every run (see Directory
Structure below) — reads whichever of transparent/explicit's two log files exists for the denied
side and raw console output, so `docker compose logs builder` and the `report` action work
unmodified against either engine.

The `explicit` engine's job summary builds its "Allowed"/"Audited Hosts" table, and a collapsed
**Communication details** section (a per-command breakdown `transparent` mode has no equivalent for),
from the same source: `core/lib/log/vertex-log.ts` calls `buildctl debug histories` (to enumerate
_every_ build recorded since the container started — a workflow may run several builds against the
same buildcage container before calling the report action once, and each is independently tracked)
and `buildctl debug logs --progress=rawjson <ref>` for each one, whose log entries are each tagged
with the exact vertex (RUN step) that produced them — reliable even under concurrent execution, since
BuildKit can run independent RUN steps concurrently. The host-aggregated table sums these
vertex-tagged entries across every RUN step and build; the Communication details section lists them
per-step instead, with each step's own start time and duration — steps with no communication at all
are still listed, marked `(no communication)`. Independent build stages are grouped together (ordered
by each stage's earliest start) rather than interleaved by raw timestamp, since that's easier to read
when debugging; if more than one build is found, each gets its own `### Build N` heading so
identically-numbered steps from different builds aren't mistaken for one another.

Denied requests are listed separately, as a flat, timestamped `DENIED` list at the end — BuildKit's
own source-policy denial log carries no vertex/span identifier at all, so there's no reliable way to
attribute a denial to a specific RUN step; a human has to compare its timestamp against the per-step
times above. That timestamp is also only whole-seconds precise (buildkitd's own logrus formatter
doesn't record sub-second precision), unlike the millisecond-precision start/duration `buildctl`
reports for the allowed side.

## Makefile Commands

| Command                                               | Description                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `make help`                                           | Show available commands                                                        |
| `make setup_buildkit_transparent_audit`               | Start transparent engine in audit mode                                         |
| `make setup_buildkit_transparent_restrict`            | Start transparent engine in restrict mode (default domains)                    |
| `make setup_buildkit_explicit_audit`                  | Start explicit proxy engine in audit mode                                      |
| `make setup_buildkit_explicit_restrict`               | Start explicit proxy engine in restrict mode                                   |
| `make report_buildkit`                                | Show the buildcage report for the currently running builder                    |
| `make test_integration_buildkit`                      | Run all `test_integration_buildkit_*` tests                                    |
| `make test_integration_buildkit_transparent_audit`    | Run transparent-engine audit mode tests (start → build → verify → clean up)    |
| `make test_integration_buildkit_transparent_restrict` | Run transparent-engine restrict mode tests (start → build → verify → clean up) |
| `make test_integration_buildkit_explicit_audit`       | Run explicit-engine audit mode tests (start → build → verify → clean up)       |
| `make test_integration_buildkit_explicit_restrict`    | Run explicit-engine restrict mode tests (start → build → verify → clean up)    |
| `make test_unit`                                      | Run unit tests                                                                 |
| `make clean_buildkit`                                 | Stop and remove the buildkit builder's containers/images and buildx builder    |

## Directory Structure

```text
.
├── action.yml                # Setup action entry (node24 → dist/main.cjs, dist/post.cjs)
├── src/                      # Source (ESM): verify image provenance, resolve image ref, compose up
│   ├── lib/                  # Setup action's own small helpers (errors.ts)
│   └── core/                 # Code shared across actions
│       ├── lib/               # All shared library code, consolidated: acl/ (rule parsing) is
│       │                     # dual-consumed by Node and QuickJS; test/test-shim.ts is a portable
│       │                     # node:test-alike shim used by *.test.ts across the whole tree
│       │                     # (Node and QuickJS alike). Everything else — log/, report/,
│       │                     # docker/, provenance/ (Sigstore, OCI registry lookups, image ref
│       │                     # resolution, local-image test-hook override), actions/ — is
│       │                     # Node-only, used by this action's and report's Node runtime and
│       │                     # report-action.node.ts, never by the QuickJS scripts
│       └── scripts/           # QuickJS entry point (convert-rule.ts), run inside the built images
│                             # (rolldown-bundled into /opt/buildcage/scripts/ at image build time
│                             # — see rolldown.scripts.config.js); test/ is a qjs test runner, types/ is
│                             # the qjs:std/qjs:os ambient type declaration
├── dist/                     # Bundled output (rolldown → CommonJS); dist/qjs, dist/qjs-test,
│                             # dist/report-action are gitignored build-time scratch output, not committed
├── docker/                   # proxy_engine build contexts
│   ├── compose.action.yaml   # Runtime compose file the action itself uses (verified, digest-pinned
│   │                         # image ref) — distinct from the top-level compose.yaml below
│   ├── lib/                  # write-step-summary.ts, shared by both engines' report-action.node.ts
│   ├── transparent/          # proxy_engine: transparent — Dockerfile + BuildKit/haproxy/dnsmasq/
│   │                         # s6-overlay config + scripts/report-action.node.ts (runs under Node
│   │                         # on the runner, `docker cp`'d out by the report action)
│   └── explicit/             # proxy_engine: explicit — Dockerfile + buildkit-proxy/ (Go module:
│                             # entrypoint/PID1, supervises buildkitd, injects the source policy
│                             # into Solve via a gRPC proxy) + scripts/ (gen-source-policy.ts runs
│                             # under QuickJS; report-action.node.ts runs under Node on the runner,
│                             # `docker cp`'d out by the report action — TypeScript, rolldown-bundled
│                             # at image build time)
├── test/                     # Dockerfile.*/assert-*.sh per {engine}-{mode} combination, plus
│                             # test-server(-explicit)/test-dns(-explicit) fixture containers
├── compose.test-*.yaml       # Test override config, one per engine
├── report/                   # GitHub Actions report action
│   ├── action.yml            # Action entry (node24 → dist/main.cjs)
│   ├── src/                  # Source (ESM): log analysis, per-command breakdown, Job Summary output
│   └── dist/                 # Bundled output (rolldown → CommonJS)
├── docs/                     # development.md, explicit-engine.md, security.md, self-hosting.md
├── compose.yaml              # Docker Compose config for local dev (dockerfile path selected by
│                             # PROXY_ENGINE; also defines the local-dev `proxy` service)
└── Makefile                  # Operational commands
```

## Troubleshooting

If you encounter issues, try reproducing the problem locally to get detailed logs:

1. **Check logs:**

   ```bash
   docker compose logs builder
   ```

2. **Run in audit mode** to understand your build's network behavior:

   ```bash
   make clean_buildkit
   make setup_buildkit_transparent_audit
   docker buildx build --builder buildcage --no-cache -f Dockerfile .
   docker compose logs builder
   ```

3. **TLS/certificate errors under `proxy_engine: explicit`**: if a `RUN` step fails with a
   certificate error there but works fine under `transparent` (or without Buildcage at all), the tool
   likely bundles its own CA store instead of consulting the system one BuildKit already trusts — see
   [CA trust for tools with their own CA store](./explicit-engine.md#ca-trust-for-tools-with-their-own-ca-store)
   in the Reference doc.

4. **Open an issue** at [github.com/buildcage/docker/issues](https://github.com/buildcage/docker/issues) with:
   - Your Dockerfile
   - The audit mode report output
   - Full error messages from `docker compose logs builder`
