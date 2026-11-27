import { describe, it, expect, assert } from "vitest";

import { VerifyImageError } from "./errors.ts";
import type { VerifyBundleOptions } from "./sigstore.ts";
import { buildVerifyOptions, releaseTarget } from "./verify-policy.ts";

// ── Constants mirrored from verify-policy.ts ──────────────────────────────────

const EXPECTED_ISSUER = "https://token.actions.githubusercontent.com";
const RELEASE_WORKFLOW = ".github/workflows/docker-publish.yml";
const REPO = "owner/repo";
const COMMIT = "a".repeat(40);

const OID_RUNNER_ENVIRONMENT = "1.3.6.1.4.1.57264.1.11";
const OID_SOURCE_REPO_DIGEST = "1.3.6.1.4.1.57264.1.13";
const OID_SOURCE_REPO_REF = "1.3.6.1.4.1.57264.1.14";
const OID_BUILD_CONFIG_DIGEST = "1.3.6.1.4.1.57264.1.19";

/** DER UTF8String: [0x0C, len, ...utf8bytes] */
const der = (s: string) => Buffer.concat([Buffer.from([0x0c, s.length]), Buffer.from(s, "utf8")]);

function expectVerifyFailed(fn: () => unknown): VerifyImageError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(VerifyImageError);
    expect((err as VerifyImageError).code).toBe("VERIFY_FAILED");
    return err as VerifyImageError;
  }
  assert.fail("should have thrown");
}

// ── releaseTarget ─────────────────────────────────────────────────────────────

describe("releaseTarget: SHA pin", () => {
  it("uses the pinned commit, lowercased, whatever the version", () => {
    expect(releaseTarget({ actionRef: COMMIT, actionVersion: "2.1.0" })).toEqual({
      kind: "commit",
      commit: COMMIT,
    });
    expect(releaseTarget({ actionRef: COMMIT.toUpperCase(), actionVersion: "2.1.0-rc1" })).toEqual({
      kind: "commit",
      commit: COMMIT,
    });
  });
});

describe("releaseTarget: version tag", () => {
  const target = (actionRef: string, actionVersion: string) =>
    releaseTarget({ actionRef, actionVersion });

  it("takes a full ref naming exactly this version, prerelease or not", () => {
    expect(target("v2.1.0", "2.1.0")).toEqual({ kind: "tag" });
    expect(target("v2.1.6-rc1", "2.1.6-rc1")).toEqual({ kind: "tag" });
    expect(target("v2.2.0-beta.1", "2.2.0-beta.1")).toEqual({ kind: "tag" });
  });

  it("takes a major or minor ref this version falls under, stable releases only", () => {
    expect(target("v2", "2.99.0")).toEqual({ kind: "tag" });
    expect(target("v2.1", "2.1.3")).toEqual({ kind: "tag" });
  });

  it("refuses a full ref naming another version", () => {
    const err = expectVerifyFailed(() => target("v2.1.0", "2.1.1"));
    expect(err.message).toContain("does not cover this action's version v2.1.1.");
    expectVerifyFailed(() => target("v2.1.6", "2.1.6-rc1"));
    expectVerifyFailed(() => target("v2.1.6-rc1", "2.1.6"));
    expectVerifyFailed(() => target("v2.1.6-rc1", "2.1.6-rc10"));
  });

  it("refuses a major or minor ref this version does not fall under", () => {
    expectVerifyFailed(() => target("v2.1", "2.10.0"));
    expectVerifyFailed(() => target("v2", "20.0.0"));
    expectVerifyFailed(() => target("v2.1", "2.2.0"));
  });

  it("refuses a major or minor ref when this version is a prerelease", () => {
    const err = expectVerifyFailed(() => target("v2", "2.2.0-rc1"));
    expect(err.message).toContain("or that version is a prerelease.");
    expectVerifyFailed(() => target("v2.2", "2.2.0-beta.1"));
  });
});

