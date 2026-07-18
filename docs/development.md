# Development Guide

This document covers local development, testing, and the project structure of Buildcage.

## Local Usage

You can run Buildcage locally without GitHub Actions using Docker Compose and Make.

> GitHub Actions inputs use lowercase names (e.g., `proxy_mode`), while environment variables for local usage use uppercase (e.g., `PROXY_MODE`).

### Starting the Builder

There's one `run_{engine}_{mode}_mode` target per (`transparent`, `explicit`) x (`audit`, `restrict`)
combination:

```bash
make run_transparent_audit_mode
make run_transparent_restrict_mode
make run_explicit_audit_mode
make run_explicit_restrict_mode
```

**Start with custom domains** (restrict mode only):

```bash
ALLOWED_HTTPS_RULES="github.com:443 npmjs.org:443 example.com:443" make run_transparent_restrict_mode
```

The `explicit_*` targets use BuildKit's native `--proxy-network` instead of the CNI/DNS-redirect/HAProxy
stack (see [Proxy Engines](./reference.md#proxy-engines)). `PROXY_ENGINE=explicit` selects
`setup/docker/explicit/Dockerfile` at build time (see `compose.yaml`'s
`build.dockerfile: setup/docker/${PROXY_ENGINE:-transparent}/Dockerfile`); the `transparent_*` targets build
`setup/docker/transparent/Dockerfile` exactly as before.

### End-to-End Workflow

```bash
# 1. Start Buildcage
make run_transparent_audit_mode

# 2. Build
docker buildx build --builder buildcage --progress=plain -f Dockerfile .

# 3. View report
docker compose logs builder

# 4. Clean up
make clean
```

### Sandbox Dev Loop (mac-friendly)

The `sandbox` action's own isolation mechanism (`run-isolated.sh`) uses Linux-only primitives
(`unshare`, `nsenter`, `setpriv`) that can't run natively on macOS. `make run_sandbox_mode` /
`make test_sandbox_mode` instead drive it from inside a container with `pid: host` (see
`sandbox/dev/Dockerfile` and `sandbox/compose.sandbox-dev.yaml`), which can see the sandbox proxy
container's PID/netns via `/proc` — close enough to the real "runner host + separate proxy
container" arrangement for day-to-day iteration, though it can't validate the container-boundary
parts of production (see [Sandbox Action Internals](#sandbox-action-internals) below). CI's
`test_sandbox` job runs `run-isolated.sh` directly on the runner host instead, matching production
exactly — treat that as the final word on whether a change actually works, not this dev loop.

```bash
make run_sandbox_mode   # start the proxy + dev-loop runner container
make test_sandbox_mode  # run a sample isolated command and verify allow/block + capability drop
```

## Testing

Each `run_{engine}_{mode}_mode` target has a matching `test_{engine}_{mode}_mode` target
(start → build the matching `setup/test/Dockerfile.*` → verify → clean up):

```bash
make test_transparent_audit_mode
make test_transparent_restrict_mode
make test_explicit_audit_mode
make test_explicit_restrict_mode
```

`make test_sandbox_unit` runs the sandbox action's Node.js unit tests
(`node --test 'sandbox/src/**/*.test.js'`); `make test_sandbox_mode` is the dev-loop end-to-end
check described above. The CI-only `test_sandbox` end-to-end job (real runner host, no nested
container) is described in [Sandbox Action Internals](#sandbox-action-internals) below.

## Explicit Engine Internals

This section covers how `proxy_engine: explicit` is implemented internally. For the user-facing
behavior — what's enforced, what's visible in the report — see
[Explicit Proxy Engine](./security.md#explicit-proxy-engine) in Security Details.

- A small statically-linked Go binary (`setup/docker/explicit/buildkit-proxy/`) is the image's entrypoint
  (PID 1) and directly supervises the real `buildkitd` as a child process. `RUN` steps are isolated
  into their own point-to-point network namespace by `proxyNetwork = true`, built directly on
  netlink/veth rather than CNI.
- At startup, the binary: writes `/etc/resolv.conf` from `EXTERNAL_RESOLVER` if that variable is
  set (otherwise the container's own resolv.conf, e.g. Docker's embedded DNS, is left untouched);
  runs a QuickJS script that compiles `allowed_https_rules` / `allowed_http_rules` /
  `allowed_ip_rules` (the exact same syntax as `transparent` mode — see
  [Rule Syntax](./rules.md)) into a BuildKit
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

## Sandbox Action Internals

This section covers how the `sandbox` action (`sandbox/`) is implemented internally. For the
user-facing behavior and threat model, see [Sandbox Action](./security.md#sandbox-action) in
Security Details and the [Reference](./reference.md#sandbox-action) doc.

- `sandbox/docker/` is a stripped-down build of the `transparent` engine's image with `buildkitd`
  removed entirely — only the bridge (`sandbox0`, not `buildkit0` — there's no BuildKit here to
  share the name with), iptables `REDIRECT`/`DROP` rules, dnsmasq, and HAProxy remain. Since
  BuildKit's CNI integration normally creates that bridge, a new `init-cni-bridge` s6 service
  (`sandbox/docker/files/s6-scripts/init-cni-bridge`) creates it directly via `ip link add ... type
  bridge` instead. `sandbox/docker/files/s6-scripts/init-iptables` is `setup/docker/transparent`'s
  script with the bridge name swapped; `init-haproxy-cfg`, `dnsmasq.conf`, and `haproxy.cfg.template`
  are unmodified copies.
- `sandbox/action.yml` is a `node24` action (`main` + `post`, mirroring `setup`'s shape). Each
  invocation is fully self-contained — `sandbox/src/main.js` verifies and pulls the proxy image
  (same Sigstore flow as `setup`, published under the `-sandbox` tag suffix — see
  `imageTagFromRef` in `core/lib/verify-image.js`), starts a uniquely-named throwaway proxy
  container, runs the isolated command, appends this step's report section to the Job Summary, and
  stops the container again, all inside `main`'s own `try`/`finally`. `sandbox/src/post.js` is a
  fallback only — it reads the container name and Compose project name back from `GITHUB_STATE`
  (`STATE_container_name`/`STATE_project_name`) and stops it, in case the process was killed before
  reaching `main`'s own `finally`. If `STATE_project_name` is missing, `post.js` skips cleanup
  entirely rather than falling back to an unscoped `docker compose down` (see below).
- Every `docker compose` invocation passes `-p <containerName>` (`lib/container.js`'s
  `deriveProjectName`, currently the identity function — container names and Compose project names
  live in separate Docker namespaces, so reusing the same string for both is safe and keeps
  `docker ps`/`docker network ls` output easy to correlate). This matters once GitHub Actions'
  `background`/`wait`/`parallel` step keywords let multiple `sandbox` steps in the same job run
  truly concurrently: without an explicit `-p`, Compose falls back to an implicit,
  directory-derived project name shared by every invocation, and it identifies "the" container for
  a service by its project+service label rather than by container name — so one step's `up`/`down`
  could recreate or tear down another step's still-running proxy container even though their
  container names never collide.
- The actual isolation is `sandbox/scripts/run-isolated.sh`, invoked via `sudo -n` since setting up
  namespaces/veth/iptables requires root:
  1. `unshare --net --pid --mount --uts --ipc --cgroup --mount-proc --fork -- sleep infinity` creates
     a placeholder process holding the new namespaces. `unshare --pid` doesn't move the caller
     itself into the new PID namespace — only the first forked child does — so the script discovers
     that child's host-visible PID via `/proc/<unshare-pid>/task/<unshare-pid>/children` before it
     can `nsenter` into it. Immediately after, `mount --make-rprivate /` (recursive) runs inside the
     placeholder's mount namespace: a cloned mount namespace starts out in the same propagation peer
     group as the one it was cloned from (typically "shared" under systemd), so without this, every
     mount change made in the steps below would propagate straight back out to the host's real mount
     namespace.
  2. A veth pair is created with one end moved into the placeholder's netns, the other moved
     directly into the (already-running) proxy container's netns and attached to its `sandbox0`
     bridge as a bridge port — the same role a BuildKit `RUN` step container's veth plays under
     `transparent` mode.
  3. `/etc/resolv.conf` is bind-mounted over inside the placeholder's mount namespace only; a
     handful of sensitive `/proc` paths are bind-mounted over with `/dev/null` the same way.
  4. The rest of the filesystem is then restricted to read-only, except `$GITHUB_WORKSPACE`, `$HOME`,
     `/tmp`, and any paths from the action's `writable` input (`--writable`, repeatable). Each of
     those is first bind-mounted onto itself, giving it its own mount-table entry, then every
     *other* existing mount is remounted read-only via `mount -o remount,bind,ro` — the `bind`
     there is required: a plain `remount,ro` changes the underlying filesystem's shared state
     (still shared with the host even after step 1's `make-rprivate`, since that only stops
     mount/unmount *event* propagation, not this kind of flag change), and would leak the read-only
     flag back to the host, whereas `remount,bind,ro` scopes it to this one mount entry only. A
     literal `/` among the `writable` paths is a sentinel that skips this whole step instead of
     bind-mounting "/" itself, since most paths below "/" aren't separate mount points and so
     wouldn't be covered by protecting "/" alone.
  5. The command finally executes via `nsenter --target <placeholder-pid> --net --mount --uts --ipc
     --cgroup --pid -- env -i "${ENV_ASSIGNMENTS[@]}" setpriv --reuid=<uid> --regid=<gid>
     --clear-groups --bounding-set=-all --no-new-privs -- <script>`. Environment variables are
     passed through a NUL-separated dump file, read into a bash array with `mapfile -d ''` and
     re-applied via `env -i`, rather than `sudo -E` (whose availability depends on a non-portable
     sudoers `SETENV` tag). `mapfile` is used instead of `xargs -0` specifically so the isolated
     command's real exit code survives: GNU xargs remaps any exit status 1-125 from the command it
     runs to its own fixed exit status 123.
  6. A `trap ... EXIT INT TERM` cleanup always removes the proxy-side veth and kills the placeholder
     — with `kill -9`, specifically: the placeholder is PID 1 of its own new PID namespace, and PID
     1 ignores the default-terminate action for signals it hasn't installed a handler for, so
     `SIGTERM` alone leaves it running forever. Only `SIGKILL` (which can't be caught or ignored)
     reliably tears it down.
- The report step (`sandbox/src/lib/report.js`) reuses `core/scripts/report.js` and
  `core/shared/lib/aggregate.js` unmodified via `docker exec <container> qjs -m
  /opt/buildcage/scripts/report.js` — the sandbox proxy always runs the `transparent`
  engine's HAProxy log format, so there's no `explicit`-engine branch to handle here the way
  `report/src/main.js` has to.

## Local Development

### Local testing of the setup/report/sandbox actions

Sigstore verification requires a real, published GHCR image, so the setup and sandbox actions
normally can't run against an unpublished branch or local changes. This repo's own CI (`test_action`
and `test_sandbox` jobs in `.github/workflows/test-e2e.yml`) tests the real `setup`/`report`/`sandbox`
actions end-to-end against a locally built image instead, via a build-time-gated mechanism:
`BUILDCAGE_BUILD_TEST_HOOKS=1 pnpm build` compiles `setup/dist/main.cjs` and `sandbox/dist/main.cjs`
where the `BUILDCAGE_LOCAL_IMAGE_REF` override is reachable. The override logic lives in its own
module (`core/lib/local-image-override.js`, shared by both actions), loaded only via a
dynamic `import()` gated by that build-time flag. Without the flag (i.e. every normal/committed
build), rollup's own module-graph tree-shaking excludes that entire file from the bundle — it's
physically absent, not just unreachable. A CI check (`unit_test` job) additionally confirms a normal
build never contains a live runtime read of `BUILDCAGE_BUILD_TEST_HOOKS` in either action's `dist`,
guarding against a future refactor silently breaking that guarantee.

To exercise it locally:

1. Build the image: `docker compose build` (set `PROXY_ENGINE` to select the engine, or `docker
   compose build sandbox` for the sandbox proxy image).
2. `BUILDCAGE_BUILD_TEST_HOOKS=1 pnpm build`
3. Run it with `BUILDCAGE_LOCAL_IMAGE_REF=<image ref from step 1>` set (e.g. via `act`, or by
   invoking `node setup/dist/main.cjs` / `node sandbox/dist/main.cjs` directly with the relevant
   `INPUT_*` env vars — note `sandbox`'s own isolation step still needs a real Linux host, so this
   only gets you past image verification, not a full local run on macOS). Never commit a
   `dist/main.cjs` built this way — run `pnpm build` again (without the flag) before committing.

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
source-policy engine. Allowed/audited requests are *not* read from this log file: BuildKit's own
"proxy network requests:" build output only ends up there if buildkitd runs with
`BUILDKIT_DEBUG_EXEC_OUTPUT=1`, which also mirrors every RUN step's own console output into the same
log. That data is instead fetched via `buildctl debug logs --progress=rawjson`, described below,
which needs no such flag. The `report` action reads whichever of transparent/explicit's two log files
exists for the denied side and raw console output, so `docker compose logs builder` and the `report`
action work unmodified against either engine.

The `explicit` engine's job summary builds its "Allowed"/"Audited Hosts" table, and a collapsed
**Communication details** section (a per-command breakdown `transparent` mode has no equivalent for),
from the same source: `report/src/lib/vertex-log.js` calls `buildctl debug histories` (to enumerate
*every* build recorded since the container started — a workflow may run several builds against the
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

| Command | Description |
|---------|-------------|
| `make help` | Show available commands |
| `make run_transparent_audit_mode` | Start transparent engine in audit mode |
| `make run_transparent_restrict_mode` | Start transparent engine in restrict mode (default domains) |
| `make run_explicit_audit_mode` | Start explicit proxy engine in audit mode |
| `make run_explicit_restrict_mode` | Start explicit proxy engine in restrict mode |
| `make test_transparent_audit_mode` | Run transparent-engine audit mode tests (start → build → verify → clean up) |
| `make test_transparent_restrict_mode` | Run transparent-engine restrict mode tests (start → build → verify → clean up) |
| `make test_explicit_audit_mode` | Run explicit-engine audit mode tests (start → build → verify → clean up) |
| `make test_explicit_restrict_mode` | Run explicit-engine restrict mode tests (start → build → verify → clean up) |
| `make run_sandbox_mode` | Start the sandbox action's proxy + mac-friendly dev-loop runner |
| `make test_sandbox_mode` | Run a sample isolated command in the dev loop and verify isolation |
| `make test_unit` | Run unit tests (includes `test_sandbox_unit`) |
| `make test_sandbox_unit` | Run the sandbox action's Node.js unit tests |
| `make clean` | Remove all resources |

## Directory Structure

```text
.
├── setup/                    # GitHub Actions setup action
│   ├── action.yml            # Action entry (node24 → dist/main.cjs, dist/post.cjs)
│   ├── src/                  # Source (ESM): verify image provenance, resolve image ref, compose up
│   ├── dist/                 # Bundled output (rollup → CommonJS)
│   ├── compose.yaml          # Runtime compose file the action itself uses (verified, digest-pinned
│   │                         # image ref) — distinct from the top-level compose.yaml below
│   ├── docker/               # proxy_engine build contexts
│   │   ├── transparent/      # proxy_engine: transparent — Dockerfile + BuildKit/haproxy/dnsmasq/
│   │   │                     # s6-overlay config
│   │   └── explicit/         # proxy_engine: explicit — Dockerfile + buildkit-proxy/ (Go module:
│   │                         # entrypoint/PID1, supervises buildkitd, injects the source policy
│   │                         # into Solve via a gRPC proxy) + scripts/ (QuickJS report/policy tools)
│   ├── test/                 # Dockerfile.*/assert-*.sh per {engine}-{mode} combination, plus
│   │                         # test-server(-explicit)/test-dns(-explicit) fixture containers
│   └── compose.test-*.yaml   # Test override config, one per engine
├── report/                   # GitHub Actions report action
│   ├── action.yml            # Action entry (node24 → dist/main.cjs)
│   ├── src/                  # Source (ESM): log analysis, per-command breakdown, Job Summary output
│   └── dist/                 # Bundled output (rollup → CommonJS)
├── sandbox/                  # GitHub Actions sandbox action (isolates an arbitrary run: command)
│   ├── action.yml            # Action entry (node24 → dist/main.cjs, dist/post.cjs)
│   ├── src/                  # Source (ESM): start proxy, run isolated command, report, stop
│   ├── dist/                 # Bundled output (rollup → CommonJS)
│   ├── scripts/run-isolated.sh  # unshare/veth/setpriv isolation, invoked via `sudo -n`
│   ├── compose.yaml          # Runtime compose file the action itself uses (verified, digest-pinned
│   │                         # image ref)
│   ├── docker/               # sandbox action's proxy image — transparent's bridge/iptables/
│   │                         # dnsmasq/HAProxy stack with buildkitd removed entirely
│   ├── test/                 # assert-sandbox*.sh (checks the sandbox action's Job Summary and
│   │                         # concurrent-execution behavior)
│   ├── compose.sandbox-dev.yaml  # Mac dev-loop overlay for the sandbox action (see dev/)
│   └── dev/                  # Mac dev-loop-only Dockerfile + smoke-test.sh (see
│                             # compose.sandbox-dev.yaml) — not used in production or CI
├── core/                     # Code shared across actions
│   ├── lib/                  # Image verification: Sigstore, OCI registry lookups, image ref
│   │                         # resolution, local-image test-hook override
│   ├── scripts/              # QuickJS report/rule-conversion scripts, run inside the built images
│   │                         # (COPYed into /opt/buildcage/scripts/)
│   └── shared/               # Rule/log parsing + aggregation shared by scripts/ and report/;
│                             # shared/test/ is a qjs test runner + node:test shim
├── docs/                     # development.md, rules.md, security.md, self-hosting.md
├── compose.yaml              # Docker Compose config for local dev (dockerfile path selected by
│                             # PROXY_ENGINE; also defines the local-dev `sandbox` service)
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
   make clean
   make run_transparent_audit_mode
   docker buildx build --builder buildcage --no-cache -f Dockerfile .
   docker compose logs builder
   ```

3. **TLS/certificate errors under `proxy_engine: explicit`**: if a `RUN` step fails with a
   certificate error there but works fine under `transparent` (or without Buildcage at all), the tool
   likely bundles its own CA store instead of consulting the system one BuildKit already trusts — see
   [CA Trust for Tools with Their Own CA Store](./reference.md#ca-trust-for-tools-with-their-own-ca-store)
   in the Reference doc.

4. **Open an issue** at [github.com/dash14/buildcage/issues](https://github.com/dash14/buildcage/issues) with:
   - Your Dockerfile
   - The audit mode report output
   - Full error messages from `docker compose logs builder`
