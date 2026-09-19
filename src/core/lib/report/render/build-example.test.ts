import { describe, it, expect } from "vitest";
import { buildRestrictExample } from "./build-example.ts";
import { restrictExampleBlock } from "./restrict-example.ts";

const REPO = "buildcage/docker";
const REF = "v2";

describe("buildRestrictExample", () => {
  it("empty array → empty string", () => {
    expect(buildRestrictExample([], REPO)).toBe("");
  });

  it("null/undefined → empty string", () => {
    expect(buildRestrictExample(null, REPO)).toBe("");
    expect(buildRestrictExample(undefined, REPO)).toBe("");
  });

  it("keeps several rules under one param, in the order they appeared", () => {
    const rows = [
      { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 5 },
      { host: "github.com", port: "443", ruleType: "HTTPS", count: 2 },
    ];
    expect(buildRestrictExample(rows, REPO, REF)).toBe(
      restrictExampleBlock(
        [
          "- name: Start Buildcage",
          `  uses: ${REPO}@${REF}`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      registry.npmjs.org:443",
          "      github.com:443",
        ].join("\n") + "\n",
      ),
    );
  });

  it("all three rule types", () => {
    const rows = [
      { host: "example.com", port: "443", ruleType: "HTTPS", count: 2 },
      { host: "example.com", port: "80", ruleType: "HTTP", count: 1 },
      { host: "10.0.0.1", port: "8080", ruleType: "IP", count: 1 },
    ];
    expect(buildRestrictExample(rows, REPO, REF)).toBe(
      restrictExampleBlock(
        [
          "- name: Start Buildcage",
          `  uses: ${REPO}@${REF}`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      example.com:443",
          "    allowed_http_rules: >-",
          "      example.com:80",
          "    allowed_ip_rules: >-",
          "      10.0.0.1:8080",
        ].join("\n") + "\n",
      ),
    );
  });
});

describe("buildRestrictExample: rows that map to no action input", () => {
  const audited = (ruleType: string) => ({
    host: "a.example.com",
    port: "443",
    ruleType,
    count: 1,
  });

  it("skips a rule type the setup action has no input for", () => {
    const yaml = buildRestrictExample([audited("DNS"), audited("HTTPS")], REPO, "v3");
    expect(yaml.match(/a\.example\.com/g)?.length).toBe(1);
  });

  it("renders nothing when no row maps to an input", () => {
    expect(buildRestrictExample([audited("DNS")], REPO, "v3")).toBe("");
  });
});
