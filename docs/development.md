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

The `run` action's own isolation mechanism (`run-isolated.sh`) uses Linux-only primitives
(`ip netns`, `nsenter`, `runc`) that can't run natively on macOS. `make run_sandbox_mode` /
`make test_sandbox_mode` instead drive it from inside a container with `pid: host` (see
`run/dev/Dockerfile` and `run/compose.sandbox-dev.yaml`), which can see the proxy
container's PID/netns via `/proc` — close enough to the real "runner host + separate proxy
container" arrangement for day-to-day iteration, though it can't validate the container-boundary
parts of production (see [Run Action Internals](#run-action-internals) below). `runc` and
`gen-seccomp-profile` are built directly into the dev-loop image (mirroring `run/docker/Dockerfile`)
rather than `docker cp`-extracted from the proxy image at runtime, so the dev loop doesn't need the
Docker socket mounted in just to reach a sibling container; `run/dev/build-test-bundle.sh` stands in
for `isolated-exec.js`'s `buildOciConfig` to build a minimal OCI bundle for the smoke test. CI's
`test_sandbox_*` e2e jobs run `run-isolated.sh` directly on the runner host instead, matching
production exactly — treat those as the final word on whether a change actually works, not this
dev loop.

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

`make test_sandbox_unit` runs the run action's Node.js unit tests
(`node --test 'run/src/**/*.test.js'`); `make test_sandbox_mode` is the dev-loop end-to-end
check described above; `make test_sandbox_integration` drives `run/dist/main.cjs` directly for
checks that don't depend on the real action wrapper (see `run/test/integration-test-*.sh`) and
is what CI's `test_sandbox` job in `test-integration.yml` runs. The CI-only `test_sandbox_*`
end-to-end jobs (real runner host, no nested container) are described in
[Run Action Internals](#run-action-internals) below.

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

## Run Action Internals

This section covers how the `run` action (`run/`) is implemented internally. For the
user-facing behavior and threat model, see [Run Action](./security.md#run-action) in
Security Details and the [Reference](./reference.md#run-action) doc.

- `run/docker/` is a stripped-down build of the `transparent` engine's image with `buildkitd`
  removed entirely — only the bridge (`sandbox0`, not `buildkit0` — there's no BuildKit here to
  share the name with), iptables `REDIRECT`/`DROP` rules, dnsmasq, and HAProxy remain. Since
  BuildKit's CNI integration normally creates that bridge, a new `init-cni-bridge` s6 service
  (`run/docker/files/s6-scripts/init-cni-bridge`) creates it directly via `ip link add ... type
  bridge` instead. `run/docker/files/s6-scripts/init-iptables` is `setup/docker/transparent`'s
  script with the bridge name swapped; `init-haproxy-cfg`, `dnsmasq.conf`, and `haproxy.cfg.template`
  are unmodified copies.
- `run/action.yml` is a `node24` action (`main` + `post`, mirroring `setup`'s shape). Each
  invocation is fully self-contained — `run/src/main.js` verifies and pulls the proxy image
  (same Sigstore flow as `setup`, published under the `-proxy` tag suffix — see
  `imageTagFromRef` in `core/lib/verify-image.js`), starts a uniquely-named throwaway proxy
  container, runs the isolated command, appends this step's report section to the Job Summary, and
  stops the container again, all inside `main`'s own `try`/`finally`. `run/src/post.js` is a
  fallback only — it reads the container name and Compose project name back from `GITHUB_STATE`
  (`STATE_container_name`/`STATE_project_name`) and stops it, in case the process was killed before
  reaching `main`'s own `finally`. If `STATE_project_name` is missing, `post.js` skips cleanup
  entirely rather than falling back to an unscoped `docker compose down` (see below).
- Every `docker compose` invocation passes `-p <containerName>` (`lib/container.js`'s
  `deriveProjectName`, currently the identity function — container names and Compose project names
  live in separate Docker namespaces, so reusing the same string for both is safe and keeps
  `docker ps`/`docker network ls` output easy to correlate). This matters once GitHub Actions'
  `background`/`wait`/`parallel` step keywords let multiple `run` steps in the same job run
  truly concurrently: without an explicit `-p`, Compose falls back to an implicit,
  directory-derived project name shared by every invocation, and it identifies "the" container for
  a service by its project+service label rather than by container name — so one step's `up`/`down`
  could recreate or tear down another step's still-running proxy container even though their
  container names never collide.
- The actual isolation is `runc` (the OCI reference runtime), driven by an OCI bundle
  (`config.json`) that `run/src/lib/isolated-exec.js` builds in JS and `run/scripts/run-isolated.sh`
  (invoked via `sudo -n`, since setting up the netns/veth/rootfs bind-mount requires root) hands off
  to. Namespaces, capabilities, mounts, uid/gid, and the seccomp filter are all declared in
  `config.json` and enforced by runc itself — `run-isolated.sh`'s own job is only what runc can't do:
  1. `runc` and `gen-seccomp-profile` (see below) are `docker cp`-extracted from the already-running
     proxy container onto the runner host and run natively there — not `docker exec`'d inside the
     container — since their output depends on the real host's architecture/kernel, which only
     matches when they actually run on it. `getOrPopulateBootstrapCache` (in `isolated-exec.js`)
     caches the extracted `runc` binary and the resolved seccomp profile/base OCI spec under a
     digest-keyed directory in `tmpdir()`, reused across every `run:` step in the same job instead of
     redoing this extraction from scratch each time — but the actual `runc` binary handed to
     `run-isolated.sh` is always a fresh copy into that run's own scratch dir, never a path into the
     shared cache directly (see the function's own doc comment for why: a shared, long-lived binary
     path would stay "busy" inside every concurrently running sandbox's `mount --rbind /` rootfs
     snapshot, not just the one using it).
  2. `isolated-exec.js` generates a baseline OCI spec via `runc spec` (rather than hand-writing one
     from scratch, so the mount/rlimit/etc. defaults stay whatever runc itself considers sane for its
     own version) and patches it: `root.path` to a not-yet-created bind-mount directory, `root.readonly`
     plus `rw` mount overrides for `$GITHUB_WORKSPACE`/`$HOME`/`/tmp`/`writable` paths (a literal `/`
     among them disables the read-only root entirely, per the `writable` input), `process.capabilities`
     fully emptied, `process.noNewPrivileges`, `process.user` (uid/gid preserved, no `additionalGids`),
     `process.env` replaced with the step's real environment, `linux.namespaces`' network entry given a
     `path` pointing at a netns `run-isolated.sh` will create, `linux.seccomp` set to the resolved
     profile, and `linux.maskedPaths` extended with a few sensitive `/proc` paths runc's own defaults
     don't cover. `process.args` wraps the script in `setpriv --pdeathsig=KILL --` (see step 6).
  3. Before anything else, `run-isolated.sh` re-execs itself into a fresh, private mount namespace
     (`unshare --mount --propagation private`, no `--fork` — same PID throughout, so
     `integration-test-die-with-parent.sh`'s pgrep-based lookup still matches). Without this, its
     later `mount --rbind /` staging (step 5) would run directly in the one mount namespace shared by
     every concurrently running `run:` step on the host: since each step's own scratch dir lives under
     the same `/tmp`, each step's `--rbind` snapshot would unavoidably capture a nested copy of every
     *other* concurrently running step's own rootfs tree too, which was empirically the root cause of
     an intermittent `EBUSY` race in `withScratchDir`'s cleanup under concurrent `run:` steps — the
     same staging pattern tools like bubblewrap use to avoid it.
  4. `run-isolated.sh` creates the network namespace with `ip netns add` (not a placeholder process —
     unlike a namespace held open by a live process, `ip netns add`'s bind-mount at
     `/var/run/netns/<name>` persists on its own), creates a veth pair with one end moved into that
     netns and the other into the (already-running) proxy container's netns, attached to its
     `sandbox0` bridge as a bridge port — the same role a BuildKit `RUN` step container's veth plays
     under `transparent` mode.
  5. It bind-mounts the host's own `/` onto a fresh directory (`mount --rbind`) for runc's
     `root.path` — `pivot_root` can't target `/` itself. No separate `mount --make-rprivate` is
     needed for this bind-mount specifically: every mount created under an already-private namespace
     (step 3) is private by default. `resolv.conf` and the sensitive-`/proc`-path masking no longer
     need separate bind-mount steps here — they're declared in `config.json`'s
     `mounts`/`linux.maskedPaths` and applied by runc itself when it sets up the container's own
     mount namespace.
  6. The command finally executes via `setpriv --pdeathsig=KILL -- runc run --bundle <dir>
     <container-id>` — no `nsenter --net=...` wrapper needed, since `config.json`'s namespace `path`
     already tells runc which netns to join itself. The outer `setpriv --pdeathsig` (targeting
     `run-isolated.sh`'s own life) and the inner one baked into `process.args` (targeting `runc
     run`'s life) form a two-hop die-with-parent chain: `runc run`'s own process sits between
     `run-isolated.sh` and the container's init process, so a single-hop guard on just one end
     wouldn't tie the whole tree's life together.
  6. A `trap ... EXIT INT TERM` cleanup runs `runc delete -f` (also kills the container if the trap
     fired mid-run), unmounts the rootfs bind-mount, removes the proxy-side veth, and deletes the
     netns.
- `run/docker/gen-seccomp-profile/` is a small pure-Go tool (`CGO_ENABLED=0`, cross-compiles the same
  way `buildkit-proxy` does) that resolves `moby/profiles`' Docker default seccomp profile into the
  OCI form `config.json` expects, via the exported `GetDefaultProfile` — against a synthetic spec
  with an empty capability set, matching the sandboxed process. It's built into the proxy image but
  deliberately *run* on the runner host rather than at image-build time or via `docker exec`: its
  output depends on the actual architecture and kernel of whatever machine runs it (a handful of
  Docker's profile rules are gated on kernel version via a real `uname(2)` call), so it has to
  execute on the real target to be correct.
- The report step (`run/src/lib/report.js`) reuses `core/scripts/report.js` and
  `core/shared/lib/aggregate.js` unmodified via `docker exec <container> qjs -m
  /opt/buildcage/scripts/report.js` — the proxy always runs the `transparent`
  engine's HAProxy log format, so there's no `explicit`-engine branch to handle here the way
  `report/src/main.js` has to.

## Local Development

### Local testing of the setup/report/run actions

Sigstore verification requires a real, published GHCR image, so the setup and run actions
normally can't run against an unpublished branch or local changes. This repo's own CI (`test_action`
and `test_sandbox_*` jobs in `.github/workflows/test-e2e.yml`) tests the real `setup`/`report`/`run`
actions end-to-end against a locally built image instead, via a build-time-gated mechanism:
`BUILDCAGE_BUILD_TEST_HOOKS=1 pnpm build` compiles `setup/dist/main.cjs` and `run/dist/main.cjs`
where the `BUILDCAGE_LOCAL_IMAGE_REF` override is reachable. The override logic lives in its own
module (`core/lib/local-image-override.js`, shared by both actions), loaded only via a
dynamic `import()` gated by that build-time flag. Without the flag (i.e. every normal/committed
build), rollup's own module-graph tree-shaking excludes that entire file from the bundle — it's
physically absent, not just unreachable. A CI check (`unit_test` job) additionally confirms a normal
build never contains a live runtime read of `BUILDCAGE_BUILD_TEST_HOOKS` in either action's `dist`,
guarding against a future refactor silently breaking that guarantee.

To exercise it locally:

1. Build the image: `docker compose build` (set `PROXY_ENGINE` to select the engine, or `docker
   compose build proxy` for the proxy image).
2. `BUILDCAGE_BUILD_TEST_HOOKS=1 pnpm build`
3. Run it with `BUILDCAGE_LOCAL_IMAGE_REF=<image ref from step 1>` set (e.g. via `act`, or by
   invoking `node setup/dist/main.cjs` / `node run/dist/main.cjs` directly with the relevant
   `INPUT_*` env vars — note `run`'s own isolation step still needs a real Linux host, so this
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
| `make run_sandbox_mode` | Start the run action's proxy + mac-friendly dev-loop runner |
| `make test_sandbox_mode` | Run a sample isolated command in the dev loop and verify isolation |
| `make test_unit` | Run unit tests (includes `test_sandbox_unit`) |
| `make test_sandbox_unit` | Run the run action's Node.js unit tests |
| `make test_sandbox_integration` | Run the run action's integration tests (needs `BUILDCAGE_LOCAL_IMAGE_REF` and a test-hook build of `run/dist/main.cjs`) |
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
├── run/                      # GitHub Actions run action (isolates an arbitrary run: command)
│   ├── action.yml            # Action entry (node24 → dist/main.cjs, dist/post.cjs)
│   ├── src/                  # Source (ESM): start proxy, run isolated command, report, stop
│   ├── dist/                 # Bundled output (rollup → CommonJS)
│   ├── scripts/run-isolated.sh  # netns/veth/rootfs-bind setup around `runc run`, invoked via
│   │                         # `sudo -n` (see Run Action Internals)
│   ├── compose.yaml          # Runtime compose file the action itself uses (verified, digest-pinned
│   │                         # image ref)
│   ├── docker/               # run action's proxy image — transparent's bridge/iptables/
│   │                         # dnsmasq/HAProxy stack with buildkitd removed entirely, plus a
│   │                         # checksum-pinned runc binary and the gen-seccomp-profile/ Go tool
│   ├── test/                 # assert-sandbox*.sh + integration-test-*.sh (capability/filesystem/
│   │                         # seccomp/die-with-parent checks driving run/dist/main.cjs directly)
│   ├── compose.sandbox-dev.yaml  # Mac dev-loop overlay for the run action (see dev/)
│   └── dev/                  # Mac dev-loop-only Dockerfile + smoke-test.sh + build-test-bundle.sh
│                             # (see compose.sandbox-dev.yaml) — not used in production or CI
├── core/                     # Code shared across actions
│   ├── lib/                  # Image verification: Sigstore, OCI registry lookups, image ref
│   │                         # resolution, local-image test-hook override
│   ├── scripts/              # QuickJS report/rule-conversion scripts, run inside the built images
│   │                         # (COPYed into /opt/buildcage/scripts/)
│   └── shared/               # Rule/log parsing + aggregation shared by scripts/ and report/;
│                             # shared/test/ is a qjs test runner + node:test shim
├── docs/                     # development.md, rules.md, security.md, self-hosting.md
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
