/**
 * The @sigstore/* packages are mocked: what is under test here is not their
 * cryptography but the policy this module hands them, how it reports their
 * refusal, and that it still checks the signed digest afterwards.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const sigstore = vi.hoisted(() => ({
  trustedRoot: { marker: "trusted-root" },
  getTrustedRoot: vi.fn(),
  verify: vi.fn(),
  verifierOptions: vi.fn(),
}));

vi.mock("@sigstore/tuf", () => ({
  getTrustedRoot: (options: unknown) => sigstore.getTrustedRoot(options),
}));

vi.mock("@sigstore/bundle", () => ({
  bundleFromJSON: vi.fn((json: unknown) => ({ parsed: json })),
}));

vi.mock("@sigstore/verify", () => ({
  toTrustMaterial: vi.fn((root: unknown) => ({ material: root })),
  toSignedEntity: vi.fn((bundle: unknown) => ({ entity: bundle })),
  Verifier: class {
    constructor(material: unknown, options: unknown) {
      sigstore.verifierOptions({ material, options });
    }
    verify(entity: unknown, policy: unknown) {
      return sigstore.verify(entity, policy);
    }
  },
}));

import { VerifyImageError } from "./errors.ts";
import type { DsseBundle } from "./signed-digest.ts";
import { verifyBundle, type VerifyBundleOptions } from "./sigstore.ts";

const DIGEST = "sha256:" + "a".repeat(64);

/** A DSSE bundle whose signed in-toto payload names `digest`. */
function bundleFor(digest: string): DsseBundle {
  const statement = { subject: [{ digest: { sha256: digest.replace("sha256:", "") } }] };
  return {
    dsseEnvelope: {
      payloadType: "application/vnd.in-toto+json",
      payload: Buffer.from(JSON.stringify(statement), "utf8").toString("base64"),
    },
  };
}

/** The policy object the Verifier was handed on the most recent call. */
function policyOfLastVerify(): any {
  return sigstore.verify.mock.calls[sigstore.verify.mock.calls.length - 1][1];
}

async function codeOfRejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(VerifyImageError);
    return (err as VerifyImageError).code;
  }
  throw new Error("should have thrown");
}

