import { describe, it, expect } from "vitest";

import { scanInspectLog, scanInspectDnsLog, hasProxyStarted } from "./inspect.ts";
import type { TrafficEvent } from "./traffic-event.ts";

// Lines exactly as the generated configuration emits them. The timestamp is
// milliseconds since the epoch (HAProxy's date(0,ms)).
const ALLOWED =
  "buildcage 1787471975123 https GET 200 708 ts=-- reason=- tlserr=- dst=104.16.1.34:443 host=registry.npmjs.org /pkg";
const REFUSED =
  "buildcage 1787471976000 https POST 403 0 ts=PR reason=- tlserr=- dst=1.2.3.4:443 host=evil.example.com /exfil?d=SECRET";
const PLAIN =
  "buildcage 1787471977000 http POST 201 12 ts=-- reason=- tlserr=- dst=10.0.0.5:8080 host=a.example.com:8080 /x";
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

  it("writes the host as the rules judged it: lowercased, one trailing dot dropped", async () => {
    const line = (host: string) =>
      `buildcage 1 https GET 403 0 ts=PR reason=- tlserr=- dst=1.1.1.1:443 host=${host} /x`;
    const [plain, withPort, twoDots] = await parse([
      line("Blocked.COM."),
      line("Blocked.Com.:8443"),
      line("a.com.."),
    ]);
    expect(plain.host).toBe("blocked.com");
    expect(plain.url).toBe("https://blocked.com/x");
    expect(withPort.url).toBe("https://blocked.com:8443/x");
    // The rules drop only one, so a rule for a.com does not match it either.
    expect(twoDots.host).toBe("a.com.");
  });

  it("lowercases only ASCII, as HAProxy does before matching", async () => {
    // U+212A KELVIN SIGN lowercases to "k" in JavaScript, not in HAProxy.
    const [e] = await parse([
      "buildcage 1 https GET 403 0 ts=PR reason=- tlserr=- dst=1.1.1.1:443 host=blo\u212Aed.com /x",
    ]);
    expect(e.host).toBe("blo\u212Aed.com");
  });

  it("spells a passthrough's SNI the same way", async () => {
    const [e] = await parse([
      "buildcage 1 pass tls 10 ts=-- reason=- dst=10.0.0.9:5432 sni=DB.Example.com",
    ]);
    expect(e.host).toBe("db.example.com");
  });

  it("keeps a passthrough SNI's trailing dot", async () => {
    const [e] = await parse([
      "buildcage 1 pass tls 10 ts=-- reason=- dst=10.0.0.9:5432 sni=db.example.com.",
    ]);
    expect(e.host).toBe("db.example.com.");
  });

  it("names a request that never came by its SNI, spelled the same way", async () => {
    const [e] = await parse([
      "buildcage 1 https <BADREQ> 400 0 ts=CR reason=- tlserr=- dst=198.19.255.1:443 sni=API.Example.com host=- -",
    ]);
    expect(e.host).toBe("api.example.com");
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
      "buildcage 1 https GET 403 120 ts=-- reason=- tlserr=- dst=1.1.1.1:443 host=reg.example.com /pkg",
      "buildcage 2 https GET 503 90 ts=-- reason=- tlserr=- dst=1.1.1.1:443 host=reg.example.com /pkg",
    ];
    expect((await parse(relayed)).some((e) => e.action === "block")).toBe(false);
  });

  it("takes the reason the config wrote, whatever status the line carried", async () => {
    const lines = [
      "buildcage 1 https GET 502 0 ts=PR-- reason=dns-failed tlserr=- dst=0.0.0.0:443 host=a.com /",
      "buildcage 2 https GET 403 0 ts=PR-- reason=internal-address tlserr=- dst=10.0.0.1:443 host=c.com /",
    ];
    expect((await parse(lines)).map((e) => e.reason)).toStrictEqual([
      "dns-failed",
      "internal-address",
    ]);
  });

  // The cause comes first: `P` is this proxy, so `PH` is not the origin's
  // doing. Phase `C` then splits on tlserr; see reasonFor.
  it("names a refusal the config left unnamed from the cause, the phase and tlserr", async () => {
    const lines = [
      "buildcage 1 https POST 403 0 ts=PR-- reason=- tlserr=- dst=1.1.1.1:443 host=b.com /",
      "buildcage 2 https GET 503 0 ts=SC-- reason=- tlserr=- dst=1.1.1.1:443 host=c.com /",
      "buildcage 3 https GET 503 0 ts=SC-- reason=- tlserr=167772294 dst=1.1.1.1:443 host=d.com /",
      "buildcage 4 https GET 502 0 ts=SH-- reason=- tlserr=- dst=1.1.1.1:443 host=e.com /",
      "buildcage 5 https GET 502 0 ts=PH-- reason=- tlserr=- dst=1.1.1.1:443 host=f.com /",
      "buildcage 6 https GET 200 56 ts=SD-- reason=- tlserr=- dst=1.1.1.1:443 host=g.com /",
    ];
    const events = await parse(lines);
    expect(events.map((e) => e.reason)).toStrictEqual([
      "not-allowed",
      "origin-connect-failed",
      "origin-untrusted",
      "origin-no-response",
      "not-allowed",
      "origin-aborted",
    ]);
    // Only what this proxy itself refused stays in the blocked table, and a
    // connection it never completed counts: it never authenticated that origin.
    expect(events.map((e) => e.action)).toStrictEqual([
      "block",
      "block",
      "block",
      "failed",
      "block",
      "failed",
    ]);
  });

  it("counts an origin that timed out as a refusal, unless it had already answered", async () => {
    // haproxy itself writes the 503 and the 504 in `sC` and `sH`, exactly as it
    // does for `SC` and `SH`; whether the origin refused the connection or
    // simply went quiet is all that separates the two.
    const lines = [
      "buildcage 1 https GET 503 0 ts=sC reason=- tlserr=- dst=1.1.1.1:443 host=a.com /",
      "buildcage 2 https GET 504 0 ts=sH reason=- tlserr=- dst=1.1.1.1:443 host=b.com /",
    ];
    const events = await parse(lines);
    expect(events.map((e) => e.reason)).toStrictEqual([
      "origin-connect-failed",
      "origin-no-response",
    ]);
    expect(events.every((e) => e.status === undefined)).toBe(true);
  });

  it("leaves a timeout that cut an answered transfer short with the origin's own result", async () => {
    const lines = [
      "buildcage 1 https GET 200 61 ts=sD reason=- tlserr=- dst=1.1.1.1:443 host=a.com /",
      "buildcage 2 https GET 200 56 ts=cD reason=- tlserr=- dst=1.1.1.1:443 host=b.com /",
      "buildcage 3 pass tls 4096 ts=sD reason=- dst=10.0.0.5:5432 sni=db.example.com",
    ];
    const events = await parse(lines);
    expect(events.every((e) => e.action === "allow")).toBe(true);
    expect(events.map((e) => e.bytes)).toStrictEqual([61, 56, 4096]);
  });

  it("keeps the generic reason for a termination state it does not know", async () => {
    const lines = [
      "buildcage 1 https GET 403 0 ts=P reason=- tlserr=- dst=1.1.1.1:443 host=a.com /",
    ];
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
    expect(e.status === undefined).toBe(true);
    expect(e.url === undefined).toBe(true);
  });

  it("names a passthrough refusal the same way, though it has no status at all", async () => {
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
    const [e] = await parse([TCP_PASS]);
    expect(e.protocol).toBe("tcp");
    expect(e.host).toBe("10.0.0.5");
    expect(e.port).toBe(5432);
  });

  it("marks everything as audited when nothing was being enforced", async () => {
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

  it("reads a request line whose target runs to thousands of bytes", async () => {
    const target = `/x?token=${"a".repeat(15000)}`;
    const [e] = await parse([
      `buildcage 1 https GET 403 0 ts=PR reason=- tlserr=- dst=1.1.1.1:443 host=example.com ${target}`,
    ]);
    expect(e.url).toBe(`https://example.com${target}`);
    expect(e.action).toBe("block");
  });

  it("counts a line that opens as ours but cannot be read", async () => {
    // What a half-written write leaves: the next line joined onto what got
    // through, still opening with our own prefix.
    const { events, unparsed } = await scanInspectLog([ALLOWED, ALLOWED.slice(0, 60) + REFUSED]);
    expect(events.length).toBe(1);
    expect(unparsed).toBe(1);
  });

  it("counts a line cut where the SNI ends, rather than reading the SNI as the host", async () => {
    // The one cut that leaves something shaped like a whole line: every field
    // up to the SNI is there, and only the host and the target are gone.
    const { events, unparsed } = await scanInspectLog([
      "buildcage 1 https GET 200 708 ts=-- reason=- tlserr=- dst=1.1.1.1:443 sni=example.com",
    ]);
    expect(events.length).toBe(0);
    expect(unparsed).toBe(1);
  });

  it("counts a line cut where the host ends, rather than reading it without a target", async () => {
    const { events, unparsed } = await scanInspectLog([
      "buildcage 1 https GET 200 708 ts=-- reason=- tlserr=- dst=1.1.1.1:443 sni=a.com host=a.com",
    ]);
    expect(events.length).toBe(0);
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

describe("a connection sent straight to an address that ended before its request", () => {
  // No ip rule passed it, and no SNI went with it. The ERESET is a client that
  // would not trust the certificate.
  const closed = (ts: string, fcerr = "ERESET", dst = "203.0.113.9:8443") =>
    `buildcage 1 https <BADREQ> 0 0 ts=${ts} reason=- tlserr=- dst=${dst} fcerr=${fcerr} sni=- host=- -`;
  const plainClose =
    "buildcage 2 http <BADREQ> 408 0 ts=cR reason=- tlserr=- dst=10.0.0.5:8080 host=- -";

  it("is refused as an address no ip rule covers, however it ended", async () => {
    const events = await parse([
      closed("CR"),
      closed("PR", "SSL_HANDSHAKE"),
      closed("cR"),
      closed("RR"),
      plainClose,
    ]);
    for (const e of events) {
      expect(`${e.action} ${e.protocol} ${e.reason}`).toBe("block tcp ip-not-allowed");
    }
    expect(events[0].host).toBe("203.0.113.9");
    expect(events[0].destination).toBe("203.0.113.9:8443");
  });

  it("is refused in audit mode too, where nothing would have let it through", async () => {
    const [e] = await parse([closed("CR")], true);
    expect(e.action).toBe("block");
  });

  it("stays a keepalive close where the address had a request read", async () => {
    // A rule may name an address for plain http; its pool closes the same way.
    const served =
      "buildcage 1 http GET 200 5 ts=-- reason=- tlserr=- dst=10.0.0.5:8080 host=10.0.0.5:8080 /x";
    const [, close] = await parse([served, plainClose]);
    expect(close.action).toBe("incomplete");
    expect(close.reason).toBe("client-timeout");
  });

  it("leaves one sent to the proxy's own address or named by its SNI undecided", async () => {
    const events = await parse([
      closed("CR", "ERESET", "198.19.255.1:443"),
      closed("CR").replace("sni=-", "sni=untrusted-ca.example.com"),
    ]);
    expect(events.map((e) => e.action)).toStrictEqual(["incomplete", "incomplete"]);
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

describe("a resolver line whose name CoreDNS escaped", () => {
  const at = (rest: string) => `2026-08-23 16:45:00.000000000  [INFO] buildcage dns ${rest}`;

  it("reads a refused name with an escaped space as written", async () => {
    const { events, unparsed } = await scanInspectDnsLog([
      at(String.raw`denied name=secret\ data.evil.com.`),
    ]);
    expect(unparsed).toBe(0);
    expect(events.length).toBe(1);
    expect(events[0].host).toBe(String.raw`secret\ data.evil.com`);
    expect(events[0].action).toBe("block");
  });

  it("dedupes an escaped name like any other", async () => {
    const { events } = await scanInspectDnsLog([
      at(String.raw`allowed name=a\ b.example.com.`),
      at(String.raw`denied name=a\ b.example.com.`),
    ]);
    expect(events.length).toBe(1);
    expect(events[0].action).toBe("allow");
  });

  it("splits the type from an escaped discovery or service name", async () => {
    // The escape keeps a planted ` type=` inside the name.
    const { events, unparsed } = await scanInspectDnsLog([
      at(String.raw`discovery name=_a._tcp.x\ type=A.com. type=SRV`),
      at(String.raw`service-denied name=_b._tcp.y\ z.com. type=TXT`),
    ]);
    expect(unparsed).toBe(0);
    expect(events.map((e) => [e.host, e.queryType])).toStrictEqual([
      [String.raw`_a._tcp.x\ type=A.com`, "SRV"],
      [String.raw`_b._tcp.y\ z.com`, "TXT"],
    ]);
  });

  it("keeps every other escape as written", async () => {
    const names = [String.raw`q\"x.com`, String.raw`a\.b.com`, String.raw`c\010d.com`, "e\\\\"];
    const { events } = await scanInspectDnsLog(names.map((n) => at(`denied name=${n}.`)));
    expect(events.map((e) => e.host)).toStrictEqual(names);
  });

  it("counts a decision line it cannot read", async () => {
    // CoreDNS writes neither a bare space nor a lone trailing backslash.
    const { events, unparsed } = await scanInspectDnsLog([
      at("denied name=bad com."),
      at("service-denied name=_a._tcp.x com. type=SRV"),
      at("denied name=bad\\"),
    ]);
    expect(events.length).toBe(0);
    expect(unparsed).toBe(3);
  });

  it("does not count a reverse lookup or coredns' own output", async () => {
    const { unparsed } = await scanInspectDnsLog([
      "2026-08-23 16:44:58.000000000  buildcage coredns starting",
      at("reverse name=1.255.19.198.in-addr.arpa."),
      at(String.raw`reverse name=a\ b.in-addr.arpa.`),
      "2026-08-23 16:45:00.000000000  [INFO] CoreDNS-1.14.7",
    ]);
    expect(unparsed).toBe(0);
  });
});

describe("lines and stamps the inspect logs can carry", () => {
  it("skips a blank line in the proxy log", async () => {
    expect((await scanInspectLog(["", "   "])).events.length).toBe(0);
  });

  it("skips a blank line in the resolver log", async () => {
    expect((await scanInspectDnsLog(["", "   "])).events.length).toBe(0);
  });
});

describe("a request whose target is not a path", () => {
  // `OPTIONS *` (RFC 9112 §3.2.4) and a CONNECT's authority are both legal
  // request-targets that leave haproxy's pathq empty, printed as `-`. Read as
  // the tail of a URL they would name the host `registry.npmjs.org-`, which
  // nothing resolves and no rule can be written for.
  const ASTERISK =
    "buildcage 1787471975123 https OPTIONS 403 0 ts=PR reason=- tlserr=- dst=1.2.3.4:443 sni=registry.npmjs.org host=registry.npmjs.org -";

  it("names the host the request actually carried", async () => {
    const [e] = await parse([ASTERISK]);
    expect(e.host).toBe("registry.npmjs.org");
    expect(e.method).toBe("OPTIONS");
    expect(e.action).toBe("block");
  });

  it("reports no URL rather than inventing one", async () => {
    // A URL here would reach the generated restrict example as an origin and
    // a path, proposing a rule that cannot match what was sent.
    expect((await parse([ASTERISK]))[0].url === undefined).toBe(true);
  });

  it("keeps the URL of a request that named a path but no host", async () => {
    // The two are separate cases: a request with no Host still has a path to
    // show, and the stage names that refusal for itself. Only the target
    // being no path leaves nothing to build a URL around. The URL is built
    // around the host the row carries, with the port only where it is not the
    // scheme's own.
    const line = (dst: string) =>
      `buildcage 1787471975123 http GET 400 0 ts=PR reason=missing-host-header tlserr=- dst=${dst} host=- /x`;
    const [byAddress, onOtherPort, byProxy] = await parse([
      line("1.2.3.4:80"),
      line("1.2.3.4:8080"),
      line("198.19.255.1:80"),
    ]);
    expect(byAddress.url).toBe("http://1.2.3.4/x");
    expect(onOtherPort.url).toBe("http://1.2.3.4:8080/x");
    expect(byProxy.url).toBe("http://(unknown)/x");
    expect(byProxy.host).toBe("(unknown)");
  });
});

describe("a resolver line whose stamp is not a date", () => {
  // s6-log writes the stamp, and the line shape only requires two fields
  // before the marker. An unreadable one is timed at 0 rather than NaN, which
  // would render as an empty cell.
  it("times the event at 0", async () => {
    const { events } = await scanInspectDnsLog([
      "xx yy  buildcage dns allowed name=a.example.com.",
    ]);
    for (const event of events) expect(event.time).toBe(0);
  });
});
