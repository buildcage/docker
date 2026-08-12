/**
 * Unit tests for core/lib/oci-registry.ts
 *
 * Tests use injectable _exec / _fetch arguments to avoid real network/docker calls.
 *
 * Run with: vp test run core/lib/provenance/oci-registry.test.ts
 */
import { describe, it, expect, assert } from "vitest";

import {
  fetchManifestDigest,
  fetchRegistryToken,
  fetchBundle,
  readGhcrBasicAuth,
} from "./oci-registry.ts";
import { VerifyImageError } from "./errors.ts";

// ── fetchManifestDigest ───────────────────────────────────────────────────

describe("fetchManifestDigest", () => {
  const digest = "sha256:" + "a".repeat(64);

  function makeResp(status: number, digestValue: string | null) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name === "Docker-Content-Digest" ? digestValue : null) },
    };
  }

  it("returns digest from Docker-Content-Digest header on success", async () => {
    let capturedOpts: { method?: string } | undefined;
    const mockFetch = async (url: string, opts?: { method?: string }) => {
      capturedOpts = opts;
      return makeResp(200, digest);
    };
    const result = await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
    expect(result).toBe(digest);
    expect(capturedOpts?.method).toBe("HEAD");
  });

  it("throws NOT_FOUND on 404", async () => {
    const mockFetch = async () => makeResp(404, null);
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("NOT_FOUND");
    }
  });

  it("throws TRANSIENT on 5xx", async () => {
    const mockFetch = async () => makeResp(500, null);
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TRANSIENT");
    }
  });

  it("throws TRANSIENT with auth hint on 401", async () => {
    const mockFetch = async () => makeResp(401, null);
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TRANSIENT");
      expect(
        (err as VerifyImageError).message.includes("authenticated"),
        "error message should hint at authentication",
      ).toBeTruthy();
    }
  });

  it("throws TRANSIENT with auth hint on 403", async () => {
    const mockFetch = async () => makeResp(403, null);
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TRANSIENT");
      expect(
        (err as VerifyImageError).message.includes("authenticated"),
        "error message should hint at authentication",
      ).toBeTruthy();
    }
  });

  it("throws TRANSIENT when Docker-Content-Digest header is absent", async () => {
    const mockFetch = async () => makeResp(200, null);
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TRANSIENT");
    }
  });

  it("throws TRANSIENT on network error", async () => {
    const mockFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    try {
      await fetchManifestDigest("ghcr.io", "owner/repo", "2.1.0", "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TRANSIENT");
    }
  });
});

// ── fetchRegistryToken ────────────────────────────────────────────────────

describe("fetchRegistryToken", () => {
  // ── basicAuth=null (未ログイン) ─────────────────────────────────────────

  it("returns anonymous token when no Docker credentials and registry responds 200", async () => {
    let callCount = 0;
    const mockFetch = async (url: string, opts?: { headers?: Record<string, string> }) => {
      callCount++;
      expect(opts, "should send no auth header").toBe(undefined);
      return { ok: true, status: 200, json: async () => ({ token: "anon-token" }) };
    };
    const token = await fetchRegistryToken("ghcr.io", "dash14/buildcage", null, mockFetch);
    expect(token).toBe("anon-token");
    expect(callCount, "should make exactly one request").toBe(1);
  });

  it("throws TOKEN_ERROR on 401 when no Docker credentials (private, not logged in)", async () => {
    const mockFetch = async () => ({ ok: false, status: 401 });
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", null, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TOKEN_ERROR");
      expect(
        (err as VerifyImageError).message.includes("docker login"),
        "error message should mention docker login",
      ).toBeTruthy();
    }
  });

  it("throws TOKEN_ERROR on 403 when no Docker credentials (private, not logged in)", async () => {
    const mockFetch = async () => ({ ok: false, status: 403 });
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", null, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TOKEN_ERROR");
    }
  });

  it("throws TRANSIENT on 5xx when no Docker credentials", async () => {
    const mockFetch = async () => ({ ok: false, status: 503 });
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", null, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TRANSIENT");
    }
  });

  it("throws TRANSIENT on network error when no Docker credentials", async () => {
    const mockFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", null, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TRANSIENT");
    }
  });

  // ── basicAuth あり (docker login 済み) ────────────────────────────────

  it("uses Basic auth directly (no anonymous attempt) when Docker credentials are available", async () => {
    const basicAuth = Buffer.from("actor:ghp_token").toString("base64");
    let callCount = 0;
    let capturedAuth: string | undefined;
    const mockFetch = async (url: string, opts?: { headers?: Record<string, string> }) => {
      callCount++;
      capturedAuth = opts?.headers?.Authorization;
      return { ok: true, status: 200, json: async () => ({ token: "jwt-token" }) };
    };
    const token = await fetchRegistryToken("ghcr.io", "dash14/buildcage", basicAuth, mockFetch);
    expect(token).toBe("jwt-token");
    expect(callCount, "should make exactly one request (no anonymous attempt)").toBe(1);
    expect(capturedAuth, "should send the Docker config auth directly").toBe(`Basic ${basicAuth}`);
  });

  it("throws TOKEN_ERROR immediately on 401 when Docker credentials are present (no fallback)", async () => {
    const basicAuth = Buffer.from("actor:expired_token").toString("base64");
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      return { ok: false, status: 401 };
    };
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", basicAuth, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TOKEN_ERROR");
      expect(
        (err as VerifyImageError).message.includes("docker login"),
        "error message should mention docker login",
      ).toBeTruthy();
      expect(callCount, "should not retry with anonymous").toBe(1);
    }
  });

  it("throws TOKEN_ERROR immediately on 403 when Docker credentials are present (no fallback)", async () => {
    const basicAuth = Buffer.from("actor:token").toString("base64");
    const mockFetch = async () => ({ ok: false, status: 403 });
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", basicAuth, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TOKEN_ERROR");
    }
  });

  it("throws TRANSIENT on 5xx when Docker credentials are present", async () => {
    const basicAuth = Buffer.from("actor:token").toString("base64");
    const mockFetch = async () => ({ ok: false, status: 500 });
    try {
      await fetchRegistryToken("ghcr.io", "dash14/buildcage", basicAuth, mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TRANSIENT");
    }
  });
});

