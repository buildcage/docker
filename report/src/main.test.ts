import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseContainerIds, shouldFailOnBlocked, substituteActionPlaceholders, consoleMethodForLevel } from "./main.ts";

describe("parseContainerIds", () => {
  it("splits one ID per line", () => {
    assert.deepEqual(parseContainerIds("abc123\ndef456\n"), ["abc123", "def456"]);
  });

  it("returns an empty array for empty output", () => {
    assert.deepEqual(parseContainerIds(""), []);
  });

  it("drops blank lines and trims whitespace", () => {
    assert.deepEqual(parseContainerIds("\n  abc123  \n\n"), ["abc123"]);
  });
});

describe("shouldFailOnBlocked", () => {
  it("fails when restrict mode, blocked, and fail_on_blocked are all true", () => {
    assert.equal(shouldFailOnBlocked({ mode: "restrict", blocked: true }, true), true);
  });

  it("does not fail when fail_on_blocked is false", () => {
    assert.equal(shouldFailOnBlocked({ mode: "restrict", blocked: true }, false), false);
  });

  it("does not fail when blocked is false", () => {
    assert.equal(shouldFailOnBlocked({ mode: "restrict", blocked: false }, true), false);
  });

  it("does not fail when blocked is absent (e.g. no blocked connections at all)", () => {
    assert.equal(shouldFailOnBlocked({ mode: "restrict" }, true), false);
  });

  it("never fails in audit mode, even if blocked were somehow set", () => {
    assert.equal(shouldFailOnBlocked({ mode: "audit", blocked: true }, true), false);
  });

  it("never fails when mode is null (no proxy logs found)", () => {
    assert.equal(shouldFailOnBlocked({ mode: null, blocked: true }, true), false);
  });
});

describe("substituteActionPlaceholders", () => {
  it("substitutes both placeholders from the given env", () => {
    const env = { GITHUB_ACTION_REPOSITORY: "dash14/buildcage", GITHUB_ACTION_REF: "v2" };
    assert.equal(
      substituteActionPlaceholders("uses: {{GITHUB_ACTION_REPOSITORY}}/setup@{{GITHUB_ACTION_REF}}", env),
      "uses: dash14/buildcage/setup@v2",
    );
  });

  it("substitutes every occurrence, not just the first", () => {
    const env = { GITHUB_ACTION_REPOSITORY: "dash14/buildcage" };
    assert.equal(
      substituteActionPlaceholders("{{GITHUB_ACTION_REPOSITORY}} and {{GITHUB_ACTION_REPOSITORY}}", env),
      "dash14/buildcage and dash14/buildcage",
    );
  });

  it("falls back to an empty string when the env var is unset", () => {
    assert.equal(substituteActionPlaceholders("repo: {{GITHUB_ACTION_REPOSITORY}}", {}), "repo: ");
  });

  it("leaves text with no placeholders untouched", () => {
    assert.equal(substituteActionPlaceholders("no placeholders here", {}), "no placeholders here");
  });
});

describe("consoleMethodForLevel", () => {
  it("maps each known level to its console method", () => {
    assert.equal(consoleMethodForLevel("info"), "log");
    assert.equal(consoleMethodForLevel("debug"), "debug");
    assert.equal(consoleMethodForLevel("warning"), "warn");
    assert.equal(consoleMethodForLevel("error"), "error");
  });

  it("falls back to \"log\" for an unrecognized level", () => {
    assert.equal(consoleMethodForLevel("trace"), "log");
  });
});
