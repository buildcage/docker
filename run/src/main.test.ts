/**
 * Unit tests for run/main.ts
 *
 * Run with: vp test run run/src/main.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  buildACLRules,
  buildComposeUpArgs,
  buildComposeDownArgs,
  parseWritablePaths,
  readKnownBlockedRules,
} from "./main.ts";
import { InvalidRulesError } from "../../core/lib/acl/rules.ts";

describe("buildACLRules", () => {
  it("parses whitespace-separated HTTPS rules", () => {
    const { httpsRules } = buildACLRules({
      httpsRulesInput: "example.com:443 *.cdn.example.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    assert.deepEqual(httpsRules, ["example.com:443", "*.cdn.example.com:443"]);
  });

  it("handles newline-separated rules", () => {
    const { httpsRules } = buildACLRules({
      httpsRulesInput: "a.com:443\nb.com:443",
      httpRulesInput: "",
      ipRulesInput: "",
    });
    assert.deepEqual(httpsRules, ["a.com:443", "b.com:443"]);
  });

  it("returns empty arrays for empty/undefined inputs", () => {
    const result = buildACLRules({
      httpsRulesInput: "",
      httpRulesInput: undefined,
      ipRulesInput: "   ",
    });
    assert.deepEqual(result.httpsRules, []);
    assert.deepEqual(result.httpRules, []);
    assert.deepEqual(result.ipRules, []);
  });

  it("throws InvalidRulesError with code INVALID_RULES for invalid rule syntax", () => {
    assert.throws(
      () =>
        buildACLRules({
          httpsRulesInput: "no-port-specified",
          httpRulesInput: "",
          ipRulesInput: "",
        }),
      (err) => {
        assert.ok(err instanceof InvalidRulesError);
        assert.equal(err.code, "INVALID_RULES");
        return true;
      },
    );
  });
});

describe("readKnownBlockedRules", () => {
  it("parses whitespace-separated rules", () => {
    assert.deepEqual(readKnownBlockedRules("known-bad.example.com:443 *.noisy.example.com:80"), [
      "known-bad.example.com:443",
      "*.noisy.example.com:80",
    ]);
  });

  it("returns an empty array for empty/undefined input", () => {
    assert.deepEqual(readKnownBlockedRules(undefined), []);
    assert.deepEqual(readKnownBlockedRules(""), []);
  });

  it("throws InvalidRulesError with code INVALID_RULES for invalid rule syntax", () => {
    assert.throws(
      () => readKnownBlockedRules("no-port-specified"),
      (err) => {
        assert.ok(err instanceof InvalidRulesError);
        assert.equal(err.code, "INVALID_RULES");
        return true;
      },
    );
  });
});

// -----------------------------------------------------------------------
// buildComposeUpArgs / buildComposeDownArgs
//
// Regression guard for the concurrent-step container/network collision:
// both must always include "-p" + the project name, or Compose falls back
// to an implicit, directory-derived project name shared by every
// concurrent `run` step in the job (see core/lib/docker/container.ts's
// deriveProjectName).
// -----------------------------------------------------------------------

describe("buildComposeUpArgs", () => {
  it("always includes -p <projectName> alongside -f <composeFile>", () => {
    const args = buildComposeUpArgs({
      composeFile: "/path/to/compose.yaml",
      projectName: "buildcage-proxy-abcd1234",
      pullPolicy: "always",
    });
    assert.deepEqual(args, [
      "compose",
      "-f",
      "/path/to/compose.yaml",
      "-p",
      "buildcage-proxy-abcd1234",
      "up",
      "-d",
      "--pull",
      "always",
      "--no-build",
      "--wait",
      "--quiet-pull",
    ]);
  });
});

describe("buildComposeDownArgs", () => {
  it("always includes -p <projectName> alongside -f <composeFile>", () => {
    const args = buildComposeDownArgs({
      composeFile: "/path/to/compose.yaml",
      projectName: "buildcage-proxy-abcd1234",
    });
    assert.deepEqual(args, [
      "compose",
      "-f",
      "/path/to/compose.yaml",
      "-p",
      "buildcage-proxy-abcd1234",
      "down",
    ]);
  });
});

describe("parseWritablePaths", () => {
  it("splits on newlines, trimming each entry", () => {
    assert.deepEqual(parseWritablePaths("/opt/extra\n /var/cache \n"), [
      "/opt/extra",
      "/var/cache",
    ]);
  });

  it("does not split on internal spaces (paths may contain them)", () => {
    assert.deepEqual(parseWritablePaths("/path with spaces\n/other"), [
      "/path with spaces",
      "/other",
    ]);
  });

  it("returns an empty array for empty/undefined input", () => {
    assert.deepEqual(parseWritablePaths(""), []);
    assert.deepEqual(parseWritablePaths(undefined), []);
    assert.deepEqual(parseWritablePaths("   \n  \n"), []);
  });

  it("preserves a lone '/' entry (the disable-readonly sentinel)", () => {
    assert.deepEqual(parseWritablePaths("/"), ["/"]);
  });
});
