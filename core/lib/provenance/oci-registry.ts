/**
 * oci-registry.ts — OCI registry I/O helpers
 *
 * All errors are thrown as VerifyImageError (see errors.ts).
 * Callers do not need to catch and re-wrap; just let them propagate.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { VerifyImageError } from "./errors.ts";
import { errorMessage } from "../errors.ts";

const BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";

interface OciDescriptor {
  mediaType?: string;
  artifactType?: string;
  digest: string;
}

export interface HeadersLike {
  get(name: string): string | null;
}

// Narrowed to the subset of the global fetch() signature this module
// actually uses, so tests can pass lightweight mock responses/functions
// instead of constructing real Response objects.
export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  headers?: HeadersLike;
  json?(): Promise<any>;
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchLikeResponse>;

// Narrowed to the one overload of node:fs's readFileSync this module actually
// calls, so tests can pass a simple stub instead of the fully overloaded type.
export type ReadFileSyncLike = (path: string, encoding: string) => string;

/**
 * Read the base64 Basic-auth credential for ghcr.io from Docker's config.json.
 * Returns the raw `auth` string (base64) if found, or null if not logged in.
 * Credential helpers (credsStore/credHelpers) are not supported — only direct
 * base64 auth written by `docker login` / `docker/login-action` is detected.
 */
