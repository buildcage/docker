/**
 * Unit tests for the bundle lookup in oci-bundle.ts: the Referrers API, the
 * sha256-<hex> fallback tag, and every way each of them can decline.
 *
 * Tests use an injectable _fetch to avoid real network access.
 *
 * Run with: vp test run core/lib/provenance/oci-bundle.test.ts
 */
import { describe, it, expect } from "vitest";

import { fetchBundle } from "./oci-bundle.ts";
import {
  expectVerifyError,
  failsWith,
  networkFailure,
  okJson,
  stubRegistry,
  type Route,
} from "#core/lib/test/registry-stub.ts";
import type { FetchLike } from "./oci-registry.ts";

const BUNDLE_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";
const IMAGE_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const EMPTY_CONFIG = "application/vnd.oci.empty.v1+json";

const DIGEST = "sha256:" + "a".repeat(64);
const MANIFEST_DIGEST = "sha256:" + "b".repeat(64);
const BLOB_DIGEST = "sha256:" + "c".repeat(64);

const REFERRERS_PATH = `/referrers/${DIGEST}`;
/** The `sha256-<hex>` tag the fallback path looks the bundle up under. */
const TAG_PATH = `/manifests/${DIGEST.replace(":", "-")}`;

const bundle = (_fetch: FetchLike) =>
  fetchBundle("ghcr.io", "buildcage/docker", DIGEST, "token", _fetch);

/** What the Referrers API answers when it does hold the bundle manifest. */
const REFERRERS_HIT = okJson({
  manifests: [{ artifactType: BUNDLE_TYPE, mediaType: IMAGE_MANIFEST, digest: MANIFEST_DIGEST }],
});
/** A registry with no Referrers API at all. */
const REFERRERS_MISS = failsWith(404);

describe("fetchBundle: Referrers API path", () => {
  const bundleObj = { mediaType: BUNDLE_TYPE, verificationMaterial: {} };

  it("returns bundle when found via Referrers API (3-request flow: referrers → manifest → blob)", async () => {
    const registry = stubRegistry({
      [REFERRERS_PATH]: REFERRERS_HIT,
      [`/manifests/${MANIFEST_DIGEST}`]: okJson({
        artifactType: BUNDLE_TYPE,
        layers: [{ mediaType: BUNDLE_TYPE, digest: BLOB_DIGEST }],
      }),
      [`/blobs/${BLOB_DIGEST}`]: okJson(bundleObj),
    });
    expect(await bundle(registry)).toStrictEqual(bundleObj);
    expect(registry.urls.length, "referrers, bundle manifest, blob").toBe(3);
  });

  it("throws NOT_FOUND when Referrers returns no matching artifactType", async () => {
    await expectVerifyError(
      bundle(
        stubRegistry({
          [REFERRERS_PATH]: okJson({
            manifests: [{ artifactType: "application/other", digest: "sha256:c" }],
          }),
          [TAG_PATH]: failsWith(404),
        }),
      ),
      "NOT_FOUND",
    );
  });
});