// ── readGhcrBasicAuth ─────────────────────────────────────────────────────

describe("readGhcrBasicAuth", () => {
  const mockReadFileSync = (content: string) => (_path: string, _enc: string) => content;

  it("returns auth when auths['ghcr.io'].auth is present", () => {
    const config = JSON.stringify({ auths: { "ghcr.io": { auth: "dGVzdDp0b2tlbg==" } } });
    const result = readGhcrBasicAuth({}, mockReadFileSync(config));
    expect(result).toBe("dGVzdDp0b2tlbg==");
  });

  it("normalizes https:// prefix and trailing slash in key", () => {
    const config = JSON.stringify({ auths: { "https://ghcr.io/": { auth: "dGVzdA==" } } });
    const result = readGhcrBasicAuth({}, mockReadFileSync(config));
    expect(result).toBe("dGVzdA==");
  });

  it("returns null when ghcr.io entry is absent", () => {
    const config = JSON.stringify({ auths: { "docker.io": { auth: "dGVzdA==" } } });
    expect(readGhcrBasicAuth({}, mockReadFileSync(config))).toBe(null);
  });

  it("returns null when auth field is empty string (credsStore environment)", () => {
    const config = JSON.stringify({ auths: { "ghcr.io": {} } });
    expect(readGhcrBasicAuth({}, mockReadFileSync(config))).toBe(null);
  });

  it("returns null when auths is absent", () => {
    const config = JSON.stringify({ credsStore: "desktop" });
    expect(readGhcrBasicAuth({}, mockReadFileSync(config))).toBe(null);
  });

  it("returns null on file read error (not logged in at all)", () => {
    const throwingRead = () => {
      throw new Error("ENOENT");
    };
    expect(readGhcrBasicAuth({}, throwingRead)).toBe(null);
  });

  it("returns null on invalid JSON", () => {
    expect(readGhcrBasicAuth({}, mockReadFileSync("not json"))).toBe(null);
  });

  it("uses DOCKER_CONFIG env var to resolve config path", () => {
    let capturedPath: string | undefined;
    const readSpy = (p: string) => {
      capturedPath = p;
      return JSON.stringify({ auths: {} });
    };
    readGhcrBasicAuth({ DOCKER_CONFIG: "/custom/docker" }, readSpy);
    expect(
      capturedPath?.startsWith("/custom/docker"),
      `expected path under DOCKER_CONFIG, got: ${capturedPath}`,
    ).toBeTruthy();
  });
});

// ── fetchBundle ───────────────────────────────────────────────────────────

const BUNDLE_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";

function makeFetchReturning(responses: any[]) {
  let i = 0;
  return async (url: string) => {
    const resp = responses[i++] ?? responses[responses.length - 1];
    return typeof resp === "function" ? resp(url) : resp;
  };
}

describe("fetchBundle — Referrers API path", () => {
  const digest = "sha256:" + "a".repeat(64);
  const manifestDig = "sha256:" + "b".repeat(64);
  const blobDig = "sha256:" + "d".repeat(64);
  const bundleObj = { mediaType: BUNDLE_TYPE, verificationMaterial: {} };

  it("returns bundle when found via Referrers API (3-request flow: referrers → manifest → blob)", async () => {
    const mockFetch = makeFetchReturning([
      // GET /referrers/<digest>
      {
        ok: true,
        status: 200,
        json: async () => ({
          manifests: [
            {
              artifactType: BUNDLE_TYPE,
              mediaType: "application/vnd.oci.image.manifest.v1+json",
              digest: manifestDig,
            },
          ],
        }),
      },
      // GET /manifests/<manifestDig>
      {
        ok: true,
        status: 200,
        json: async () => ({
          artifactType: BUNDLE_TYPE,
          layers: [{ mediaType: BUNDLE_TYPE, digest: blobDig }],
        }),
      },
      // GET /blobs/<blobDig>
      { ok: true, status: 200, json: async () => bundleObj },
    ]);
    const result = await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
    expect(result).toStrictEqual(bundleObj);
  });

  it("throws NOT_FOUND when Referrers returns no matching artifactType", async () => {
    const mockFetch = makeFetchReturning([
      // Referrers API → no bundle
      {
        ok: true,
        status: 200,
        json: async () => ({
          manifests: [{ artifactType: "application/other", digest: "sha256:c" }],
        }),
      },
      // Fallback tag → 404
      { ok: false, status: 404, json: async () => ({}) },
    ]);
    try {
      await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("NOT_FOUND");
    }
  });
});

