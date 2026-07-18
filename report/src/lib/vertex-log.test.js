import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectAllRefs, parseAllowedRequestsFromText, parseVertexAllowedLog, aggregateAllowedHosts } from "./vertex-log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");

// Captured from a live moby/buildkit v0.31.1 explicit-mode container building
// a 3-stage Dockerfile (stage1: a no-op RUN then an allowed RUN; stage2: one
// allowed RUN; a final stage COPYing from stage2). stage1/stage2's RUN
// vertices have overlapping `started` timestamps, since independent stages
// can run concurrently.
const MULTISTAGE_HISTORIES = readFileSync(join(fixturesDir, "histories.json"), "utf8");
const MULTISTAGE_RAWJSON = readFileSync(join(fixturesDir, "multistage-rawjson.json"), "utf8");

// Captured from a live moby/buildkit v0.31.1 explicit-mode container building
// test/Dockerfile.explicit-restrict (15 steps, single stage). BuildKit right-
// pads single-digit step counters with a leading space to align with the
// build's total ("[ 2/15]" vs "[10/15]") — regression coverage for
// runVertexPattern correctly matching a padded counter like that.
const PADDED_STEPS_RAWJSON = readFileSync(join(fixturesDir, "padded-steps-rawjson.json"), "utf8");

function encode(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

describe("selectAllRefs", () => {
  it("returns the ref from a real single-record histories.json capture", () => {
    assert.deepEqual(selectAllRefs(MULTISTAGE_HISTORIES), ["jsvnbiyvnlslxxui8ap3i2na2"]);
  });

  it("returns every ref ordered oldest-first by CreatedAt", () => {
    const historiesText = [
      JSON.stringify({ type: 1, record: { Ref: "newer", CreatedAt: { seconds: 200, nanos: 0 } } }),
      JSON.stringify({ type: 1, record: { Ref: "older", CreatedAt: { seconds: 100, nanos: 0 } } }),
    ].join("\n");
    assert.deepEqual(selectAllRefs(historiesText), ["older", "newer"]);
  });

  it("breaks ties within the same second using nanos", () => {
    const historiesText = [
      JSON.stringify({ type: 1, record: { Ref: "later-nanos", CreatedAt: { seconds: 100, nanos: 999 } } }),
      JSON.stringify({ type: 1, record: { Ref: "earlier-nanos", CreatedAt: { seconds: 100, nanos: 500 } } }),
    ].join("\n");
    assert.deepEqual(selectAllRefs(historiesText), ["earlier-nanos", "later-nanos"]);
  });

  it("deduplicates a ref reported on multiple lines as its build progresses", () => {
    const historiesText = [
      JSON.stringify({ type: 1, record: { Ref: "build-1", CreatedAt: { seconds: 100, nanos: 0 } } }),
      JSON.stringify({ type: 1, record: { Ref: "build-1", CreatedAt: { seconds: 100, nanos: 0 }, CompletedAt: { seconds: 101, nanos: 0 } } }),
    ].join("\n");
    assert.deepEqual(selectAllRefs(historiesText), ["build-1"]);
  });

  it("ignores blank lines and records with no Ref/CreatedAt", () => {
    const historiesText = ["", JSON.stringify({ type: 1, record: {} }), "", MULTISTAGE_HISTORIES.trim()].join("\n");
    assert.deepEqual(selectAllRefs(historiesText), ["jsvnbiyvnlslxxui8ap3i2na2"]);
  });

  it("returns an empty array when there are no records at all", () => {
    assert.deepEqual(selectAllRefs(""), []);
  });
});

describe("parseAllowedRequestsFromText", () => {
  it("parses a real 'proxy network requests:' block with a status code", () => {
    const text = ["proxy network requests:", "- GET https://allowed.example.com/ -> 200"].join("\n");
    assert.deepEqual(parseAllowedRequestsFromText(text), [
      { method: "GET", url: "https://allowed.example.com/", status: 200 },
    ]);
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

describe("parseVertexAllowedLog", () => {
  it("captures every single-digit step despite BuildKit's leading-space padding (regression: a real 15-step build)", () => {
    const result = parseVertexAllowedLog(PADDED_STEPS_RAWJSON);
    assert.equal(result.length, 14); // steps 2/15 through 15/15
    assert.equal(result[0].command, '[ 2/15] RUN echo "=== DNS Configuration ===" &&     cat /etc/resolv.conf');
    assert.deepEqual(result[0].entries, []);
    assert.equal(result[1].command.startsWith('[ 3/15] RUN echo "=== [HTTPS - allowed - exact match]'), true);
    assert.deepEqual(result[1].entries, [{ method: "GET", url: "https://allowed.example.com/", status: 200 }]);
    // step numbers stay in ascending order despite the "[ 2/15]" vs "[10/15]" width difference
    assert.deepEqual(
      result.map((v) => v.command.match(/^\[\s*(\d+)\/15\]/)[1]),
      ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"]
    );
  });

  it("groups a real multi-stage build's RUN vertices by stage, stages ordered by earliest start, marking the no-op step's entries empty", () => {
    const result = parseVertexAllowedLog(MULTISTAGE_RAWJSON);
    assert.deepEqual(
      result.map((v) => v.command),
      [
        '[stage2 2/2] RUN echo "step B" && wget -q -O /dev/null --timeout=5 https://allowed.example.com/two && echo "B done"',
        '[stage1 2/3] RUN echo "no network here" && mkdir -p /tmp/work',
        '[stage1 3/3] RUN echo "step A" && wget -q -O /dev/null --timeout=5 https://allowed.example.com/one && echo "A done"',
      ]
    );
    // stage1's two vertices stay adjacent and in step order, even though
    // stage2's single vertex (started ~109us earlier) sorts before the group.
    assert.deepEqual(result[1].entries, []);
    assert.deepEqual(result[2].entries, [{ method: "GET", url: "https://allowed.example.com/one", status: 200 }]);
    assert.deepEqual(result[0].entries, [{ method: "GET", url: "https://allowed.example.com/two", status: 200 }]);
    for (const v of result) {
      assert.equal(typeof v.started, "string");
      assert.equal(typeof v.completed, "string");
    }
  });

  it("excludes non-RUN vertices (FROM, internal loads, COPY, exporting)", () => {
    const result = parseVertexAllowedLog(MULTISTAGE_RAWJSON);
    for (const v of result) {
      assert.match(v.command, /\bRUN\b/);
    }
  });

  it("orders single-stage vertices by started time with no stage prefix", () => {
    const rawJson = JSON.stringify({
      vertexes: [
        { digest: "d1", name: "[3/3] RUN second", started: "2026-01-01T00:00:01.000Z", completed: "2026-01-01T00:00:01.100Z" },
        { digest: "d2", name: "[2/3] RUN first", started: "2026-01-01T00:00:00.000Z", completed: "2026-01-01T00:00:00.500Z" },
      ],
      logs: [],
    });
    const result = parseVertexAllowedLog(rawJson);
    assert.deepEqual(result.map((v) => v.command), ["[2/3] RUN first", "[3/3] RUN second"]);
    assert.deepEqual(result[0].entries, []);
  });

  it("does not let an anonymous stage's auto-numbered prefix ('stage-0') collide across groups", () => {
    const rawJson = JSON.stringify({
      vertexes: [
        { digest: "d1", name: '[stage-0 2/2] RUN echo "zero"', started: "2026-01-01T00:00:00.100Z", completed: "2026-01-01T00:00:00.200Z" },
        { digest: "d2", name: '[stage-1 2/2] RUN echo "one"', started: "2026-01-01T00:00:00.050Z", completed: "2026-01-01T00:00:00.150Z" },
      ],
      logs: [],
    });
    const result = parseVertexAllowedLog(rawJson);
    // stage-1 started earlier, so its (single-vertex) group sorts first.
    assert.deepEqual(result.map((v) => v.command), ['[stage-1 2/2] RUN echo "one"', '[stage-0 2/2] RUN echo "zero"']);
  });

  it("decodes base64 stderr logs and concatenates multiple fragments for the same vertex in timestamp order", () => {
    const rawJson = JSON.stringify({
      vertexes: [{ digest: "d1", name: "[2/2] RUN wget", started: "2026-01-01T00:00:00.000Z", completed: "2026-01-01T00:00:00.100Z" }],
      logs: [
        { vertex: "d1", stream: 2, timestamp: "2026-01-01T00:00:00.050Z", data: encode("- GET https://allowed.example.com/ -> 200\n") },
        { vertex: "d1", stream: 2, timestamp: "2026-01-01T00:00:00.010Z", data: encode("proxy network requests:\n") },
        { vertex: "d1", stream: 1, timestamp: "2026-01-01T00:00:00.005Z", data: encode("stdout noise\n") },
      ],
    });
    const result = parseVertexAllowedLog(rawJson);
    assert.deepEqual(result[0].entries, [{ method: "GET", url: "https://allowed.example.com/", status: 200 }]);
  });

  it("skips vertex records missing started/completed (e.g. an in-progress partial update)", () => {
    const rawJson = JSON.stringify({
      vertexes: [
        { digest: "d1", name: "[2/2] RUN wget" }, // no started/completed yet
        { digest: "d1", name: "[2/2] RUN wget", started: "2026-01-01T00:00:00.060Z", completed: "2026-01-01T00:00:00.100Z" },
      ],
      logs: [],
    });
    const result = parseVertexAllowedLog(rawJson);
    assert.equal(result.length, 1);
    assert.equal(result[0].started, "2026-01-01T00:00:00.060Z");
  });

  it("returns an empty array when there are no RUN vertices", () => {
    const rawJson = JSON.stringify({
      vertexes: [{ digest: "d1", name: "[1/2] FROM alpine", started: "2026-01-01T00:00:00.000Z", completed: "2026-01-01T00:00:00.050Z" }],
      logs: [],
    });
    assert.deepEqual(parseVertexAllowedLog(rawJson), []);
  });
});

describe("aggregateAllowedHosts", () => {
  it("aggregates entries across multiple vertices within one build", () => {
    const builds = [
      [
        { entries: [{ method: "GET", url: "https://allowed.example.com/", status: 200 }] },
        { entries: [{ method: "GET", url: "https://allowed.example.com/", status: 200 }] },
      ],
    ];
    assert.deepEqual(aggregateAllowedHosts(builds, "ALLOWED"), [
      { host: "allowed.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 2 },
    ]);
  });

  it("aggregates entries across multiple builds", () => {
    const builds = [
      [{ entries: [{ method: "GET", url: "https://allowed.example.com/one" }] }],
      [{ entries: [{ method: "GET", url: "https://allowed.example.com/two" }] }],
    ];
    const result = aggregateAllowedHosts(builds, "ALLOWED");
    assert.equal(result.length, 1);
    assert.equal(result[0].count, 2);
  });

  it("uses the given decision label", () => {
    const builds = [[{ entries: [{ method: "GET", url: "https://allowed.example.com/" }] }]];
    assert.equal(aggregateAllowedHosts(builds, "ALLOWED")[0]?.count, 1);
    // decision itself isn't part of the aggregated shape (aggregate() drops it),
    // but distinct decisions must not collide during aggregation
    const mixed = [
      [
        { entries: [{ method: "GET", url: "https://allowed.example.com/" }] },
      ],
    ];
    assert.deepEqual(aggregateAllowedHosts(mixed, "AUDIT"), [
      { host: "allowed.example.com", port: "443", ruleType: "HTTPS", reason: "-", count: 1 },
    ]);
  });

  it("skips vertices with no entries", () => {
    const builds = [[{ entries: [] }]];
    assert.deepEqual(aggregateAllowedHosts(builds, "ALLOWED"), []);
  });

  it("returns an empty array for no builds at all", () => {
    assert.deepEqual(aggregateAllowedHosts([], "ALLOWED"), []);
  });

  it("resolves host/port the same way as core/shared/lib/parse-identifier.js's parseIdentifier", () => {
    const builds = [[{ entries: [{ method: "GET", url: "http://allowed.example.com:8080/path" }] }]];
    assert.deepEqual(aggregateAllowedHosts(builds, "ALLOWED"), [
      { host: "allowed.example.com", port: "8080", ruleType: "HTTP", reason: "-", count: 1 },
    ]);
  });
});
