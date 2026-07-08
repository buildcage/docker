# Security Policy

## Scope

I welcome reports about both proxy engines (`transparent` and `explicit`):

- **Proxy bypass (`transparent`)** — ways to make network connections from `RUN` steps that evade the Buildcage proxy (other than the [known domain fronting limitation](./docs/security.md#known-limitations))
- **Network isolation escape (`transparent`)** — bypassing CNI isolation or iptables rules to reach the internet directly
- **DNS filtering bypass (`transparent`)** — bypassing the DNS redirect mechanism
- **Source policy bypass (`explicit`)** — ways to make network connections from `RUN` steps that evade the BuildKit source policy *compiled by buildcage* from your allowlist (e.g., a flaw in how buildcage translates rules into policy, or in how it injects/merges that policy via the gRPC `Solve` intercept)
- **GitHub Actions setup** — vulnerabilities in the `setup` or `report` actions (e.g., injection, credential leak)

The following are **out of scope** (please report to the respective projects instead):

- Vulnerabilities in BuildKit, Docker, or other upstream dependencies — including BuildKit's own `--proxy-network` isolation, its MITM/TLS handling, or its source-policy evaluation engine itself. Buildcage's `explicit`-engine scope is limited to the policy it compiles and injects, not BuildKit's enforcement of that policy.
- Issues that require the attacker to already have privileged access to the host
- Domain fronting via shared CDN infrastructure (documented in [Security Details](./docs/security.md#known-limitations))

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | :x: |
| 2.x     | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use [GitHub Security Advisories](https://github.com/dash14/buildcage/security/advisories/new) to report vulnerabilities privately:

1. Go to the **Security** tab of this repository
2. Click **Report a vulnerability**
3. Fill in the details and submit

### What to include

- Description of the vulnerability and its impact
- Steps to reproduce
- Proof of concept, if possible
- Affected versions

## Response Timeline

This project is maintained by a single developer. Realistic timelines:

- **Acknowledgment**: within 1 week
- **Validation**: a few days to 2 weeks, depending on complexity
- **Fix release**: varies by severity and complexity; critical issues are prioritized

I'll credit reporters in the security advisory unless they prefer to remain anonymous.

## Code Auditing

All code is public and I welcome security reviews. If you prefer to audit or control the code yourself, feel free to fork and self-host.
