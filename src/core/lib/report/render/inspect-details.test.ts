import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import { renderInspectDetails, renderInspectDetailsBody } from "./inspect-details.ts";
import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

const t = 1787471975;
const TIMELINE: TrafficEvent[] = [
  {
    time: t,
    action: "allow",
    protocol: "https",
    host: "a.example.com",
    port: 443,
    method: "GET",
    url: "https://a.example.com/pkg",
    status: 200,
    bytes: 708,
  },
  {
    time: t + 1,
    action: "block",
    protocol: "dns",
    host: "secret.attacker.example",
    reason: "dns-not-allowed",
  },
  {
    time: t + 2,
    action: "block",
    protocol: "https",
    host: "evil.example.com",
    port: 443,
    method: "POST",
    url: "https://evil.example.com/exfil?token=SECRET",
    reason: "not-allowed",
  },
  {
    time: t + 3,
    action: "allow",
    protocol: "tls",
    host: "db.example.com",
    port: 5432,
    bytes: 3421,
  },
  { time: t + 4, action: "allow", protocol: "dns", host: "a.example.com" },
];

describe("renderInspectDetails", () => {
  const md = renderInspectDetails(TIMELINE, t);
  const body = md.split("```")[1] ?? "";
  const lines = body.trim().split("\n");

  it("keeps everything in one timeline rather than splitting by outcome", () => {
    // Nothing here can be attributed to a RUN step, so time is the only
    // structure available, and a refusal reads in the context around it.
    expect(lines[0].startsWith("✅")).toBe(true);
    expect(lines[1].startsWith("🚫")).toBe(true);
    expect(lines[2].startsWith("🚫")).toBe(true);
  });

  it("shows the full URL and method of a refused request", () => {
    expect(md.includes("POST https://evil.example.com/exfil?token=SECRET")).toBe(true);
  });

  it("names the reason after the arrow instead of a status", () => {
    // 403, 502 and 503 mean different things; the number does not say which.
    expect(md.includes("-> not-allowed")).toBe(true);
    expect(md.includes("-> 403")).toBe(false);
  });

  it("shows a passthrough as a host and port, having no url to show", () => {
    expect(md.includes("TLS db.example.com:5432 -> (3.3KB)")).toBe(true);
  });

  it("scales the byte count to a readable unit, at each magnitude", () => {
    // A silent unit or rounding error would misreport how much crossed.
    const size = (bytes: number) => {
      const out = renderInspectDetails(
        [{ time: t, action: "allow", protocol: "tls", host: "a", port: 1, bytes }],
        t,
      );
      return out.slice(out.indexOf("-> ") + 3, out.indexOf("\n", out.indexOf("-> ")));
    };
    expect(size(0)).toBe("(0B)");
    expect(size(1023)).toBe("(1023B)");
    expect(size(1024)).toBe("(1.0KB)");
    expect(size(1024 * 1024 - 1)).toBe("(1024.0KB)");
    expect(size(1024 * 1024)).toBe("(1.0MB)");
    expect(size(3 * 1024 * 1024 + 512 * 1024)).toBe("(3.5MB)");
  });

  it("keeps a refused name, which nothing else records", () => {
    expect(md.includes("DNS secret.attacker.example -> dns-not-allowed")).toBe(true);
  });

  it("drops a refused name once a refused request for it also shows up", () => {
    const md2 = renderInspectDetails(
      [
        {
          time: t,
          action: "block",
          protocol: "dns",
          host: "notallowed.example.com",
          reason: "dns-not-allowed",
        },
        {
          time: t + 1,
          action: "block",
          protocol: "https",
          host: "notallowed.example.com",
          method: "GET",
          url: "https://notallowed.example.com/",
          reason: "not-allowed",
        },
      ],
      t,
    );
    const body2 = (md2.split("```")[1] ?? "").trim().split("\n");
    expect(body2.length).toBe(1);
    expect(body2[0].includes("DNS notallowed.example.com")).toBe(false);
    expect(body2[0].includes("GET https://notallowed.example.com/")).toBe(true);
  });

  it("leaves out a name that merely resolved", () => {
    // The request that followed already says it did, and listing both doubles
    // every line.
    expect(lines.length).toBe(4);
    expect(md.includes("DNS a.example.com")).toBe(false);
  });

  it("puts everything in a fenced block, so URLs stay copy-pastable", () => {
    expect(md.includes("```")).toBe(true);
    expect(md.includes("\\_")).toBe(false);
  });

  it("renders nothing at all when there was no traffic", () => {
    expect(renderInspectDetails([], t)).toBe("");
  });

  it("renders nothing when only resolved names were seen", () => {
    expect(
      renderInspectDetails([{ time: t, action: "allow", protocol: "dns", host: "a.com" }], t),
    ).toBe("");
  });
});

describe("renderInspectDetails elapsed time", () => {
  it("shows the first event at zero when it lands exactly on the start time", () => {
    const md = renderInspectDetails(
      [{ time: t, action: "allow", protocol: "tls", host: "a", port: 1, bytes: 1 }],
      t,
    );
    expect(md.includes("00:00.000:")).toBe(true);
  });

  it("widens to HH:MM:SS.mmm once elapsed passes an hour", () => {
    const md = renderInspectDetails(
      [{ time: t + 3600, action: "allow", protocol: "tls", host: "a", port: 1, bytes: 1 }],
      t,
    );
    expect(md.includes("01:00:00.000:")).toBe(true);
  });

  it("falls back to absolute UTC when there is no start time to be relative to", () => {
    const md = renderInspectDetails(
      [{ time: t, action: "allow", protocol: "tls", host: "a", port: 1, bytes: 1 }],
      undefined,
    );
    expect(md.includes("00:00.000:")).toBe(false);
    expect(md.includes("Z:")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wrapLogGroup skips emitting a ::group:: at all when handed "" -- the
// property that actually matters here, not the tag shape of a non-empty one.
// ---------------------------------------------------------------------------
describe("renderInspectDetailsBody", () => {
  it("renders nothing at all when there was no traffic", () => {
    expect(renderInspectDetailsBody([], t)).toBe("");
  });
});

reportResults();
