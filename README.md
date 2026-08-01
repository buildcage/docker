# Buildcage

![Buildcage](./assets/banner.png)

[![GitHub](https://img.shields.io/badge/GitHub-dash14%2Fbuildcage-blue?logo=github)](https://github.com/dash14/buildcage)
![version](https://img.shields.io/github/v/release/dash14/buildcage)
![build](https://img.shields.io/github/actions/workflow/status/dash14/buildcage/docker-publish.yml)
![test](https://img.shields.io/github/actions/workflow/status/dash14/buildcage/test-e2e.yml?label=test)
![license](https://img.shields.io/github/license/dash14/buildcage)

**Secure your builds against supply chain attacks in GitHub Actions: restrict outbound network access to only the domains you allow.**

When a compromised dependency pulled in by `RUN npm install`, `RUN pip install`, or any other build command tries to exfiltrate secrets or phone home, Buildcage blocks it: only the domains you specify are reachable. No Dockerfile changes, no proxy configuration, no certificates to install: works with any language or package manager.

- **Protects `docker build`**: every `RUN` step, zero Dockerfile changes
- **Also protects plain `run:` steps**: the `run` action applies the same isolation to any command, not just Docker builds
- **Self-contained on GitHub**: no external service, no telemetry, free and open source

This is not a hypothetical risk: the [Shai-Hulud npm worm](https://unit42.paloaltonetworks.com/npm-supply-chain-attack/) compromised hundreds of packages whose `postinstall` scripts exfiltrated CI/CD secrets straight out of the build environment. npm v12 disables install scripts by default, closing off that specific path, but builds still handle secrets and run plenty of other commands that could do the same thing. That's the layer Buildcage protects, regardless of which command triggers it.

<img src="assets/report-restrict-mode.png" alt="Buildcage report showing allowed and blocked connections" width="556">

_A build tries to reach an unexpected domain. Buildcage blocks it and records it in the report. This is what your report looks like after completing the audit → restrict flow below._

## Features

- 🚀 **Zero build script changes**: Your Dockerfile or shell commands stay exactly as they are
- 🔍 **Dependency discovery**: Discover what your build already talks to before enforcing anything (`audit` mode)
- 🛡️ **Allowlist enforcement**: Block every destination except the ones you explicitly allow (`restrict` mode)
- 🔒 **Network isolation**: Isolates network access per Dockerfile `RUN` step or workflow `run:` step, so only explicitly allowed destinations are reachable
- 📊 **Detailed logging**: Every destination your build reaches, reported directly in GitHub's Job Summary

## Quick Start

Buildcage protects your build in two ways: wrap `docker build` itself, or isolate a `run:` step
directly. Both follow the same audit → restrict flow.

### Protect a Docker Build

Using Buildcage comes down to three steps: start the Buildcage container, point Docker Buildx at it
as a remote builder, then run your build as usual: your Dockerfile and build commands don't change.
Steps 2 and 3 use Docker's own `setup-buildx-action` and `build-push-action`, so any Buildx-based
tool works the same way, including `docker/bake-action`: just point its `driver: remote` and
`endpoint` at Buildcage.

#### Step 1: Discover what domains your build needs (Audit Mode)

```yaml
- name: Start Buildcage in audit mode
  uses: dash14/buildcage/setup@f40c162979dc9f095993ad26049b08b2eca77911 # v2.2.5
  with:
    proxy_mode: audit # Log every destination, block nothing

- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0
  with:
    driver: remote
    endpoint: docker-container://buildcage

- name: Build Docker image
  uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7.3.0
  with:
    context: .
    push: false # Set to true to push the built image

- name: Show Buildcage report
  if: always()
  uses: dash14/buildcage/report@f40c162979dc9f095993ad26049b08b2eca77911 # v2.2.5
```

See the [complete example workflow](.github/workflows/example-audit.yml).

#### Step 2: Check the report

The report action outputs a Job Summary showing every destination your build contacted:

<img src="assets/report-audit-mode.png" alt="Outbound Traffic Report - audit mode" width="556">

_Same workflow, run first in audit mode: every destination is logged, nothing is blocked yet._

Copy these domain names into `allowed_https_rules` or `allowed_http_rules` for Step 3.

#### Step 3: Create your allowlist and switch to restrict mode

```yaml
- name: Start Buildcage in restrict mode
  uses: dash14/buildcage/setup@f40c162979dc9f095993ad26049b08b2eca77911 # v2.2.5
  with:
    proxy_mode: restrict # Block every destination except the ones you allow
    allowed_https_rules: |
      registry.npmjs.org:443
      fonts.googleapis.com:443

- name: Set up Docker Buildx
  uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0
  with:
    driver: remote
    endpoint: docker-container://buildcage

- name: Build Docker image
  uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7.3.0
  with:
    context: .
    push: false # Set to true to push the built image

- name: Show Buildcage report
  if: always()
  uses: dash14/buildcage/report@f40c162979dc9f095993ad26049b08b2eca77911 # v2.2.5
  # Build fails if any unexpected connections were blocked
```

See the [complete example workflow](.github/workflows/example-restrict.yml).

### Protect a `run:` Step

For commands that aren't part of a Docker build (`npm install`, a test suite, a build script running
directly in the job), wrap them with the `run` action instead. Same audit → restrict flow, same
report, just applied to one step rather than a whole `docker build`.

```yaml
- name: Run tests with outbound network isolation
  uses: dash14/buildcage/run@f40c162979dc9f095993ad26049b08b2eca77911 # v2.2.5
  with:
    proxy_mode: restrict
    allowed_https_rules: |
      registry.npmjs.org:443
    run: |
      npm install
      npm test
```

See the [complete example workflow](.github/workflows/example-run-restrict.yml).

---

Your builds are now protected. Any unexpected connections will be blocked and reported.

For the full parameter reference, rule syntax, and operation modes, see the [Reference](./docs/reference.md) doc.

## How It Works

For Docker builds, Buildcage runs as a remote driver for Docker Buildx and routes each `RUN`
step's outbound traffic through a proxy that enforces your allowlist, without touching your
Dockerfile.

For the `run` action, Buildcage isolates the command directly on the runner: its own network
namespace enforces the same kind of allowlist proxy, while capability and namespace restrictions
keep it from escaping to the rest of the runner. It keeps the same UID and `$HOME` as the rest of
the job, though, so things configured by earlier steps, like AWS credentials or an npm cache, keep
working unmodified.

Neither approach requires an agent installed on the runner.

See [Reference](./docs/reference.md) for the full mechanism, including Docker build's experimental
proxy engine switch.

> [!IMPORTANT]
> Buildcage controls _where_ your builds can connect, not _what code_ they run. If a malicious
> package is delivered through a legitimate repository (e.g., a compromised npm package hosted on
> `registry.npmjs.org`), Buildcage cannot detect or prevent it: the connection goes to an allowed
> domain.
>
> Don't make Buildcage your only supply chain security measure. Use it as one layer in a
> defense-in-depth strategy, a last line of defense. If something slips through your other
> measures, at least it can't call home.
>
> See [Security Considerations](./docs/security.md) for full details.

## Comparison

The closest tools in this space are [StepSecurity Harden-Runner](https://github.com/step-security/harden-runner)
and [Bullfrog](https://github.com/bullfrogsec/bullfrog), both of which control outbound traffic for
an entire GitHub Actions job rather than one build step.

**Harden-Runner** is a broader security agent, monitoring network, file integrity, and process
activity across the whole runner. Buildcage stays narrower on purpose: it only restricts outbound
traffic during a build, either a `docker build` or a `run:` step, and does nothing else. That
focus is also why it stays entirely within your GitHub Actions job: no external dashboard, no
account, no tier to unlock for private repos or self-hosted runners.

**Bullfrog** is free and open source too, but the architecture differs. It allowlists by resolving
a domain to an IP address and then permitting that IP, without inspecting the SNI or Host header of
the actual connection, so shared infrastructure like a CDN can end up permitting more than the
intended domain. Its own documentation also states that jobs running in containers aren't
supported, which rules out protecting a Docker build. Buildcage matches on the domain itself and
isolates each `RUN` step or `run:` command individually.

## FAQ

- **Does this slow down my builds?**

  Minimal impact. Buildcage runs locally, alongside your build, so checking a destination against
  your allowlist adds no meaningful latency.

- **Can I use this with multi-stage builds?**

  Yes. Buildcage doesn't fork or patch BuildKit itself; it only wires up how build traffic is
  routed, so multi-stage Dockerfiles work exactly as they would without Buildcage.

- **Does this work with private package registries?**

  Yes. Just add your private registry's domain to `allowed_https_rules` (e.g., `registry.example.com:443`).

- **What happens if I forget to add a required domain?**

  In restrict mode, the build will fail with a clear error message. Run in audit mode first to discover all required domains.

- **Can I allow access to an IP address (e.g., `http://192.168.1.1`)?**

  Yes. Add the IP address with a port to `allowed_ip_rules` (e.g., `192.168.1.1:80`). Only IPv4
  addresses are supported, and CIDR notation isn't, but a regex rule can match a range (e.g.,
  `~^192\.168\.1\.\d+:80$`).

- **Does this protect against malicious code execution?**

  No. Buildcage only controls network access. It doesn't prevent malicious code from running; it prevents that code from communicating with external servers.

- **Can a `run:` step wrapped by `run` use Docker itself?**

  No. `run` clears the `docker` group before the command executes, so even if the Docker socket is
  visible on the filesystem, the isolated command has no permission to use it.

- **Can I host Buildcage in my own private repository?**

  Yes, see the [Self-Hosting Guide](./docs/self-hosting.md). Most projects don't need to, though:
  pinning the action to a commit SHA (`uses: dash14/buildcage/setup@<sha> # vX.Y.Z`) locks in an
  exact, Sigstore-verified image for that release, which covers most of the same risk self-hosting
  is meant to address, without the overhead of maintaining a fork.

## Documentation

| Doc                                          | What's in it                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Reference](./docs/reference.md)             | Full parameter reference, operation modes, and how each proxy engine and the `run` action work under the hood |
| [Rule Syntax](./docs/rules.md)               | Wildcard, regex, and IP rule syntax in detail                                                                 |
| [Security Details](./docs/security.md)       | Architecture, attack resistance, and known limitations for Docker builds and the `run` action                 |
| [Self-Hosting Guide](./docs/self-hosting.md) | Hosting your own Buildcage image in a private repository                                                      |
| [Development Guide](./docs/development.md)   | Local usage, testing, logs, and implementation internals                                                      |

## Why I Built This

Supply chain attacks keep getting more varied and more sophisticated: typosquatted packages,
compromised maintainer accounts, malicious postinstall scripts. No single control catches all of
it. Defense-in-depth is the baseline now, not an aspiration.

Buildcage is meant to be one of those layers: even if a secret gets stolen, it can't leave the
build environment. Layers like that only help if people actually deploy them. Real network
isolation for a build usually means someone on a security team configuring egress rules and
maintaining them over time. Most projects, especially small ones, don't have that, not because
they don't care, but because it's more setup than a side project or a small team has time for.

I wanted adopting this layer to take nothing more than adding an action. The easier it is to
adopt, the more systems get that protection, and the more people's
personal information stays where it belongs.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests at [github.com/dash14/buildcage](https://github.com/dash14/buildcage).

## Show Your Support

Knowing that this project is useful to others gives me the motivation to keep working on it.
If you find Buildcage helpful, please consider giving it a star ⭐ on GitHub!

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. The authors and contributors are not liable for any damages, losses, or security incidents arising from the use of this software. Use at your own risk.

## License

The Buildcage source code is licensed under the MIT License. See [LICENSE](./LICENSE) file for details.

The Docker image includes third-party components under their own licenses (GPL, Apache 2.0, ISC, etc.). See [THIRD_PARTY_LICENSES](./THIRD_PARTY_LICENSES) for the full list.
