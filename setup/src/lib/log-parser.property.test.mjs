/**
 * Property-based tests for docker/files/tools/lib/log-parser.mjs.
 *
 * Run with: node --test setup/src/lib/log-parser.property.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { parseEntries, aggregate } from "../../../docker/files/tools/lib/log-parser.mjs";

// ---------------------------------------------------------------------------
// parseEntries
// ---------------------------------------------------------------------------

describe("parseEntries – properties", () => {
  // A well-formed log line always round-trips: parseEntries recovers all five fields.
  it("valid log line always parses to exactly one entry with matching fields", () => {
    const decision = fc.constantFrom("ALLOWED", "BLOCKED", "AUDIT");
    // ruleType must match \w+ in the log pattern
    const ruleType = fc.stringMatching(/^\w{1,10}$/);
    // host: no '"' or ':' to keep the lastIndexOf split unambiguous
    const host = fc.stringMatching(/^[a-z][a-z0-9.]{0,20}$/);
    const port = fc.integer({ min: 1, max: 65535 }).map(String);
    // reason: \S+ so the log pattern captures it in full
    const reason = fc.oneof(fc.constant("-"), fc.stringMatching(/^\S{1,15}$/));

    fc.assert(
      fc.property(decision, ruleType, host, port, reason, (d, rt, h, p, r) => {
        const line = `[2024-01-01] buildcage [${d}] (${rt}) "${h}:${p}" ${r}`;
        const entries = parseEntries(line);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].decision, d);
        assert.equal(entries[0].ruleType, rt);
        assert.equal(entries[0].host, h);
        assert.equal(entries[0].port, p);
        assert.equal(entries[0].reason, r);
      }),
    );
  });

  // The log pattern captures reason as \S* (no whitespace). A reason string
  // containing an internal space is silently truncated to its first word.
  it("reason with internal space is truncated to the first word", () => {
    const word = fc.stringMatching(/^\S{1,10}$/);

    fc.assert(
      fc.property(word, word, (w1, w2) => {
        const line = `[ts] buildcage [ALLOWED] (HTTPS) "example.com:443" ${w1} ${w2}`;
        const entries = parseEntries(line);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].reason, w1);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

describe("aggregate – properties", () => {
  // aggregate sorts by Number(port) as a tiebreaker. When port is non-numeric,
  // Number(port) is NaN; the sort must not throw.
  it("non-numeric port values never cause aggregate to throw", () => {
    const entryWithAlphaPort = fc.record({
      host: fc.constant("example.com"),
      port: fc.stringMatching(/^[a-z]{1,5}$/),
      ruleType: fc.constant("HTTPS"),
      reason: fc.constant("-"),
    });

    fc.assert(
      fc.property(fc.array(entryWithAlphaPort, { minLength: 1, maxLength: 5 }), (entries) => {
        assert.doesNotThrow(() => aggregate(entries));
      }),
    );
  });
});
