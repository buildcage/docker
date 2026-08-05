import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectAllRefs } from "./build-histories-parser.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");

// Captured from a live moby/buildkit v0.31.1 explicit-mode container building
// a 3-stage Dockerfile (stage1: a no-op RUN then an allowed RUN; stage2: one
// allowed RUN; a final stage COPYing from stage2). stage1/stage2's RUN
// vertices have overlapping `started` timestamps, since independent stages
// can run concurrently.
const MULTISTAGE_HISTORIES = readFileSync(join(fixturesDir, "histories.json"), "utf8");

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
      JSON.stringify({
        type: 1,
        record: { Ref: "later-nanos", CreatedAt: { seconds: 100, nanos: 999 } },
      }),
      JSON.stringify({
        type: 1,
        record: { Ref: "earlier-nanos", CreatedAt: { seconds: 100, nanos: 500 } },
      }),
    ].join("\n");
    assert.deepEqual(selectAllRefs(historiesText), ["earlier-nanos", "later-nanos"]);
  });

  it("deduplicates a ref reported on multiple lines as its build progresses", () => {
    const historiesText = [
      JSON.stringify({
        type: 1,
        record: { Ref: "build-1", CreatedAt: { seconds: 100, nanos: 0 } },
      }),
      JSON.stringify({
        type: 1,
        record: {
          Ref: "build-1",
          CreatedAt: { seconds: 100, nanos: 0 },
          CompletedAt: { seconds: 101, nanos: 0 },
        },
      }),
    ].join("\n");
    assert.deepEqual(selectAllRefs(historiesText), ["build-1"]);
  });

  it("ignores blank lines and records with no Ref/CreatedAt", () => {
    const historiesText = [
      "",
      JSON.stringify({ type: 1, record: {} }),
      "",
      MULTISTAGE_HISTORIES.trim(),
    ].join("\n");
    assert.deepEqual(selectAllRefs(historiesText), ["jsvnbiyvnlslxxui8ap3i2na2"]);
  });

  it("returns an empty array when there are no records at all", () => {
    assert.deepEqual(selectAllRefs(""), []);
  });
});
