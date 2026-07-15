import { describe, it, assert, reportResults } from "../../shared/lib/test-shim.js";
import {
  parseEntries,
  parseAllowedRequestsFromText,
  parseDenialTimeline,
  parseIdentifier,
  parseBuildcageEvents,
} from "./buildkitd-log-parser.js";

// Real line captured from a live moby/buildkit v0.31.1 explicit-mode container.
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

describe("parseAllowedRequestsFromText", () => {
  it("parses a real 'proxy network requests:' block with a status code", () => {
    const text = ["proxy network requests:", "- GET https://allowed.example.com/ -> 200"].join("\n");
    assert.deepEqual(parseAllowedRequestsFromText(text), [{ method: "GET", url: "https://allowed.example.com/", status: 200 }]);
  });

  it("parses a request line with no status code at all", () => {
    const text = ["proxy network requests:", "- GET https://allowed.example.com/"].join("\n");
    assert.deepEqual(parseAllowedRequestsFromText(text), [{ method: "GET", url: "https://allowed.example.com/" }]);
  });

  it("parses multiple entries under one block, stopping at the next unrelated line", () => {
    const text = [
      "proxy network requests:",
      "- GET https://allowed.example.com/ -> 200",
      "- GET https://sub.wildcard.example.com/ -> 200",
      'time="x" level=debug msg="Evaluated source policy" error="denied"',
    ].join("\n");
    assert.deepEqual(parseAllowedRequestsFromText(text), [
      { method: "GET", url: "https://allowed.example.com/", status: 200 },
      { method: "GET", url: "https://sub.wildcard.example.com/", status: 200 },
    ]);
  });

  it("parses multiple separate blocks", () => {
    const text = [
      "proxy network requests:",
      "- GET https://allowed.example.com/ -> 200",
      'time="x" level=debug msg="> creating abc"',
      "proxy network requests:",
      "- GET http://allowed.example.com:8080/ -> 200",
    ].join("\n");
    assert.equal(parseAllowedRequestsFromText(text).length, 2);
  });

  it("does not misinterpret unrelated '- ' output as a request line outside a block", () => {
    const text = "- rw-r--r-- 1 root root 0 file.txt";
    assert.deepEqual(parseAllowedRequestsFromText(text), []);
  });

  it("returns an empty array when no block is present", () => {
    assert.deepEqual(parseAllowedRequestsFromText('time="x" level=info msg="found worker"'), []);
  });
});

describe("parseIdentifier", () => {
  it("fills in the default port when none is present", () => {
    assert.deepEqual(parseIdentifier("https://allowed.example.com/"), {
      scheme: "https",
      host: "allowed.example.com",
      port: "443",
    });
    assert.deepEqual(parseIdentifier("http://allowed.example.com/"), {
      scheme: "http",
      host: "allowed.example.com",
      port: "80",
    });
  });

  it("keeps an explicit non-default port", () => {
    assert.deepEqual(parseIdentifier("https://allowed.example.com:8443/"), {
      scheme: "https",
      host: "allowed.example.com",
      port: "8443",
    });
  });

  it("returns null for non-http(s) identifiers", () => {
    assert.equal(parseIdentifier("docker-image://docker.io/library/alpine:latest"), null);
  });
});

describe("parseDenialTimeline", () => {
  it("parses a real denial line's url and timestamp, in chronological order", () => {
    const logText = [REAL_DENY_LINE, REAL_DENY_LINE_WITH_PATH].join("\n");
    assert.deepEqual(parseDenialTimeline(logText), [
      { url: "https://blocked.example.com/", timestamp: "2026-07-05T02:26:34Z" },
      { url: "https://dl-cdn.alpinelinux.org:443/alpine/v3.20/main/aarch64/APKINDEX.tar.gz", timestamp: "2026-07-05T02:26:21Z" },
    ]);
  });

  it("does not aggregate — repeated denials for the same URL each get their own entry", () => {
    const logText = [REAL_DENY_LINE, REAL_DENY_LINE].join("\n");
    assert.equal(parseDenialTimeline(logText).length, 2);
  });

  it("ignores non-denial lines", () => {
    assert.deepEqual(parseDenialTimeline('time="2026-07-05T00:00:00Z" level=info msg="found worker"'), []);
  });
});

describe("parseBuildcageEvents", () => {
  it("parses a real event line, ignoring the Go log package's own date/time prefix", () => {
    const line =
      '2026/07/14 22:11:52 buildcage: event={"type":"source_policy_merged","level":"notice","message":"merged 1 client-supplied source policy rule(s) with buildcage\'s own policy","ref":"build-ref-1"}';
    assert.deepEqual(parseBuildcageEvents(line), [
      {
        type: "source_policy_merged",
        level: "notice",
        message: "merged 1 client-supplied source policy rule(s) with buildcage's own policy",
        ref: "build-ref-1",
      },
    ]);
  });

  it("parses an event keyed by sessionID instead of ref", () => {
    const line = '2026/07/14 22:11:52 buildcage: event={"type":"arg_injection_applied","level":"notice","message":"injected ARG(s): NODE_USE_SYSTEM_CA","sessionID":"abc123"}';
    assert.deepEqual(parseBuildcageEvents(line), [
      {
        type: "arg_injection_applied",
        level: "notice",
        message: "injected ARG(s): NODE_USE_SYSTEM_CA",
        sessionID: "abc123",
      },
    ]);
  });

  it("parses multiple event lines interleaved with unrelated log lines", () => {
    const logText = [
      'time="2026-07-05T00:00:00Z" level=info msg="found worker"',
      '2026/07/14 22:11:52 buildcage: event={"type":"arg_injection_skipped","level":"error","message":"remote context","ref":"build-ref-1"}',
      'time="2026-07-05T00:00:01Z" level=debug msg="Evaluated source policy" error="denied"',
      '2026/07/14 22:11:53 buildcage: event={"type":"session_ended_with_error","level":"warning","message":"boom","sessionID":"xyz"}',
    ].join("\n");
    const events = parseBuildcageEvents(logText);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "arg_injection_skipped");
    assert.equal(events[0].level, "error");
    assert.equal(events[1].type, "session_ended_with_error");
    assert.equal(events[1].level, "warning");
  });

  it("skips a malformed event payload instead of throwing", () => {
    const logText = [
      "2026/07/14 22:11:52 buildcage: event={not valid json}",
      '2026/07/14 22:11:53 buildcage: event={"type":"arg_injection_applied","level":"notice","message":"ok"}',
    ].join("\n");
    const events = parseBuildcageEvents(logText);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "arg_injection_applied");
  });

  it("returns an empty array when no event lines are present", () => {
    assert.deepEqual(parseBuildcageEvents('time="x" level=info msg="found worker"'), []);
  });
});

// aggregate() itself is tested in docker/tools/shared/lib/aggregate.test.js.

reportResults();
