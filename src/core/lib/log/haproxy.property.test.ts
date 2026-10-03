import fc from "fast-check";
import { describe, it, expect } from "vitest";

import { aggregate } from "./aggregate.ts";
import { scanHaproxyLog } from "./haproxy.ts";

describe("scanHaproxyLog: properties", () => {
  // A well-formed line always becomes exactly one event with the right action:
  // BLOCKED → block (or failed for a dns-failed reason); ALLOWED/AUDIT → an
  // event only when it matches the decision `isAudit` selects, else dropped.
  // The host comes out as the rules match it, whatever case the log carried.
  it("a valid line always becomes exactly one event in the right shape", async () => {
    const decision = fc.constantFrom("ALLOWED", "BLOCKED", "AUDIT");
    const isAudit = fc.boolean();
    const ruleType = fc.constantFrom("HTTPS", "HTTP", "IP", "UNKNOWN");
    const host = fc.stringMatching(/^[A-Za-z][A-Za-z0-9.]{0,20}$/);
    const port = fc.integer({ min: 1, max: 65535 });
    const reason = fc.oneof(fc.constant("-"), fc.stringMatching(/^[A-Za-z0-9-]{1,15}$/));
    const bytes = fc.integer({ min: 0, max: 1_000_000 });

    await fc.assert(
      fc.asyncProperty(
        decision,
        isAudit,
        ruleType,
        host,
        port,
        reason,
        bytes,
        async (d, audit, rt, h, p, r, b) => {
          const line = `buildcage 1787471970000 [${d}] (${rt}) "${h}:${p}" ${r} ${b}`;
          const { events } = await scanHaproxyLog([line], audit);
          const passedDecision = audit ? "AUDIT" : "ALLOWED";
          // An HTTPS line names the SNI, which keeps its trailing dot.
          const folded = rt === "HTTPS" ? h.toLowerCase() : h.toLowerCase().replace(/\.$/, "");

          if (d === "BLOCKED") {
            expect(events.length).toBe(1);
            expect(events[0].action).toBe(r === "dns-failed" ? "failed" : "block");
            expect(events[0].host).toBe(folded);
            expect(events[0].port).toBe(p);
            expect(events[0].reason).toBe(r);
          } else if (d === passedDecision) {
            expect(events.length).toBe(1);
            expect(events[0].action).toBe(audit ? "audit" : "allow");
            expect(events[0].host).toBe(folded);
            expect(events[0].port).toBe(p);
            expect(events[0].bytes).toBe(b);
          } else {
            // The "other" of ALLOWED/AUDIT for this mode: dropped entirely.
            expect(events.length).toBe(0);
          }
        },
      ),
    );
  });

  // The line is anchored at both ends, so a token appended past the last field
  // (an injection attempt) makes the whole line fail to match rather than being
  // silently accepted with a field truncated.
  it("a line with trailing content past its last field does not match", async () => {
    const reason = fc.stringMatching(/^[A-Za-z0-9-]{1,10}$/);
    const trailing = fc.stringMatching(/^\S{1,10}$/);

    await fc.assert(
      fc.asyncProperty(reason, trailing, async (r, extra) => {
        const line = `buildcage 1787471970000 [ALLOWED] (HTTPS) "example.com:443" ${r} 0 ${extra}`;
        const { events } = await scanHaproxyLog([line], false);
        expect(events.length).toBe(0);
      }),
    );
  });
});

describe("aggregate: properties", () => {
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
