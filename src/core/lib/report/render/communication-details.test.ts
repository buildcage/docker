import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

import { renderCommunicationDetailsBody } from "./communication-details.ts";

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

describe("renderCommunicationDetailsBody", () => {
  const md = renderCommunicationDetailsBody(TIMELINE, t);
  const body = md.split("```")[1] ?? "";
  const lines = body.trim().split("\n");

  it("keeps everything in one timeline rather than splitting by outcome", () => {
    expect(lines[0].startsWith("✅")).toBe(true);
    expect(lines[1].startsWith("🚫")).toBe(true);
    expect(lines[2].startsWith("🚫")).toBe(true);
  });

  it("shows the URL and method of a blocked request", () => {
    expect(md).toContain("POST https://evil.example.com/exfil?token=***");
  });

  it("says what restrict would have blocked of a request audit let through", () => {
    const audited: TrafficEvent = {
      ...TIMELINE[0],
      action: "audit",
      wouldBlock: "example-block",
    };
    const line = (renderCommunicationDetailsBody([audited], t).split("```")[1] ?? "").trim();
    expect(line).toBe(
      "⚠️ 00:00.000: GET https://a.example.com/pkg -> 200 (708B) (restrict would block: example-block)",
    );
  });

  it("names the reason a request was blocked for and the one restrict would block it for", () => {
    const both: TrafficEvent = {
      ...TIMELINE[0],
      action: "block",
      reason: "first",
      wouldBlock: "second",
    };
    const line = (renderCommunicationDetailsBody([both], t).split("```")[1] ?? "").trim();
    expect(line.endsWith(" -> first (restrict would block: second)")).toBe(true);
  });

  it("says what restrict would have blocked after a reason too", () => {
    const failed: TrafficEvent = {
      ...TIMELINE[2],
      action: "failed",
      reason: "dns-failed",
      wouldBlock: "example-block",
    };
    const line = (renderCommunicationDetailsBody([failed], t).split("```")[1] ?? "").trim();
    expect(line.endsWith("-> dns-failed (restrict would block: example-block)")).toBe(true);
  });

  it("names the reason after the arrow instead of a status", () => {
    // 403, 502 and 503 mean different things; the number does not say which.
    expect(md).toContain("-> not-allowed");
    expect(md).not.toContain("-> 403");
  });

  it("shows a passthrough as a host and port, though it has no url to show", () => {
    expect(md).toContain("TLS db.example.com:5432 -> (3.3KB)");
  });

  it("shows a portless connection as just its host, never host:undefined", () => {
    const out = renderCommunicationDetailsBody(
      [{ time: t, action: "allow", protocol: "https", host: "a.example.com" }],
      t,
    );
    expect(out).toContain("HTTPS a.example.com ");
    expect(out).not.toContain("undefined");
  });

  it("scales the byte count to a readable unit, at each magnitude", () => {
    // A silent unit or rounding error would misreport how much crossed.
    const size = (bytes: number) => {
      const out = renderCommunicationDetailsBody(
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

  it("keeps a blocked name, which nothing else records", () => {
    expect(md).toContain("DNS secret.attacker.example -> dns-not-allowed");
  });

  it("drops a blocked name once a blocked request for it also shows up", () => {
    const md2 = renderCommunicationDetailsBody(
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
    expect(body2[0]).not.toContain("DNS notallowed.example.com");
    expect(body2[0]).toContain("GET https://notallowed.example.com/");
  });

  it("leaves out a name that merely resolved", () => {
    // The request that followed already says it did, and listing both doubles
    // every line.
    expect(lines.length).toBe(4);
    expect(md).not.toContain("DNS a.example.com");
  });

  it("puts everything in a fenced block, so URLs stay copy-pastable", () => {
    expect(md).toContain("```");
    expect(md).not.toContain("\\_");
  });

  it("names the record type a discovery lookup asked for, and says it got nothing", () => {
    // SRV going unanswered costs apt nothing; TXT going unanswered is why a
    // `mongodb+srv://` connection never got its options.
    const md2 = renderCommunicationDetailsBody(
      [
        {
          time: t,
          action: "discovery",
          protocol: "dns",
          host: "_http._tcp.deb.debian.org",
          queryType: "SRV",
        },
      ],
      t,
    );
    expect(md2).toContain("DNS SRV _http._tcp.deb.debian.org");
    expect(md2).toContain("no data (SRV is never served)");
    // Neither allowed nor blocked, so it carries neither mark.
    expect(md2).not.toContain("🚫");
    expect(md2).not.toContain("✅");
  });

  it("shows a discovery lookup even though the host it belongs to connected", () => {
    // Nothing connects to `_service._proto.<host>`, so this is not the
    // connection to the plain name said twice.
    const md2 = renderCommunicationDetailsBody(
      [
        {
          time: t,
          action: "discovery",
          protocol: "dns",
          host: "_http._tcp.deb.debian.org",
          queryType: "SRV",
        },
        {
          time: t + 1,
          action: "allow",
          protocol: "http",
          host: "deb.debian.org",
          method: "GET",
          url: "http://deb.debian.org/debian/InRelease",
          status: 200,
          bytes: 100,
        },
      ],
      t,
    );
    expect((md2.split("```")[1] ?? "").trim().split("\n").length).toBe(2);
  });

  it("renders nothing at all when there was no traffic", () => {
    expect(renderCommunicationDetailsBody([], t)).toBe("");
  });

  it("keeps a name that resolved and was never connected to", () => {
    // Its own sole trace: a rule wide enough to cover something the build
    // only looked at is exactly what an audit run is meant to surface.
    const only = renderCommunicationDetailsBody(
      [{ time: t, action: "allow", protocol: "dns", host: "a.com" }],
      t,
    );
    expect(only).toContain("DNS a.com -> resolved");
  });

  it('falls back to a bare "blocked" when a block names no reason', () => {
    const rendered = renderCommunicationDetailsBody(
      [
        {
          time: t,
          action: "block",
          protocol: "https",
          host: "a.example.com",
          port: 443,
          method: "GET",
          url: "https://a.example.com/pkg",
        },
      ],
      t,
    );
    expect(rendered).toMatch(/blocked/);
  });

  it("keeps a client-ended connection to a host nothing else reached", () => {
    // Nothing else reached this host, so the close is kept (see clientEndedNoise).
    for (const reason of ["client-aborted", "client-timeout"]) {
      const rendered = renderCommunicationDetailsBody(
        [
          {
            time: t,
            action: "incomplete",
            protocol: "https",
            host: "untrusted.example.com",
            port: 8443,
            reason,
          },
        ],
        t,
      );
      expect(rendered).toContain(`HTTPS untrusted.example.com:8443 -> ${reason}`);
    }
  });

  it("keeps a client-ended connection to (unknown), which is never one host", () => {
    // A block elsewhere under (unknown) proves nothing about this close.
    const rendered = renderCommunicationDetailsBody(
      [
        {
          time: t,
          action: "block",
          protocol: "http",
          host: "(unknown)",
          port: 22,
          reason: "bad-request",
        },
        {
          time: t,
          action: "incomplete",
          protocol: "http",
          host: "(unknown)",
          port: 25,
          reason: "client-aborted",
        },
      ],
      t,
    );
    expect(rendered).toContain("HTTP (unknown):25 -> client-aborted");
  });

  it("hides a client-ended connection to a host that also completed one", () => {
    // A keepalive pool cleaning up after its work is noise, not a failure.
    for (const reason of ["client-aborted", "client-timeout"]) {
      const md = renderCommunicationDetailsBody(
        [
          {
            time: t,
            action: "allow",
            protocol: "https",
            host: "registry.example.com",
            port: 443,
            method: "GET",
            url: "https://registry.example.com/pkg",
            status: 200,
            bytes: 10,
          },
          {
            time: t + 1,
            action: "incomplete",
            protocol: "https",
            host: "registry.example.com",
            port: 443,
            reason,
          },
        ],
        t,
      );
      expect(md).not.toContain(reason);
      expect(md).toContain("GET https://registry.example.com/pkg");
    }
  });

  it("hides a client-ended close to a host whose only request failed at the origin", () => {
    // A failed request still proves the client trusted the CA and a request
    // arrived, so the later keepalive close to that host is noise too.
    const md = renderCommunicationDetailsBody(
      [
        {
          time: t,
          action: "failed",
          protocol: "https",
          host: "cdn.example.com",
          port: 443,
          method: "GET",
          url: "https://cdn.example.com/x.tgz",
          reason: "origin-aborted",
        },
        {
          time: t + 1,
          action: "incomplete",
          protocol: "https",
          host: "cdn.example.com",
          port: 443,
          reason: "client-aborted",
        },
      ],
      t,
    );
    expect(md).not.toContain("client-aborted");
    expect(md).toContain("-> origin-aborted");
  });

  it("marks a request the proxy could not read as the block it was", () => {
    // Blocked, so 🚫 rather than ⚠️, and named by its port alone: the plain
    // stage has no SNI, and no request arrived to carry a Host.
    const rendered = renderCommunicationDetailsBody(
      [
        {
          time: t,
          action: "block",
          protocol: "http",
          host: "(unknown)",
          port: 8080,
          reason: "bad-request",
        },
      ],
      t,
    );
    expect(rendered).toContain("🚫 00:00.000: HTTP (unknown):8080 -> bad-request");
  });

  it("marks a connection haproxy itself ended before a request arrived", () => {
    const rendered = renderCommunicationDetailsBody(
      [
        {
          time: t,
          action: "incomplete",
          protocol: "https",
          host: "a.example.com",
          port: 443,
          reason: "no-request",
        },
      ],
      t,
    );
    expect(rendered).toContain("⚠️ 00:00.000: HTTPS a.example.com:443 -> no-request");
  });

  it("keeps the method of a request whose target no URL fits", () => {
    // `OPTIONS *` reaches the rules and is blocked by them, so the row is a
    // block rather than a connection that carried nothing. Without the
    // method it would read as the latter.
    const rendered = renderCommunicationDetailsBody(
      [
        {
          time: t,
          action: "block",
          protocol: "https",
          host: "registry.npmjs.org",
          port: 443,
          method: "OPTIONS",
          reason: "not-allowed",
        },
      ],
      t,
    );
    expect(rendered).toContain("🚫 00:00.000: OPTIONS HTTPS registry.npmjs.org:443 -> not-allowed");
  });

  it('falls back to a bare "no request" when such a connection names no reason', () => {
    const rendered = renderCommunicationDetailsBody(
      [{ time: t, action: "incomplete", protocol: "https", host: "a.example.com", port: 443 }],
      t,
    );
    expect(rendered).toMatch(/-> no request/);
  });

  // The same ⚠️ as a request that never arrived, but this one has a URL to
  // show: it did arrive, and the rules passed on it.
  it("marks a connection the origin broke, keeping the request it named", () => {
    const rendered = renderCommunicationDetailsBody(
      [
        {
          time: t,
          action: "failed",
          protocol: "https",
          host: "a.example.com",
          port: 443,
          method: "GET",
          url: "https://a.example.com/pkg.tgz",
          reason: "origin-aborted",
        },
      ],
      t,
    );
    expect(rendered).toContain("⚠️ 00:00.000: GET https://a.example.com/pkg.tgz -> origin-aborted");
  });

  it('falls back to a bare "failed" when such a connection names no reason', () => {
    const rendered = renderCommunicationDetailsBody(
      [{ time: t, action: "failed", protocol: "https", host: "a.example.com", port: 443 }],
      t,
    );
    expect(rendered).toMatch(/-> failed/);
  });
});

describe("renderCommunicationDetailsBody credential parameters", () => {
  it("redacts a credential in the query of the URL it prints", () => {
    const md = renderCommunicationDetailsBody(
      [
        {
          time: t,
          action: "allow",
          protocol: "https",
          host: "h",
          port: 443,
          method: "GET",
          url: "https://h/x?token=secret&page=2",
        },
      ],
      t,
    );
    expect(md).toContain("GET https://h/x?token=***&page=2 ->");
    expect(md).not.toContain("secret");
  });
});

describe("renderCommunicationDetailsBody elapsed time", () => {
  it("falls back to absolute UTC when there is no start time to be relative to", () => {
    const md = renderCommunicationDetailsBody(
      [{ time: t, action: "allow", protocol: "tls", host: "a", port: 1, bytes: 1 }],
      undefined,
    );
    expect(md).not.toContain("00:00.000:");
    expect(md).toContain("Z:");
  });
});
