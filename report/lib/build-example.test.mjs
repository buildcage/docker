import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRestrictExample } from "./build-example.mjs";

const REPO = "dash14/buildcage";

function wrap(yaml) {
  return (
    "\n<details>\n" +
    "<summary>🛡️ Switch to restrict mode</summary>\n\n" +
    "```yaml\n" +
    yaml +
    "```\n\n" +
    "</details>\n"
  );
}

describe("buildRestrictExample", () => {
  it("empty array → empty string", () => {
    assert.equal(buildRestrictExample([], REPO), "");
  });

  it("null/undefined → empty string", () => {
    assert.equal(buildRestrictExample(null, REPO), "");
    assert.equal(buildRestrictExample(undefined, REPO), "");
  });

  it("HTTPS only entries", () => {
    const rows = [
      { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 5 },
      { host: "github.com", port: "443", ruleType: "HTTPS", count: 2 },
    ];
    assert.equal(
      buildRestrictExample(rows, REPO),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/setup@v2`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      registry.npmjs.org:443",
          "      github.com:443",
        ].join("\n") + "\n",
      )
    );
  });

  it("HTTP + HTTPS mixed entries", () => {
    const rows = [
      { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 3 },
      { host: "deb.debian.org", port: "80", ruleType: "HTTP", count: 1 },
    ];
    assert.equal(
      buildRestrictExample(rows, REPO),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/setup@v2`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      registry.npmjs.org:443",
          "    allowed_http_rules: >-",
          "      deb.debian.org:80",
        ].join("\n") + "\n",
      )
    );
  });

  it("IP entries", () => {
    const rows = [
      { host: "192.168.1.1", port: "443", ruleType: "IP", count: 1 },
    ];
    assert.equal(
      buildRestrictExample(rows, REPO),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/setup@v2`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_ip_rules: >-",
          "      192.168.1.1:443",
        ].join("\n") + "\n",
      )
    );
  });

  it("all three rule types", () => {
    const rows = [
      { host: "example.com", port: "443", ruleType: "HTTPS", count: 2 },
      { host: "example.com", port: "80", ruleType: "HTTP", count: 1 },
      { host: "10.0.0.1", port: "8080", ruleType: "IP", count: 1 },
    ];
    assert.equal(
      buildRestrictExample(rows, REPO),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/setup@v2`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      example.com:443",
          "    allowed_http_rules: >-",
          "      example.com:80",
          "    allowed_ip_rules: >-",
          "      10.0.0.1:8080",
        ].join("\n") + "\n",
      )
    );
  });

  it("uses custom actionRepo", () => {
    const rows = [
      { host: "example.com", port: "443", ruleType: "HTTPS", count: 1 },
    ];
    assert.equal(
      buildRestrictExample(rows, "myorg/myrepo"),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          "  uses: myorg/myrepo/setup@v2",
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      example.com:443",
        ].join("\n") + "\n",
      )
    );
  });
});
