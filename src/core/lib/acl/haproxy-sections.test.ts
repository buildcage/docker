import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { preamble, resolversSection, originBackends } from "./haproxy-sections.ts";

function last(section: readonly string[]): string {
  return section[section.length - 1];
}

describe("section boundaries", () => {
  it("ends each section with the blank line that separates it from the next", () => {
    // generateHaproxyConfig joins the sections with nothing between them, so a
    // section stopping at its last directive would run that directive into the
    // next section's heading.
    expect(last(preamble({ global: [], defaults: [] }))).toBe("");
    expect(last(resolversSection())).toBe("");
    expect(last(originBackends("/etc/ssl/certs/ca-certificates.crt"))).toBe("");
  });
});

describe("the origin backends", () => {
  it("verifies against the CA file it is given, not one of its own", () => {
    // Every test that goes through generateHaproxyConfig runs with the default
    // path, which a hardcoded one would satisfy just as well.
    expect(originBackends("/tmp/other-ca.pem").filter((l) => l.includes("ca-file"))).toStrictEqual([
      "    server origin 0.0.0.0 ssl verify required ca-file /tmp/other-ca.pem " +
        "sni var(txn.host)",
    ]);
  });
});

reportResults();
