# Security Policy

## Scope

I welcome reports about:

- **Proxy bypass** — ways to make network connections from `RUN` steps that evade the buildcage proxy (other than the [known domain fronting limitation](./README.md#domain-fronting))
- **Network isolation escape** — bypassing CNI isolation or iptables rules to reach the internet directly
- **GitHub Actions setup** — vulnerabilities in the `setup` or `report` actions (e.g., injection, credential leak)
- **DNS filtering bypass** — bypassing the DNS redirect mechanism

The following are **out of scope** (please report to the respective projects instead):

- Vulnerabilities in BuildKit, Docker, or other upstream dependencies
- Issues that require the attacker to already have privileged access to the host
- Domain fronting via shared CDN infrastructure (documented in README's [Security Considerations](./README.md#security-considerations))

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | :white_check_mark: |

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
