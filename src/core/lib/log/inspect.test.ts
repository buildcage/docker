import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { scanInspectLog, scanInspectDnsLog, hasProxyStarted } from "./inspect.ts";
import type { TrafficEvent } from "./traffic-event.ts";

// Lines exactly as the generated configuration emits them. The timestamp is
// milliseconds since the epoch (HAProxy's date(0,ms)).
const ALLOWED =
  "buildcage 1787471975123 https GET 200 708 ts=-- reason=- dst=104.16.1.34:443 https://registry.npmjs.org/pkg";
const REFUSED =
  "buildcage 1787471976000 https POST 403 0 ts=PR reason=- dst=1.2.3.4:443 https://evil.example.com/exfil?d=SECRET";
const PLAIN =
  "buildcage 1787471977000 http POST 201 12 ts=-- reason=- dst=10.0.0.5:8080 http://a.example.com:8080/x";
const TLS_PASS =
  "buildcage 1787471978000 pass tls 3421 ts=-- reason=- dst=10.200.0.100:5432 sni=db.example.com";
const TCP_PASS = "buildcage 1787471979000 pass tcp 900 ts=-- reason=- dst=10.0.0.5:5432 sni=-";

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
      "buildcage 1 https GET 403 120 ts=-- reason=- dst=1.1.1.1:443 https://reg.example.com/pkg",
      "buildcage 2 https GET 503 90 ts=-- reason=- dst=1.1.1.1:443 https://reg.example.com/pkg",
    ];
    expect((await parse(relayed)).some((e) => e.action === "block")).toBe(false);
  });

  it("takes the reason the config wrote, whatever status the line carried", async () => {
    const lines = [
      "buildcage 1 https GET 502 0 ts=PR-- reason=dns-failed dst=0.0.0.0:443 https://a.com/",
      "buildcage 2 https GET 403 0 ts=PR-- reason=internal-address dst=10.0.0.1:443 https://c.com/",
    ];
    expect((await parse(lines)).map((e) => e.reason)).toStrictEqual([
      "dns-failed",
      "internal-address",
    ]);
  });

  it("names a refusal the config left unnamed from the termination phase", async () => {
    const lines = [
      "buildcage 1 https POST 403 0 ts=PR-- reason=- dst=1.1.1.1:443 https://b.com/",
      "buildcage 2 https GET 503 0 ts=SC-- reason=- dst=1.1.1.1:443 https://c.com/",
      "buildcage 3 https GET 502 0 ts=SH-- reason=- dst=1.1.1.1:443 https://d.com/",
      "buildcage 4 https GET 502 0 ts=PH-- reason=- dst=1.1.1.1:443 https://e.com/",
      "buildcage 5 https GET 200 56 ts=SD-- reason=- dst=1.1.1.1:443 https://f.com/",
    ];
    expect((await parse(lines)).map((e) => e.reason)).toStrictEqual([
      "not-allowed",
      "origin-unreachable",
      "origin-no-response",
      "origin-no-response",
      "origin-aborted",
    ]);
  });

  it("counts an origin that timed out as a refusal, but not one that answered late", async () => {
    // haproxy writes the 503 and the 504 itself here, exactly as it does for
    // `SC`; whether the origin refused the connection or simply went quiet is
    // all that separates the two. `cD` is the build hanging up on a response
    // it was already receiving, which the origin did send.
    const lines = [
      "buildcage 1 https GET 503 0 ts=sC reason=- dst=1.1.1.1:443 https://a.com/",
      "buildcage 2 https GET 504 0 ts=sH reason=- dst=1.1.1.1:443 https://b.com/",
      "buildcage 3 https GET 200 56 ts=cD reason=- dst=1.1.1.1:443 https://c.com/",
    ];
    const events = await parse(lines);
    expect(events.map((e) => e.reason)).toStrictEqual([
      "origin-unreachable",
      "origin-no-response",
      undefined,
    ]);
    expect(events.map((e) => e.status)).toStrictEqual([undefined, undefined, 200]);
  });

  it("keeps the generic reason for a termination state it does not know", async () => {
    const lines = ["buildcage 1 https GET 403 0 ts=P reason=- dst=1.1.1.1:443 https://a.com/"];
    expect((await parse(lines))[0].reason).toBe("not-allowed");
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

  it("names a passthrough refusal the same way, having no status at all", async () => {
    const lines = [
      "buildcage 1 pass tcp 0 ts=PR reason=dns-failed dst=10.0.0.5:5432 sni=db.example.com",
      "buildcage 2 pass tcp 0 ts=PR reason=internal-address dst=10.0.0.5:5432 sni=db.example.com",
      "buildcage 3 pass tcp 0 ts=PR reason=- dst=10.0.0.5:5432 sni=-",
      "buildcage 4 pass tcp 0 ts=SC reason=- dst=10.0.0.5:5432 sni=-",
      "buildcage 5 pass tcp 0 ts=sC reason=- dst=10.0.0.5:5432 sni=-",
      "buildcage 6 pass tcp 0 ts=SD reason=- dst=10.0.0.5:5432 sni=-",
    ];
    expect((await parse(lines)).map((e) => e.reason)).toStrictEqual([
      "dns-failed",
      "internal-address",
      "not-allowed",
      "origin-unreachable",
      "origin-unreachable",
      "origin-aborted",
    ]);
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

  it("reads a request line whose URL runs to thousands of bytes", async () => {
    // The log line is sized to hold the longest request haproxy accepts.
    const url = `https://example.com/x?token=${"a".repeat(15000)}`;
    const [e] = await parse([`buildcage 1 https GET 403 0 ts=PR reason=- dst=1.1.1.1:443 ${url}`]);
    expect(e.url).toBe(url);
    expect(e.action).toBe("block");
  });

  it("counts a line that opens as ours but cannot be read", async () => {
    // What a half-written write leaves: the next line joined onto what got
    // through, still opening with our own prefix.
    const { events, unparsed } = await scanInspectLog([ALLOWED, ALLOWED.slice(0, 60) + REFUSED]);
    expect(events.length).toBe(1);
    expect(unparsed).toBe(1);
  });

  it("counts neither haproxy's own output nor the startup marker", async () => {
    const lines = [
      "[NOTICE] (1) : haproxy version is 3.4.3",
      "buildcage haproxy starting 1787471970000",
      // The marker without its stamp, if qjs failed to print one.
      "buildcage haproxy starting",
      ALLOWED,
    ];
    expect((await scanInspectLog(lines)).unparsed).toBe(0);
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
  const startMarker = "2026-08-23 16:44:58.000000000  buildcage coredns starting";
  const lines = [
    startMarker,
    "2026-08-23 16:45:00.550304964  [INFO] buildcage dns allowed name=registry.npmjs.org.",
    "2026-08-23 16:45:00.551089047  [INFO] buildcage dns allowed name=registry.npmjs.org.",
    "2026-08-23 16:45:01.100000000  [INFO] buildcage dns denied name=evil.example.com.",
  ];

  it("reports each name once, at the time it was first asked for", async () => {
    const { events } = await scanInspectDnsLog(lines);
    expect(events.length).toBe(2);
    // Millisecond precision, truncated from the source line's nanoseconds,
    // not floored away to the whole second.
    expect(events[0].time).toBe(Date.parse("2026-08-23T16:45:00.550Z") / 1000);
  });

  it("strips the trailing dot a query carries", async () => {
    const { events } = await scanInspectDnsLog(lines);
    expect(events.some((e) => e.host === "registry.npmjs.org")).toBe(true);
  });

  it("separates a name the resolver refused from one it answered", async () => {
    const { events } = await scanInspectDnsLog(lines);
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
    expect((await scanInspectDnsLog(mixed)).events[0].action).toBe("allow");
  });

  it("ignores coredns' own output", async () => {
    const noise = ["2026-08-23 16:45:00.000000000  [INFO] CoreDNS-1.14.7", "[INFO] linux/arm64"];
    expect((await scanInspectDnsLog(noise)).events.length).toBe(0);
  });

  it("headIntact is true when the log opens with the startup marker", async () => {
    expect((await scanInspectDnsLog(lines)).headIntact).toBe(true);
  });

  it("headIntact is false when the log opens mid-traffic", async () => {
    expect((await scanInspectDnsLog(lines.slice(1))).headIntact).toBe(false);
  });

  it("headIntact is false for an empty log", async () => {
    expect((await scanInspectDnsLog([])).headIntact).toBe(false);
  });

  it("reads a discovery lookup as its own kind of event, neither allowed nor blocked", async () => {
    const { events } = await scanInspectDnsLog([
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns discovery name=_http._tcp.deb.debian.org. type=SRV",
    ]);
    expect(events.length).toBe(1);
    expect(events[0].action).toBe("discovery");
    expect(events[0].host).toBe("_http._tcp.deb.debian.org");
    expect(events[0].queryType).toBe("SRV");
    // No rule refused it, so there is no reason to give for one.
    expect(events[0].reason === undefined).toBe(true);
  });

  it("keeps a discovery lookup apart per type, the type being the point of it", async () => {
    // `mongodb+srv://` asks both, and only the TXT explains a connection that
    // never got its options.
    const { events } = await scanInspectDnsLog([
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns discovery name=_mongodb._tcp.c0.example.net. type=SRV",
      "2026-08-23 16:45:00.100000000  [INFO] buildcage dns discovery name=_mongodb._tcp.c0.example.net. type=SRV",
      "2026-08-23 16:45:00.200000000  [INFO] buildcage dns discovery name=_mongodb._tcp.c0.example.net. type=TXT",
    ]);
    expect(events.length).toBe(2);
    expect(events.map((e) => e.queryType).join(",")).toBe("SRV,TXT");
  });

  it("reads a refused service name as a refusal that names its own remedy", async () => {
    // Which names are service names is decided in the Corefile; this only
    // reads the verb it logged them under.
    const { events } = await scanInspectDnsLog([
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns service-denied name=_mongodb._tcp.c0.example.net. type=SRV",
    ]);
    expect(events.length).toBe(1);
    expect(events[0].action).toBe("block");
    expect(events[0].reason).toBe("dns-service-not-allowed");
    expect(events[0].queryType).toBe("SRV");
  });

  it("reports a refused service name once, whatever it was asked as", async () => {
    // getaddrinfo(AF_UNSPEC) asks A and AAAA for one name; the report is about
    // the name, so it keeps the type it was first asked as.
    const { events } = await scanInspectDnsLog([
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns service-denied name=_a._tcp.x.example. type=A",
      "2026-08-23 16:45:00.100000000  [INFO] buildcage dns service-denied name=_a._tcp.x.example. type=AAAA",
    ]);
    expect(events.length).toBe(1);
    expect(events[0].queryType).toBe("A");
  });

  it("calls a discovery lookup the same thing in audit mode", async () => {
    // No rule decided it either way, so there is nothing for audit to soften.
    const { events } = await scanInspectDnsLog(
      [
        "2026-08-23 16:45:00.000000000  [INFO] buildcage dns discovery name=_a._tcp.x.example. type=SRV",
      ],
      true,
    );
    expect(events[0].action).toBe("discovery");
  });

  it("headIntact is false when coredns' own output stands where the marker should be", async () => {
    // The errors plugin writes mid-run, so a flood can leave one of these first.
    const noise = [
      "2026-08-23 16:45:00.000000000  [ERROR] plugin/errors: 2 evil.example.com. A: read udp timeout",
      "2026-08-23 16:45:01.000000000  [INFO] buildcage dns denied name=evil.example.com.",
    ];
    expect((await scanInspectDnsLog(noise)).headIntact).toBe(false);
  });
});

reportResults();
