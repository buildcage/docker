import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseVertexAllowedLog } from "./vertex.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");

// Captured from a live moby/buildkit v0.31.1 explicit-mode container building
// a 3-stage Dockerfile (stage1: a no-op RUN then an allowed RUN; stage2: one
// allowed RUN; a final stage COPYing from stage2). stage1/stage2's RUN
// vertices have overlapping `started` timestamps, since independent stages
// can run concurrently.
const MULTISTAGE_RAWJSON = readFileSync(join(fixturesDir, "multistage-rawjson.json"), "utf8");

// Captured from a live moby/buildkit v0.31.1 explicit-mode container building
// test/Dockerfile.explicit-restrict (15 steps, single stage). BuildKit right-
// pads single-digit step counters with a leading space to align with the
// build's total ("[ 2/15]" vs "[10/15]") — regression coverage for
// runVertexPattern correctly matching a padded counter like that.
const PADDED_STEPS_RAWJSON = readFileSync(join(fixturesDir, "padded-steps-rawjson.json"), "utf8");

function encode(text: string) {
  return Buffer.from(text, "utf8").toString("base64");
}

describe("parseVertexAllowedLog", () => {
  it("captures every single-digit step despite BuildKit's leading-space padding (regression: a real 15-step build)", () => {
    const result = parseVertexAllowedLog(PADDED_STEPS_RAWJSON);
    assert.equal(result.length, 14); // steps 2/15 through 15/15
    assert.equal(
      result[0].command,
      '[ 2/15] RUN echo "=== DNS Configuration ===" &&     cat /etc/resolv.conf',
    );
    assert.deepEqual(result[0].entries, []);
    assert.equal(
      result[1].command.startsWith('[ 3/15] RUN echo "=== [HTTPS - allowed - exact match]'),
      true,
    );
    assert.deepEqual(result[1].entries, [
      { method: "GET", url: "https://allowed.example.com/", status: 200 },
    ]);
    // step numbers stay in ascending order despite the "[ 2/15]" vs "[10/15]" width difference
    assert.deepEqual(
      result.map((v) => v.command.match(/^\[\s*(\d+)\/15\]/)![1]),
      ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"],
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
      ],
    );
    // stage1's two vertices stay adjacent and in step order, even though
    // stage2's single vertex (started ~109us earlier) sorts before the group.
    assert.deepEqual(result[1].entries, []);
    assert.deepEqual(result[2].entries, [
      { method: "GET", url: "https://allowed.example.com/one", status: 200 },
    ]);
    assert.deepEqual(result[0].entries, [
      { method: "GET", url: "https://allowed.example.com/two", status: 200 },
    ]);
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
        {
          digest: "d1",
          name: "[3/3] RUN second",
          started: "2026-01-01T00:00:01.000Z",
          completed: "2026-01-01T00:00:01.100Z",
        },
        {
          digest: "d2",
          name: "[2/3] RUN first",
          started: "2026-01-01T00:00:00.000Z",
          completed: "2026-01-01T00:00:00.500Z",
        },
      ],
      logs: [],
    });
    const result = parseVertexAllowedLog(rawJson);
    assert.deepEqual(
      result.map((v) => v.command),
      ["[2/3] RUN first", "[3/3] RUN second"],
    );
    assert.deepEqual(result[0].entries, []);
  });

  it("does not let an anonymous stage's auto-numbered prefix ('stage-0') collide across groups", () => {
    const rawJson = JSON.stringify({
      vertexes: [
        {
          digest: "d1",
          name: '[stage-0 2/2] RUN echo "zero"',
          started: "2026-01-01T00:00:00.100Z",
          completed: "2026-01-01T00:00:00.200Z",
        },
        {
          digest: "d2",
          name: '[stage-1 2/2] RUN echo "one"',
          started: "2026-01-01T00:00:00.050Z",
          completed: "2026-01-01T00:00:00.150Z",
        },
      ],
      logs: [],
    });
    const result = parseVertexAllowedLog(rawJson);
    // stage-1 started earlier, so its (single-vertex) group sorts first.
    assert.deepEqual(
      result.map((v) => v.command),
      ['[stage-1 2/2] RUN echo "one"', '[stage-0 2/2] RUN echo "zero"'],
    );
  });

  it("decodes base64 stderr logs and concatenates multiple fragments for the same vertex in timestamp order", () => {
    const rawJson = JSON.stringify({
      vertexes: [
        {
          digest: "d1",
          name: "[2/2] RUN wget",
          started: "2026-01-01T00:00:00.000Z",
          completed: "2026-01-01T00:00:00.100Z",
        },
      ],
      logs: [
        {
          vertex: "d1",
          stream: 2,
          timestamp: "2026-01-01T00:00:00.050Z",
          data: encode("- GET https://allowed.example.com/ -> 200\n"),
        },
        {
          vertex: "d1",
          stream: 2,
          timestamp: "2026-01-01T00:00:00.010Z",
          data: encode("proxy network requests:\n"),
        },
        {
          vertex: "d1",
          stream: 1,
          timestamp: "2026-01-01T00:00:00.005Z",
          data: encode("stdout noise\n"),
        },
      ],
    });
    const result = parseVertexAllowedLog(rawJson);
    assert.deepEqual(result[0].entries, [
      { method: "GET", url: "https://allowed.example.com/", status: 200 },
    ]);
  });

  it("skips vertex records missing started/completed (e.g. an in-progress partial update)", () => {
    const rawJson = JSON.stringify({
      vertexes: [
        { digest: "d1", name: "[2/2] RUN wget" }, // no started/completed yet
        {
          digest: "d1",
          name: "[2/2] RUN wget",
          started: "2026-01-01T00:00:00.060Z",
          completed: "2026-01-01T00:00:00.100Z",
        },
      ],
      logs: [],
    });
    const result = parseVertexAllowedLog(rawJson);
    assert.equal(result.length, 1);
    assert.equal(result[0].started, "2026-01-01T00:00:00.060Z");
  });

  it("returns an empty array when there are no RUN vertices", () => {
    const rawJson = JSON.stringify({
      vertexes: [
        {
          digest: "d1",
          name: "[1/2] FROM alpine",
          started: "2026-01-01T00:00:00.000Z",
          completed: "2026-01-01T00:00:00.050Z",
        },
      ],
      logs: [],
    });
    assert.deepEqual(parseVertexAllowedLog(rawJson), []);
  });

  it("merges vertexes and logs when buildctl emits multiple newline-separated JSON documents instead of one blob", () => {
    const doc1 = JSON.stringify({
      vertexes: [
        {
          digest: "d1",
          name: "[1/2] RUN echo one",
          started: "2026-01-01T00:00:00.000Z",
          completed: "2026-01-01T00:00:00.050Z",
        },
      ],
      logs: [
        {
          vertex: "d1",
          stream: 2,
          timestamp: "2026-01-01T00:00:00.010Z",
          data: encode("proxy network requests:\n- GET https://one.example.com/ -> 200\n"),
        },
      ],
    });
    const doc2 = JSON.stringify({
      vertexes: [
        {
          digest: "d2",
          name: "[2/2] RUN echo two",
          started: "2026-01-01T00:00:00.100Z",
          completed: "2026-01-01T00:00:00.150Z",
        },
      ],
      logs: [
        {
          vertex: "d2",
          stream: 2,
          timestamp: "2026-01-01T00:00:00.110Z",
          data: encode("proxy network requests:\n- GET https://two.example.com/ -> 200\n"),
        },
      ],
    });
    // A single JSON.parse(rawJsonText) on this combined text would throw
    // ("Unexpected non-whitespace character after JSON ... line 2 column 1")
    // — this is the exact failure this parses around.
    const result = parseVertexAllowedLog(`${doc1}\n${doc2}\n`);
    assert.equal(result.length, 2);
    assert.equal(result[0].entries[0].url, "https://one.example.com/");
    assert.equal(result[1].entries[0].url, "https://two.example.com/");
  });

  it("skips a document line that fails to parse as JSON, keeping the rest", () => {
    const doc1 = JSON.stringify({
      vertexes: [
        {
          digest: "d1",
          name: "[1/2] RUN echo one",
          started: "2026-01-01T00:00:00.000Z",
          completed: "2026-01-01T00:00:00.050Z",
        },
      ],
      logs: [
        {
          vertex: "d1",
          stream: 2,
          timestamp: "2026-01-01T00:00:00.010Z",
          data: encode("proxy network requests:\n- GET https://one.example.com/ -> 200\n"),
        },
      ],
    });
    const result = parseVertexAllowedLog(`${doc1}\nnot json at all\n`);
    assert.equal(result.length, 1);
    assert.equal(result[0].entries[0].url, "https://one.example.com/");
  });
});
