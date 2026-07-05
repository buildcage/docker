import { describe, it, assert, reportResults } from "./test-shim.js";
import { parseEntries } from "./buildkitd-log-parser.js";

// Real line captured from a live moby/buildkit v0.31.1 explicit-mode container
// (see docs/security.md for how this was verified).
const REAL_DENY_LINE =
  'time="2026-07-05T02:26:34Z" level=debug msg="Evaluated source policy" error="source \\"https://blocked.example.com/\\" denied by policy: source denied by policy" mutated=false orig="identifier:\\"https://blocked.example.com/\\"" ref="https://blocked.example.com/" updated="https://blocked.example.com/"';

const REAL_DENY_LINE_WITH_PATH =
  'time="2026-07-05T02:26:21Z" level=debug msg="Evaluated source policy" error="source \\"https://dl-cdn.alpinelinux.org:443/alpine/v3.20/main/aarch64/APKINDEX.tar.gz\\" denied by policy: source denied by policy" mutated=false orig="identifier:\\"https://dl-cdn.alpinelinux.org:443/alpine/v3.20/main/aarch64/APKINDEX.tar.gz\\"" ref="https://dl-cdn.alpinelinux.org:443/alpine/v3.20/main/aarch64/APKINDEX.tar.gz" updated="https://dl-cdn.alpinelinux.org:443/alpine/v3.20/main/aarch64/APKINDEX.tar.gz"';

describe("parseEntries", () => {
  it("parses a real denial line (no explicit port in URL)", () => {
    const entries = parseEntries(REAL_DENY_LINE);
    assert.deepEqual(entries, [
      { decision: "BLOCKED", ruleType: "HTTPS", host: "blocked.example.com", port: "443", reason: "not-allowed" },
    ]);
  });

  it("parses a real denial line with an explicit port and path", () => {
    const entries = parseEntries(REAL_DENY_LINE_WITH_PATH);
    assert.deepEqual(entries, [
      { decision: "BLOCKED", ruleType: "HTTPS", host: "dl-cdn.alpinelinux.org", port: "443", reason: "not-allowed" },
    ]);
  });

  it("parses an http:// denial as ruleType HTTP", () => {
    const line =
      'time="2026-07-05T00:00:00Z" level=debug msg="Evaluated source policy" error="source \\"http://blocked.example.com:80/\\" denied by policy: source denied by policy" mutated=false ref="http://blocked.example.com:80/" updated="http://blocked.example.com:80/"';
    const entries = parseEntries(line);
    assert.deepEqual(entries, [
      { decision: "BLOCKED", ruleType: "HTTP", host: "blocked.example.com", port: "80", reason: "not-allowed" },
    ]);
  });

  it("ignores unrelated debug lines", () => {
    const line = 'time="2026-07-05T00:00:00Z" level=debug msg="finished setting up network namespace abc"';
    assert.deepEqual(parseEntries(line), []);
  });

  it("ignores 'Evaluated source policy' lines that are not denials (e.g. a CONVERT)", () => {
    const line =
      'time="2026-07-05T00:00:00Z" level=debug msg="Evaluated source policy" mutated=true updated="https://mirror.example.com/" ref="https://example.com/"';
    assert.deepEqual(parseEntries(line), []);
  });

  it("ignores non-http(s) identifiers (defensive — buildcage never denies these)", () => {
    const line =
      'time="2026-07-05T00:00:00Z" level=debug msg="Evaluated source policy" error="source \\"docker-image://docker.io/library/alpine:latest\\" denied by policy: source denied by policy" ref="docker-image://docker.io/library/alpine:latest"';
    assert.deepEqual(parseEntries(line), []);
  });

  it("parses multiple lines and skips non-matching ones", () => {
    const logText = [REAL_DENY_LINE, 'time="x" level=info msg="found worker"', REAL_DENY_LINE_WITH_PATH].join("\n");
    assert.equal(parseEntries(logText).length, 2);
  });
});

// aggregate() itself is tested in docker/shared/tools/lib/aggregate.test.js.

reportResults();