describe("fetchBundle — fallback tag path", () => {
  const digest = "sha256:" + "a".repeat(64);
  const manifestDig = "sha256:" + "b".repeat(64);
  const blobDig = "sha256:" + "c".repeat(64);
  const bundleObj = { mediaType: BUNDLE_TYPE };

  it("falls back to sha256-<hex> tag (legacy direct-layers format) and returns bundle", async () => {
    const mockFetch = makeFetchReturning([
      // Referrers API → 404 (old registry, no Referrers support)
      { ok: false, status: 404, json: async () => ({}) },
      // Fallback tag: direct manifest with layers
      {
        ok: true,
        status: 200,
        json: async () => ({
          layers: [{ mediaType: BUNDLE_TYPE, digest: blobDig }],
        }),
      },
      // Blob
      { ok: true, status: 200, json: async () => bundleObj },
    ]);
    const result = await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
    expect(result).toStrictEqual(bundleObj);
  });

  it("falls back to sha256-<hex> tag as OCI image index (standard artifactType match)", async () => {
    const mockFetch = makeFetchReturning([
      // Referrers API → 404
      { ok: false, status: 404, json: async () => ({}) },
      // Fallback tag: image index with correct artifactType
      {
        ok: true,
        status: 200,
        json: async () => ({
          manifests: [
            {
              mediaType: "application/vnd.oci.image.manifest.v1+json",
              artifactType: BUNDLE_TYPE,
              digest: manifestDig,
            },
          ],
        }),
      },
      // Sub-manifest
      {
        ok: true,
        status: 200,
        json: async () => ({
          artifactType: BUNDLE_TYPE,
          layers: [{ mediaType: BUNDLE_TYPE, digest: blobDig }],
        }),
      },
      // Blob
      { ok: true, status: 200, json: async () => bundleObj },
    ]);
    const result = await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
    expect(result).toStrictEqual(bundleObj);
  });

  it("falls back to sha256-<hex> tag as OCI image index (GHCR: config.mediaType used as artifactType)", async () => {
    // GHCR stores config.mediaType ("application/vnd.oci.empty.v1+json") as artifactType
    // in the Referrers Tag Schema index instead of the manifest's own artifactType field.
    const mockFetch = makeFetchReturning([
      // Referrers API → 303 redirect → image index (GHCR behaviour)
      {
        ok: true,
        status: 200,
        json: async () => ({
          manifests: [
            {
              mediaType: "application/vnd.oci.image.manifest.v1+json",
              artifactType: "application/vnd.oci.empty.v1+json", // ← GHCR: config.mediaType
              digest: manifestDig,
            },
          ],
        }),
      },
      // Fallback tag: same image index (fetched again)
      {
        ok: true,
        status: 200,
        json: async () => ({
          manifests: [
            {
              mediaType: "application/vnd.oci.image.manifest.v1+json",
              artifactType: "application/vnd.oci.empty.v1+json", // ← GHCR: config.mediaType
              digest: manifestDig,
            },
          ],
        }),
      },
      // Sub-manifest inspection: real artifactType is correct
      {
        ok: true,
        status: 200,
        json: async () => ({
          artifactType: BUNDLE_TYPE,
          layers: [{ mediaType: BUNDLE_TYPE, digest: blobDig }],
        }),
      },
      // Blob
      { ok: true, status: 200, json: async () => bundleObj },
    ]);
    const result = await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
    expect(result).toStrictEqual(bundleObj);
  });

  it("throws TRANSIENT on 5xx from Referrers API", async () => {
    const mockFetch = makeFetchReturning([{ ok: false, status: 503 }]);
    try {
      await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TRANSIENT");
    }
  });

  it("throws TRANSIENT on network error from Referrers API", async () => {
    const mockFetch = async () => {
      throw new Error("ECONNRESET");
    };
    try {
      await fetchBundle("ghcr.io", "dash14/buildcage", digest, "token", mockFetch);
      assert.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("TRANSIENT");
    }
  });

  it("throws TRANSIENT (not NOT_FOUND) on 403 from blob fetch", async () => {
    const mockFetch = makeFetchReturning([
      // Referrers API → 404 (no Referrers support)
      { ok: false, status: 404, json: async () => ({}) },
      // Fallback tag manifest found (legacy format)
      {
        ok: true,
        status: 200,
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
      expect(err).toBeInstanceOf(VerifyImageError);
      expect(
        (err as VerifyImageError).code,
        "auth error must not be reported as NOT_FOUND (unsigned image)",
      ).toBe("TRANSIENT");
    }
  });
});
