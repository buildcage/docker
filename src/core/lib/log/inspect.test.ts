import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { scanInspectLog, scanInspectDnsLog, hasProxyStarted } from "./inspect.ts";
import type { TrafficEvent } from "./traffic-event.ts";

// Lines exactly as the generated configuration emits them. The timestamp is
// milliseconds since the epoch (HAProxy's date(0,ms)).
const ALLOWED =
  "buildcage 1787471975123 https GET https://registry.npmjs.org/pkg 200 708 ts=-- dst=104.16.1.34:443";
const REFUSED =
  "buildcage 1787471976000 https POST https://evil.example.com/exfil?d=SECRET 403 0 ts=PR dst=1.2.3.4:443";
const PLAIN =
  "buildcage 1787471977000 http POST http://a.example.com:8080/x 201 12 ts=-- dst=10.0.0.5:8080";
const TLS_PASS =
  "buildcage 1787471978000 pass tls sni=db.example.com 3421 ts=-- dst=10.200.0.100:5432";
const TCP_PASS = "buildcage 1787471979000 pass tcp sni=- 900 ts=-- dst=10.0.0.5:5432";

/** scanInspectLog accepts a plain array, so tests pass one and read events. */
async function parse(lines: string[], isAudit = false): Promise<TrafficEvent[]> {
  return (await scanInspectLog(lines, isAudit)).events;
}

describe("scanInspectLog", () => {
  it("reads every field a report needs from one request line", async () => {
    const [e] = await parse([ALLOWED]);
    expect(e.time).toBe(1787471975.123);
    expect(e.action).toBe("allow");
    expect(e.protocol).toBe("https");
    expect(e.host).toBe("registry.npmjs.org");
    expect(e.port).toBe(443);
    expect(e.method).toBe("GET");
    expect(e.url).toBe("https://registry.npmjs.org/pkg");
    expect(e.status).toBe(200);
    expect(e.bytes).toBe(708);
    expect(e.destination).toBe("104.16.1.34:443");
  });

  it("keeps the query string, where an exfiltration payload would be", async () => {
    expect((await parse([REFUSED]))[0].url).toBe("https://evil.example.com/exfil?d=SECRET");
  });

  it("names the reason instead of a status when it refused", async () => {
    const [e] = await parse([REFUSED]);
    expect(e.action).toBe("block");
    expect(e.reason).toBe("not-allowed");
    // Nothing answered, so reporting either would be inventing a result.
    expect(e.status === undefined).toBe(true);
    expect(e.bytes === undefined).toBe(true);
  });

  it("does not mistake an origin's own 403 or 503 for a refusal", async () => {
    // A registry answers 403 to an unauthenticated fetch and an origin under
    // load answers 503. Counting those would fail a build where nothing was
    // blocked, since fail_on_blocked defaults to true.
    const relayed = [
      "buildcage 1 https GET https://reg.example.com/pkg 403 120 ts=-- dst=1.1.1.1:443",
      "buildcage 2 https GET https://reg.example.com/pkg 503 90 ts=-- dst=1.1.1.1:443",
    ];
    expect((await parse(relayed)).some((e) => e.action === "block")).toBe(false);
  });

  it("tells the two kinds of refusal apart by their status", async () => {
    const lines = [
      "buildcage 1 https GET https://a.com/ 502 0 ts=PR dst=0.0.0.0:443",
      "buildcage 2 https GET https://b.com/ 503 0 ts=SC dst=1.1.1.1:443",
    ];
    const reasons = (await parse(lines)).map((e) => e.reason);
    expect(reasons[0]).toBe("dns-failed");
    expect(reasons[1]).toBe("origin-unreachable");
  });

  it("takes the port from the connection, not from the URL", async () => {
    const [e] = await parse([PLAIN]);
    expect(e.protocol).toBe("http");
    expect(e.host).toBe("a.example.com");
    expect(e.port).toBe(8080);
  });

  it("reads a tls passthrough, which has a name but no status", async () => {
    const [e] = await parse([TLS_PASS]);
    expect(e.protocol).toBe("tls");
    expect(e.host).toBe("db.example.com");
    expect(e.port).toBe(5432);
    expect(e.bytes).toBe(3421);
    // Never decrypted, so there is nothing to report a status for.
    expect(e.status === undefined).toBe(true);
    expect(e.url === undefined).toBe(true);
  });

  it("falls back to the address for a passthrough with no name", async () => {
    // An ip rule names an address and carries no SNI at all.
    const [e] = await parse([TCP_PASS]);
    expect(e.protocol).toBe("tcp");
    expect(e.host).toBe("10.0.0.5");
    expect(e.port).toBe(5432);
  });

  it("marks everything as audited when nothing was being enforced", async () => {
    // audit makes no allow decision, so calling it "allow" would claim one.
    expect((await parse([ALLOWED], true))[0].action).toBe("audit");
  });

  it("ignores haproxy's own output rather than failing on it", async () => {
    const lines = [
      "[NOTICE] (1) : haproxy version is 3.4.3",
      ALLOWED,
      "[WARNING] (1) : config : something",
    ];
    expect((await parse(lines)).length).toBe(1);
  });

  it("reads the startup marker's own millisecond epoch", async () => {
    const { startedAt } = await scanInspectLog(["buildcage haproxy starting 1787471970000"]);
    expect(startedAt).toBe(1787471970);
  });

  it("leaves startedAt undefined when the marker never showed up", async () => {
    const { startedAt } = await scanInspectLog([ALLOWED]);
    expect(startedAt === undefined).toBe(true);
  });

  it("keeps the first startup marker if the line somehow repeats", async () => {
    const lines = [
      "buildcage haproxy starting 1787471970000",
      "buildcage haproxy starting 1787471999000",
    ];
    const { startedAt } = await scanInspectLog(lines);
    expect(startedAt).toBe(1787471970);
  });
});

