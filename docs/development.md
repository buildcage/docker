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
- [Inspect Engine Internals](#inspect-engine-internals)
- [Explicit Engine Internals](#explicit-engine-internals)
- [Troubleshooting](#troubleshooting)

## Local Usage

You can run Buildcage locally without GitHub Actions using Docker Compose and Make.

GitHub Actions inputs are lowercase (`proxy_mode`); the environment variables for local usage are
the uppercase form of the same names (`PROXY_MODE`).

### Starting the Builder

There's one `setup_buildkit_{engine}_{mode}` target per (`universal`, `inspect`, `explicit`) x
(`audit`, `restrict`) combination:

```bash
make setup_buildkit_universal_audit
make setup_buildkit_universal_restrict
make setup_buildkit_inspect_audit
make setup_buildkit_inspect_restrict
make setup_buildkit_explicit_audit
make setup_buildkit_explicit_restrict
```

**Start with custom domains** (restrict mode only):

```bash
ALLOWED_HTTPS_RULES="github.com:443 npmjs.org:443 example.com:443" make setup_buildkit_universal_restrict
```

Each target sets `PROXY_ENGINE`, which picks the build context at image build time through
`compose.yaml`'s `build.dockerfile: docker/${PROXY_ENGINE:-universal}/Dockerfile`. The `explicit_*`
targets therefore get BuildKit's native `--proxy-network` instead of the CNI/DNS-redirect/HAProxy
stack (see [Engines](../README.md#engines)).

`transparent` is an alias for `universal` in the action's own `proxy_engine` **input** only, resolved
in TypeScript. `PROXY_ENGINE` here is a raw Compose build-context selector with no alias layer, so
it does not understand that name.

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
make test_integration_buildkit_explicit_audit
make test_integration_buildkit_explicit_restrict
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

`make test_unit_go_coverage` does the same for `buildcage-runc`, in two steps: `go test
-coverprofile`, then `test/covfilter` over the result. The second step exists because Go has no way
to say a statement does not need a test -- `cmd/cover` takes no exclusion flag and the toolchain
carries no directive for it (the proposal for one, golang/go#53271, was closed without it).
covfilter reads `//coverage:ignore start` / `stop` markers out of the source, drops the blocks they
cover, and holds what is left to `RUNC_COVERAGE_THRESHOLD` in the Makefile. It also holds a marker
to its word: one covering a statement the tests do reach, or covering none at all, fails the run
the same way a gap does, so the list of what is deliberately untested cannot quietly stop being
true.

The threshold is 100, so a statement added without a test fails the run. Eight markers carry the
exceptions: `main`'s `os.Exit`, the default behind the rsync seam, and six error returns that
cannot be reached without a seam of their own for one statement each. A marker excuses the whole
construct its unreached statement sits in -- guarding an error return means enclosing the `if` that
guards it -- so the run reports both totals: what it measured, and what the markers took out.

Two caveats. Go measures statements and not branches, so even at 100 this is a weaker claim than
the Node side's: a short-circuited `&&` counts as reached once either half runs. And the percentage
below 100 is not comparable across Go releases, since `cmd/cover` splits blocks differently between
them; 100 is the one reading that means the same thing under all of them.

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
pinned rather than left to Docker because Docker's own pool includes
`172.20.0.0/16`, which overlaps the builder's CNI bridge: a daemon-side network
in that range is shadowed by the longer prefix and becomes unreachable from
inside the builder. Two worktrees whose names happen to pick the same subnet
fail with `Pool overlaps with other one on this address space`; rename one, or
set `TEST_NET_SUBNET`.

Docker picks the Compose `default` network's subnet from its own pool, which
includes `172.20.0.0/16` and can collide the same way. If the builder starts
failing to reach the fixtures or the network for no apparent reason, check that
subnet with `docker network inspect` and consider narrowing
`default-address-pools` in the daemon configuration.

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

**Log format (`universal` and `explicit`):**

```
[28/Feb/2026:10:15:30 +0000] buildcage [ALLOWED] "github.com:443" -
[28/Feb/2026:10:15:31 +0000] buildcage [BLOCKED] "malicious.com:443" not-allowed
[28/Feb/2026:10:15:32 +0000] buildcage [AUDIT] "npmjs.org:80" -
```

Fields: `[timestamp] buildcage [status] "domain:port" reason`

**`inspect` reads two logs instead**, since a name CoreDNS refused never reaches HAProxy at all:

```bash
docker compose exec builder cat /var/log/haproxy/current
docker compose exec builder cat /var/log/coredns/current
```

HAProxy's log carries one line per request, oldest first, with its method, status, size, and its
full URL last:

```
buildcage 1787471975123 https GET 200 708 ts=-- reason=- dst=104.16.1.34:443 sni=registry.npmjs.org https://registry.npmjs.org/express
buildcage 1787471976000 pass tls 3421 ts=-- reason=- dst=10.200.0.100:5432 sni=db.example.com
```

Only the stage that terminates TLS has an SNI, so the plain-HTTP stage logs no such field. It is
what names the host of a connection that closed before sending a request, where the method and the
captured `Host` are both empty.

The URL and the SNI come last because a build decides how long they are: every field the report
needs to place an event then sits ahead of anything that could cut the line short. The line is
sized for the longest request HAProxy will accept, so nothing should cut one; a line that arrives
unreadable anyway is counted, and the report says it is not a full record rather than passing off
what survived as everything. A line the log pipe dropped whole leaves no trace and cannot be
counted.

Refusals are interleaved with the rest, since nothing here can be attributed to a `RUN` step
the way `explicit`'s per-step breakdown can:

```
✅ 00:00.512: GET https://registry.npmjs.org/express -> 200 (99.9KB)
🚫 00:01.048: DNS secret-data.attacker.example -> dns-not-allowed
🚫 00:01.390: POST https://registry.npmjs.org/express/-rev/1-abc -> not-allowed
✅ 00:02.115: TLS db.example.com:5432 -> (12.3KB)
⚠️ 00:03.407: HTTPS untrusted-ca.example.com:443 -> client-aborted
```

Times are relative to when the proxy started. A refusal names its reason rather than a status. The
`reason` field carries it whenever the rule that refused knew one the line could not otherwise show
(`dns-failed`, `internal-address`); a `-` there leaves the termination state's phase to name it: `R`
a request buildcage refused (`not-allowed`), `C` an origin that could not be reached or verified,
`H` one that never sent usable response headers, `D`/`L` one that cut the transfer short.

The ⚠️ line is the exception: a termination state of `CR` or `cR` is the client itself giving up in
phase `R`, before a whole request had arrived. The stage resolves and connects only after one
parses, so nothing left the proxy: the logged `dst` is still the proxy's own address. That is
neither an allow nor a block, and like a `discovery` lookup it stays out of both host tables so no
row appears that no rule could take away. Only `R` counts: a later phase means the rules had
already decided on a request.

Each log is an s6-log directory rather than a single file: `current` rotates into a timestamped
archive once it crosses 1MB, up to 100 archives kept, and a line is only ever split past 32KB. The
report reads every archive, oldest first, then `current`, so early traffic is never dropped just
because a later part of the same run pushed the log past a rotation. Reading `current` by hand, as
above, only shows what has accumulated since the most recent one.

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
├── src/                      # Source (ESM): verify image provenance, resolve image ref, compose up
│   ├── lib/                  # Setup action's own modules. setup-step.ts is the step itself, in the
│   │                         # order its parts have to happen in; src/main.ts is only the entry guard
│   └── core/                 # Code shared across actions
│       ├── lib/               # All shared library code, consolidated: acl/ (rule parsing and the
│       │                     # proxy config generators) is dual-consumed by Node and QuickJS;
│       │                     # test/test-shim.ts is a portable node:test-alike shim used by
│       │                     # *.test.ts across the whole tree (Node and QuickJS alike).
│       │                     # Everything else is Node-only, used by the setup and report actions'
│       │                     # Node runtime and report-action.node.ts, never by the QuickJS
│       │                     # scripts: log/, report/ (including the
│       │                     # report-action.node.ts skeleton every engine's own script runs),
│       │                     # docker/, provenance/ (Sigstore, OCI registry lookups, image ref
│       │                     # resolution, local-image test-hook override), actions/
│       └── scripts/           # QuickJS entry point (convert-rule.ts), run inside the built images
│                             # (rolldown-bundled into /opt/buildcage/scripts/ at image build time;
│                             # see rolldown.scripts.config.js). test/ is a qjs test runner, types/
│                             # is the qjs:std/qjs:os ambient type declaration
├── dist/                     # Bundled output (rolldown → CommonJS); dist/qjs, dist/qjs-test,
│                             # dist/report-action are gitignored build-time scratch output, not committed
├── docker/                   # proxy_engine build contexts
│   ├── compose.action.yaml   # Runtime compose file the action itself uses (verified, digest-pinned
│   │                         # image ref), distinct from the top-level compose.yaml below
│   ├── seccomp/              # builder.json, the builder container's seccomp profile (moby's own
│   │                         # default plus what runc needs), and gen-profile.mjs that vendors it.
│   │                         # Read by the Docker client on the runner, not copied into any image
│   ├── universal/            # proxy_engine: universal. Dockerfile + BuildKit/haproxy/dnsmasq/
│   │                         # s6-overlay config + scripts/report-action.node.ts (runs under Node
│   │                         # on the runner, copied out of the image by the report action)
│   ├── inspect/               # proxy_engine: inspect. Dockerfile + HAProxy/CoreDNS/s6-overlay
│   │                         # config + buildcage-runc/ (Go module: wraps buildkit-runc to inject
│   │                         # CA trust at exec time) + scripts/report-action.node.ts
│   └── explicit/             # proxy_engine: explicit. Dockerfile + buildkit-proxy/ (Go module:
│                             # entrypoint/PID1, supervises buildkitd, injects the source policy
│                             # into Solve via a gRPC proxy) + scripts/ (gen-source-policy.ts runs
│                             # under QuickJS; report-action.node.ts runs under Node on the runner,
│                             # copied out of the image by the report action. TypeScript, rolldown-bundled
│                             # at image build time)
├── test/                     # Dockerfile.*/assert-*.sh per {engine}-{mode} combination, plus the
│                             # fixture containers: test-server and test-dns per engine, and
│                             # test-server-impostor / test-udp-echo for the inspect assertions.
│                             # helpers.sh carries what every assert script shares (pass/fail,
│                             # the result line, the builder's logs and the log matchers)
├── compose.test-*.yaml       # Test override config, one per engine
├── report/                   # GitHub Actions report action
│   ├── action.yml            # Action entry (node24 → dist/main.cjs)
│   ├── src/                  # Source (ESM): log analysis, per-command breakdown, Job Summary output
│   └── dist/                 # Bundled output (rolldown → CommonJS)
├── docs/                     # development.md, security.md, explicit-engine.md, plus the
│                             # reference.md/rules.md/inspect-engine.md link stubs
├── licenses/                 # gen-license-file.mjs, which regenerates THIRD_PARTY_LICENSES_NPM
│                             # during `vp run build`, and what .glf.jsonc substitutes in
├── compose.yaml              # Docker Compose config for local dev (dockerfile path selected by
│                             # PROXY_ENGINE; also defines the local-dev `proxy` service)
└── Makefile                  # Operational commands
```

## Inspect Engine Internals

This section covers how `proxy_engine: inspect` is implemented internally. For the user-facing
behavior, see [Inspect Proxy Engine](./security.md#inspect-proxy-engine) in Security Details.

- `PROXY_ENGINE=inspect` selects `docker/inspect/Dockerfile` at build time (see `compose.yaml`'s
  `build.dockerfile: docker/${PROXY_ENGINE:-universal}/Dockerfile`), the same mechanism `explicit`
  uses.
- **HAProxy** is the single listener. `req.ssl_hello_type` tells a TLS handshake from a plain
  request by its first bytes, so one `bind` line handles both without the config declaring per-port
  whether it's plaintext or TLS. Two HAProxy features carry the rest of the enforcement:
  `normalize-uri` (an upstream directive still marked experimental, gated behind
  `expose-experimental-directives` in `src/core/lib/acl/haproxy-sections.ts`) resolves `..` in the
  path before ACLs see it, and `do-resolve` + `set-dst` resolve the requested name and rewrite the
  connection's destination to it, run only after the ACL check for that request has already passed.

  What those two resolve against is the container's own `/etc/resolv.conf`, through HAProxy's
  `parse-resolv-conf`, as in `universal`. On a runner that file is Docker's embedded DNS forwarding
  to the runner's own resolvers, so a name only an internal resolver knows resolves, and the query
  follows the runner's own DNS policy. `EXTERNAL_RESOLVER` names upstreams explicitly instead; it
  is not an action input, and only the integration tests set it, to reach their own fixture
  resolver. Either way HAProxy's resolvers do no search-domain expansion, so a rule has to name a
  host in full.

- **CoreDNS** answers every query with the proxy's own address, allowed or not, using an `expr`
  plugin view compiled from the same host patterns HAProxy's own ACLs use, so what's logged as
  `allowed` matches exactly what HAProxy would actually let through:

  ```
  # Allowlisted names are logged as allowed, but answered exactly like a denied
  # one below: this resolver never gets a request any closer to a real address.
  . {
      view allowlist {
        expr name() matches '^(abc[^.]*\.amazonaws\.com|registry\.npmjs\.org)\.$'
      }
      template IN A   { answer "{{ .Name }} 60 IN A <proxy-ip>" }
      template IN AAAA { }
      template IN ANY  { }
      log . "buildcage dns allowed name={name}"
  }
  ```

  Reverse lookups get their own block, ahead of these, answering `PTR` with `NXDOMAIN` and
  logging `buildcage dns reverse name=...`. Nothing in the cage has a name to give back, and no
  rule can name an address backwards, so the lookup is recorded rather than judged. `NXDOMAIN` is
  what ends it: a query no template matches is answered `SERVFAIL` instead, which musl retries and
  then waits out its full five-second resolver timeout on, once per lookup. `template IN ANY` above
  does the same for every other query type, `SRV` and `HTTPS` included.

  A view of its own holds that block to names that really are an address backwards. Anything else
  under `in-addr.arpa` or `ip6.arpa`, `SECRET-DATA.in-addr.arpa` included, misses the view and
  falls through to the blocks above, so appending a reverse suffix is no way out of the report.

  Service-discovery names get a block of the same shape, logging
  `buildcage dns discovery name=... type=...`. No rule can permit one: this resolver returns no
  discovery record to anybody, so reporting the lookup as denied would put a row in the report that
  no rule could ever take away, and fail the build under `fail_on_blocked` over a lookup the caller
  falls back from on its own. apt asks for `_http._tcp.<repo>` on every repository it fetches from,
  which is how this shows up in practice. The report keeps these out of both host tables and shows
  them in the timeline instead, carrying the query type, which is the difference between a fallback
  nobody notices and a `mongodb+srv://` connection that fails outright.

  Its view is what stops that verb from becoming a hiding place. Three things have to hold: the name
  is shaped like a service name, the host below it is one the rules allow, and the type is one of
  the four defined at such a name (`SRV`, `TXT`, `TLSA`, `URI`). A type nobody has taught the block
  about is not one to exempt on a guess.

  Every other service name gets a block of its own after the allowlist, logging
  `buildcage dns service-denied name=... type=...`. Note that only this second block sits after the
  allowlist: the discovery block sits before it, so a service name under an allowed host reads as
  `discovery` even when a rule names it outright. That is the more accurate of the two, the record
  being unserved either way. It is a refusal like any other, kept apart only
  so the report can name the remedy: the host below the name, never the name itself, which no rule
  can make resolve. That becomes `dns-service-not-allowed` in the Blocked Hosts table. Sitting after
  the allowlist is what leaves a name someone did write a rule for reading as allowed.

  Between them, these two blocks are the only place a service name is recognised. The report reads
  the verbs they log under, so nothing in `src/core/lib/log/` or `src/core/lib/report/` has to know
  the shape, and the two cannot drift apart.

- **`buildcage-runc`** (`docker/inspect/buildcage-runc/`) wraps BuildKit's own `buildkit-runc`,
  selected via `[worker.oci] binary` in `buildkitd.toml`. For the subcommands that carry an OCI
  bundle, it sets the CA-trust environment variables (see
  [CA trust variables](./reference.md#ca-trust-variables)) directly, and for the CA itself, mirrors
  the step's CA store directory into a scratch copy, appends the CA there, and
  bind-mounts the copy over the step's view of the real directory for the step's duration. Once the
  real `runc` exits, that mirror is compared against its state right after the CA was added: if
  nothing else changed, the real directory was never opened for writing, so BuildKit's layer diff for
  that step is unaffected; only a step that actually changed the store gets that change synced back.
  This is what keeps a step that never touches its CA store from producing a different layer than an
  unmodified build would. Either way this happens at exec time, entirely outside LLB, so it cannot
  affect a cache key: two builds that differ only in `proxy_engine` still share cache.

  The CA is also written into each distribution's anchor directory, which the step's own
  `update-ca-certificates` rebuilds its bundle from. Without it, a step that installs
  `ca-certificates` part-way through loses the CA for everything after that point. Undoing that
  reaches further than the files it wrote: a rebuild leaves a copy of each anchor beside the bundle
  under a name of its own, so the undo strips the certificate from everything in the store directory
  and drops the links left pointing at what it removed.

- The `allowed_url_rules` compiler enumerates hosts rather than generalizing them
  (`a.example.com`/`b.example.com` never becomes `*.example.com`), because CoreDNS's own allow/deny
  view is generated from the same host patterns. Widening a host widens what's logged as allowed
  DNS-side, not only what matches HTTP-side.
- `make test_integration_buildkit_inspect_roundtrip` (see [Testing](#testing) above) runs an audit
  build, asserts what it recorded, feeds its own generated `allowed_url_rules` back as `restrict`,
  and checks both halves: every request the audit saw still passes, and a path, method, host, or
  port it never saw is refused.

## Explicit Engine Internals

> [!WARNING]
> `explicit` is **deprecated**; see [Explicit Proxy Engine](./explicit-engine.md). This section is
> kept for existing maintenance only; it receives no further development.

This section covers how `proxy_engine: explicit` is implemented internally. For the user-facing
behavior (what's enforced, what's visible in the report), see
[Explicit Proxy Engine](./security.md#explicit-proxy-engine) in Security Details.

- A small statically-linked Go binary (`docker/explicit/buildkit-proxy/`) is the image's entrypoint
  (PID 1) and directly supervises the real `buildkitd` as a child process. `RUN` steps are isolated
  into their own point-to-point network namespace by `proxyNetwork = true`, built directly on
  netlink/veth rather than CNI.
- At startup, the binary: writes `/etc/resolv.conf` from `EXTERNAL_RESOLVER` if that variable is
  set (otherwise the container's own resolv.conf, e.g. Docker's embedded DNS, is left untouched);
  runs a QuickJS script that compiles `allowed_https_rules` / `allowed_http_rules` /
  `allowed_ip_rules` (the same syntax as `universal`; see
  [Rule syntax](./reference.md#rule-syntax)) into a BuildKit
  [source policy](https://github.com/moby/buildkit/blob/master/docs/proxy.md); starts `buildkitd`
  with `proxyNetwork = true` bound to an internal Unix socket; and starts its own gRPC listener on
  the socket path Buildx actually connects to.
- That gRPC listener sits in front of the real `buildkitd` control socket. It intercepts only the
  `Solve` RPC to inject the compiled source policy, and transparently relays every other RPC
  (`Session`, `Status`, `DiskUsage`, etc.) to the real daemon without decoding it, so future
  BuildKit versions that add new RPCs are automatically supported.
- If the build client has already set a **static** source policy on the request (e.g. via the
  `EXPERIMENTAL_BUILDKIT_SOURCE_POLICY` environment variable, which `docker buildx build` reads
  unconditionally), buildcage **merges** it with its own policy rather than rejecting the build,
  placing its own rules last so they always have the final say for every `http(s)` source: a
  client-supplied policy can never widen access beyond `allowed_https_rules` / `allowed_http_rules` /
  `allowed_ip_rules`. For any other scheme (`docker-image://`, `git://`, etc.) buildcage's rules
  never match, so the client's rules apply unmodified: buildcage only ever governs what it was
  configured to govern. A **dynamic**, session-based policy (`docker buildx build --policy=...`,
  `docker/buildx`'s own Rego policy feature) is a separate mechanism and is left untouched; it
  applies as an additional condition alongside buildcage's (merged) policy.

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
   See [Limitations](../README.md#limitations). The JVM is the common case; fall back to
   `universal` for it.

4. **TLS/certificate errors under `proxy_engine: explicit`**: if a `RUN` step fails with a
   certificate error there but works fine under `universal` (or without Buildcage at all), the tool
   likely bundles its own CA store instead of consulting the system one BuildKit already trusts. See
   [CA trust for tools with their own CA store](./explicit-engine.md#ca-trust-for-tools-with-their-own-ca-store)
   in the Explicit Proxy Engine doc.

5. **The setup step fails with "never became ready"**: the builder came up but `buildctl debug
workers` never succeeded inside it. The step prints the container log; locally:

   ```bash
   docker inspect --format '{{json .State.Health}}' buildcage
   ```

6. **Open an issue** at [github.com/buildcage/docker/issues](https://github.com/buildcage/docker/issues) with:
   - Your Dockerfile
   - The audit mode report output
   - Full error messages from `docker compose logs builder`
