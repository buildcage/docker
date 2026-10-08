import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

import { renderInspectDetails, renderWouldRefuseBody } from "./inspect-details.ts";

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

describe("renderWouldRefuseBody", () => {
  it("lists only the requests restrict would refuse, in a fenced block", () => {
    const audited: TrafficEvent = {
      ...TIMELINE[0],
      action: "audit",
      wouldRefuse: "example-refusal",
    };
    expect(renderWouldRefuseBody([...TIMELINE, audited], t)).toBe(
      "```\n" +
        "🚨 00:00.000: GET https://a.example.com/pkg -> 200 (708B) (restrict would refuse: example-refusal)\n" +
        "```\n",
    );
  });

  it("is empty when restrict would refuse nothing", () => {
    expect(renderWouldRefuseBody(TIMELINE, t)).toBe("");
  });
});

describe("renderInspectDetails", () => {
  const md = renderInspectDetails(TIMELINE, t);
  const body = md.split("```")[1] ?? "";
  const lines = body.trim().split("\n");

  it("keeps everything in one timeline rather than splitting by outcome", () => {
    expect(lines[0].startsWith("✅")).toBe(true);
    expect(lines[1].startsWith("🚫")).toBe(true);
    expect(lines[2].startsWith("🚫")).toBe(true);
  });

  it("shows the URL and method of a refused request", () => {
    expect(md.includes("POST https://evil.example.com/exfil?token=***")).toBe(true);
  });

  it("says what restrict would have refused of a request audit let through", () => {
    const audited: TrafficEvent = {
      ...TIMELINE[0],
      action: "audit",
      wouldRefuse: "example-refusal",
    };
    const line = (renderInspectDetails([audited], t).split("```")[1] ?? "").trim();
    expect(line).toBe(
      "🚨 00:00.000: GET https://a.example.com/pkg -> 200 (708B) (restrict would refuse: example-refusal)",
    );
  });

  it("says what restrict would have refused after a reason too", () => {
    const failed: TrafficEvent = {
      ...TIMELINE[2],
      action: "failed",
      reason: "dns-failed",
      wouldRefuse: "example-refusal",
    };
    const line = (renderInspectDetails([failed], t).split("```")[1] ?? "").trim();
    expect(line.endsWith("-> dns-failed (restrict would refuse: example-refusal)")).toBe(true);
  });

  it("names the reason after the arrow instead of a status", () => {
    // 403, 502 and 503 mean different things; the number does not say which.
    expect(md.includes("-> not-allowed")).toBe(true);
    expect(md.includes("-> 403")).toBe(false);
  });

  it("shows a passthrough as a host and port, though it has no url to show", () => {
    expect(md.includes("TLS db.example.com:5432 -> (3.3KB)")).toBe(true);
  });

  it("shows a portless connection as just its host, never host:undefined", () => {
    const out = renderInspectDetails(
      [{ time: t, action: "allow", protocol: "https", host: "a.example.com" }],
      t,
    );
    expect(out).toContain("HTTPS a.example.com ");
    expect(out).not.toContain("undefined");
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

  it("names the record type a discovery lookup asked for, and says it got nothing", () => {
    // SRV going unanswered costs apt nothing; TXT going unanswered is why a
    // `mongodb+srv://` connection never got its options.
    const md2 = renderInspectDetails(
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
    expect(md2.includes("DNS SRV _http._tcp.deb.debian.org")).toBe(true);
    expect(md2.includes("no data (SRV is never served)")).toBe(true);
    // Neither allowed nor refused, so it carries neither mark.
    expect(md2.includes("🚫")).toBe(false);
    expect(md2.includes("✅")).toBe(false);
  });

  it("shows a discovery lookup even though the host it belongs to connected", () => {
    // Nothing connects to `_service._proto.<host>`, so this is not the
    // connection to the plain name said twice.
    const md2 = renderInspectDetails(
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
    expect(renderInspectDetails([], t)).toBe("");
  });

  it("keeps a name that resolved and was never connected to", () => {
    // Its own sole trace: a rule wide enough to cover something the build
    // only looked at is exactly what an audit run is meant to surface.
    const only = renderInspectDetails(
      [{ time: t, action: "allow", protocol: "dns", host: "a.com" }],
      t,
    );
    expect(only.includes("DNS a.com -> resolved")).toBe(true);
  });

  it('falls back to a bare "blocked" when a refusal names no reason', () => {
    const rendered = renderInspectDetails(
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
      const rendered = renderInspectDetails(
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
      expect(rendered.includes(`HTTPS untrusted.example.com:8443 -> ${reason}`)).toBe(true);
    }
  });

  it("keeps a client-ended connection to (unknown), which is never one host", () => {
    // A refusal elsewhere under (unknown) proves nothing about this close.
    const rendered = renderInspectDetails(
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
    expect(rendered.includes("HTTP (unknown):25 -> client-aborted")).toBe(true);
  });

  it("hides a client-ended connection to a host that also completed one", () => {
    // A keepalive pool cleaning up after its work is noise, not a failure.
    for (const reason of ["client-aborted", "client-timeout"]) {
      const md = renderInspectDetails(
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
      expect(md.includes(reason)).toBe(false);
      expect(md.includes("GET https://registry.example.com/pkg")).toBe(true);
    }
  });

  it("hides a client-ended close to a host whose only request failed at the origin", () => {
    // A failed request still proves the client trusted the CA and a request
    // arrived, so the later keepalive close to that host is noise too.
    const md = renderInspectDetails(
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
    expect(md.includes("client-aborted")).toBe(false);
    expect(md.includes("-> origin-aborted")).toBe(true);
  });

  it("marks a request the proxy could not read as the refusal it was", () => {
    // Refused, so 🚫 rather than ⚠️, and named by its port alone: the plain
    // stage has no SNI, and no request arrived to carry a Host.
    const rendered = renderInspectDetails(
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
    expect(rendered.includes("🚫 00:00.000: HTTP (unknown):8080 -> bad-request")).toBe(true);
  });

  it("marks a connection haproxy itself ended before a request arrived", () => {
    const rendered = renderInspectDetails(
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
    expect(rendered.includes("⚠️ 00:00.000: HTTPS a.example.com:443 -> no-request")).toBe(true);
  });

  it("keeps the method of a request whose target no URL fits", () => {
    // `OPTIONS *` reaches the rules and is refused by them, so the row is a
    // refusal rather than a connection that carried nothing. Without the
    // method it would read as the latter.
    const rendered = renderInspectDetails(
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
    expect(
      rendered.includes("🚫 00:00.000: OPTIONS HTTPS registry.npmjs.org:443 -> not-allowed"),
    ).toBe(true);
  });

  it('falls back to a bare "no request" when such a connection names no reason', () => {
    const rendered = renderInspectDetails(
      [{ time: t, action: "incomplete", protocol: "https", host: "a.example.com", port: 443 }],
      t,
    );
    expect(rendered).toMatch(/-> no request/);
  });

  // The same ⚠️ as a request that never arrived, but this one has a URL to
  // show: it did arrive, and the rules passed on it.
  it("marks a connection the origin broke, keeping the request it named", () => {
    const rendered = renderInspectDetails(
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
    expect(
      rendered.includes("⚠️ 00:00.000: GET https://a.example.com/pkg.tgz -> origin-aborted"),
    ).toBe(true);
  });

  it('falls back to a bare "failed" when such a connection names no reason', () => {
    const rendered = renderInspectDetails(
      [{ time: t, action: "failed", protocol: "https", host: "a.example.com", port: 443 }],
      t,
    );
    expect(rendered).toMatch(/-> failed/);
  });
});

describe("renderInspectDetails credential parameters", () => {
  const subjectOf = (url: string) => {
    const md = renderInspectDetails(
      [{ time: t, action: "allow", protocol: "https", host: "h", port: 443, method: "GET", url }],
      t,
    );
    const line = (md.split("```")[1] ?? "").trim();
    return line.slice(line.indexOf("GET "), line.indexOf(" ->"));
  };

  it("replaces a presigned URL's signature and leaves the rest readable", () => {
    // Which object was fetched and when the link expires are the whole point
    // of the line; the signature is the only part that grants anything.
    expect(subjectOf("https://h/x.tar.gz?X-Amz-Signature=abc123&X-Amz-Expires=3600")).toBe(
      "GET https://h/x.tar.gz?X-Amz-Signature=***&X-Amz-Expires=3600",
    );
  });

  it("matches the parameter name whatever its case", () => {
    expect(subjectOf("https://h/v1?Api_Key=sk_live_1")).toBe("GET https://h/v1?Api_Key=***");
  });

  it("redacts the token names a bearer scheme spells out", () => {
    expect(subjectOf("https://h/v1?api_token=t&auth_token=t&session_token=t&jwt=t")).toBe(
      "GET https://h/v1?api_token=***&auth_token=***&session_token=***&jwt=***",
    );
    expect(subjectOf("https://h/v1?PRIVATE-TOKEN=t&access_key=k&passwd=p&pwd=p")).toBe(
      "GET https://h/v1?PRIVATE-TOKEN=***&access_key=***&passwd=***&pwd=***",
    );
  });

  it("matches the name however its words are joined, keeping the spelling sent", () => {
    expect(subjectOf("https://h/v1?subscription-key=a&api-key=b&client-secret=c")).toBe(
      "GET https://h/v1?subscription-key=***&api-key=***&client-secret=***",
    );
    expect(
      subjectOf(
        "https://h/v1?accessToken=a&apiToken=b&clientSecret=c&authToken=d&refreshToken=e&idToken=f&sessionToken=g",
      ),
    ).toBe(
      "GET https://h/v1?accessToken=***&apiToken=***&clientSecret=***&authToken=***&refreshToken=***&idToken=***&sessionToken=***",
    );
    expect(subjectOf("https://h/v1?X-Api-Key=a&subscription_key=b")).toBe(
      "GET https://h/v1?X-Api-Key=***&subscription_key=***",
    );
  });

  it("redacts the names a session or a personal access token goes by", () => {
    expect(subjectOf("https://h/v1?Authorization=a&session=b&pat=c")).toBe(
      "GET https://h/v1?Authorization=***&session=***&pat=***",
    );
  });

  it("redacts a credential or credentials parameter", () => {
    expect(subjectOf("https://h/v1?credential=a&Credentials=b")).toBe(
      "GET https://h/v1?credential=***&Credentials=***",
    );
  });

  it("splits parameters at `;` too, keeping the separator sent", () => {
    expect(subjectOf("https://h/v1?a=1;token=t&b=2")).toBe("GET https://h/v1?a=1;token=***&b=2");
  });

  it("hides a credential's value up to the next `&`, whatever it holds", () => {
    expect(subjectOf("https://h/v1?password=p;ss?w&x=1")).toBe("GET https://h/v1?password=***&x=1");
    expect(subjectOf("https://h/v1?token=;s&x=1")).toBe("GET https://h/v1?token=***&x=1");
  });

  it("reads the query of a URL carried in a value", () => {
    expect(subjectOf("https://h/login?next=/cb?token=t&page=2")).toBe(
      "GET https://h/login?next=/cb?token=***&page=2",
    );
  });

  it("does not match a name that only contains one it knows", () => {
    expect(subjectOf("https://h/v1?tokenizer=x&keys=y")).toBe(
      "GET https://h/v1?tokenizer=x&keys=y",
    );
  });

  it("leaves a parameter nobody credentialed alone", () => {
    // A refused request has to keep saying what it tried to send, and an
    // exfiltration payload is named whatever its author chose.
    expect(subjectOf("https://h/?d=BASE64PAYLOAD&page=2")).toBe(
      "GET https://h/?d=BASE64PAYLOAD&page=2",
    );
  });

  it("leaves an empty value empty rather than claiming a secret", () => {
    expect(subjectOf("https://h/v1?token=&page=2")).toBe("GET https://h/v1?token=&page=2");
  });

  it("leaves a URL with no query of its own alone", () => {
    expect(subjectOf("https://h/token/key")).toBe("GET https://h/token/key");
  });

  it("redacts the query of a URL that also carries a fragment", () => {
    expect(subjectOf("https://h/x?token=secret#frag")).toBe("GET https://h/x?token=***#frag");
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