describe("hasProxyStarted", () => {
  it("tells a proxy that saw nothing from one that never ran", () => {
    expect(hasProxyStarted(["buildcage haproxy starting"])).toBe(true);
    expect(hasProxyStarted([ALLOWED])).toBe(false);
    expect(hasProxyStarted([])).toBe(false);
  });

  it("still matches now that the marker carries a timestamp", () => {
    expect(hasProxyStarted(["buildcage haproxy starting 1787471970000"])).toBe(true);
  });
});

describe("scanInspectDnsLog", () => {
  const lines = [
    "2026-08-23 16:45:00.550304964  [INFO] buildcage dns allowed name=registry.npmjs.org.",
    "2026-08-23 16:45:00.551089047  [INFO] buildcage dns allowed name=registry.npmjs.org.",
    "2026-08-23 16:45:01.100000000  [INFO] buildcage dns denied name=evil.example.com.",
  ];

  it("reports each name once, at the time it was first asked for", async () => {
    const events = await scanInspectDnsLog(lines);
    expect(events.length).toBe(2);
    // Millisecond precision, truncated from the source line's nanoseconds,
    // not floored away to the whole second.
    expect(events[0].time).toBe(Date.parse("2026-08-23T16:45:00.550Z") / 1000);
  });

  it("strips the trailing dot a query carries", async () => {
    const events = await scanInspectDnsLog(lines);
    expect(events.some((e) => e.host === "registry.npmjs.org")).toBe(true);
  });

  it("separates a name the resolver refused from one it answered", async () => {
    const events = await scanInspectDnsLog(lines);
    const denied = events.find((e) => e.host === "evil.example.com");
    expect(denied?.action).toBe("block");
    expect(denied?.reason).toBe("dns-not-allowed");
    // Nothing was connected to, so there is no port a rule could name.
    expect(denied?.port === undefined).toBe(true);
  });

  it("does not let a refused AAAA mask an A that resolved", async () => {
    const mixed = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns allowed name=a.example.com.",
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=a.example.com.",
    ];
    expect((await scanInspectDnsLog(mixed))[0].action).toBe("allow");
  });

  it("ignores coredns' own output", async () => {
    const noise = ["2026-08-23 16:45:00.000000000  [INFO] CoreDNS-1.14.7", "[INFO] linux/arm64"];
    expect((await scanInspectDnsLog(noise)).length).toBe(0);
  });
});

reportResults();
