/**
 * The real @sigstore/verify, run on the bundle buildcage/docker published for
 * its v4.0.4 inspect image. A policy that accepted another repository, tag or
 * commit would still pass sigstore.test.ts, whose @sigstore/* are mocks, but
 * not this. Only the TUF fetch is replaced, by the trusted root it returned
 * then, to keep the test offline.
 */
import { readFileSync } from "node:fs";

import { describe, it, expect, vi } from "vitest";

vi.mock("@sigstore/tuf", async () => {
  const { TrustedRoot } = await import("@sigstore/protobuf-specs");
  const json = readFileSync(new URL("./__fixtures__/trusted_root.json", import.meta.url), "utf8");
  return { getTrustedRoot: async () => TrustedRoot.fromJSON(JSON.parse(json)) };
});

import { verifyBundle } from "./sigstore.ts";
import { buildVerifyOptions } from "./verify-policy.ts";

const BUNDLE: unknown = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/docker-v4.0.4-inspect.bundle.json", import.meta.url),
    "utf8",
  ),
);
const DIGEST = "sha256:8dad90c2134d490ac20f65498f7d2b40362a8cd79b919e4e9960075f8563bc2a";
const COMMIT = "b5459229d32c2aad72e4492fac98a192f85f75e0";

function verifyAs(actionRef: string, actionRepo = "buildcage/docker", digest = DIGEST) {
  const options = buildVerifyOptions({ actionRef, actionRepo });
  if (!options) throw new Error(`no policy for ${actionRef}`);
  return verifyBundle(BUNDLE, options, digest);
}

describe("verifyBundle on a published bundle", () => {
  it("accepts the release it was signed for, by tag, by a tag it falls under, or by commit", async () => {
    for (const ref of ["v4.0.4", "v4.0", "v4", COMMIT]) {
      await expect(verifyAs(ref)).resolves.toBeUndefined();
    }
    await expect(verifyAs("v4.0.4", "BuildCage/Docker")).resolves.toBeUndefined();
  });

  it("rejects it for another repository", async () => {
    await expect(verifyAs("v4.0.4", "buildcage/isolated-run")).rejects.toThrow(
      /verification failed/,
    );
  });

  it("rejects it for another tag", async () => {
    for (const ref of ["v4.0.3", "v4.1", "v3"]) {
      await expect(verifyAs(ref)).rejects.toThrow(/verification failed/);
    }
  });

  it("rejects it for another commit", async () => {
    // v4.0.3's.
    await expect(verifyAs("ecedf92e65a9cef8c91249e890a13d02ecfaf7a6")).rejects.toThrow(
      /verification failed/,
    );
  });

  it("rejects it for another image", async () => {
    await expect(verifyAs("v4.0.4", undefined, `sha256:${"0".repeat(64)}`)).rejects.toThrow(
      /does not match fetched digest/,
    );
  });
});
