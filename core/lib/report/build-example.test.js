import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRestrictExample } from "./build-example.js";

const REPO = "dash14/buildcage";
const REF = "v2";

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
      buildRestrictExample(rows, REPO, REF),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/setup@${REF}`,
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
      buildRestrictExample(rows, REPO, REF),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/setup@${REF}`,
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
      buildRestrictExample(rows, REPO, REF),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/setup@${REF}`,
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
      buildRestrictExample(rows, REPO, REF),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/setup@${REF}`,
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
      buildRestrictExample(rows, "myorg/myrepo", REF),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: myorg/myrepo/setup@${REF}`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      example.com:443",
        ].join("\n") + "\n",
      )
    );
  });

  it("renders a tag actionRef as-is", () => {
    const rows = [
      { host: "example.com", port: "443", ruleType: "HTTPS", count: 1 },
    ];
    assert.equal(
      buildRestrictExample(rows, REPO, "v2.1.0"),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/setup@v2.1.0`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      example.com:443",
        ].join("\n") + "\n",
      )
    );
  });

  it("renders a commit SHA actionRef as a <sha> placeholder", () => {
    const rows = [
      { host: "example.com", port: "443", ruleType: "HTTPS", count: 1 },
    ];
    const sha = "abc1234567890def1234567890abcdef12345678";
    assert.equal(
      buildRestrictExample(rows, REPO, sha),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/setup@<sha>`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      example.com:443",
        ].join("\n") + "\n",
      )
    );
  });

  it("uses the run action and includes the run command when actionName is 'run'", () => {
    const rows = [
      { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 5 },
    ];
    assert.equal(
      buildRestrictExample(rows, REPO, REF, { actionName: "run", runCommand: "npm install" }),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/run@${REF}`,
          "  with:",
          "    run: |",
          "      npm install",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      registry.npmjs.org:443",
        ].join("\n") + "\n",
      )
    );
  });

  it("preserves multi-line run commands, indented under run: |", () => {
    const rows = [
      { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 1 },
    ];
    assert.equal(
      buildRestrictExample(rows, REPO, REF, { actionName: "run", runCommand: "npm ci\nnpm test" }),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/run@${REF}`,
          "  with:",
          "    run: |",
          "      npm ci",
          "      npm test",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      registry.npmjs.org:443",
        ].join("\n") + "\n",
      )
    );
  });

  it("strips the trailing newline GitHub Actions adds to `run: |` block scalars", () => {
    const rows = [
      { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 1 },
    ];
    assert.equal(
      buildRestrictExample(rows, REPO, REF, { actionName: "run", runCommand: "npm ci\nnpm test\n" }),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/run@${REF}`,
          "  with:",
          "    run: |",
          "      npm ci",
          "      npm test",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      registry.npmjs.org:443",
        ].join("\n") + "\n",
      )
    );
  });

  it("actionName 'run' without a runCommand omits the run: block", () => {
    const rows = [
      { host: "registry.npmjs.org", port: "443", ruleType: "HTTPS", count: 1 },
    ];
    assert.equal(
      buildRestrictExample(rows, REPO, REF, { actionName: "run" }),
      wrap(
        [
          "- name: Start Buildcage in restrict mode",
          `  uses: ${REPO}/run@${REF}`,
          "  with:",
          "    proxy_mode: restrict",
          "    allowed_https_rules: >-",
          "      registry.npmjs.org:443",
        ].join("\n") + "\n",
      )
    );
  });
});
