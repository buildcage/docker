import { describe, it, assert, reportResults } from "../../test/test-shim.ts";
import { annotateKnownBlocked } from "./annotate-known-blocked.ts";

describe("annotateKnownBlocked", () => {
  const row = (overrides = {}) => ({
    host: "evil.example.com",
    port: "443",
    ruleType: "HTTPS",
    reason: "not in allowlist",
    count: 3,
    ...overrides,
  });

  it("marks all rows as not expected when no rules are given", () => {
    const result = annotateKnownBlocked([row()], []);
    assert.equal(result[0].expected, false);
  });

  it("marks a row as expected on an exact host:port match", () => {
    const result = annotateKnownBlocked([row()], ["evil.example.com:443"]);
    assert.equal(result[0].expected, true);
  });

  it("marks a row as expected on a wildcard match", () => {
    const result = annotateKnownBlocked([row()], ["*.example.com:443"]);
    assert.equal(result[0].expected, true);
  });

  it("marks a row as expected on a ~regex match", () => {
    const result = annotateKnownBlocked([row()], ["~^evil\\.example\\.com:443$"]);
    assert.equal(result[0].expected, true);
  });

  it("does not match when the port differs", () => {
    const result = annotateKnownBlocked([row({ port: "80" })], ["evil.example.com:443"]);
    assert.equal(result[0].expected, false);
  });

  it("preserves the original row fields", () => {
    const result = annotateKnownBlocked([row()], []);
    assert.equal(result[0].host, "evil.example.com");
    assert.equal(result[0].port, "443");
    assert.equal(result[0].ruleType, "HTTPS");
    assert.equal(result[0].reason, "not in allowlist");
    assert.equal(result[0].count, 3);
  });

  it("annotates each row independently across a mixed list", () => {
    const result = annotateKnownBlocked(
      [row({ host: "known.example.com" }), row({ host: "unknown.example.com" })],
      ["known.example.com:443"],
    );
    assert.equal(result[0].expected, true);
    assert.equal(result[1].expected, false);
  });
});

reportResults();
