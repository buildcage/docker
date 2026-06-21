# Self-Hosting Guide

This guide explains how to host your own Buildcage Docker image in a private GitHub repository. This is useful when you want to:

- Keep the build infrastructure private within your organization
- Control exactly which version of Buildcage is deployed and when updates are applied
- Meet compliance requirements that mandate use of an internal container registry

> [!NOTE]
> The upstream image (`ghcr.io/dash14/buildcage`) is verified at action startup via Sigstore, confirming it was built from the exact source commit of the release — sufficient provenance assurance for most use cases. Self-hosting adds operational overhead: keeping your fork in sync with upstream and managing your own signing pipeline.

## Prerequisites

- A GitHub Organizations account with **GitHub Team** or **Enterprise** plan (required for private repository packages)

## 1. Import the Repository

Since forking creates a public repository, use **GitHub's import** feature to create a private copy.

1. Go to [github.com/new/import](https://github.com/new/import)
2. Enter the source URL: `https://github.com/dash14/buildcage.git`
3. Select your organization as the owner
4. Set the repository name (e.g., `buildcage`)
5. Choose **Private**
6. Click **Begin import**

## 2. Build and Publish the Docker Image

Your imported repository already contains the **Build and Push Docker Image** workflow (`.github/workflows/docker-publish.yml`). This workflow builds the image from source and publishes it to your repository's GitHub Container Registry (GHCR).

To trigger the build:

1. Go to your repository on GitHub
2. Navigate to **Actions** > **Build and Push Docker Image**
3. Click **Run workflow**

Once complete, the image will be available at:

```
ghcr.io/<your_org>/buildcage
```

## 3. Configure Package Visibility

The published package needs to be accessible from the repositories that will use it.

1. Go to `github.com/<your_org>/buildcage/pkgs/container/buildcage`
2. Click **Package settings**
3. Under **Manage Actions access**, add the repositories that need to pull the image

## 4. Configure Actions Access

Allow other repositories in your organization to use the actions from your private repository:

1. Go to your Buildcage repository's **Settings** > **Actions** > **General**
2. Under **Access**, select **Accessible from repositories in the '\<your_org\>' organization**

## 5. Update Your Workflows

In the repositories where you want to use Buildcage, make two changes:

### Add GHCR login step

Add a login step before the Buildcage setup, and ensure the job has `packages: read` permission:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Login to GHCR
        uses: docker/login-action@650006c6eb7dba73a995cc03b0b2d7f5ca915bee # v4.2.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Start Buildcage
        id: buildcage
        uses: <your_org>/buildcage/setup@<40-char-sha> # vX.Y.Z
        with:
          proxy_mode: audit
      # ... rest of your workflow
```

Note that `uses:` now points to `<your_org>/buildcage/setup@<40-char-sha> # vX.Y.Z` instead of
`dash14/buildcage/setup@...`. Replace `<40-char-sha>` with the commit SHA of the release tag in
your fork. The same applies to the report action (`<your_org>/buildcage/report@<40-char-sha> # vX.Y.Z`).

### Image provenance verification

The setup action automatically verifies the Docker image's build provenance before pulling it. When you fork the repository:

- The `docker-publish.yml` workflow in your fork will sign images with **your fork's** GitHub Actions OIDC identity.
- The setup action will verify against your fork's workflow identity, so verification passes correctly.
- If you use `uses: <your_org>/buildcage/setup@<40-char-sha>`, `github.action_repository` resolves to `<your_org>/buildcage` and the image is pulled from `ghcr.io/<your_org>/buildcage` automatically.

> [!NOTE]
> The `buildcage_image` and `buildcage_version` parameters have been **removed** as of v2.1.
> External image overrides are no longer supported because they would bypass the provenance
> verification that guarantees image integrity. Self-hosting via fork is the supported alternative.

If provenance verification fails, the action will exit with an error. Make sure you have published at least one signed release in your fork before using a version tag.

You can independently confirm that a specific image digest has a valid signature using standard signing tooling, e.g. the cosign CLI:

```bash
cosign verify \
  --certificate-identity-regexp "^https://github.com/<your_org>/buildcage/.github/workflows/docker-publish.yml@refs/tags/.*$" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/<your_org>/buildcage@sha256:<digest>
```

## Syncing with Upstream

### Initial setup

Clone your private repository and register the upstream remote:

```bash
git clone https://github.com/<your_org>/buildcage.git
cd buildcage
git remote add upstream https://github.com/dash14/buildcage.git
```

### Pulling updates

Fetch the latest changes from the original repository and merge them into your copy:

```bash
git fetch upstream --tags --force
git merge upstream/main
git push origin HEAD --tags --force
```

After pushing a new version tag, the **Build and Push Docker Image** workflow will automatically trigger and publish the updated image.

> [!NOTE]
> If the workflow does not trigger automatically, run it manually from **Actions** > **Build and Push Docker Image** > **Run workflow**. The branch selection can be left as `main` — the workflow will build from the latest version tag.
