/**
 * The registry client itself has no test file: it is exercised through the
 * pull token, the manifest digest and the config-label reads that use it.
 */
import { createHash } from "node:crypto";

import { describe, it, expect } from "vitest";

import {
  expectVerifyError,
  failsWith,
  networkFailure,
  okBytes,
  okJson,
  stubRegistry,
} from "#core/lib/test/registry-stub.ts";

import {
  fetchManifestDigest,
  fetchRegistryToken,
  fetchImageConfigLabels,
  type FetchLike,
  type FetchLikeResponse,
} from "./oci-registry.ts";

const DIGEST = "sha256:" + "a".repeat(64);

/** The `sha256:<hex>` a content-addressed read of `body` must match, over the
 *  exact bytes okJson serves, so a test addresses each stub route by the same
 *  digest the client verifies it against. */
const digestOf = (body: unknown): string =>
  "sha256:" + createHash("sha256").update(JSON.stringify(body)).digest("hex");

/** The HEAD response fetchManifestDigest reads its digest out of. */
function manifestHead(status: number, digestValue: string | null): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name === "Docker-Content-Digest" ? digestValue : null) },
  };
}

describe("fetchManifestDigest", () => {
  const call = (_fetch: FetchLike) =>
    fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", _fetch);

  it("returns digest from Docker-Content-Digest header on success", async () => {
    let capturedOpts: { method?: string } | undefined;
    const result = await call(async (_url, opts) => {
      capturedOpts = opts;
      return manifestHead(200, DIGEST);
    });
    expect(result).toBe(DIGEST);
    expect(capturedOpts?.method).toBe("HEAD");
  });

  it("throws NOT_FOUND on 404", async () => {
    await expectVerifyError(
      call(async () => manifestHead(404, null)),
      "NOT_FOUND",
    );
  });

  it("throws TRANSIENT on 5xx", async () => {
    await expectVerifyError(
      call(async () => manifestHead(500, null)),
      "TRANSIENT",
    );
  });

  it("throws TRANSIENT with an auth hint on 401", async () => {
    await expectVerifyError(
      call(async () => manifestHead(401, null)),
      "TRANSIENT",
      /authenticated/,
    );
  });

  it("throws TRANSIENT with an auth hint on 403", async () => {
    await expectVerifyError(
      call(async () => manifestHead(403, null)),
      "TRANSIENT",
      /authenticated/,
    );
  });

  it("throws TRANSIENT when Docker-Content-Digest header is absent", async () => {
    await expectVerifyError(
      call(async () => manifestHead(200, null)),
      "TRANSIENT",
    );
  });

  it("refuses a digest header that is not a well-formed OCI digest", async () => {
    for (const bad of [
      "sha256:../../blobs/x",
      "sha256:" + "a".repeat(63),
      "sha256:" + "A".repeat(64),
      "sha512:" + "a".repeat(64),
      "md5:" + "a".repeat(32),
    ]) {
      await expectVerifyError(
        call(async () => manifestHead(200, bad)),
        "VERIFY_FAILED",
        /Malformed digest/,
      );
    }
  });

  it("accepts a sha512 digest at its own length", async () => {
    const sha512 = "sha512:" + "b".repeat(128);
    expect(await call(async () => manifestHead(200, sha512))).toBe(sha512);
  });

  it("throws TRANSIENT on network error", async () => {
    await expectVerifyError(call(networkFailure), "TRANSIENT");
  });

  it("throws TRANSIENT for a non-ok status that is not 404, 401/403 or 5xx", async () => {
    await expectVerifyError(
      call(async () => manifestHead(418, null)),
      "TRANSIENT",
    );
  });
});

