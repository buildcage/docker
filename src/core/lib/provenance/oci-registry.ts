/**
 * OCI registry transport, auth and manifest reads.
 *
 * All errors are thrown as VerifyImageError (see errors.ts).
 */

import { errorMessage } from "../errors.ts";
import { VerifyImageError } from "./errors.ts";

/** Appended to every 401/403 message: the status alone reads as a bug in the
 *  action, when by far the likeliest cause is an unauthenticated runner. */
const PRIVATE_REPO_HINT =
  "For private repositories, ensure the runner is authenticated to the registry.";

export interface OciDescriptor {
  mediaType?: string;
  artifactType?: string;
  digest: string;
  platform?: { os?: string };
}

const MANIFEST_MEDIA_TYPES = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
];

const INDEX_MEDIA_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];

/**
 * Runs a registry call, turning anything that isn't already a VerifyImageError
 * (a DNS failure, a socket reset, a malformed JSON body) into a transient
 * one naming what was being fetched.
 *
 * `what` is the phrase after "Transient error", e.g. "fetching bundle blob".
 */
export async function withRegistryErrors<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof VerifyImageError) throw err;
    throw new VerifyImageError(`Transient error ${what}: ${errorMessage(err)}`, "TRANSIENT");
  }
}

export type RegistryFailure = "TRANSIENT" | "NOT_FOUND";

/**
 * The response-status ladder every registry call needs, in one place.
 *
 * `subject` names what was being fetched ("bundle blob", "fallback tag") and
 * goes into each message. `onFailure` classifies a response the ladder below
 * has no more specific reading for: TRANSIENT where a retry could still
 * succeed, NOT_FOUND where the thing asked for is absent. A caller that reads a
 * particular status as something more specific checks for it before calling
 * this.
 */
export function assertRegistryOk(
  resp: FetchLikeResponse,
  subject: string,
  onFailure: RegistryFailure,
): void {
  if (resp.status >= 500) {
    throw new VerifyImageError(
      `Transient error fetching ${subject}: HTTP ${resp.status}`,
      "TRANSIENT",
    );
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new VerifyImageError(
      `Registry denied access to ${subject}: HTTP ${resp.status}. ` + PRIVATE_REPO_HINT,
      "TRANSIENT",
    );
  }
  if (!resp.ok) {
    throw new VerifyImageError(`Failed to fetch ${subject}: HTTP ${resp.status}`, onFailure);
  }
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
  arrayBuffer?(): Promise<ArrayBuffer>;
}

// The OCI digest algorithms this module can verify.
const CONTENT_DIGEST_ALGORITHMS: Record<string, { subtle: string; hexLength: number }> = {
  sha256: { subtle: "SHA-256", hexLength: 64 },
  sha384: { subtle: "SHA-384", hexLength: 96 },
  sha512: { subtle: "SHA-512", hexLength: 128 },
};

/** A registry-supplied digest goes into request paths, so only the OCI shape passes. */
export function isOciDigest(digest: unknown): digest is string {
  if (typeof digest !== "string") return false;
  const match = /^([a-z0-9]+):([0-9a-f]+)$/.exec(digest);
  return match !== null && CONTENT_DIGEST_ALGORITHMS[match[1]]?.hexLength === match[2].length;
}

export function assertOciDigest(digest: unknown, where: string): string {
  if (isOciDigest(digest)) return digest;
  throw new VerifyImageError(
    `Malformed digest in ${where}: ${JSON.stringify(digest)}`,
    "VERIFY_FAILED",
  );
}

/**
 * Confirm a content-addressed document's bytes hash to the digest that
 * addressed it, so the registry cannot answer a digest read with other content.
 * The signature covers the top-level image digest and the config-label chain
 * hangs off it, but the labels themselves are not signed, so this is what ties
 * them back to the signed digest.
 *
 * Hashes with the algorithm the digest itself names rather than assuming
 * sha256, so a hop addressed by another OCI algorithm is verified, not falsely
 * rejected. Uses the Web Crypto global rather than node:crypto: the
 * registry-stub test helper imports this module's types under tsconfig.qjs.json,
 * which carries no node types, and this module already reads `fetch` from the
 * same lib.
 */
