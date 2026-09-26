# Development Guide

This document covers local development, testing, and the project structure of Buildcage.

## Contents

- [Local Usage](#local-usage)
- [Testing](#testing)
- [Local Development](#local-development)
- [Formatting & Linting](#formatting--linting)
- [Viewing Logs](#viewing-logs)
- [Makefile Commands](#makefile-commands)
- [Directory Structure](#directory-structure)
- [Troubleshooting](#troubleshooting)

## Local Usage

You can run Buildcage locally without GitHub Actions using Docker Compose and Make.

GitHub Actions inputs are lowercase (`proxy_mode`); the environment variables for local usage are
the uppercase form of the same names (`PROXY_MODE`).

### Starting the Builder

There's one `setup_buildkit_{engine}_{mode}` target per (`universal`, `inspect`) x
(`audit`, `restrict`) combination:

```bash
make setup_buildkit_universal_audit
make setup_buildkit_universal_restrict
make setup_buildkit_inspect_audit
make setup_buildkit_inspect_restrict
```

**Start with custom domains** (restrict mode only):

```bash
ALLOWED_HTTPS_RULES="github.com:443 npmjs.org:443 example.com:443" make setup_buildkit_universal_restrict
```

Each target sets `PROXY_ENGINE`, which picks the build context at image build time through
`compose.yaml`'s `build.dockerfile: docker/${PROXY_ENGINE:-inspect}/Dockerfile` (see
[Engines](../README.md#engines)).

`EXTERNAL_RESOLVER` is the one variable here with no action input behind it: the action pins it empty
(`src/lib/compose-env.ts`), and locally it takes a comma-separated list of IPv4 addresses for HAProxy
to resolve against in place of the container's own `/etc/resolv.conf`. The integration tests set it
to reach their own fixture resolver.

### End-to-End Workflow

```bash
# 1. Start Buildcage
make setup_buildkit_universal_audit

# 2. Build
docker buildx build --builder buildcage --progress=plain -f Dockerfile .

# 3. View report
make report_buildkit

# 4. Clean up
make clean_buildkit
```

`make report_buildkit` runs `node report/src/main.ts` with the same `COMPOSE_PROJECT_NAME`/`BUILDCAGE_BUILD_TEST_HOOKS`
override the `setup_buildkit_*`/`clean_buildkit` targets use (see the pattern rule near the top of the
Makefile). Running `node report/src/main.ts` directly, without going through `make`, won't find the
running builder container. Raw builder logs are also available via `docker compose logs builder`.

## Testing

Most `setup_buildkit_{engine}_{mode}` targets have a matching
`test_integration_buildkit_{engine}_{mode}` target (start → build the matching
`test/Dockerfile.*` → verify → clean up):

```bash
make test_integration_buildkit_universal_audit
make test_integration_buildkit_universal_restrict
make test_integration_buildkit_inspect_restrict
# Debian/apt build, which starts with no CA store at all
make test_integration_buildkit_inspect_debian_audit
make test_integration_buildkit_inspect_debian_restrict
# Asserts an inspect audit run, then enforces the rules it generated unedited.
# There is no inspect_audit target of its own: this builds the same
# test/Dockerfile.inspect-audit in the same audit mode, so the audit-mode
# assertions belong to its first phase.
make test_integration_buildkit_inspect_roundtrip
# known_blocked_rules against fail_on_blocked, both matched and unmatched
make test_integration_buildkit_universal_known_blocked
# Builds for the host's architecture and for the other one
make test_integration_buildkit_multiarch
# Brings the builder up alone, with no build running, and probes :10024/:53
# from the compose network and from the host -- both engines
make test_integration_buildkit_listener_scope
```

CI runs these same targets, one job per target (`.github/workflows/test-integration.yml`), so
`make test_integration_buildkit` and a pull request's integration run cover the same set. The one
difference is the architecture they build for: `TEST_PLATFORM` is `linux/arm64` for the development
machines, and CI overrides it with the runner's own.

### Unit test coverage

`make test_unit_coverage` runs every Node-side unit test in a single vitest pass and writes a
report to `coverage/`. CI runs the same target and pastes `coverage/summary.txt` into the job
summary. The threshold is 100% on all four counters, so anything added without a test fails the
run. Code that is deliberately not tested carries a `/* v8 ignore */` comment saying why, which
keeps that decision in the source rather than buried in a percentage. Only two things qualify: code
whose body lives outside the process, and the default implementation behind a seam whose callers
are already tested.

`make test_unit_go_coverage` does the same for `buildcage-runc`: `go test -coverprofile`, then
`test/covfilter` over the result, which drops the blocks `//coverage:ignore start` / `stop` markers
cover and holds what is left to `RUNC_COVERAGE_THRESHOLD` in the Makefile. The threshold is 100. A
marker covering a statement the tests do reach, or covering none at all, fails the run the same way
a gap does, so the list of what is deliberately untested cannot quietly stop being true. Go measures
statements rather than branches, so even at 100 this is a weaker claim than the Node side's.

The QuickJS run (`make test_unit_qjs`) is not measured separately. It executes the same `.test.ts`
files as the Node run, so `src/core/lib/acl/`'s line coverage is already accounted for above.

### Running the suite from several git worktrees

One Docker daemon serves every worktree and namespaces nothing per worktree: the
builder container, the buildx builder, the Compose project and the built image
all have one fixed name, so a second worktree's `setup_buildkit_*` tears down the
first one's builder without saying so.

The fixtures' addresses are not part of that problem. Each assigns its own
`10.200.0.x` inside its own network namespace instead of taking one from Compose
IPAM (see each fixture's entrypoint, and `test/test-net-addr/attach.sh`, which the test overlays
wrap the builder's own entrypoint with),
so the daemon never allocates `10.200.0.0/24` and every worktree uses the same
addresses. That is why the assertions name those addresses literally.

A fresh worktree needs `vp install` before any target that runs `report/src` or
`src/post.ts`: `node_modules` is per checkout, and the integration targets run
both straight from source.

Nothing has to be configured for it. The Makefile takes the worktree's name from
`git rev-parse --git-dir` and suffixes the builder, the buildx builder, the
Compose project, the image tags and the `/tmp` paths with it, so a worktree named
`wt2` uses `buildcage-wt2` and `buildcage-project-wt2`. The main checkout has no
worktree name and keeps the unsuffixed names used everywhere else in this
document. `BUILDCAGE_WORKTREE_SUFFIX` and `TEST_NET_SUBNET` override the derived values.

`test-net`'s subnet comes from the same name, and appears in no assertion. It is
pinned rather than left to Docker because `test/test-net-addr` finds the
builder's interface on it by that subnet. Two worktrees whose names happen to
pick the same subnet fail with `Pool overlaps with other one on this address
space`; rename one, or set `TEST_NET_SUBNET`.

The builder's CNI bridge is `198.19.255.0/24`, from the `198.18.0.0/15` block
RFC 2544 reserves for benchmarking: outside Docker's default address pools, so
no network Docker allocates on its own overlaps it. A daemon whose
`default-address-pools` covers that range can still hand it to the Compose
`default` network, and a network shadowed that way is unreachable from inside
the builder. If the builder starts failing to reach the network for no apparent
reason, check that subnet with `docker network inspect`.

## Local Development

Local Usage above runs the builder image. This is about running the setup and report actions
themselves against changes that aren't published yet.

Sigstore verification requires a real, published GHCR image, so the setup action normally can't
run against an unpublished branch or local changes. This repo's own CI (`test_action` job in
`.github/workflows/test-e2e.yml`) tests the real `setup`/`report` actions end-to-end against a
locally built image instead, via a build-time-gated mechanism: `BUILDCAGE_BUILD_TEST_HOOKS=1 vp run
build` compiles `dist/main.cjs` where the `BUILDCAGE_LOCAL_IMAGE_REF` override is reachable.
The override logic lives in its own module (`src/core/lib/provenance/local-image-override.ts`), loaded
only via a dynamic `import()` gated by that build-time flag. Without the flag (i.e. every
normal/committed build), rolldown's own module-graph tree-shaking excludes that entire file from
the bundle. It is physically absent, not just unreachable. A CI check (`unit_test` job)
additionally confirms a normal build never contains a live runtime read of
`BUILDCAGE_BUILD_TEST_HOOKS` in `dist`, guarding against a future refactor silently breaking
that guarantee.

To exercise it locally:

1. Build the image: `docker compose build` (set `PROXY_ENGINE` to select the engine).
2. `BUILDCAGE_BUILD_TEST_HOOKS=1 vp run build`
3. Run it with `BUILDCAGE_LOCAL_IMAGE_REF=<image ref from step 1>` set (e.g. via `act`, or by
   invoking `node dist/main.cjs` directly with the relevant `INPUT_*` env vars). Never commit a
   `dist/main.cjs` built this way: run `vp run build` again (without the flag) before committing.

See [security.md](./security.md#verification-limitations) for more details.

## Formatting & Linting

Formatting, linting, and type-aware linting are handled by [vp (Vite+)](https://viteplus.dev/),
installed globally on your machine like `pnpm`/`corepack` rather than through `pnpm exec`:

```bash
curl -fsSL https://vite.plus | bash   # macOS/Linux
# Windows: irm https://viteplus.dev/install.ps1 | iex
```

The project pins its own toolchain version via the `vite-plus` devDependency in `package.json`
(the same way `packageManager` pins `pnpm`), and the globally installed `vp` binary detects and
delegates to that pinned version automatically, so plain `vp ...` commands are reproducible without
going through `pnpm exec`. This was verified against `vp v0.2.7` / local `vite-plus
v0.2.5`; if a much newer `vp` behaves differently, that's the version to compare against.

```bash
vp check       # format + lint + type-aware lint (read-only; what CI runs)
vp check --fix # same, but auto-fixes format/lint issues in place
vp lint --fix
vp fmt --write
```

`vp run typecheck` (`tsc`) remains the authoritative full type check; `vp check`'s type-aware
linting (via `oxlint-tsgolint`) catches a subset of type-driven issues fast but doesn't replace it.

Running `vp install` (in place of `pnpm install`) automatically sets up a pre-commit hook, via the
`prepare` script, that formats and lints your staged files (`vite.config.ts`'s `staged` config)
before each commit, auto-fixing and re-staging what it can.

## Viewing Logs

```bash
# All communication logs
docker compose logs builder

# Real-time log monitoring
docker compose logs -f builder
```

**Log format (`universal`):**

```
buildcage 1787471970500 [ALLOWED] (HTTPS) "github.com:443" - 1024
buildcage 1787471971200 [BLOCKED] (HTTPS) "malicious.com:443" not-allowed 0
buildcage 1787471972000 [AUDIT] (HTTP) "npmjs.org:80" - 812
```

Fields: `buildcage <epoch-ms> [status] (rule) "domain:port" reason bytes`. The
millisecond epoch orders the timeline and times each line against the startup
marker; `bytes` is `%B`, the only per-connection detail a passthrough sees.

`universal` also reads the resolver's log (`/var/log/coredns`), since a name CoreDNS refused never
reaches HAProxy at all: it is the only trace of a name looked up but never connected to.

**`inspect`'s proxy log is richer**, since it terminates TLS and sees each request whole; it reads the
same resolver log alongside it:

```bash
docker compose exec builder cat /var/log/haproxy/current
docker compose exec builder cat /var/log/coredns/current
```

HAProxy's log carries one line per request, oldest first, with its method, status, size, the `Host`
header it carried, and its request target last:

```
buildcage 1787471975123 https GET 200 708 ts=-- reason=- tlserr=- dst=104.16.1.34:443 sni=registry.npmjs.org host=registry.npmjs.org /express
buildcage 1787471976000 pass tls 3421 ts=-- reason=- dst=10.200.0.100:5432 sni=db.example.com
```

`host` and the target are two fields rather than one URL because a request target need not be a
path: `OPTIONS *` and a `CONNECT`'s authority are both legal, and both leave the target as `-`, so a
reader splitting a URL back apart would take the host for `registry.npmjs.org-`. A missing `Host`
prints as `-` too.

`ts` is HAProxy's termination state and `reason` the refusal reason where the rule that refused
knew one the line could not otherwise show. `tlserr` carries haproxy's own error from the handshake
with the origin, which is what tells a connection the proxy would not make from one it could not
make; the passthrough stage terminates no TLS and logs no such field.

What the report makes of those is in
[Requests that never arrived whole](./reference.md#requests-that-never-arrived-whole), for a
connection that never delivered a whole request, and in
[Connections that failed](./reference.md#connections-that-failed), for one the rules allowed that
then came to nothing.

Each log is an s6-log directory rather than a single file: `current` rotates into a timestamped
archive once it crosses 1MB, up to 100 archives kept, and a line is only ever split past 32KB. The
report reads every archive, oldest first, then `current`, so early traffic is never dropped just
because a later part of the same run pushed the log past a rotation. Reading `current` by hand, as
above, only shows what has accumulated since the most recent one.

HAProxy writes to s6-log through a pipe without blocking, so a line it cannot write at once is
dropped rather than delayed, and nothing in the log marks where. A thread that keeps finding another
mid-write on the pipe drops its line, so HAProxy runs one thread (`nbthread 1`). A stalled s6-log
can still fill the pipe, so `pipesz` widens it from 64KB to 1MB before HAProxy starts. HAProxy
counts the lines it drops itself: its `health` socket serves the Prometheus exporter, and the report
reads `haproxy_process_dropped_logs_total` from it. A nonzero count, or one the report cannot read,
marks the report incomplete. To read it by hand:

```bash
docker compose exec builder curl -s --unix-socket /var/run/haproxy-health.sock \
  'http://localhost/metrics?scope=global' | grep dropped_logs
```

## Makefile Commands

`make help` lists every target with its own description. The ones you type most:

| Command                                          | Description                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `make setup_buildkit_{engine}_{mode}`            | Start a builder, for any engine x `{audit,restrict}`                   |
| `make report_buildkit`                           | Show the report for the currently running builder                      |
| `make clean_buildkit`                            | Stop and remove the builder's containers/images and the buildx builder |
| `make test_unit`                                 | Every unit test, the QuickJS ones included (needs Docker)              |
| `make test_unit_coverage`                        | Every Node unit test in one run, with a coverage report                |
| `make test_unit_go_coverage`                     | buildcage-runc's tests, with its filtered coverage checked             |
| `make test_integration_buildkit`                 | Every `test_integration_buildkit_*` target in turn                     |
| `make test_integration_buildkit_{engine}_{mode}` | One engine and mode (start, build, verify, clean up)                   |
| `make seccomp_profile`                           | Re-vendor the builder's seccomp profile from moby/profiles             |

The integration set also holds `inspect_debian_{audit,restrict}` (an apt build that starts with no
CA store), `inspect_roundtrip` (learn rules from an audit run, then enforce them unedited),
`inspect_byte_exact`, `universal_restrict_no_traffic`, `universal_known_blocked` and `multiarch`.

## Directory Structure

```text
.
├── action.yml                # Setup action entry (node24 → dist/main.cjs, dist/post.cjs)
├── src/                      # Setup action source (ESM): verify provenance, resolve the image
│   │                         # ref, compose up. src/main.ts is only the entry guard
│   ├── lib/                  # The setup action's own modules; setup-step.ts is the step itself
│   └── core/                 # Code shared across both actions
│       ├── lib/              # acl/ (rule parsing and the proxy config generators) is built for
│       │                     # both runtimes, and so is anything it imports — errors.ts today.
│       │                     # log/, report/, docker/, provenance/ and actions/ are Node-only,
│       │                     # and test/test-shim.ts is the node:test-alike shim *.test.ts uses
│       │                     # under either runtime
│       └── scripts/          # QuickJS entry points, rolldown-bundled into
│                             # /opt/buildcage/scripts/ at image build time
├── dist/                     # Bundled output (rolldown → CommonJS), committed. dist/qjs,
│                             # dist/qjs-test and dist/report-action are gitignored scratch
├── docker/                   # proxy_engine build contexts
│   ├── compose.action.yaml   # Runtime compose file the action uses (verified, digest-pinned
│   │                         # image ref), distinct from the top-level compose.yaml below
│   ├── seccomp/              # The builder container's seccomp profile and gen-profile.mjs,
│   │                         # read by the Docker client on the runner, not copied into an image
│   ├── universal/            # proxy_engine: universal — BuildKit, HAProxy, CoreDNS, s6-overlay
│   └── inspect/              # proxy_engine: inspect — HAProxy, CoreDNS, s6-overlay, and
│                             # buildcage-runc/ (Go module: CA trust at exec time)
├── test/                     # Dockerfile.*/assert-*.sh per {engine}-{mode}, plus the fixture
│                             # containers. helpers.sh carries what every assert script shares
├── compose.test-*.yaml       # Test override config, one per engine
├── report/                   # Report action: action.yml, src/ (ESM), dist/ (rolldown → CommonJS)
├── docs/                     # development.md, security.md, plus the
│                             # reference.md/rules.md/inspect-engine.md link stubs
├── licenses/                 # gen-license-file.mjs, which regenerates THIRD_PARTY_LICENSES_NPM
│                             # during `vp run build`, and what .glf.jsonc substitutes in
├── compose.yaml              # Local-dev compose config (dockerfile selected by PROXY_ENGINE)
└── Makefile                  # Operational commands
```

Every engine directory carries a `scripts/` of its own. `report-action.node.ts` is in both, and
runs under Node on the runner after the report action copies it out of the image. `inspect` also has
a QuickJS entry point beside it (`gen-configs.qjs.ts`), so that directory is a second QuickJS build
target alongside `src/core/scripts/`; `tsconfig.qjs.json` names both.

`buildcage-runc` takes `go-pkcs12` from the
[buildcage/go-pkcs12](https://github.com/buildcage/go-pkcs12) fork through a `replace` in its
`go.mod`. The fork adds `DecodeTrustStoreEntries`, since a keystore rewrite must keep the aliases,
and `MaxIterations`, which the sweep sets to a million so a keystore naming more key-derivation
iterations is left unread instead of stalling the build. Its `vX.Y.Z-buildcage.N` tags are upstream
`vX.Y.Z` plus those additions.

## Troubleshooting

If you encounter issues, try reproducing the problem locally to get detailed logs:

1. **Check logs:**

   ```bash
   docker compose logs builder
   ```

2. **Run in audit mode** to understand your build's network behavior:

   ```bash
   make clean_buildkit
   make setup_buildkit_universal_audit
   docker buildx build --builder buildcage --no-cache -f Dockerfile .
   docker compose logs builder
   ```

3. **TLS/certificate errors under `proxy_engine: inspect`**: if a `RUN` step fails with a
   certificate error there but works fine under `universal`, the tool likely pins a certificate or
   ships its own trust store rather than reading the CA-trust environment variables Buildcage sets.
   A JVM already in the base image is handled (`buildcage-runc` injects into its
   `$JAVA_HOME/lib/security/cacerts`, JKS or PKCS#12); a keystore sealed with a password other than
   the JDK default still needs `universal`. Chromium is handled too (its NSS database is covered
   with one holding the CA); a step that writes to that database fails with "changed the NSS
   database". See [Limitations](../README.md#limitations).

4. **The setup step fails with "never became ready"**: the builder came up but `buildctl debug
workers` never succeeded inside it. The step prints the container log; locally:

   ```bash
   docker inspect --format '{{json .State.Health}}' buildcage
   ```

5. **Open an issue** at [github.com/buildcage/docker/issues](https://github.com/buildcage/docker/issues) with:
   - Your Dockerfile
   - The audit mode report output
   - Full error messages from `docker compose logs builder`
