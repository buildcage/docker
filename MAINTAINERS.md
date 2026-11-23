# Maintainers

## Current Maintainer

| Name | GitHub | Role | Access |
|------|--------|------|--------|
| dash14 | [@dash14](https://github.com/dash14) | Maintainer | Repository admin (write access, branch protection, secrets), GHCR package publishing, GitHub Security Advisories |

## Responsibilities

The maintainer is responsible for:

- Reviewing and merging pull requests
- Triaging and responding to issues
- Cutting releases and publishing the Docker image to GHCR
- Responding to security reports (see [SECURITY.md](./SECURITY.md))
- Maintaining project documentation

## Cutting a release

1. Merge a `chore: release vX.Y.Z` pull request that sets `version` in `package.json` to `X.Y.Z` and
   rebuilds `dist/`. A prerelease needs its own, with the full prerelease version.
2. While that merge is still the head of `main`, run `release.yml` from `main` with the tag
   `vX.Y.Z`. It refuses a tag other than `package.json`'s version, or a head that did not set it.

The action finds its image through the version in its own code and trusts that version's tag not to
move, so keep the repository's immutable releases setting on.

## Release secrets

`TAG_CREATION_TOKEN` pushes the release tag in `release.yml`. It is a personal access token rather
than `GITHUB_TOKEN` because a tag pushed with `GITHUB_TOKEN` does not trigger `docker-publish.yml`.
Keep it a fine-grained token limited to this repository, with **Contents: Read and write** and no
other permissions, and give it an expiry.
