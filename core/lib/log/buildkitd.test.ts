import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { scanBuildkitdLog } from "./buildkitd.ts";

// Real line captured from a live moby/buildkit v0.31.1 explicit-mode container.
const REAL_DENY_LINE =
  'time="2026-07-05T02:26:34Z" level=debug msg="Evaluated source policy" error="source \\"https://blocked.example.com/\\" denied by policy: source denied by policy" mutated=false orig="identifier:\\"https://blocked.example.com/\\"" ref="https://blocked.example.com/" updated="https://blocked.example.com/"';

const REAL_DENY_LINE_WITH_PATH =
  'time="2026-07-05T02:26:21Z" level=debug msg="Evaluated source policy" error="source \\"https://dl-cdn.alpinelinux.org:443/alpine/v3.20/main/aarch64/APKINDEX.tar.gz\\" denied by policy: source denied by policy" mutated=false orig="identifier:\\"https://dl-cdn.alpinelinux.org:443/alpine/v3.20/main/aarch64/APKINDEX.tar.gz\\"" ref="https://dl-cdn.alpinelinux.org:443/alpine/v3.20/main/aarch64/APKINDEX.tar.gz" updated="https://dl-cdn.alpinelinux.org:443/alpine/v3.20/main/aarch64/APKINDEX.tar.gz"';

describe("scanBuildkitdLog — blocked", () => {
  it("aggregates a real denial line (no explicit port in URL)", async () => {
    const result = await scanBuildkitdLog(REAL_DENY_LINE.split("\n"));
    assert.deepEqual(result.blocked, [
      {
        ruleType: "HTTPS",
        host: "blocked.example.com",
        port: "443",
        reason: "not-allowed",
        count: 1,
      },
    ]);
  });

  it("aggregates a real denial line with an explicit port and path", async () => {
    const result = await scanBuildkitdLog(REAL_DENY_LINE_WITH_PATH.split("\n"));
    assert.deepEqual(result.blocked, [
      {
        ruleType: "HTTPS",
        host: "dl-cdn.alpinelinux.org",
        port: "443",
        reason: "not-allowed",
        count: 1,
      },
    ]);
  });

  it("aggregates an http:// denial as ruleType HTTP", async () => {
    const line =
      'time="2026-07-05T00:00:00Z" level=debug msg="Evaluated source policy" error="source \\"http://blocked.example.com:80/\\" denied by policy: source denied by policy" mutated=false ref="http://blocked.example.com:80/" updated="http://blocked.example.com:80/"';
    const result = await scanBuildkitdLog(line.split("\n"));
    assert.deepEqual(result.blocked, [
      {
        ruleType: "HTTP",
        host: "blocked.example.com",
        port: "80",
        reason: "not-allowed",
        count: 1,
      },
    ]);
  });

  it("ignores unrelated debug lines", async () => {
    const line =
      'time="2026-07-05T00:00:00Z" level=debug msg="finished setting up network namespace abc"';
    const result = await scanBuildkitdLog(line.split("\n"));
    assert.deepEqual(result.blocked, []);
  });

  it("ignores 'Evaluated source policy' lines that are not denials (e.g. a CONVERT)", async () => {
    const line =
      'time="2026-07-05T00:00:00Z" level=debug msg="Evaluated source policy" mutated=true updated="https://mirror.example.com/" ref="https://example.com/"';
    const result = await scanBuildkitdLog(line.split("\n"));
    assert.deepEqual(result.blocked, []);
  });

  it("ignores non-http(s) identifiers (defensive — buildcage never denies these)", async () => {
    const line =
      'time="2026-07-05T00:00:00Z" level=debug msg="Evaluated source policy" error="source \\"docker-image://docker.io/library/alpine:latest\\" denied by policy: source denied by policy" ref="docker-image://docker.io/library/alpine:latest"';
    const result = await scanBuildkitdLog(line.split("\n"));
    assert.deepEqual(result.blocked, []);
  });

  it("aggregates repeated identical denials into one row with a count", async () => {
    const logText = [REAL_DENY_LINE, REAL_DENY_LINE].join("\n");
    const result = await scanBuildkitdLog(logText.split("\n"));
    assert.equal(result.blocked.length, 1);
    assert.equal(result.blocked[0].count, 2);
  });

  it("parses multiple lines and skips non-matching ones", async () => {
    const logText = [
      REAL_DENY_LINE,
      'time="x" level=info msg="found worker"',
      REAL_DENY_LINE_WITH_PATH,
    ].join("\n");
    const result = await scanBuildkitdLog(logText.split("\n"));
    assert.equal(result.blocked.length, 2);
  });
});

describe("scanBuildkitdLog — denied (chronological, unaggregated)", () => {
  it("parses a real denial line's url and timestamp, in chronological order", async () => {
    const logText = [REAL_DENY_LINE, REAL_DENY_LINE_WITH_PATH].join("\n");
    const result = await scanBuildkitdLog(logText.split("\n"));
    assert.deepEqual(result.denied, [
      { url: "https://blocked.example.com/", timestamp: "2026-07-05T02:26:34Z" },
      {
        url: "https://dl-cdn.alpinelinux.org:443/alpine/v3.20/main/aarch64/APKINDEX.tar.gz",
        timestamp: "2026-07-05T02:26:21Z",
      },
    ]);
  });

  it("does not aggregate — repeated denials for the same URL each get their own entry", async () => {
    const logText = [REAL_DENY_LINE, REAL_DENY_LINE].join("\n");
    const result = await scanBuildkitdLog(logText.split("\n"));
    assert.equal(result.denied.length, 2);
  });

  it("ignores non-denial lines", async () => {
    const result = await scanBuildkitdLog(
      'time="2026-07-05T00:00:00Z" level=info msg="found worker"'.split("\n"),
    );
    assert.deepEqual(result.denied, []);
  });
});

describe("scanBuildkitdLog — hasNonDenialContent", () => {
  it("returns false for empty log text", async () => {
    const result = await scanBuildkitdLog("".split("\n"));
    assert.equal(result.hasNonDenialContent, false);
  });

  it("returns false when the log has only denial lines", async () => {
    const result = await scanBuildkitdLog(REAL_DENY_LINE.split("\n"));
    assert.equal(result.hasNonDenialContent, false);
  });

  it("returns true when the log contains buildkitd's own non-denial debug output", async () => {
    const logText = [REAL_DENY_LINE, 'time="x" level=info msg="found worker"'].join("\n");
    const result = await scanBuildkitdLog(logText.split("\n"));
    assert.equal(result.hasNonDenialContent, true);
  });

  it("ignores blank lines when deciding", async () => {
    const result = await scanBuildkitdLog("\n\n  \n".split("\n"));
    assert.equal(result.hasNonDenialContent, false);
  });
});

// aggregate()/createIncrementalAggregator() itself is tested in core/lib/log/aggregate.test.ts.
// parseIdentifier() itself is tested in core/lib/log/parse-identifier.test.ts.

reportResults();