async function assertContentDigest(
  bytes: Uint8Array<ArrayBuffer>,
  expected: string,
  what: string,
): Promise<void> {
  const [algorithm] = expected.split(":", 1);
  const subtleName = CONTENT_DIGEST_ALGORITHMS[algorithm]?.subtle;
  if (!subtleName) {
    throw new VerifyImageError(
      `Cannot verify ${what}: unsupported digest algorithm in ${expected}.`,
      "VERIFY_FAILED",
    );
  }
  const hash = await crypto.subtle.digest(subtleName, bytes);
  const actual =
    `${algorithm}:` +
    Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) {
    throw new VerifyImageError(
      `Content digest mismatch for ${what}: the registry served ${actual}, ` +
        `not the requested ${expected}.`,
      "VERIFY_FAILED",
    );
  }
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
}

export type FetchLike = (url: string, init?: FetchInit) => Promise<FetchLikeResponse>;

/**
 * One repository's API endpoint with a pull token attached. Everything that
 * reads from the registry goes through it, so the base URL, the Authorization
 * header and the injected fetch are held once rather than threaded through
 * every call.
 */
export interface RegistryClient {
  /**
   * GET a JSON document under the repository, e.g. `/manifests/<digest>`.
   * `what` names it in any error.
   */
  getJson(
    path: string,
    what: string,
    opts?: {
      /** Media types to negotiate, where the endpoint needs narrowing. */
      accept?: string;
      /** How a non-ok response reads, a 404 aside. Defaults to TRANSIENT. */
      onFailure?: RegistryFailure;
      /**
       * Read a 404 as the document being absent. Defaults to true; pass
       * false where the registry has already pointed at the document, so a 404
       * contradicts it rather than answering.
       */
      absentOn404?: boolean;
      /**
       * The `sha256:<hex>` this document is addressed by. When set, the fetched
       * bytes are verified against it before they are parsed, so the registry
       * cannot answer a content-addressed read with different content.
       */
      verifyDigest?: string;
    },
  ): Promise<any>;
  /** Fetch a path, leaving the response to a caller with its own status ladder. */
  request(path: string, init?: { method?: string; accept?: string }): Promise<FetchLikeResponse>;
}

export function registryClient(
  registry: string,
  repo: string,
  token: string,
  _fetch: FetchLike,
): RegistryClient {
  const api = `https://${registry}/v2/${repo}`;
  const authorization = `Bearer ${token}`;

  const request: RegistryClient["request"] = (path, init = {}) =>
    _fetch(`${api}${path}`, {
      method: init.method,
      headers: init.accept
        ? { Authorization: authorization, Accept: init.accept }
        : { Authorization: authorization },
    });

  return {
    request,
    getJson: (path, what, opts = {}) =>
      withRegistryErrors(`fetching ${what}`, async () => {
        const resp = await request(path, { accept: opts.accept });
        if (resp.status === 404 && opts.absentOn404 !== false) {
          throw new VerifyImageError(`Not found: ${what}`, "NOT_FOUND");
        }
        assertRegistryOk(resp, what, opts.onFailure ?? "TRANSIENT");
        if (opts.verifyDigest !== undefined) {
          // The bytes as served: text() would drop a BOM and replace invalid UTF-8.
          const bytes = new Uint8Array(await resp.arrayBuffer!());
          await assertContentDigest(bytes, opts.verifyDigest, what);
          return JSON.parse(new TextDecoder().decode(bytes));
        }
        return await resp.json!();
      }),
  };
}

/**
 * Fetch the manifest digest for a container image tag via the OCI registry API.
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
  const client = registryClient(registry, repo, token, _fetch);
  const image = `${registry}/${repo}:${tag}`;

  return withRegistryErrors(`fetching manifest digest for ${image}`, async () => {
    // Accept only index/manifest-list types so the registry returns the image
    // index digest, not a per-platform manifest digest. The Sigstore bundle is
    // signed against the index digest, so content-negotiating down to a
    // platform manifest would make the bundle lookup fail.
    const resp = await client.request(`/manifests/${tag}`, {
      method: "HEAD",
      accept: INDEX_MEDIA_TYPES.join(", "),
    });
    if (resp.status === 404) {
      throw new VerifyImageError(
        `Docker image not found: ${image}. ` +
          `Make sure the action ref corresponds to a published release.`,
        "NOT_FOUND",
      );
    }
    assertRegistryOk(resp, `manifest for ${image}`, "TRANSIENT");
    const digest = resp.headers!.get("Docker-Content-Digest");
    if (!digest) {
      throw new VerifyImageError(`No digest in manifest response for ${image}`, "TRANSIENT");
    }
    return assertOciDigest(digest, `manifest response for ${image}`);
  });
}

/**
 * Fetch an image's config labels, walking index to platform manifest to config
 * blob. Every hop is addressed by a digest read from the one before, so the
 * chain hangs off the digest the signature covers rather than any tag, and each
 * hop's bytes are verified against that digest before they are read: the labels
 * decide which engine the image is accepted for and are not themselves signed,
 * so the chain back to the signed digest has to be checked, not just followed.
 */
