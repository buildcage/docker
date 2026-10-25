# Development Guide

This page is for working on Buildcage itself: setting up, finding your way around the repository,
running and testing it locally, and what to keep in mind when changing it. What Buildcage does is
in the [README](../README.md), the [Reference](./reference.md) and the
[Security Details](./security.md).

## Contents

- [Getting set up](#getting-set-up)
- [Repository layout](#repository-layout)
- [Running it locally](#running-it-locally)
- [Testing](#testing)
- [Rules when changing code](#rules-when-changing-code)
- [Debugging](#debugging)

## Getting set up

The toolchain is [vp (Vite+)](https://viteplus.dev/), installed globally:

```bash
curl -fsSL https://vite.plus | bash   # macOS/Linux
# Windows: irm https://viteplus.dev/install.ps1 | iex
```

`vp` delegates to the version the `vite-plus` devDependency in `package.json` pins, so plain
`vp …` commands are reproducible. Run `vp install`, not `pnpm install`, in each checkout: it
installs `node_modules` and sets up a pre-commit hook that formats and lints the staged files
(`vite.config.ts`'s `staged` config), fixing and re-staging what it can. The builder, the QuickJS
unit tests and the integration tests also need Docker, and `buildcage-runc`'s tests need Go.

```bash
vp check          # format, lint and type-aware lint, read-only (what CI runs)
vp check --fix    # the same, fixing what it can
vp run typecheck  # tsc, the authoritative type check
vp run build      # rolldown → the committed dist/ bundles
```

`vp check`'s type-aware lint catches a subset of type errors quickly but does not replace
`vp run typecheck`. Build with `vp run build`, never `vp build`.

## Repository layout

```text
.
├── action.yml              # Setup action entry (node24 → dist/main.cjs, dist/post.cjs)
├── src/                    # Setup action source (ESM); src/main.ts is only the entry guard
│   ├── lib/                # The setup action's own modules; setup-step.ts is the step itself
│   ├── report/             # Report code only this action needs (#report/*)
│   └── core/
│       ├── lib/            # acl/ and what it imports also run under QuickJS; the rest is Node-only
│       └── scripts/        # QuickJS only: the config generators, the test runner, qjs's types
├── dist/                   # Bundled output (rolldown → CommonJS), committed
├── report/                 # Report action: action.yml, src/, dist/
├── docker/
│   ├── common/             # Image files every engine shares: s6 services, init-iptables
│   ├── universal/          # proxy_engine: universal (BuildKit, HAProxy, CoreDNS, s6-overlay)
│   ├── inspect/            # proxy_engine: inspect, the same plus buildcage-runc/ (Go)
│   ├── seccomp/            # The builder's seccomp profile, applied by the runner's Docker
│   ├── compose.action.yaml # The compose file the action runs, with the digest-pinned image
│   └── *-licenses.sh       # License collection and checks run at image build time
├── test/                   # Dockerfile.* and assert-*.sh per engine and mode, and the fixtures
├── compose.yaml            # Local compose config (the Dockerfile is chosen by PROXY_ENGINE)
├── compose.test-*.yaml     # Test overrides, one per engine
├── licenses/               # License texts copied into the images, and the npm license generator
├── docs/
└── Makefile
```

Each engine's config generator is `src/core/scripts/gen-configs-<engine>.qjs.ts`. It runs under
QuickJS when the container starts and writes haproxy.cfg and the Corefile from the rules, through
the generators in `src/core/lib/acl/` (`haproxy-config.ts` for `inspect`,
`haproxy-universal-config.ts` for `universal`). Every engine directory also carries a
`scripts/report-action.node.ts`, which the report action copies out of the image and runs under
Node on the runner.

## Running it locally

Action inputs become uppercase environment variables locally (`proxy_mode` is `PROXY_MODE`). There
is one `setup_buildkit_{engine}_{mode}` target per engine and mode, and each sets `PROXY_ENGINE`,
which picks the engine's Dockerfile in `compose.yaml`:

```bash
make setup_buildkit_universal_audit
make setup_buildkit_inspect_restrict
ALLOWED_HTTPS_RULES="github.com:443 npmjs.org:443" make setup_buildkit_universal_restrict
```

A whole run:

```bash
make setup_buildkit_universal_audit                                      # 1. start the builder
docker buildx build --builder buildcage --progress=plain -f Dockerfile . # 2. build
make report_buildkit                                                     # 3. show the report
make clean_buildkit                                                      # 4. clean up
```

Run the report through `make report_buildkit` rather than `node report/src/main.ts` by hand: the
Makefile exports the same `COMPOSE_PROJECT_NAME` and `BUILDCAGE_BUILD_TEST_HOOKS` to it as to the
setup targets, and without them the report does not find the builder.

### The actions against an unpublished image

Sigstore verification needs a real, published GHCR image, so the setup action cannot normally run
against local changes. A test-hook build lets it: `BUILDCAGE_BUILD_TEST_HOOKS=1 vp run build`
produces a `dist/main.cjs` that honors `BUILDCAGE_LOCAL_IMAGE_REF`. CI's `test_action` job in
`.github/workflows/test-e2e.yml` runs the real `setup` and `report` actions this way.

1. Build the image: `docker compose build` (set `PROXY_ENGINE` to select the engine).
2. `BUILDCAGE_BUILD_TEST_HOOKS=1 vp run build`
3. Run it with `BUILDCAGE_LOCAL_IMAGE_REF=<image ref from step 1>` set, through `act` or by
   invoking `node dist/main.cjs` with the relevant `INPUT_*` variables.

Run `vp run build` again, without the flag, before committing; see
[Rules when changing code](#rules-when-changing-code).

## Testing

`make help` lists every target with its own description.

### Unit tests and coverage

```bash
make test_unit               # every unit test, the QuickJS and Go ones included
make test_unit_coverage      # every Node unit test in one run, with a report in coverage/
make test_unit_go_coverage   # buildcage-runc's tests, with its filtered coverage checked
vp test run src/core/lib/acl # the Node tests whose path contains the argument
```

The Node threshold is 100% on all four counters, so anything added without a test fails CI, which
pastes `coverage/summary.txt` into the job summary. Code that is deliberately not tested carries a
`/* v8 ignore */` comment saying why, which keeps that decision in the source rather than buried in
a percentage. Only two things qualify: code whose body lives outside the process, and the default
implementation behind a seam whose callers are already tested.

`make test_unit_go_coverage` holds `buildcage-runc` to `RUNC_COVERAGE_THRESHOLD` in the Makefile,
which is 100, after `test/covfilter` drops the blocks `//coverage:ignore start` / `stop` markers
cover. A marker covering a statement the tests do reach, or covering none at all, fails the run the
same way a gap does, so the list of what is deliberately untested cannot quietly stop being true.
Go measures statements rather than branches, so even at 100 this is a weaker claim than the Node
side's.

The QuickJS run (`make test_unit_qjs`) is not measured separately. It executes the same `.test.ts`
files as the Node run, so `src/core/lib/acl/`'s coverage is already accounted for.

### Integration tests

Each `test_integration_buildkit_*` target starts a builder, builds the matching
`test/Dockerfile.*`, checks the result and cleans up:

```bash
make test_integration_buildkit_universal_audit
make test_integration_buildkit_universal_restrict
make test_integration_buildkit_inspect_restrict
# Debian/apt build, which starts with no CA store at all
make test_integration_buildkit_inspect_debian_audit
make test_integration_buildkit_inspect_debian_restrict
# An inspect audit run, then its generated rules enforced unedited (holds the audit-mode checks)
make test_integration_buildkit_inspect_roundtrip
# known_blocked_rules against fail_on_blocked, both matched and unmatched
make test_integration_buildkit_universal_known_blocked
# Builds for the host's architecture and for the other one
make test_integration_buildkit_multiarch
# Brings the builder up alone and probes :10024/:53 from the compose network and the host
make test_integration_buildkit_listener_scope
```

`make help` lists the rest, such as `inspect_byte_exact` and `universal_restrict_no_traffic`, and
`make test_integration_buildkit` runs all of them in turn. CI runs them in a few jobs, several
targets side by side in each, every one under its own worktree suffix and test-net subnet
(`.github/workflows/test-integration.yml`), with a check that none is left out. `TEST_PLATFORM` is
`linux/arm64` locally, and CI sets it to the runner's own architecture.

### Several worktrees at once

One Docker daemon serves every worktree, so the builder container, the buildx builder, the Compose
project and the built image would otherwise collide. The Makefile takes the worktree's name from
`git rev-parse --git-dir` and suffixes all of them, and the `/tmp` paths, with it: a worktree named
`wt2` uses `buildcage-wt2` and `buildcage-project-wt2`. The main checkout keeps the unsuffixed
names. `BUILDCAGE_WORKTREE_SUFFIX` and `TEST_NET_SUBNET` override the derived values.

The fixtures' addresses need no suffix. Each fixture assigns its own `10.200.0.x` inside its own
network namespace (see each fixture's entrypoint, and `test/test-net-addr/attach.sh`, which the
test overlays run in front of the builder's entrypoint), so every worktree uses the same addresses,
and the assertions name them literally. `test-net`'s subnet is derived from the worktree name too;
two names that happen to pick the same one fail with `Pool overlaps with other one on this address
space`, so rename one or set `TEST_NET_SUBNET`.

A fresh worktree needs `vp install` before any target that runs `report/src` or `src/post.ts`,
since the integration targets run both straight from source.

## Rules when changing code

- **`dist/` is committed.** After changing anything under `src/` or `report/src/`, run
  `vp run build` and commit the bundles with the change; CI's "Check dist is up to date" step
  rebuilds and compares them. The bundles are never formatted or linted.
- **A test-hook build never ships.** The `BUILDCAGE_LOCAL_IMAGE_REF` override lives in
  `src/core/lib/provenance/local-image-override.ts`, reached only through a dynamic `import()`
  gated by `BUILDCAGE_BUILD_TEST_HOOKS` at build time, so a normal build tree-shakes it out. CI and
  the pre-commit hook fail a `dist/` that names `BUILDCAGE_BUILD_TEST_HOOKS`,
  `BUILDCAGE_LOCAL_IMAGE_REF`, or any `BUILDCAGE_TEST_*` or `BUILDCAGE_RUN_DEBUG_*` name. A new
  test hook goes behind the same gate.
- **`acl/` runs under QuickJS too.** `src/core/lib/acl/`, everything it imports,
  `src/core/lib/test/` and `src/core/scripts/` also run inside the image under QuickJS
  (`tsconfig.qjs.json`), so they cannot use Node's APIs. `make test_unit_qjs` runs the tests under
  `src/core/lib/acl/` there.
- **An engine keeps only what differs.** Each Dockerfile copies `docker/common/files/` first and
  the engine's own `files/` on top. A path in both would be settled silently by copy order, so
  `src/core/lib/docker/engine-files.test.ts` rejects one.
- **Pinned downloads move together.** The CNI plugins and CoreDNS are downloaded at a pinned
  version and checked against one SHA256 per architecture, set as `ARG`s in each engine's
  Dockerfile. Renovate updates the version and the SHA256 lines together, taking the digests from
  the release's own checksum files; the `digestVersion` in the comment above each SHA256 line tells
  it which release that digest belongs to. A bump by hand changes all of them.
- **`go-pkcs12` comes from a fork.** `buildcage-runc` takes it from
  [buildcage/go-pkcs12](https://github.com/buildcage/go-pkcs12) through a `replace` in its
  `go.mod`. The fork adds `DecodeTrustStoreEntries`, since a keystore rewrite must keep the
  aliases, and `MaxIterations`, which the sweep sets to a million so a keystore naming more
  key-derivation iterations is left unread instead of stalling the build. Its `vX.Y.Z-buildcage.N`
  tags are upstream `vX.Y.Z` plus those additions.
- **The seccomp profile is vendored.** `make seccomp_profile` regenerates it from moby/profiles.

## Debugging

### Logs

```bash
docker compose logs builder    # the builder's output; -f to follow
docker compose exec builder cat /var/log/haproxy/current
docker compose exec builder cat /var/log/coredns/current
```

The proxy's line formats are the `log-format` lines the generators in `src/core/lib/acl/` write,
and `src/core/lib/log/` parses them back. A line from each engine looks like this:

```
buildcage 1787471970500 [ALLOWED] (HTTPS) "github.com:443" - 1024
buildcage 1787471975123 https GET 200 708 ts=-- reason=- tlserr=- dst=104.16.1.34:443 fcerr=- sni=registry.npmjs.org host=registry.npmjs.org /express
```

Each log is an s6-log directory: `current` rotates into a timestamped archive at 1MB, up to 100
archives kept. The report reads every archive, so `current` alone shows only what came after the
last rotation.

HAProxy drops a log line it cannot write at once rather than wait, and counts the lines it drops;
the report reads that count and marks itself incomplete when it is not zero. To read it by hand:

```bash
docker compose exec builder curl -s --unix-socket /var/run/haproxy-health.sock \
  'http://localhost/metrics?scope=global' | grep dropped_logs
```

### The setup step fails with "never became ready"

The builder came up but `buildctl debug workers` never succeeded inside it. The step prints the
container log; locally:

```bash
docker inspect --format '{{json .State.Health}}' buildcage
```

### The builder cannot reach the network

The builder's CNI bridge is `198.19.255.0/24`, from the `198.18.0.0/15` block RFC 2544 reserves
for benchmarking, outside Docker's default address pools. A daemon whose `default-address-pools`
covers that range can still hand it to the Compose `default` network, which the builder then
cannot reach. Check that subnet with `docker network inspect`.
