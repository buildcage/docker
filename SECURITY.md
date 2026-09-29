# Security Policy

## Scope

I welcome reports about both proxy engines (`universal` and `inspect`):

- **Proxy bypass (`universal`)**: ways to make network connections from `RUN` steps that evade the Buildcage proxy (other than the [known domain fronting limitation](./docs/security.md#domain-fronting))
- **Network isolation escape (`universal`)**: bypassing CNI isolation or iptables rules to reach the internet directly
- **DNS filtering bypass (`universal`)**: bypassing the DNS redirect mechanism
- **Rule bypass (`inspect`)**: ways to reach a destination, method or path that the rules do not permit: a request that escapes its path rule, a forged `Host` or SNI that changes where the proxy connects, or a name resolved to somewhere the rules never named
- **GitHub Actions setup**: vulnerabilities in the `setup` or `report` actions (e.g., injection, credential leak)

The following are **out of scope** (please report to the respective projects instead):

- Vulnerabilities in BuildKit, Docker, or other upstream dependencies
- Issues that require the attacker to already have privileged access to the host
- Domain fronting via shared CDN infrastructure (documented in [Security Details](./docs/security.md#domain-fronting))

## Supported Versions

| Version   | Supported          |
| --------- | ------------------ |
| 4.x       | :white_check_mark: |
| 1.x – 3.x | :x:                |

## Verifying Releases

Buildcage ships one Docker image at `ghcr.io/buildcage/docker`, published per engine: release
`vX.Y.Z` is tagged `X.Y.Z-inspect` for the default `inspect` engine and `X.Y.Z-universal` for the
universal engine (the image tag drops the release tag's leading `v` and carries the engine suffix).
Each release is signed
keylessly with [cosign](https://github.com/sigstore/cosign) and carries a GitHub build-provenance
attestation, both issued via GitHub Actions OIDC at release time. There is no long-lived signing key
to leak or rotate. The `setup` action verifies this automatically, in-process, on every run (see
[Image Provenance Verification](./docs/security.md#image-provenance-verification) for exactly how);
to verify a release manually instead:

```sh
cosign verify ghcr.io/buildcage/docker:X.Y.Z-<engine> \
  --certificate-identity 'https://github.com/buildcage/docker/.github/workflows/docker-publish.yml@refs/tags/vX.Y.Z' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify oci://ghcr.io/buildcage/docker:X.Y.Z-<engine> --repo buildcage/docker
```

The image tag is `X.Y.Z-<engine>`, but the identity names the release tag `vX.Y.Z`. Pinning the
exact workflow rejects a signature from any other workflow, ref or repository.

The Sigstore bundle for each release is also attached as a downloadable asset
(`buildcage-container-universal.sigstore.json` and `buildcage-container-inspect.sigstore.json`) on the
corresponding [GitHub Release](https://github.com/buildcage/docker/releases).

## Dependency Management

- Dependencies are pinned: JS packages via `pnpm-lock.yaml`, Go modules via `go.sum`, GitHub Actions
  by commit SHA (with a version comment for readability), and container base images by digest.
- [Renovate](https://docs.renovatebot.com/) opens dependency, GitHub Actions, and base-image update
  PRs automatically; each still goes through CI and manual review before merging.
- New dependencies are chosen for necessity, an OSI-approved license, and active maintenance; the
  standard library is preferred where practical.
- [Trivy](https://github.com/aquasecurity/trivy) rebuilds each engine's image from source and scans
  it for known vulnerabilities on a monthly schedule (and on manual dispatch), and Dependabot alerts
  are enabled on the repository; both report into this repository's Security tab.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use [GitHub Security Advisories](https://github.com/buildcage/docker/security/advisories/new) to report vulnerabilities privately:

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

All code is public and I welcome security reviews. If you prefer to audit the code yourself, feel free to fork it.
