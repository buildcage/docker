// Checks the traffic artifact of test-e2e.yml's inspect run.
// Usage: node assert-inspect-traffic-artifact.mjs <traffic.json>
import { readFileSync } from "node:fs";

const rows = JSON.parse(readFileSync(process.argv[2], "utf8"));
let failures = 0;

function check(ok, message) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${message}`);
  if (!ok) failures++;
}

console.log("\n=== Traffic Artifact Assertions (inspect) ===\n");

check(
  rows.some(
    (r) =>
      r.action === "block" && r.host === "example.com" && r.url === "https://example.com/some/path",
  ),
  "example.com/some/path is recorded as blocked, with its full URL",
);
check(
  rows.some((r) => r.protocol === "tls" && r.host === "github.com" && r.bytes > 0),
  "github.com is recorded as an undecrypted TLS passthrough",
);
check(
  rows.some((r) => r.action === "block" && r.host === "registry.npmjs.org" && r.method === "POST"),
  "the POST to registry.npmjs.org is recorded as blocked by allowed_url_rules",
);

if (failures > 0) {
  console.log(`::error::${failures} traffic artifact assertion(s) failed`);
  process.exit(1);
}
