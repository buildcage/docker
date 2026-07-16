/**
 * Unit tests for sandbox/main.js
 *
 * Run with: node --test sandbox/src/main.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildACLRules, buildComposeUpArgs, buildComposeDownArgs } from "./main.js";
import { SandboxError } from "./lib/errors.js";

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

  it("throws SandboxError with code INVALID_RULES for invalid rule syntax", () => {
    assert.throws(
      () =>
        buildACLRules({
          httpsRulesInput: "no-port-specified",
          httpRulesInput: "",
          ipRulesInput: "",
        }),
      (err) => {
        assert.ok(err instanceof SandboxError);
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
// concurrent `sandbox` step in the job (see lib/container.js's
// deriveProjectName).
// -----------------------------------------------------------------------

describe("buildComposeUpArgs", () => {
  it("always includes -p <projectName> alongside -f <composeFile>", () => {
    const args = buildComposeUpArgs({
      composeFile: "/path/to/compose.yaml",
      projectName: "buildcage-sandbox-abcd1234",
      pullPolicy: "always",
    });
    assert.deepEqual(args, [
      "compose", "-f", "/path/to/compose.yaml",
      "-p", "buildcage-sandbox-abcd1234",
      "up", "-d", "--pull", "always", "--no-build", "--wait", "--quiet-pull",
    ]);
  });
});

describe("buildComposeDownArgs", () => {
  it("always includes -p <projectName> alongside -f <composeFile>", () => {
    const args = buildComposeDownArgs({
      composeFile: "/path/to/compose.yaml",
      projectName: "buildcage-sandbox-abcd1234",
    });
    assert.deepEqual(args, [
      "compose", "-f", "/path/to/compose.yaml",
      "-p", "buildcage-sandbox-abcd1234",
      "down",
    ]);
  });
});