describe("fetchRegistryToken", () => {
  const call = (basicAuth: string | null, _fetch: FetchLike) =>
    fetchRegistryToken("ghcr.io", "owner/repo", basicAuth, _fetch);

  // ── basicAuth=null (not logged in) ─────────────────────────────────────

  it("returns an anonymous token when there are no Docker credentials and the registry responds 200", async () => {
    let callCount = 0;
    const token = await call(null, async (_url, opts) => {
      callCount++;
      expect(opts, "should send no auth header").toBe(undefined);
      return okJson({ token: "anon-token" });
    });
    expect(token).toBe("anon-token");
    expect(callCount, "should make exactly one request").toBe(1);
  });

  it("throws TOKEN_ERROR on 401/403 when no Docker credentials (private, not logged in)", async () => {
    await expectVerifyError(
      call(null, async () => failsWith(401)),
      "TOKEN_ERROR",
      /docker login/,
    );
    await expectVerifyError(
      call(null, async () => failsWith(403)),
      "TOKEN_ERROR",
    );
  });

  it("throws TRANSIENT on 5xx when no Docker credentials", async () => {
    await expectVerifyError(
      call(null, async () => failsWith(503)),
      "TRANSIENT",
    );
  });

  it("throws TRANSIENT on network error when no Docker credentials", async () => {
    await expectVerifyError(call(null, networkFailure), "TRANSIENT");
  });

  // ── basicAuth set (after docker login) ─────────────────────────────────

  it("uses Basic auth directly (no anonymous attempt) when Docker credentials are available", async () => {
    const basicAuth = Buffer.from("actor:ghp_token").toString("base64");
    let callCount = 0;
    let capturedAuth: string | undefined;
    const token = await call(basicAuth, async (_url, opts) => {
      callCount++;
      capturedAuth = opts?.headers?.Authorization;
      return okJson({ token: "jwt-token" });
    });
    expect(token).toBe("jwt-token");
    expect(callCount, "should make exactly one request (no anonymous attempt)").toBe(1);
    expect(capturedAuth, "should send the Docker config auth directly").toBe(`Basic ${basicAuth}`);
  });

  it("throws TOKEN_ERROR immediately on 401 when Docker credentials are present (no fallback)", async () => {
    let callCount = 0;
    await expectVerifyError(
      call(Buffer.from("actor:expired_token").toString("base64"), async () => {
        callCount++;
        return failsWith(401);
      }),
      "TOKEN_ERROR",
      /docker login/,
    );
    expect(callCount, "should not retry with anonymous").toBe(1);
  });

  it("throws TRANSIENT on 5xx when Docker credentials are present", async () => {
    await expectVerifyError(
      call(Buffer.from("actor:token").toString("base64"), async () => failsWith(500)),
      "TRANSIENT",
    );
  });

  it("wraps a network failure under Basic auth as TRANSIENT", async () => {
    await expectVerifyError(call("dXNlcjpwYXNz", networkFailure), "TRANSIENT");
  });
});