describe("fetchBundle: fallback tag path", () => {
  const bundleObj = { mediaType: BUNDLE_TYPE };
  const bundleBlob = { [`/blobs/${BLOB_DIGEST}`]: okJson(bundleObj) };

  it("falls back to sha256-<hex> tag (legacy direct-layers format) and returns bundle", async () => {
    const registry = stubRegistry({
      [REFERRERS_PATH]: REFERRERS_MISS,
      [TAG_PATH]: okJson({ layers: [{ mediaType: BUNDLE_TYPE, digest: BLOB_DIGEST }] }),
      ...bundleBlob,
    });
    expect(await bundle(registry)).toStrictEqual(bundleObj);
  });

  it("falls back to sha256-<hex> tag as OCI image index (standard artifactType match)", async () => {
    const registry = stubRegistry({
      [REFERRERS_PATH]: REFERRERS_MISS,
      [TAG_PATH]: okJson({
        manifests: [
          { mediaType: IMAGE_MANIFEST, artifactType: BUNDLE_TYPE, digest: MANIFEST_DIGEST },
        ],
      }),
      [`/manifests/${MANIFEST_DIGEST}`]: okJson({
        artifactType: BUNDLE_TYPE,
        layers: [{ mediaType: BUNDLE_TYPE, digest: BLOB_DIGEST }],
      }),
      ...bundleBlob,
    });
    expect(await bundle(registry)).toStrictEqual(bundleObj);
  });

  it("falls back to sha256-<hex> tag as OCI image index (GHCR: config.mediaType used as artifactType)", async () => {
    // GHCR stores config.mediaType ("application/vnd.oci.empty.v1+json") as artifactType
    // in the Referrers Tag Schema index instead of the manifest's own artifactType field,
    // so the same index satisfies neither the referrers lookup nor a direct type match.
    const index = okJson({
      manifests: [
        { mediaType: IMAGE_MANIFEST, artifactType: EMPTY_CONFIG, digest: MANIFEST_DIGEST },
      ],
    });
    const registry = stubRegistry({
      [REFERRERS_PATH]: index,
      [TAG_PATH]: index,
      [`/manifests/${MANIFEST_DIGEST}`]: okJson({
        artifactType: BUNDLE_TYPE,
        layers: [{ mediaType: BUNDLE_TYPE, digest: BLOB_DIGEST }],
      }),
      ...bundleBlob,
    });
    expect(await bundle(registry)).toStrictEqual(bundleObj);
  });

  it("throws TRANSIENT on 5xx from Referrers API", async () => {
    await expectVerifyError(
      bundle(stubRegistry({ [REFERRERS_PATH]: failsWith(503) })),
      "TRANSIENT",
    );
  });

  it("throws TRANSIENT on network error from Referrers API", async () => {
    await expectVerifyError(bundle(networkFailure), "TRANSIENT");
  });

  it("throws TRANSIENT (not NOT_FOUND) on 403 from blob fetch", async () => {
    await expectVerifyError(
      bundle(
        stubRegistry({
          [REFERRERS_PATH]: REFERRERS_MISS,
          [TAG_PATH]: okJson({ layers: [{ mediaType: BUNDLE_TYPE, digest: BLOB_DIGEST }] }),
          [`/blobs/${BLOB_DIGEST}`]: failsWith(403),
        }),
      ),
      "TRANSIENT",
      /authenticated/,
    );
  });
});

// ── fail-closed paths ─────────────────────────────────────────────────────
//
// Every branch below refuses rather than returns. They are what stands between
// a registry that answers oddly and an unverified image being pulled anyway, so
// each case pins the code that comes back, not just that something threw.

describe("fetchBundle: fallback tag refusals", () => {
  const tagIs = (response: Route) =>
    stubRegistry({ [REFERRERS_PATH]: REFERRERS_MISS, [TAG_PATH]: response });

  it("throws TRANSIENT on 5xx", async () => {
    await expectVerifyError(bundle(tagIs(failsWith(503))), "TRANSIENT");
  });

  it("throws TRANSIENT on 401/403, an auth problem rather than a missing bundle", async () => {
    await expectVerifyError(bundle(tagIs(failsWith(403))), "TRANSIENT");
  });

  it("throws NOT_FOUND for any other non-ok status", async () => {
    await expectVerifyError(bundle(tagIs(failsWith(418))), "NOT_FOUND");
  });

  it("wraps a network failure on the fallback tag as TRANSIENT", async () => {
    await expectVerifyError(bundle(tagIs(networkFailure)), "TRANSIENT");
  });

  it("throws NOT_FOUND when the legacy direct-layers manifest carries no bundle layer", async () => {
    const tag = okJson({ layers: [{ mediaType: "application/octet-stream" }] });
    await expectVerifyError(bundle(tagIs(tag)), "NOT_FOUND");
  });

  it("throws NOT_FOUND when the legacy manifest omits layers entirely", async () => {
    await expectVerifyError(bundle(tagIs(okJson({}))), "NOT_FOUND");
  });

  it("falls through to the tag when the referrers API answers without a manifests list", async () => {
    await expectVerifyError(
      bundle(stubRegistry({ [REFERRERS_PATH]: okJson({}), [TAG_PATH]: failsWith(404) })),
      "NOT_FOUND",
    );
  });
});

