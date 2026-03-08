import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  convertLegacyDomains,
  buildLegacyRules,
} from "./legacy-rules.mjs";

// ---------------------------------------------------------------------------
// convertLegacyDomains (now returns wildcard format)
// ---------------------------------------------------------------------------
describe("convertLegacyDomains", () => {
  it("single domain + single port", () => {
    assert.deepEqual(
      convertLegacyDomains("example.com", "80"),
      ["example.com:80"],
    );
  });

  it("single domain + multiple ports (expanded per port)", () => {
    assert.deepEqual(
      convertLegacyDomains("example.com", "443,8443"),
      ["example.com:443", "example.com:8443"],
    );
  });

  it("multiple domains", () => {
    assert.deepEqual(
      convertLegacyDomains("a.com, b.com", "80"),
      ["a.com:80", "b.com:80"],
    );
  });

  it("wildcard domain + multiple ports", () => {
    assert.deepEqual(
      convertLegacyDomains("*.example.com", "443,8443"),
      ["*.example.com:443", "*.example.com:8443"],
    );
  });

  it("multiple domains + multiple ports (cartesian product)", () => {
    assert.deepEqual(
      convertLegacyDomains("a.com, b.com", "80,8080"),
      ["a.com:80", "a.com:8080", "b.com:80", "b.com:8080"],
    );
  });
});

// ---------------------------------------------------------------------------
// buildLegacyRules
// ---------------------------------------------------------------------------
describe("buildLegacyRules", () => {
  it("converts legacy domains with deprecation warning", () => {
    const warnings = [];
    const origLog = console.log;
    console.log = (msg) => warnings.push(msg);
    try {
      const result = buildLegacyRules({
        domainsInput: "example.com",
        portsInput: "80",
        defaultPort: 80,
        protocol: "HTTP",
      });
      assert.deepEqual(result, ["example.com:80"]);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /Deprecated/i);
    } finally {
      console.log = origLog;
    }
  });

  it("empty input → empty array", () => {
    const result = buildLegacyRules({
      domainsInput: "",
      portsInput: "80",
      defaultPort: 80,
      protocol: "HTTP",
    });
    assert.deepEqual(result, []);
  });

  it("falls back to defaultPort when portsInput is empty", () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      const result = buildLegacyRules({
        domainsInput: "example.com",
        portsInput: "",
        defaultPort: 443,
        protocol: "HTTPS",
      });
      assert.deepEqual(result, ["example.com:443"]);
    } finally {
      console.log = origLog;
    }
  });
});
