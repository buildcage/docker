// @ts-nocheck
/**
 * Unit tests for core/lib/oci-registry.js
 *
 * Tests use injectable _exec / _fetch arguments to avoid real network/docker calls.
 *
 * Run with: node --test core/lib/provenance/oci-registry.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fetchManifestDigest,
  fetchRegistryToken,
  fetchBundle,
  readGhcrBasicAuth,
} from "./oci-registry.js";

// ── fetchManifestDigest ───────────────────────────────────────────────────

describe("fetchManifestDigest", () => {
  const digest = "sha256:" + "a".repeat(64);

  function makeResp(status, digestValue) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => name === "Docker-Content-Digest" ? digestValue : null },
    };
  }

  it("returns digest from Docker-Content-Digest header on success", async () => {
    let capturedOpts;
    const mockFetch = async (url, opts) => { capturedOpts = opts; return makeResp(200, digest); };
    const result = await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
    assert.equal(result, digest);
    assert.equal(capturedOpts.method, "HEAD");
  });

  it("throws NOT_FOUND on 404", async () => {
    const mockFetch = async () => makeResp(404, null);
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "NOT_FOUND");
    }
  });

  it("throws TRANSIENT on 5xx", async () => {
    const mockFetch = async () => makeResp(500, null);
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT");
    }
  });

  it("throws TRANSIENT with auth hint on 401", async () => {
    const mockFetch = async () => makeResp(401, null);
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT");
      assert.ok(err.message.includes("authenticated"), "error message should hint at authentication");
    }
  });

  it("throws TRANSIENT with auth hint on 403", async () => {
    const mockFetch = async () => makeResp(403, null);
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT");
      assert.ok(err.message.includes("authenticated"), "error message should hint at authentication");
    }
  });

  it("throws TRANSIENT when Docker-Content-Digest header is absent", async () => {
    const mockFetch = async () => makeResp(200, null);
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT");
    }
  });

  it("throws TRANSIENT on network error", async () => {
    const mockFetch = async () => { throw new Error("ECONNREFUSED"); };
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT");
    }
  });
});

// ── fetchRegistryToken ────────────────────────────────────────────────────

describe("fetchRegistryToken", () => {
  // ── basicAuth=null (未ログイン) ─────────────────────────────────────────

  it("returns anonymous token when no Docker credentials and registry responds 200", async () => {
    let callCount = 0;
    const mockFetch = async (url, opts) => {
      callCount++;
      assert.equal(opts, undefined, "should send no auth header");
      return { ok: true, status: 200, json: async () => ({ token: "anon-token" }) };
    };
    const token = await fetchRegistryToken("ghcr.io", "dash14/buildcage", null, mockFetch);
    assert.equal(token, "anon-token");
    assert.equal(callCount, 1, "should make exactly one request");
  });

  it("throws TOKEN_ERROR on 401 when no Docker credentials (private, not logged in)", async () => {
    const mockFetch = async () => ({ ok: false, status: 401 });
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", null, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TOKEN_ERROR");
      assert.ok(err.message.includes("docker login"), "error message should mention docker login");
    }
  });

  it("throws TOKEN_ERROR on 403 when no Docker credentials (private, not logged in)", async () => {
    const mockFetch = async () => ({ ok: false, status: 403 });
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", null, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TOKEN_ERROR");
    }
  });

  it("throws TRANSIENT on 5xx when no Docker credentials", async () => {
    const mockFetch = async () => ({ ok: false, status: 503 });
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", null, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT");
    }
  });

  it("throws TRANSIENT on network error when no Docker credentials", async () => {
    const mockFetch = async () => { throw new Error("ECONNREFUSED"); };
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", null, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT");
    }
  });

  // ── basicAuth あり (docker login 済み) ────────────────────────────────

  it("uses Basic auth directly (no anonymous attempt) when Docker credentials are available", async () => {
    const basicAuth = Buffer.from("actor:ghp_token").toString("base64");
    let callCount = 0;
    let capturedAuth;
    const mockFetch = async (url, opts) => {
      callCount++;
      capturedAuth = opts?.headers?.Authorization;
      return { ok: true, status: 200, json: async () => ({ token: "jwt-token" }) };
    };
    const token = await fetchRegistryToken("ghcr.io", "dash14/buildcage", basicAuth, mockFetch);
    assert.equal(token, "jwt-token");
    assert.equal(callCount, 1, "should make exactly one request (no anonymous attempt)");
    assert.equal(capturedAuth, `Basic ${basicAuth}`, "should send the Docker config auth directly");
  });

  it("throws TOKEN_ERROR immediately on 401 when Docker credentials are present (no fallback)", async () => {
    const basicAuth = Buffer.from("actor:expired_token").toString("base64");
    let callCount = 0;
    const mockFetch = async () => { callCount++; return { ok: false, status: 401 }; };
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", basicAuth, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TOKEN_ERROR");
      assert.ok(err.message.includes("docker login"), "error message should mention docker login");
      assert.equal(callCount, 1, "should not retry with anonymous");
    }
  });

  it("throws TOKEN_ERROR immediately on 403 when Docker credentials are present (no fallback)", async () => {
    const basicAuth = Buffer.from("actor:token").toString("base64");
    const mockFetch = async () => ({ ok: false, status: 403 });
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", basicAuth, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TOKEN_ERROR");
    }
  });

  it("throws TRANSIENT on 5xx when Docker credentials are present", async () => {
    const basicAuth = Buffer.from("actor:token").toString("base64");
    const mockFetch = async () => ({ ok: false, status: 500 });
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", basicAuth, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT");
    }
  });
});

// ── readGhcrBasicAuth ─────────────────────────────────────────────────────

describe("readGhcrBasicAuth", () => {
  const mockReadFileSync = (content) => (_path, _enc) => content;

  it("returns auth when auths['ghcr.io'].auth is present", () => {
    const config = JSON.stringify({ auths: { "ghcr.io": { auth: "dGVzdDp0b2tlbg==" } } });
    const result = readGhcrBasicAuth({}, mockReadFileSync(config));
    assert.equal(result, "dGVzdDp0b2tlbg==");
  });

  it("normalizes https:// prefix and trailing slash in key", () => {
    const config = JSON.stringify({ auths: { "https://ghcr.io/": { auth: "dGVzdA==" } } });
    const result = readGhcrBasicAuth({}, mockReadFileSync(config));
    assert.equal(result, "dGVzdA==");
  });

  it("returns null when ghcr.io entry is absent", () => {
    const config = JSON.stringify({ auths: { "docker.io": { auth: "dGVzdA==" } } });
    assert.equal(readGhcrBasicAuth({}, mockReadFileSync(config)), null);
  });

  it("returns null when auth field is empty string (credsStore environment)", () => {
    const config = JSON.stringify({ auths: { "ghcr.io": {} } });
    assert.equal(readGhcrBasicAuth({}, mockReadFileSync(config)), null);
  });

  it("returns null when auths is absent", () => {
    const config = JSON.stringify({ credsStore: "desktop" });
    assert.equal(readGhcrBasicAuth({}, mockReadFileSync(config)), null);
  });

  it("returns null on file read error (not logged in at all)", () => {
    const throwingRead = () => { throw new Error("ENOENT"); };
    assert.equal(readGhcrBasicAuth({}, throwingRead), null);
  });

  it("returns null on invalid JSON", () => {
    assert.equal(readGhcrBasicAuth({}, mockReadFileSync("not json")), null);
  });

  it("uses DOCKER_CONFIG env var to resolve config path", () => {
    let capturedPath;
    const readSpy = (p) => { capturedPath = p; return JSON.stringify({ auths: {} }); };
    readGhcrBasicAuth({ DOCKER_CONFIG: "/custom/docker" }, readSpy);
    assert.ok(capturedPath.startsWith("/custom/docker"), `expected path under DOCKER_CONFIG, got: ${capturedPath}`);
  });
});

// ── fetchBundle ───────────────────────────────────────────────────────────

const BUNDLE_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";

function makeFetchReturning(responses) {
  let i = 0;
  return async (url) => {
    const resp = responses[i++] ?? responses[responses.length - 1];
    return typeof resp === "function" ? resp(url) : resp;
  };
}

describe("fetchBundle — Referrers API path", () => {
  const digest      = "sha256:" + "a".repeat(64);
  const manifestDig = "sha256:" + "b".repeat(64);
  const blobDig     = "sha256:" + "d".repeat(64);
  const bundleObj   = { mediaType: BUNDLE_TYPE, verificationMaterial: {} };

  it("returns bundle when found via Referrers API (3-request flow: referrers → manifest → blob)", async () => {
    const mockFetch = makeFetchReturning([
      // GET /referrers/<digest>
      {
        ok: true, status: 200,
        json: async () => ({
          manifests: [{ artifactType: BUNDLE_TYPE, mediaType: "application/vnd.oci.image.manifest.v1+json", digest: manifestDig }],
        }),
      },
      // GET /manifests/<manifestDig>
      {
        ok: true, status: 200,
        json: async () => ({
          artifactType: BUNDLE_TYPE,
          layers: [{ mediaType: BUNDLE_TYPE, digest: blobDig }],
        }),
      },
      // GET /blobs/<blobDig>
      { ok: true, status: 200, json: async () => bundleObj },
    ]);
    const result = await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
    assert.deepEqual(result, bundleObj);
  });

  it("throws NOT_FOUND when Referrers returns no matching artifactType", async () => {
    const mockFetch = makeFetchReturning([
      // Referrers API → no bundle
      {
        ok: true, status: 200,
        json: async () => ({ manifests: [{ artifactType: "application/other", digest: "sha256:c" }] }),
      },
      // Fallback tag → 404
      { ok: false, status: 404, json: async () => ({}) },
    ]);
    try {
      await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "NOT_FOUND");
    }
  });
});

describe("fetchBundle — fallback tag path", () => {
  const digest      = "sha256:" + "a".repeat(64);
  const manifestDig = "sha256:" + "b".repeat(64);
  const blobDig     = "sha256:" + "c".repeat(64);
  const bundleObj   = { mediaType: BUNDLE_TYPE };

  it("falls back to sha256-<hex> tag (legacy direct-layers format) and returns bundle", async () => {
    const mockFetch = makeFetchReturning([
      // Referrers API → 404 (old registry, no Referrers support)
      { ok: false, status: 404, json: async () => ({}) },
      // Fallback tag: direct manifest with layers
      {
        ok: true, status: 200,
        json: async () => ({
          layers: [{ mediaType: BUNDLE_TYPE, digest: blobDig }],
        }),
      },
      // Blob
      { ok: true, status: 200, json: async () => bundleObj },
    ]);
    const result = await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
    assert.deepEqual(result, bundleObj);
  });

  it("falls back to sha256-<hex> tag as OCI image index (standard artifactType match)", async () => {
    const mockFetch = makeFetchReturning([
      // Referrers API → 404
      { ok: false, status: 404, json: async () => ({}) },
      // Fallback tag: image index with correct artifactType
      {
        ok: true, status: 200,
        json: async () => ({
          manifests: [{
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            artifactType: BUNDLE_TYPE,
            digest: manifestDig,
          }],
        }),
      },
      // Sub-manifest
      {
        ok: true, status: 200,
        json: async () => ({
          artifactType: BUNDLE_TYPE,
          layers: [{ mediaType: BUNDLE_TYPE, digest: blobDig }],
        }),
      },
      // Blob
      { ok: true, status: 200, json: async () => bundleObj },
    ]);
    const result = await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
    assert.deepEqual(result, bundleObj);
  });

  it("falls back to sha256-<hex> tag as OCI image index (GHCR: config.mediaType used as artifactType)", async () => {
    // GHCR stores config.mediaType ("application/vnd.oci.empty.v1+json") as artifactType
    // in the Referrers Tag Schema index instead of the manifest's own artifactType field.
    const mockFetch = makeFetchReturning([
      // Referrers API → 303 redirect → image index (GHCR behaviour)
      {
        ok: true, status: 200,
        json: async () => ({
          manifests: [{
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            artifactType: "application/vnd.oci.empty.v1+json",  // ← GHCR: config.mediaType
            digest: manifestDig,
          }],
        }),
      },
      // Fallback tag: same image index (fetched again)
      {
        ok: true, status: 200,
        json: async () => ({
          manifests: [{
            mediaType: "application/vnd.oci.image.manifest.v1+json",
            artifactType: "application/vnd.oci.empty.v1+json",  // ← GHCR: config.mediaType
            digest: manifestDig,
          }],
        }),
      },
      // Sub-manifest inspection: real artifactType is correct
      {
        ok: true, status: 200,
        json: async () => ({
          artifactType: BUNDLE_TYPE,
          layers: [{ mediaType: BUNDLE_TYPE, digest: blobDig }],
        }),
      },
      // Blob
      { ok: true, status: 200, json: async () => bundleObj },
    ]);
    const result = await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
    assert.deepEqual(result, bundleObj);
  });

  it("throws TRANSIENT on 5xx from Referrers API", async () => {
    const mockFetch = makeFetchReturning([
      { ok: false, status: 503 },
    ]);
    try {
      await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT");
    }
  });

  it("throws TRANSIENT on network error from Referrers API", async () => {
    const mockFetch = async () => { throw new Error("ECONNRESET"); };
    try {
      await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT");
    }
  });

  it("throws TRANSIENT (not NOT_FOUND) on 403 from blob fetch", async () => {
    const mockFetch = makeFetchReturning([
      // Referrers API → 404 (no Referrers support)
      { ok: false, status: 404, json: async () => ({}) },
      // Fallback tag manifest found (legacy format)
      {
        ok: true, status: 200,
        json: async () => ({
          layers: [{ mediaType: BUNDLE_TYPE, digest: blobDig }],
        }),
      },
      // Blob fetch → 403 (auth error, e.g. private repo not authenticated)
      { ok: false, status: 403 },
    ]);
    try {
      await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      assert.equal(err.code, "TRANSIENT",
        "auth error must not be reported as NOT_FOUND (unsigned image)");
    }
  });
});