export async function fetchImageConfigLabels(
  registry: string,
  repo: string,
  digest: string,
  token: string,
  _fetch: FetchLike = fetch,
): Promise<Record<string, string>> {
  const client = registryClient(registry, repo, token, _fetch);
  const image = `${registry}/${repo}@${digest}`;

  const root = await client.getJson(`/manifests/${digest}`, `manifest for ${image}`, {
    accept: [...INDEX_MEDIA_TYPES, ...MANIFEST_MEDIA_TYPES].join(", "),
    verifyDigest: digest,
  });

  let manifest = root;
  if (Array.isArray(root.manifests)) {
    // buildx attaches an attestation manifest per platform, marked unknown/unknown.
    // Every real platform carries the same labels, so the first one answers for all.
    const platform = (root.manifests as OciDescriptor[]).find(
      (m) => m.platform?.os && m.platform.os !== "unknown",
    );
    if (!platform) {
      throw new VerifyImageError(`No platform manifest in image index ${image}`, "NOT_FOUND");
    }
    const platformDigest = assertOciDigest(platform.digest, `image index ${image}`);
    manifest = await client.getJson(
      `/manifests/${platformDigest}`,
      `platform manifest for ${image}`,
      { accept: MANIFEST_MEDIA_TYPES.join(", "), verifyDigest: platformDigest },
    );
  }

  if (!manifest.config?.digest) {
    throw new VerifyImageError(`No image config in manifest for ${image}`, "NOT_FOUND");
  }
  const configDigest = assertOciDigest(manifest.config.digest, `manifest for ${image}`);
  const config = await client.getJson(`/blobs/${configDigest}`, `image config for ${image}`, {
    verifyDigest: configDigest,
  });
  return config.config?.Labels ?? {};
}

/**
 * Fetch a pull token via Docker Token Authentication.
 *
 * If Docker credentials for the registry are available (basicAuth from
 * readGhcrBasicAuth), uses Basic auth directly, with no anonymous attempt:
 * docker pulls the image with the same credentials, so it would fail there.
 * Otherwise falls back to anonymous access (public packages).
 */
export async function fetchRegistryToken(
  registry: string,
  repo: string,
  basicAuth: string | null,
  _fetch: FetchLike = fetch,
): Promise<string> {
  const url = `https://${registry}/token?scope=repository:${repo}:pull&service=${registry}`;

  return withRegistryErrors("fetching registry token", async () => {
    const resp = basicAuth
      ? await _fetch(url, { headers: { Authorization: `Basic ${basicAuth}` } })
      : await _fetch(url);

    if (resp.status >= 500) {
      throw new VerifyImageError(
        `Transient error from ${registry} token endpoint: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (resp.ok) {
      return (await resp.json!()).token;
    }

    // The two cases need different advice: credentials that were sent and
    // rejected are stale, whereas none sent at all may only mean the package
    // is private.
    throw new VerifyImageError(
      basicAuth
        ? `Registry authentication failed: HTTP ${resp.status}. ` +
            `The credentials in Docker config may be expired, and ${registry} refuses them even for a public package. ` +
            `Run \`docker login ${registry}\` again, or \`docker logout ${registry}\` if the package is public.`
        : `Failed to get registry token: HTTP ${resp.status}. ` +
            `The package may be private. Run \`docker login ${registry}\` ` +
            `(or use docker/login-action with 'packages: read') before this action.`,
      "TOKEN_ERROR",
    );
  });
}