describe("releaseTarget: version", () => {
  it("refuses a build whose version is not a release version", () => {
    for (const actionVersion of [
      "",
      "2.1",
      "v2.1.0",
      "2.1.0-",
      "2.1.0-x-y",
      `2.1.0-${"a".repeat(95)}`,
    ]) {
      const err = expectVerifyFailed(() => releaseTarget({ actionRef: "v2", actionVersion }));
      expect(err.message).toContain("has no release version");
    }
  });
});

describe("releaseTarget: unverifiable refs", () => {
  const target = (actionRef: string) => releaseTarget({ actionRef, actionVersion: "2.1.0" });

  it("returns null for a branch ref", () => {
    expect(target("main")).toBe(null);
  });

  it("returns null for a branch that only starts with v", () => {
    for (const ref of ["vendor-fix", "v2-dev", "v2.1.x", "v2.1.0-", "v2..1", "v2.1-rc1"]) {
      expect(target(ref), ref).toBe(null);
    }
  });

  it("returns null for a local ./setup ref or an empty ref", () => {
    expect(target("./setup")).toBe(null);
    expect(target("")).toBe(null);
  });
});

// ── buildVerifyOptions ────────────────────────────────────────────────────────
//
// The SAN is checked by converting certificateIdentityURI to a RegExp and
// matching sample SAN strings, as @sigstore/verify matches
// subjectAlternativeName.

describe("buildVerifyOptions", () => {
  function opts(actionVersion = "2.1.0", actionRepo = REPO): VerifyBundleOptions {
    return buildVerifyOptions({ actionRepo, actionVersion, commit: COMMIT });
  }
  function matchesSAN(o: VerifyBundleOptions, tag: string, repo = REPO) {
    return new RegExp(o.certificateIdentityURI!).test(
      `https://github.com/${repo}/${RELEASE_WORKFLOW}@refs/tags/${tag}`,
    );
  }

  it("sets certificateIssuer and the log thresholds", () => {
    expect(opts()).toMatchObject({
      certificateIssuer: EXPECTED_ISSUER,
      tlogThreshold: 1,
      ctLogThreshold: 1,
    });
  });

  it("matches only this version's release tag", () => {
    expect(matchesSAN(opts(), "v2.1.0")).toBe(true);
    for (const tag of ["v2.1.0.1", "v2.1.00", "v2.1.0-rc1", "v2.1.1", "V2.1.0", "v2"]) {
      expect(matchesSAN(opts(), tag), tag).toBe(false);
    }
    expect(matchesSAN(opts("2.2.0-beta.1"), "v2.2.0-beta.1")).toBe(true);
    expect(matchesSAN(opts("2.2.0-beta.1"), "v2.2.0-beta11")).toBe(false);
  });

  it("matches the repository in any case, and no other repository", () => {
    expect(matchesSAN(opts("2.1.0", "Owner/Repo"), "v2.1.0", "owner/repo")).toBe(true);
    expect(matchesSAN(opts("2.1.0", "owner/repo"), "v2.1.0", "Owner/Repo")).toBe(true);
    expect(matchesSAN(opts(), "v2.1.0", "owner/repo2")).toBe(false);
    expect(matchesSAN(opts(), "v2.1.0", "owner/rep")).toBe(false);
  });

  it("requires a GitHub-hosted runner, the release commit and its tag", () => {
    const oids = opts().certificateOIDs!;
    const asBuffers = Object.fromEntries(
      Object.entries(oids).map(([oid, value]) => [oid, Buffer.from(value, "binary")]),
    );
    expect(asBuffers).toStrictEqual({
      [OID_RUNNER_ENVIRONMENT]: der("github-hosted"),
      [OID_SOURCE_REPO_DIGEST]: der(COMMIT),
      [OID_SOURCE_REPO_REF]: der("refs/tags/v2.1.0"),
      [OID_BUILD_CONFIG_DIGEST]: der(COMMIT),
    });
  });
});