export function readGhcrBasicAuth(
  _env: NodeJS.ProcessEnv = process.env,
  _readFileSync: ReadFileSyncLike = readFileSync as ReadFileSyncLike,
): string | null {
  try {
    const configDir = _env.DOCKER_CONFIG ?? path.join(os.homedir(), ".docker");
    const config: { auths?: Record<string, { auth?: string }> } = JSON.parse(
      _readFileSync(path.join(configDir, "config.json"), "utf8"),
    );
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
 * Fetch the manifest digest for a container image tag via the OCI registry API.
 * Uses HEAD /v2/{repo}/manifests/{tag} and reads the Docker-Content-Digest header.
 *
 * Throws VerifyImageError(NOT_FOUND) when the tag does not exist.
 * Throws VerifyImageError(TRANSIENT) on network or 5xx errors.
 */
export async function fetchManifestDigest(
  registry: string,
  repo: string,
  tag: string,
  token: string,
  _fetch: FetchLike = fetch,
): Promise<string> {
  const url = `https://${registry}/v2/${repo}/manifests/${tag}`;
  // Accept only index/manifest-list types so the registry returns the image index
  // digest — not a per-platform manifest digest. The Sigstore bundle is signed
  // against the index digest, so content-negotiating down to a platform manifest
  // would cause the bundle lookup to fail.
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: [
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
    ].join(", "),
  };

  try {
    const resp = await _fetch(url, { method: "HEAD", headers });
    if (resp.status === 404) {
      throw new VerifyImageError(
        `Docker image not found: ${registry}/${repo}:${tag}. ` +
          `Make sure the action ref corresponds to a published release.`,
        "NOT_FOUND",
      );
    }
    if (resp.status >= 500) {
      throw new VerifyImageError(
        `Transient error fetching manifest for ${registry}/${repo}:${tag}: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new VerifyImageError(
        `Registry denied access to manifest for ${registry}/${repo}:${tag}: HTTP ${resp.status}. ` +
          `For private repositories, ensure the runner is authenticated to the registry.`,
        "TRANSIENT",
      );
    }
    if (!resp.ok) {
      throw new VerifyImageError(
        `Failed to fetch manifest for ${registry}/${repo}:${tag}: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    const digest = resp.headers!.get("Docker-Content-Digest");
    if (!digest) {
      throw new VerifyImageError(
        `No digest in manifest response for ${registry}/${repo}:${tag}`,
        "TRANSIENT",
      );
    }
    return digest;
  } catch (err) {
    if (err instanceof VerifyImageError) throw err;
    throw new VerifyImageError(
      `Transient error fetching manifest digest for ${registry}/${repo}:${tag}: ${errorMessage(err)}`,
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
 */
export async function fetchRegistryToken(
  registry: string,
  repo: string,
  basicAuth: string | null,
  _fetch: FetchLike = fetch,
): Promise<string> {
  const url = `https://${registry}/token?scope=repository:${repo}:pull&service=${registry}`;

  if (basicAuth) {
    // Docker login credentials found — use Basic auth directly, no anonymous attempt.
    try {
      const resp = await _fetch(url, { headers: { Authorization: `Basic ${basicAuth}` } });
      if (resp.status >= 500) {
        throw new VerifyImageError(
          `Transient error from ${registry} token endpoint: HTTP ${resp.status}`,
          "TRANSIENT",
        );
      }
      if (resp.ok) {
        return (await resp.json!()).token;
      }
      throw new VerifyImageError(
        `Registry authentication failed: HTTP ${resp.status}. ` +
          `The credentials in Docker config may be expired — run \`docker login ${registry}\` again.`,
        "TOKEN_ERROR",
      );
    } catch (err) {
      if (err instanceof VerifyImageError) throw err;
      throw new VerifyImageError(
        `Transient error fetching registry token: ${errorMessage(err)}`,
        "TRANSIENT",
      );
    }
  }

  // No Docker credentials — try anonymous access (public packages).
  try {
    const resp = await _fetch(url);
    if (resp.status >= 500) {
      throw new VerifyImageError(
        `Transient error from ${registry} token endpoint: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (resp.ok) {
      return (await resp.json!()).token;
    }
    throw new VerifyImageError(
      `Failed to get registry token: HTTP ${resp.status}. ` +
        `The package may be private. Run \`docker login ${registry}\` ` +
        `(or use docker/login-action with 'packages: read') before this action.`,
      "TOKEN_ERROR",
    );
  } catch (err) {
    if (err instanceof VerifyImageError) throw err;
    throw new VerifyImageError(
      `Transient error fetching registry token: ${errorMessage(err)}`,
      "TRANSIENT",
    );
  }
}

/**
 * Pull the Sigstore Bundle from the OCI registry.
 * Tries the OCI 1.1 Referrers API first; falls back to the sha256-<hex> tag scheme.
 *
 * Throws VerifyImageError(NOT_FOUND) when no bundle exists for this digest.
 * Throws VerifyImageError(TRANSIENT) on network or 5xx errors.
 */
export async function fetchBundle(
  registry: string,
  repo: string,
  digest: string,
  token: string,
  _fetch: FetchLike = fetch,
): Promise<unknown> {
  const api = `https://${registry}/v2/${repo}`;
  const headers = { Authorization: `Bearer ${token}` };

  // Try OCI 1.1 Referrers API
  try {
    const refResp = await _fetch(
      `${api}/referrers/${digest}?artifactType=${encodeURIComponent(BUNDLE_MEDIA_TYPE)}`,
      { headers },
    );
    if (refResp.status >= 500) {
      throw new VerifyImageError(
        `Transient error from referrers API: HTTP ${refResp.status}`,
        "TRANSIENT",
      );
    }
    if (refResp.ok) {
      const referrers = await refResp.json!();
      const manifest = (referrers.manifests ?? []).find(
        (m: OciDescriptor) => m.artifactType === BUNDLE_MEDIA_TYPE,
      );
      if (manifest) {
        return fetchBundleFromManifestDigest(api, manifest.digest, headers, _fetch);
      }
      // Referrers API responded but no matching artifactType → fall through to tag fallback
    }
  } catch (err) {
    if (err instanceof VerifyImageError) throw err;
    throw new VerifyImageError(
      `Transient error fetching referrers: ${errorMessage(err)}`,
      "TRANSIENT",
    );
  }

  // Fallback: sha256-<hex> tag scheme.
  // The OCI Referrers Tag Schema represents this as an OCI Image Index whose
  // manifests[] entries point to individual referrer artifacts (as served by
  // registries such as GHCR).  Accept both the image-index and the legacy
  // direct-manifest-with-layers formats.
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
      throw new VerifyImageError(
        `No Sigstore bundle found for digest ${digest}. ` +
          `The image may not have been signed with --new-bundle-format.`,
        "NOT_FOUND",
      );
    }
    if (tagResp.status >= 500) {
      throw new VerifyImageError(
        `Transient error from fallback tag API: HTTP ${tagResp.status}`,
        "TRANSIENT",
      );
    }
    if (tagResp.status === 401 || tagResp.status === 403) {
      throw new VerifyImageError(
        `Registry denied access to fallback tag: HTTP ${tagResp.status}. ` +
          `For private repositories, ensure the runner is authenticated to the registry.`,
        "TRANSIENT",
      );
    }
    if (!tagResp.ok) {
      throw new VerifyImageError(
        `Unexpected error fetching fallback tag: HTTP ${tagResp.status}`,
        "NOT_FOUND",
      );
    }

    const tagManifest = await tagResp.json!();

    // OCI Referrers Tag Schema: the tag is an Image Index whose manifests[] entries
    // are descriptors for individual referrer artifacts.
    if (Array.isArray(tagManifest.manifests)) {
      for (const m of tagManifest.manifests as OciDescriptor[]) {
        if (m.mediaType !== "application/vnd.oci.image.manifest.v1+json") continue;
        // Standard: m.artifactType matches directly.
        if (m.artifactType === BUNDLE_MEDIA_TYPE) {
          return fetchBundleFromManifestDigest(api, m.digest, headers, _fetch);
        }
        // Per the OCI Distribution Spec, a referrer descriptor's artifactType falls back to the
        // manifest's config.mediaType when the manifest has no top-level artifactType. As a result
        // the descriptor may carry the empty-config type ("application/vnd.oci.empty.v1+json")
        // rather than the bundle type (observed with GHCR). This is a spec-valid fallback, so resolve
        // the real type by inspecting the sub-manifest's own artifactType / layer mediaType.
        const subResp = await _fetch(`${api}/manifests/${m.digest}`, {
          headers: {
            ...headers,
            Accept: "application/vnd.oci.image.manifest.v1+json",
          },
        });
        if (!subResp.ok) continue;
        const sub = await subResp.json!();
        if (sub.artifactType !== BUNDLE_MEDIA_TYPE) continue;
        const layer = (sub.layers ?? []).find(
          (l: OciDescriptor) => l.mediaType === BUNDLE_MEDIA_TYPE,
        );
        if (!layer) continue;
        return fetchBundleBlob(api, layer.digest, headers, _fetch);
      }
      throw new VerifyImageError(
        `No Sigstore bundle found for digest ${digest}. ` +
          `The image may not have been signed with --new-bundle-format.`,
        "NOT_FOUND",
      );
    }

    // Legacy format: the bundle is stored directly as a layer in the manifest.
    const layer = (tagManifest.layers ?? []).find(
      (l: OciDescriptor) => l.mediaType === BUNDLE_MEDIA_TYPE,
    );
    if (!layer) {
      throw new VerifyImageError(
        `No Sigstore bundle found for digest ${digest}. ` +
          `The image may not have been signed with --new-bundle-format.`,
        "NOT_FOUND",
      );
    }
    return fetchBundleBlob(api, layer.digest, headers, _fetch);
  } catch (err) {
    if (err instanceof VerifyImageError) throw err;
    throw new VerifyImageError(
      `Transient error fetching fallback tag: ${errorMessage(err)}`,
      "TRANSIENT",
    );
  }
}

// Fetch an OCI image manifest by digest, then fetch the bundle blob from its first
// layer with mediaType === BUNDLE_MEDIA_TYPE.
async function fetchBundleFromManifestDigest(
  api: string,
  manifestDigest: string,
  headers: Record<string, string>,
  _fetch: FetchLike = fetch,
): Promise<unknown> {
  try {
    const resp = await _fetch(`${api}/manifests/${manifestDigest}`, {
      headers: { ...headers, Accept: "application/vnd.oci.image.manifest.v1+json" },
    });
    if (resp.status >= 500) {
      throw new VerifyImageError(
        `Transient error fetching bundle manifest: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new VerifyImageError(
        `Registry denied access to bundle manifest: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (!resp.ok) {
      throw new VerifyImageError(
        `Failed to fetch bundle manifest: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    const manifest = await resp.json!();
    const layer = (manifest.layers ?? []).find(
      (l: OciDescriptor) => l.mediaType === BUNDLE_MEDIA_TYPE,
    );
    if (!layer) {
      throw new VerifyImageError("No Sigstore bundle layer found in bundle manifest", "NOT_FOUND");
    }
    return fetchBundleBlob(api, layer.digest, headers, _fetch);
  } catch (err) {
    if (err instanceof VerifyImageError) throw err;
    throw new VerifyImageError(
      `Transient error fetching bundle manifest: ${errorMessage(err)}`,
      "TRANSIENT",
    );
  }
}

async function fetchBundleBlob(
  api: string,
  blobDigest: string,
  headers: Record<string, string>,
  _fetch: FetchLike = fetch,
): Promise<unknown> {
  try {
    const resp = await _fetch(`${api}/blobs/${blobDigest}`, { headers });
    if (resp.status >= 500) {
      throw new VerifyImageError(
        `Transient error fetching bundle blob: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new VerifyImageError(
        `Registry denied access fetching bundle blob: HTTP ${resp.status}. ` +
          `For private repositories, ensure the runner is authenticated to the registry.`,
        "TRANSIENT",
      );
    }
    if (!resp.ok) {
      throw new VerifyImageError(`Failed to fetch bundle blob: HTTP ${resp.status}`, "NOT_FOUND");
    }
    return resp.json!();
  } catch (err) {
    if (err instanceof VerifyImageError) throw err;
    throw new VerifyImageError(
      `Transient error fetching bundle blob: ${errorMessage(err)}`,
      "TRANSIENT",
    );
  }
}
