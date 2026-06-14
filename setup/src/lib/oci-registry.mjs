/**
 * oci-registry.mjs — OCI registry I/O helpers
 *
 * All errors are thrown as SetupError (see errors.mjs).
 * Callers do not need to catch and re-wrap; just let them propagate.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SetupError } from "./errors.mjs";

const BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";

/**
 * Read the base64 Basic-auth credential for ghcr.io from Docker's config.json.
 * Returns the raw `auth` string (base64) if found, or null if not logged in.
 * Credential helpers (credsStore/credHelpers) are not supported — only direct
 * base64 auth written by `docker login` / `docker/login-action` is detected.
 */
export function readGhcrBasicAuth(_env = process.env, _readFileSync = readFileSync) {
  try {
    const configDir = _env.DOCKER_CONFIG ?? path.join(os.homedir(), ".docker");
    const config = JSON.parse(_readFileSync(path.join(configDir, "config.json"), "utf8"));
    for (const [key, value] of Object.entries(config.auths ?? {})) {
      const normalized = key.replace(/^https?:\/\//, "").replace(/\/$/, "");
      if (normalized === "ghcr.io" && typeof value.auth === "string" && value.auth) {
        return value.auth;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the manifest list digest using docker buildx imagetools.
 * Throws SetupError(NOT_FOUND) when the tag does not exist.
 * Throws SetupError(TRANSIENT) on network/registry errors.
 */
export function getManifestDigest(imageRef, _exec = execFileSync) {
  try {
    const result = _exec(
      "docker",
      [
        "buildx",
        "imagetools",
        "inspect",
        imageRef,
        "--format",
        "{{.Manifest.Digest}}",
      ],
      { stdio: "pipe", encoding: "utf8" },
    );
    const digest = result.trim();
    if (!digest) {
      throw new SetupError(
        `Docker image not found: ${imageRef}. ` +
          `Make sure the action ref corresponds to a published release.`,
        "NOT_FOUND",
      );
    }
    return digest;
  } catch (err) {
    if (err instanceof SetupError) throw err;
    const msg = (err.stderr || err.message || "").toString();
    if (msg.includes("not found")) {
      throw new SetupError(
        `Docker image not found: ${imageRef}. ` +
          `Make sure the action ref corresponds to a published release.`,
        "NOT_FOUND",
      );
    }
    throw new SetupError(
      `Transient error fetching image digest for ${imageRef}: ${msg}`,
      "TRANSIENT",
    );
  }
}

/**
 * Fetch a pull token via Docker Token Authentication.
 *
 * If Docker credentials for the registry are available (basicAuth from
 * readGhcrBasicAuth), uses Basic auth directly — no anonymous attempt.
 * Otherwise falls back to anonymous access (public packages).
 *
 * @param {string} registry  - Registry hostname (e.g. "ghcr.io")
 * @param {string} repo      - Repository path (e.g. "owner/repo")
 * @param {string|null} basicAuth - base64 auth from Docker config, or null
 * @param {function} [_fetch]
 */
export async function fetchRegistryToken(registry, repo, basicAuth, _fetch = fetch) {
  const url = `https://${registry}/token?scope=repository:${repo}:pull&service=${registry}`;

  if (basicAuth) {
    // Docker login credentials found — use Basic auth directly, no anonymous attempt.
    try {
      const resp = await _fetch(url, { headers: { Authorization: `Basic ${basicAuth}` } });
      if (resp.status >= 500) {
        throw new SetupError(
          `Transient error from ${registry} token endpoint: HTTP ${resp.status}`,
          "TRANSIENT",
        );
      }
      if (resp.ok) {
        return (await resp.json()).token;
      }
      throw new SetupError(
        `Registry authentication failed: HTTP ${resp.status}. ` +
          `The credentials in Docker config may be expired — run \`docker login ${registry}\` again.`,
        "TOKEN_ERROR",
      );
    } catch (err) {
      if (err instanceof SetupError) throw err;
      throw new SetupError(
        `Transient error fetching registry token: ${err.message}`,
        "TRANSIENT",
      );
    }
  }

  // No Docker credentials — try anonymous access (public packages).
  try {
    const resp = await _fetch(url);
    if (resp.status >= 500) {
      throw new SetupError(
        `Transient error from ${registry} token endpoint: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (resp.ok) {
      return (await resp.json()).token;
    }
    throw new SetupError(
      `Failed to get registry token: HTTP ${resp.status}. ` +
        `The package may be private. Run \`docker login ${registry}\` ` +
        `(or use docker/login-action with 'packages: read') before this action.`,
      "TOKEN_ERROR",
    );
  } catch (err) {
    if (err instanceof SetupError) throw err;
    throw new SetupError(
      `Transient error fetching registry token: ${err.message}`,
      "TRANSIENT",
    );
  }
}

/**
 * Pull the Sigstore Bundle from the OCI registry.
 * Tries the OCI 1.1 Referrers API first; falls back to the sha256-<hex> tag scheme.
 *
 * Throws SetupError(NOT_FOUND) when no bundle exists for this digest.
 * Throws SetupError(TRANSIENT) on network or 5xx errors.
 */
export async function fetchBundle(registry, repo, digest, token, _fetch = fetch) {
  const api = `https://${registry}/v2/${repo}`;
  const headers = { Authorization: `Bearer ${token}` };

  // Try OCI 1.1 Referrers API
  try {
    const refResp = await _fetch(
      `${api}/referrers/${digest}?artifactType=${encodeURIComponent(BUNDLE_MEDIA_TYPE)}`,
      { headers },
    );
    if (refResp.status >= 500) {
      throw new SetupError(
        `Transient error from referrers API: HTTP ${refResp.status}`,
        "TRANSIENT",
      );
    }
    if (refResp.ok) {
      const referrers = await refResp.json();
      const manifest = (referrers.manifests ?? []).find(
        (m) => m.artifactType === BUNDLE_MEDIA_TYPE,
      );
      if (manifest) {
        return fetchBundleFromManifestDigest(api, manifest.digest, headers, _fetch);
      }
      // Referrers API responded but no matching artifactType → fall through to tag fallback
    }
  } catch (err) {
    if (err instanceof SetupError) throw err;
    throw new SetupError(
      `Transient error fetching referrers: ${err.message}`,
      "TRANSIENT",
    );
  }

  // Fallback: sha256-<hex> tag scheme.
  // GHCR maintains this as an OCI Image Index (Referrers Tag Schema) whose
  // manifests[] entries point to individual referrer artifacts.  Accept both
  // the image-index and the legacy direct-manifest-with-layers formats.
  const fallbackTag = digest.replace(":", "-");
  try {
    const tagResp = await _fetch(`${api}/manifests/${fallbackTag}`, {
      headers: {
        ...headers,
        Accept: [
          "application/vnd.oci.image.index.v1+json",
          "application/vnd.oci.image.manifest.v1+json",
        ].join(", "),
      },
    });

    // 404: tag doesn't exist. 400: some registries return Bad Request instead of
    // 404 when the sha256-<hex> tag name is unrecognised (e.g. no Referrers tag
    // support at all). Treat both as "no bundle" rather than a transient error.
    if (tagResp.status === 404 || tagResp.status === 400) {
      throw new SetupError(
        `No Sigstore bundle found for digest ${digest}. ` +
          `The image may not have been signed with --new-bundle-format.`,
        "NOT_FOUND",
      );
    }
    if (tagResp.status >= 500) {
      throw new SetupError(
        `Transient error from fallback tag API: HTTP ${tagResp.status}`,
        "TRANSIENT",
      );
    }
    if (tagResp.status === 401 || tagResp.status === 403) {
      throw new SetupError(
        `Registry denied access to fallback tag: HTTP ${tagResp.status}. ` +
          `For private repositories, ensure the runner is authenticated to the registry.`,
        "TRANSIENT",
      );
    }
    if (!tagResp.ok) {
      throw new SetupError(
        `Unexpected error fetching fallback tag: HTTP ${tagResp.status}`,
        "NOT_FOUND",
      );
    }

    const tagManifest = await tagResp.json();

    // OCI Referrers Tag Schema: the tag is an Image Index whose manifests[] entries
    // are descriptors for individual referrer artifacts.
    if (Array.isArray(tagManifest.manifests)) {
      for (const m of tagManifest.manifests) {
        if (m.mediaType !== "application/vnd.oci.image.manifest.v1+json") continue;
        // Standard: m.artifactType matches directly.
        if (m.artifactType === BUNDLE_MEDIA_TYPE) {
          return fetchBundleFromManifestDigest(api, m.digest, headers, _fetch);
        }
        // GHCR stores config.mediaType ("application/vnd.oci.empty.v1+json")
        // as artifactType in the index instead of the manifest's own artifactType.
        // Inspect each sub-manifest to find the actual Sigstore bundle.
        const subResp = await _fetch(`${api}/manifests/${m.digest}`, {
          headers: {
            ...headers,
            Accept: "application/vnd.oci.image.manifest.v1+json",
          },
        });
        if (!subResp.ok) continue;
        const sub = await subResp.json();
        if (sub.artifactType !== BUNDLE_MEDIA_TYPE) continue;
        const layer = (sub.layers ?? []).find((l) => l.mediaType === BUNDLE_MEDIA_TYPE);
        if (!layer) continue;
        return fetchBundleBlob(api, layer.digest, headers, _fetch);
      }
      throw new SetupError(
        `No Sigstore bundle found for digest ${digest}. ` +
          `The image may not have been signed with --new-bundle-format.`,
        "NOT_FOUND",
      );
    }

    // Legacy format: the bundle is stored directly as a layer in the manifest.
    const layer = (tagManifest.layers ?? []).find(
      (l) => l.mediaType === BUNDLE_MEDIA_TYPE,
    );
    if (!layer) {
      throw new SetupError(
        `No Sigstore bundle found for digest ${digest}. ` +
          `The image may not have been signed with --new-bundle-format.`,
        "NOT_FOUND",
      );
    }
    return fetchBundleBlob(api, layer.digest, headers, _fetch);
  } catch (err) {
    if (err instanceof SetupError) throw err;
    throw new SetupError(
      `Transient error fetching fallback tag: ${err.message}`,
      "TRANSIENT",
    );
  }
}

// Fetch an OCI image manifest by digest, then fetch the bundle blob from its first
// layer with mediaType === BUNDLE_MEDIA_TYPE.
async function fetchBundleFromManifestDigest(api, manifestDigest, headers, _fetch = fetch) {
  try {
    const resp = await _fetch(`${api}/manifests/${manifestDigest}`, {
      headers: { ...headers, Accept: "application/vnd.oci.image.manifest.v1+json" },
    });
    if (resp.status >= 500) {
      throw new SetupError(
        `Transient error fetching bundle manifest: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new SetupError(
        `Registry denied access to bundle manifest: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (!resp.ok) {
      throw new SetupError(
        `Failed to fetch bundle manifest: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    const manifest = await resp.json();
    const layer = (manifest.layers ?? []).find((l) => l.mediaType === BUNDLE_MEDIA_TYPE);
    if (!layer) {
      throw new SetupError(
        "No Sigstore bundle layer found in bundle manifest",
        "NOT_FOUND",
      );
    }
    return fetchBundleBlob(api, layer.digest, headers, _fetch);
  } catch (err) {
    if (err instanceof SetupError) throw err;
    throw new SetupError(
      `Transient error fetching bundle manifest: ${err.message}`,
      "TRANSIENT",
    );
  }
}

async function fetchBundleBlob(api, blobDigest, headers, _fetch = fetch) {
  try {
    const resp = await _fetch(`${api}/blobs/${blobDigest}`, { headers });
    if (resp.status >= 500) {
      throw new SetupError(
        `Transient error fetching bundle blob: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new SetupError(
        `Registry denied access fetching bundle blob: HTTP ${resp.status}. ` +
          `For private repositories, ensure the runner is authenticated to the registry.`,
        "TRANSIENT",
      );
    }
    if (!resp.ok) {
      throw new SetupError(
        `Failed to fetch bundle blob: HTTP ${resp.status}`,
        "NOT_FOUND",
      );
    }
    return resp.json();
  } catch (err) {
    if (err instanceof SetupError) throw err;
    throw new SetupError(
      `Transient error fetching bundle blob: ${err.message}`,
      "TRANSIENT",
    );
  }
}