describe("verifyBundle", () => {
  // restoreMocks only restores spies; these are plain vi.fn()s created once at
  // module scope, so their call history would otherwise run across cases.
  beforeEach(() => {
    sigstore.verify.mockReset();
    sigstore.verifierOptions.mockReset();
    sigstore.getTrustedRoot.mockReset();
    sigstore.getTrustedRoot.mockImplementation(async () => sigstore.trustedRoot);
  });

  it("resolves when the signature verifies and the signed digest matches", async () => {
    await expect(verifyBundle(bundleFor(DIGEST), {}, DIGEST)).resolves.toBeUndefined();
    expect(sigstore.verify.mock.calls.length).toBe(1);
  });

  // Dropping the assertSignedDigest call at the end of verifyBundle would let a
  // bundle re-attached to another image pass, and has to fail here.
  it("still rejects a re-attached bundle after the signature itself verifies", async () => {
    const otherDigest = "sha256:" + "b".repeat(64);
    expect(await codeOfRejection(() => verifyBundle(bundleFor(otherDigest), {}, DIGEST))).toBe(
      "VERIFY_FAILED",
    );
    // The signature check did pass; what refused is the digest assertion.
    expect(sigstore.verify.mock.calls.length).toBe(1);
  });

  it("reports a verifier refusal as VERIFY_FAILED, keeping the underlying message", async () => {
    sigstore.verify.mockImplementationOnce(() => {
      throw new Error("certificate identity mismatch");
    });
    try {
      await verifyBundle(bundleFor(DIGEST), {}, DIGEST);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(VerifyImageError);
      expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
      expect((err as Error).message).toContain("certificate identity mismatch");
    }
  });

  it("passes the log thresholds straight through to the verifier", async () => {
    await verifyBundle(bundleFor(DIGEST), { tlogThreshold: 2, ctLogThreshold: 0 }, DIGEST);
    const { material, options } = sigstore.verifierOptions.mock.calls[0][0];
    expect(material).toStrictEqual({ material: sigstore.trustedRoot });
    expect(options).toStrictEqual({ tlogThreshold: 2, ctlogThreshold: 0 });
  });

  describe("policy", () => {
    async function policyFor(options: VerifyBundleOptions) {
      await verifyBundle(bundleFor(DIGEST), options, DIGEST);
      return policyOfLastVerify();
    }

    it("is empty when no identity constraints are given", async () => {
      expect(await policyFor({})).toStrictEqual({});
    });

    it("carries certificateIdentityURI as the SAN pattern", async () => {
      expect(
        await policyFor({ certificateIdentityURI: "^https://github\\.com/buildcage/" }),
      ).toStrictEqual({ subjectAlternativeName: "^https://github\\.com/buildcage/" });
    });

    it("carries certificateIssuer as the issuer extension", async () => {
      expect(
        await policyFor({ certificateIssuer: "https://token.actions.githubusercontent.com" }),
      ).toStrictEqual({ extensions: { issuer: "https://token.actions.githubusercontent.com" } });
    });

    it("turns a dotted OID string into the numeric arc the verifier expects", async () => {
      const policy = await policyFor({ certificateOIDs: { "1.3.6.1.4.1.57264.1.8": "\\fvalue" } });
      expect(policy.oids.length).toBe(1);
      expect(policy.oids[0].oid).toStrictEqual({ id: [1, 3, 6, 1, 4, 1, 57264, 1, 8] });
      expect(policy.oids[0].value.equals(Buffer.from("\\fvalue"))).toBe(true);
    });

    it("carries every constraint at once when all three are given", async () => {
      const policy = await policyFor({
        certificateIdentityURI: "^https://github\\.com/buildcage/",
        certificateIssuer: "https://token.actions.githubusercontent.com",
        certificateOIDs: { "1.2.3": "v" },
      });
      expect(policy.subjectAlternativeName).toBe("^https://github\\.com/buildcage/");
      expect(policy.extensions).toStrictEqual({
        issuer: "https://token.actions.githubusercontent.com",
      });
      expect(policy.oids[0].oid).toStrictEqual({ id: [1, 2, 3] });
    });
  });
});

describe("the TUF cache the trusted root is fetched through", () => {
  let runnerTemp: string;

  beforeEach(() => {
    runnerTemp = mkdtempSync(join(tmpdir(), "runner-temp-"));
    vi.stubEnv("RUNNER_TEMP", runnerTemp);
    sigstore.getTrustedRoot.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(runnerTemp, { recursive: true, force: true });
  });

  /** The cachePath handed to getTrustedRoot, and what it held at that moment. */
  function recordCache(result: () => unknown) {
    const seen: { cachePath?: string; entries?: string[] } = {};
    sigstore.getTrustedRoot.mockImplementation(async (options: { cachePath: string }) => {
      seen.cachePath = options.cachePath;
      seen.entries = readdirSync(options.cachePath);
      return result();
    });
    return seen;
  }

  it("starts empty under RUNNER_TEMP, so no root.json an earlier job left is trusted", async () => {
    const seen = recordCache(() => sigstore.trustedRoot);
    await verifyBundle(bundleFor(DIGEST), {}, DIGEST);
    expect(dirname(seen.cachePath!)).toBe(runnerTemp);
    expect(seen.entries).toStrictEqual([]);
    expect(existsSync(seen.cachePath!)).toBe(false);
  });

  it("is removed when the fetch fails too", async () => {
    const seen = recordCache(() => {
      throw new Error("TUF mirror unreachable");
    });
    await expect(verifyBundle(bundleFor(DIGEST), {}, DIGEST)).rejects.toThrow(
      "TUF mirror unreachable",
    );
    expect(existsSync(seen.cachePath!)).toBe(false);
  });

  it("falls back to the system temp dir outside a runner", async () => {
    vi.stubEnv("RUNNER_TEMP", "");
    const seen = recordCache(() => sigstore.trustedRoot);
    await verifyBundle(bundleFor(DIGEST), {}, DIGEST);
    expect(dirname(seen.cachePath!)).toBe(tmpdir());
  });
});