describe("fetchBundle: descriptors the referrers tag index offers but cannot satisfy", () => {
  /** Referrers miss, then a tag index holding exactly these descriptors. */
  const indexOf = (manifests: unknown[], subManifest?: Route) =>
    stubRegistry({
      [REFERRERS_PATH]: REFERRERS_MISS,
      [TAG_PATH]: okJson({ manifests }),
      ...(subManifest ? { [`/manifests/${MANIFEST_DIGEST}`]: subManifest } : {}),
    });
  const emptyConfigDescriptor = [
    { mediaType: IMAGE_MANIFEST, artifactType: EMPTY_CONFIG, digest: MANIFEST_DIGEST },
  ];

  it("skips a descriptor that is not an image manifest at all", async () => {
    const index = indexOf([
      { mediaType: "application/vnd.oci.image.index.v1+json", digest: MANIFEST_DIGEST },
    ]);
    await expectVerifyError(bundle(index), "NOT_FOUND");
  });

  it("skips a descriptor whose sub-manifest cannot be fetched", async () => {
    await expectVerifyError(bundle(indexOf(emptyConfigDescriptor, failsWith(404))), "NOT_FOUND");
  });

  it("skips a descriptor whose sub-manifest turns out to be some other artifact", async () => {
    const sub = okJson({ artifactType: "application/other" });
    await expectVerifyError(bundle(indexOf(emptyConfigDescriptor, sub)), "NOT_FOUND");
  });

  it("skips a bundle sub-manifest that carries no bundle layer", async () => {
    const sub = okJson({ artifactType: BUNDLE_TYPE, layers: [{ mediaType: "text/plain" }] });
    await expectVerifyError(bundle(indexOf(emptyConfigDescriptor, sub)), "NOT_FOUND");
  });

  it("skips a bundle sub-manifest that omits layers entirely", async () => {
    const sub = okJson({ artifactType: BUNDLE_TYPE });
    await expectVerifyError(bundle(indexOf(emptyConfigDescriptor, sub)), "NOT_FOUND");
  });
});

describe("fetchBundle: bundle manifest refusals", () => {
  const manifestIs = (response: Route) =>
    stubRegistry({
      [REFERRERS_PATH]: REFERRERS_HIT,
      [`/manifests/${MANIFEST_DIGEST}`]: response,
    });

  it("throws TRANSIENT for any other non-ok status", async () => {
    await expectVerifyError(bundle(manifestIs(failsWith(418))), "TRANSIENT");
  });

  it("throws NOT_FOUND when the bundle manifest holds no bundle layer", async () => {
    const manifest = okJson({ layers: [{ mediaType: "text/plain" }] });
    await expectVerifyError(bundle(manifestIs(manifest)), "NOT_FOUND");
  });

  it("throws NOT_FOUND when the bundle manifest omits layers entirely", async () => {
    await expectVerifyError(bundle(manifestIs(okJson({}))), "NOT_FOUND");
  });

  it("wraps a network failure as TRANSIENT", async () => {
    await expectVerifyError(bundle(manifestIs(networkFailure)), "TRANSIENT");
  });
});

describe("fetchBundle: bundle blob refusals", () => {
  /** Referrers hit, bundle manifest hit, then the blob response under test. */
  const blobIs = (response: Route) =>
    stubRegistry({
      [REFERRERS_PATH]: REFERRERS_HIT,
      [`/manifests/${MANIFEST_DIGEST}`]: okJson({
        layers: [{ mediaType: BUNDLE_TYPE, digest: BLOB_DIGEST }],
      }),
      [`/blobs/${BLOB_DIGEST}`]: response,
    });

  it("throws NOT_FOUND for any other non-ok status", async () => {
    await expectVerifyError(bundle(blobIs(failsWith(404))), "NOT_FOUND");
  });
});
