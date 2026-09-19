/**
 * Finding an image's Sigstore bundle in the registry.
 *
 * Two schemes hold one: the OCI 1.1 Referrers API, and the `sha256-<hex>` tag
 * of the Referrers Tag Schema. Both end at a manifest whose layer carries the
 * bundle, so only the way there differs.
 */

import { VerifyImageError } from "./errors.ts";
import {
  assertRegistryOk,
  registryClient,
  withRegistryErrors,
  type FetchLike,
  type OciDescriptor,
  type RegistryClient,
} from "./oci-registry.ts";

const BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";
const IMAGE_MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";

/**
 * Pull the Sigstore Bundle from the OCI registry, Referrers API first.
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
  const client = registryClient(registry, repo, token, _fetch);

  const fromReferrers = await bundleFromReferrers(client, digest);
  if (fromReferrers) return fromReferrers.bundle;
  return bundleFromFallbackTag(client, digest);
}

/** The NOT_FOUND three separate paths raise, worded once. */
function noBundleFound(digest: string): VerifyImageError {
  return new VerifyImageError(
    `No Sigstore bundle found for digest ${digest}. ` +
      `The image may not have been signed with --new-bundle-format.`,
    "NOT_FOUND",
  );
}

/**
 * Ask the OCI 1.1 Referrers API for the bundle.
 *
 * Wrapped rather than returned bare: a registry that answered without a
 * matching artifactType has not said the bundle is absent, only that it does
 * not index it, and the caller has another place to look. Undefined says that;
 * a wrapper keeps it from being confused with a bundle.
 */
async function bundleFromReferrers(
  client: RegistryClient,
  digest: string,
): Promise<{ bundle: unknown } | undefined> {
  return withRegistryErrors("fetching referrers", async () => {
    const resp = await client.request(
      `/referrers/${digest}?artifactType=${encodeURIComponent(BUNDLE_MEDIA_TYPE)}`,
    );
    // Not assertRegistryOk: a registry with no Referrers API answers 404 or
    // 405, and that is not a failure here: only a 5xx leaves it unknown
    // whether it would have had one.
    if (resp.status >= 500) {
      throw new VerifyImageError(
        `Transient error from referrers API: HTTP ${resp.status}`,
        "TRANSIENT",
      );
    }
    if (!resp.ok) return undefined;
    const referrers = await resp.json!();
    const manifest = (referrers.manifests ?? []).find(
      (m: OciDescriptor) => m.artifactType === BUNDLE_MEDIA_TYPE,
    );
    if (!manifest) return undefined;
    // Awaiting here relabels nothing: bundleFromManifest reads through the
    // client, so it only ever rejects with a VerifyImageError, which passes
    // through.
    return { bundle: await bundleFromManifest(client, manifest.digest) };
  });
}

/**
 * Ask the sha256-<hex> tag scheme for the bundle.
 *
 * The OCI Referrers Tag Schema represents this as an OCI Image Index whose
 * manifests[] entries point to individual referrer artifacts (as served by
 * registries such as GHCR). Both that and the legacy
 * direct-manifest-with-layers format are accepted.
 */
async function bundleFromFallbackTag(client: RegistryClient, digest: string): Promise<unknown> {
  return withRegistryErrors("fetching fallback tag", async () => {
    const resp = await client.request(`/manifests/${digest.replace(":", "-")}`, {
      accept: ["application/vnd.oci.image.index.v1+json", IMAGE_MANIFEST_MEDIA_TYPE].join(", "),
    });

    // 404: tag doesn't exist. 400: some registries return Bad Request instead of
    // 404 when the sha256-<hex> tag name is unrecognized (e.g. no Referrers tag
    // support at all). Treat both as "no bundle" rather than a transient error.
    if (resp.status === 404 || resp.status === 400) throw noBundleFound(digest);
    assertRegistryOk(resp, "fallback tag", "NOT_FOUND");

    const tagManifest = await resp.json!();

    // OCI Referrers Tag Schema: the tag is an Image Index whose manifests[] entries
    // are descriptors for individual referrer artifacts.
    if (Array.isArray(tagManifest.manifests)) {
      for (const m of tagManifest.manifests as OciDescriptor[]) {
        if (m.mediaType !== IMAGE_MANIFEST_MEDIA_TYPE) continue;
        // Standard: m.artifactType matches directly.
        if (m.artifactType === BUNDLE_MEDIA_TYPE) {
          return bundleFromManifest(client, m.digest);
        }
        // Per the OCI Distribution Spec, a referrer descriptor's artifactType falls back to the
        // manifest's config.mediaType when the manifest has no top-level artifactType. As a result
        // the descriptor may carry the empty-config type ("application/vnd.oci.empty.v1+json")
        // rather than the bundle type (observed with GHCR). This is a spec-valid fallback, so resolve
        // the real type by inspecting the sub-manifest's own artifactType / layer mediaType.
        const subResp = await client.request(`/manifests/${m.digest}`, {
          accept: IMAGE_MANIFEST_MEDIA_TYPE,
        });
        if (!subResp.ok) continue;
        const sub = await subResp.json!();
        if (sub.artifactType !== BUNDLE_MEDIA_TYPE) continue;
        const layer = (sub.layers ?? []).find(
          (l: OciDescriptor) => l.mediaType === BUNDLE_MEDIA_TYPE,
        );
        if (!layer) continue;
        return bundleBlob(client, layer.digest);
      }
      throw noBundleFound(digest);
    }

    // Legacy format: the bundle is stored directly as a layer in the manifest.
    const layer = (tagManifest.layers ?? []).find(
      (l: OciDescriptor) => l.mediaType === BUNDLE_MEDIA_TYPE,
    );
    if (!layer) throw noBundleFound(digest);
    return bundleBlob(client, layer.digest);
  });
}

/**
 * Read a bundle out of the manifest a descriptor named: its first layer with
 * mediaType === BUNDLE_MEDIA_TYPE.
 *
 * Every refusal is transient, a 404 included: a descriptor just named this
 * manifest, so the registry not serving it contradicts what it said.
 */
async function bundleFromManifest(
  client: RegistryClient,
  manifestDigest: string,
): Promise<unknown> {
  const manifest = await client.getJson(`/manifests/${manifestDigest}`, "bundle manifest", {
    accept: IMAGE_MANIFEST_MEDIA_TYPE,
    absentOn404: false,
  });
  const layer = (manifest.layers ?? []).find(
    (l: OciDescriptor) => l.mediaType === BUNDLE_MEDIA_TYPE,
  );
  if (!layer) {
    throw new VerifyImageError("No Sigstore bundle layer found in bundle manifest", "NOT_FOUND");
  }
  return bundleBlob(client, layer.digest);
}

/** A blob the bundle manifest named, so a 404 means the bundle itself is missing. */
function bundleBlob(client: RegistryClient, blobDigest: string): Promise<unknown> {
  return client.getJson(`/blobs/${blobDigest}`, "bundle blob", {
    onFailure: "NOT_FOUND",
    absentOn404: false,
  });
}
