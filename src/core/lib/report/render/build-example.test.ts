import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import { buildRestrictExample } from "./build-example.ts";

const REPO = "buildcage/docker";
const REF = "v2";

function wrap(yaml: string) {
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
    expect(buildRestrictExample([], REPO)).toBe("");
  });

  it("null/undefined → empty string", () => {
    expect(buildRestrictExample(null, REPO)).toBe("");
    expect(buildRestrictExample(undefined, REPO)).toBe("");
  });

  it("HTTPS only entries", () => {
    const rows = [
      { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 5 },
      { host: "github.com", port: "443", ruleType: "HTTPS", count: 2 },
    ];
    expect(buildRestrictExample(rows, REPO, REF)).toBe(
      wrap(
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

  it("HTTP + HTTPS mixed entries", () => {
    const rows = [
      { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 3 },
      { host: "deb.debian.org", port: "80", ruleType: "HTTP", count: 1 },
    ];
    expect(buildRestrictExample(rows, REPO, REF)).toBe(
      wrap(
        [
          "- name: Start Buildcage",
          `  uses: ${REPO}@${REF}`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      registry.npmjs.org:443",
          "    allowed_http_rules: >-",
          "      deb.debian.org:80",
        ].join("\n") + "\n",
      ),
    );
  });

  it("IP entries", () => {
    const rows = [{ host: "192.168.1.1", port: "443", ruleType: "IP", count: 1 }];
    expect(buildRestrictExample(rows, REPO, REF)).toBe(
      wrap(
        [
          "- name: Start Buildcage",
          `  uses: ${REPO}@${REF}`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_ip_rules: >-",
          "      192.168.1.1:443",
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
      wrap(
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

  it("uses custom actionRepo", () => {
    const rows = [{ host: "example.com", port: "443", ruleType: "HTTPS", count: 1 }];
    expect(buildRestrictExample(rows, "myorg/myrepo", REF)).toBe(
      wrap(
        [
          "- name: Start Buildcage",
          `  uses: myorg/myrepo@${REF}`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      example.com:443",
        ].join("\n") + "\n",
      ),
    );
  });

  it("renders a tag actionRef as-is", () => {
    const rows = [{ host: "example.com", port: "443", ruleType: "HTTPS", count: 1 }];
    expect(buildRestrictExample(rows, REPO, "v2.1.0")).toBe(
      wrap(
        [
          "- name: Start Buildcage",
          `  uses: ${REPO}@v2.1.0`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      example.com:443",
        ].join("\n") + "\n",
      ),
    );
  });

  it("renders a commit SHA actionRef as a <sha> placeholder", () => {
    const rows = [{ host: "example.com", port: "443", ruleType: "HTTPS", count: 1 }];
    const sha = "abc1234567890def1234567890abcdef12345678";
    expect(buildRestrictExample(rows, REPO, sha)).toBe(
      wrap(
        [
          "- name: Start Buildcage",
          `  uses: ${REPO}@<sha>`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      example.com:443",
        ].join("\n") + "\n",
      ),
    );
  });
});

reportResults();