describe("fetchImageConfigLabels", () => {
  const labels = { "org.opencontainers.image.version": "2.0.0-inspect" };
  const call = (_fetch: FetchLike) =>
    fetchImageConfigLabels("ghcr.io", "owner/repo", DIGEST, "token", _fetch);
  // Each hop is verified against the digest that addressed it, so a test states
  // the bodies and addresses each route by its own content digest.
  const callWith = (digest: string, _fetch: FetchLike) =>
    fetchImageConfigLabels("ghcr.io", "owner/repo", digest, "token", _fetch);

  it("follows index → platform manifest → config blob and returns the labels", async () => {
    const configBody = { config: { Labels: labels } };
    const configDig = digestOf(configBody);
    const amd64Body = { config: { digest: configDig } };
    const amd64Dig = digestOf(amd64Body);
    const indexBody = {
      manifests: [
        { digest: amd64Dig, platform: { architecture: "amd64", os: "linux" } },
        { digest: "sha256:" + "e".repeat(64), platform: { architecture: "arm64", os: "linux" } },
      ],
    };
    const indexDig = digestOf(indexBody);
    const registry = stubRegistry({
      [`/manifests/${indexDig}`]: okJson(indexBody),
      [`/manifests/${amd64Dig}`]: okJson(amd64Body),
      [`/blobs/${configDig}`]: okJson(configBody),
    });
    expect(await callWith(indexDig, registry)).toStrictEqual(labels);
    expect(registry.urls[1], "the first real platform, not the index again").toContain(amd64Dig);
  });

  it("skips the unknown/unknown attestation manifests buildx attaches", async () => {
    const configBody = { config: { Labels: labels } };
    const configDig = digestOf(configBody);
    const amd64Body = { config: { digest: configDig } };
    const amd64Dig = digestOf(amd64Body);
    const indexBody = {
      manifests: [
        {
          digest: "sha256:" + "f".repeat(64),
          platform: { architecture: "unknown", os: "unknown" },
        },
        { digest: amd64Dig, platform: { architecture: "amd64", os: "linux" } },
      ],
    };
    const indexDig = digestOf(indexBody);
    const registry = stubRegistry({
      [`/manifests/${indexDig}`]: okJson(indexBody),
      [`/manifests/${amd64Dig}`]: okJson(amd64Body),
      [`/blobs/${configDig}`]: okJson(configBody),
    });
    await callWith(indexDig, registry);
    expect(registry.urls[1]).toContain(amd64Dig);
  });

  it("reads a single-platform image whose digest is the manifest itself", async () => {
    const configBody = { config: { Labels: labels } };
    const configDig = digestOf(configBody);
    const manifestBody = { config: { digest: configDig } };
    const manifestDig = digestOf(manifestBody);
    const registry = stubRegistry({
      [`/manifests/${manifestDig}`]: okJson(manifestBody),
      [`/blobs/${configDig}`]: okJson(configBody),
    });
    expect(await callWith(manifestDig, registry)).toStrictEqual(labels);
  });

  it("returns an empty object for an image with no labels", async () => {
    const configBody = { config: {} };
    const configDig = digestOf(configBody);
    const manifestBody = { config: { digest: configDig } };
    const manifestDig = digestOf(manifestBody);
    const registry = stubRegistry({
      [`/manifests/${manifestDig}`]: okJson(manifestBody),
      [`/blobs/${configDig}`]: okJson(configBody),
    });
    expect(await callWith(manifestDig, registry)).toStrictEqual({});
  });

  it("hashes the bytes as served, so a leading BOM still matches its digest", async () => {
    const configBody = { config: { Labels: labels } };
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode(JSON.stringify(configBody)),
    ]);
    const configDig = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    const manifestBody = { config: { digest: configDig } };
    const manifestDig = digestOf(manifestBody);
    const registry = stubRegistry({
      [`/manifests/${manifestDig}`]: okJson(manifestBody),
      [`/blobs/${configDig}`]: okBytes(bytes, configBody),
    });
    expect(await callWith(manifestDig, registry)).toStrictEqual(labels);
  });

  it("refuses content whose bytes do not match the digest that addressed it", async () => {
    const configDig = digestOf({ config: { Labels: labels } });
    const manifestBody = { config: { digest: configDig } };
    const manifestDig = digestOf(manifestBody);
    const registry = stubRegistry({
      [`/manifests/${manifestDig}`]: okJson(manifestBody),
      // A config blob the registry substituted: right route, wrong bytes.
      [`/blobs/${configDig}`]: okJson({
        config: { Labels: { "org.opencontainers.image.version": "9.9.9-inspect" } },
      }),
    });
    await expectVerifyError(callWith(manifestDig, registry), "VERIFY_FAILED", /digest mismatch/i);
  });

  it("refuses a hop addressed by a digest algorithm it cannot verify", async () => {
    const badDigest = "sha1:" + "0".repeat(40);
    const registry = stubRegistry({ [`/manifests/${badDigest}`]: okJson({ config: {} }) });
    await expectVerifyError(
      callWith(badDigest, registry),
      "VERIFY_FAILED",
      /unsupported digest algorithm/i,
    );
  });

  it("throws TRANSIENT on 5xx", async () => {
    await expectVerifyError(
      call(stubRegistry({ [`/manifests/${DIGEST}`]: failsWith(503) })),
      "TRANSIENT",
    );
  });

  it("throws NOT_FOUND, naming the image, on 404", async () => {
    await expectVerifyError(
      call(stubRegistry({ [`/manifests/${DIGEST}`]: failsWith(404) })),
      "NOT_FOUND",
      `ghcr.io/owner/repo@${DIGEST}`,
    );
  });

  it("throws TRANSIENT with an auth hint on 403", async () => {
    await expectVerifyError(
      call(stubRegistry({ [`/manifests/${DIGEST}`]: failsWith(403) })),
      "TRANSIENT",
      /authenticated/,
    );
  });

  it("throws NOT_FOUND when an index carries no real platform", async () => {
    const indexBody = {
      manifests: [
        {
          digest: "sha256:" + "b".repeat(64),
          platform: { architecture: "unknown", os: "unknown" },
        },
      ],
    };
    const indexDig = digestOf(indexBody);
    await expectVerifyError(
      callWith(indexDig, stubRegistry({ [`/manifests/${indexDig}`]: okJson(indexBody) })),
      "NOT_FOUND",
    );
  });

  it("throws NOT_FOUND when the manifest names no config blob", async () => {
    const manifestDig = digestOf({});
    await expectVerifyError(
      callWith(manifestDig, stubRegistry({ [`/manifests/${manifestDig}`]: okJson({}) })),
      "NOT_FOUND",
    );
  });

  it("refuses a malformed platform digest before requesting it", async () => {
    const indexBody = {
      manifests: [{ digest: "sha256:../../blobs/x", platform: { os: "linux" } }],
    };
    const indexDig = digestOf(indexBody);
    const registry = stubRegistry({ [`/manifests/${indexDig}`]: okJson(indexBody) });
    await expectVerifyError(callWith(indexDig, registry), "VERIFY_FAILED", /Malformed digest/);
    expect(registry.urls).toHaveLength(1);
  });

  it("refuses a malformed config digest before requesting it", async () => {
    for (const bad of ["sha256:../../manifests/x", 42]) {
      const manifestBody = { config: { digest: bad } };
      const manifestDig = digestOf(manifestBody);
      const registry = stubRegistry({ [`/manifests/${manifestDig}`]: okJson(manifestBody) });
      await expectVerifyError(callWith(manifestDig, registry), "VERIFY_FAILED", /Malformed digest/);
      expect(registry.urls).toHaveLength(1);
    }
  });

  it("throws TRANSIENT for a non-ok status the registry JSON reader does not name", async () => {
    await expectVerifyError(
      call(stubRegistry({ [`/manifests/${DIGEST}`]: failsWith(418) })),
      "TRANSIENT",
    );
  });

  it("wraps a network failure as TRANSIENT rather than letting it escape untyped", async () => {
    await expectVerifyError(call(networkFailure), "TRANSIENT");
  });
});
