/**
 * Property-based tests for core/lib/log/haproxy.ts.
 *
 * Run with: vp test run core/lib/log/haproxy.property.test.ts
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { scanHaproxyLog } from "./haproxy.ts";
import { aggregate } from "./aggregate.ts";

// ---------------------------------------------------------------------------
// scanHaproxyLog
// ---------------------------------------------------------------------------

describe("scanHaproxyLog – properties", () => {
  // A well-formed log line always round-trips into the right bucket:
  // BLOCKED always lands in `blocked`; ALLOWED/AUDIT lands in `passed` only
  // if it matches the decision `isAudit` selects, otherwise it's dropped.
  it("valid log line always aggregates to exactly one entry in the right bucket", async () => {
    const decision = fc.constantFrom("ALLOWED", "BLOCKED", "AUDIT");
    const isAudit = fc.boolean();
    // ruleType must match \w+ in the log pattern
    const ruleType = fc.stringMatching(/^\w{1,10}$/);
    // host: no '"' or ':' to keep the lastIndexOf split unambiguous
    const host = fc.stringMatching(/^[a-z][a-z0-9.]{0,20}$/);
    const port = fc.integer({ min: 1, max: 65535 }).map(String);
    // reason: restricted to the kebab-case charset the log pattern now requires
    const reason = fc.oneof(fc.constant("-"), fc.stringMatching(/^[A-Za-z0-9-]{1,15}$/));

    await fc.assert(
      fc.asyncProperty(
        decision,
        isAudit,
        ruleType,
        host,
        port,
        reason,
        async (d, audit, rt, h, p, r) => {
          const line = `[2024-01-01] buildcage [${d}] (${rt}) "${h}:${p}" ${r}`;
          const result = await scanHaproxyLog([line], audit);
          const passedDecision = audit ? "AUDIT" : "ALLOWED";

          if (d === "BLOCKED") {
            expect(result.passed.length).toBe(0);
            expect(result.blocked.length).toBe(1);
            expect(result.blocked[0].ruleType).toBe(rt);
            expect(result.blocked[0].host).toBe(h);
            expect(result.blocked[0].port).toBe(p);
            expect(result.blocked[0].reason).toBe(r);
          } else if (d === passedDecision) {
            expect(result.blocked.length).toBe(0);
            expect(result.passed.length).toBe(1);
            expect(result.passed[0].ruleType).toBe(rt);
            expect(result.passed[0].host).toBe(h);
            expect(result.passed[0].port).toBe(p);
            expect(result.passed[0].reason).toBe(r);
          } else {
            // The "other" of ALLOWED/AUDIT for this mode — dropped entirely.
            expect(result.passed.length).toBe(0);
            expect(result.blocked.length).toBe(0);
          }
        },
      ),
    );
  });

  // The line is anchored at both ends, so a trailing token after an
  // otherwise well-formed reason (an injection attempt appended past the
  // field the report expects) makes the whole line fail to match, rather
  // than being silently accepted with the reason truncated to its first word.
  it("a reason with trailing content after it does not match at all", async () => {
    const reason = fc.stringMatching(/^[A-Za-z0-9-]{1,10}$/);
    const trailing = fc.stringMatching(/^\S{1,10}$/);

    await fc.assert(
      fc.asyncProperty(reason, trailing, async (r, extra) => {
        const line = `[ts] buildcage [ALLOWED] (HTTPS) "example.com:443" ${r} ${extra}`;
        const result = await scanHaproxyLog([line], false);
        expect(result.passed.length).toBe(0);
        expect(result.hasNonBuildcageContent).toBe(true);
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
        expect(() => aggregate(entries)).not.toThrow();
      }),
    );
  });
});
