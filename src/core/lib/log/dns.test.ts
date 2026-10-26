import { describe, it, expect } from "vitest";

import { scanDnsLog } from "./dns.ts";

describe("scanDnsLog", () => {
  const startMarker = "2026-08-23 16:44:58.000000000  buildcage coredns starting";
  const lines = [
    startMarker,
    "2026-08-23 16:45:00.550304964  [INFO] buildcage dns allowed name=registry.npmjs.org.",
    "2026-08-23 16:45:00.551089047  [INFO] buildcage dns allowed name=registry.npmjs.org.",
    "2026-08-23 16:45:01.100000000  [INFO] buildcage dns denied name=evil.example.com.",
  ];

  it("reports each name once, at the time it was first asked for", async () => {
    const { events } = await scanDnsLog(lines);
    expect(events.length).toBe(2);
    // Millisecond precision, truncated from the source line's nanoseconds,
    // not floored away to the whole second.
    expect(events[0].time).toBe(Date.parse("2026-08-23T16:45:00.550Z") / 1000);
  });

  it("strips the trailing dot a query carries", async () => {
    const { events } = await scanDnsLog(lines);
    expect(events.some((e) => e.host === "registry.npmjs.org")).toBe(true);
  });

  it("separates a name the resolver blocked from one it answered", async () => {
    const { events } = await scanDnsLog(lines);
    const denied = events.find((e) => e.host === "evil.example.com");
    expect(denied?.action).toBe("block");
    expect(denied?.reason).toBe("dns-not-allowed");
    // Nothing was connected to, so there is no port a rule could name.
    expect(denied?.port === undefined).toBe(true);
  });

  it("does not let a blocked AAAA mask an A that resolved", async () => {
    const mixed = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns allowed name=a.example.com.",
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=a.example.com.",
    ];
    expect((await scanDnsLog(mixed)).events[0].action).toBe("allow");
  });

  it("ignores coredns' own output", async () => {
    const noise = ["2026-08-23 16:45:00.000000000  [INFO] CoreDNS-1.14.7", "[INFO] linux/arm64"];
    expect((await scanDnsLog(noise)).events.length).toBe(0);
  });

  it("headIntact is true when the log opens with the startup marker", async () => {
    expect((await scanDnsLog(lines)).headIntact).toBe(true);
  });

  it("headIntact is false when the log opens mid-traffic", async () => {
    expect((await scanDnsLog(lines.slice(1))).headIntact).toBe(false);
  });

  it("headIntact is false for an empty log", async () => {
    expect((await scanDnsLog([])).headIntact).toBe(false);
  });

  it("reads a discovery lookup as its own kind of event, neither allowed nor blocked", async () => {
    const { events } = await scanDnsLog([
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns discovery name=_http._tcp.deb.debian.org. type=SRV",
    ]);
    expect(events.length).toBe(1);
    expect(events[0].action).toBe("discovery");
    expect(events[0].host).toBe("_http._tcp.deb.debian.org");
    expect(events[0].queryType).toBe("SRV");
    // No rule blocked it, so there is no reason to give for one.
    expect(events[0].reason === undefined).toBe(true);
  });

  it("keeps a discovery lookup apart per type, the type being the point of it", async () => {
    // `mongodb+srv://` asks both, and only the TXT explains a connection that
    // never got its options.
    const { events } = await scanDnsLog([
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns discovery name=_mongodb._tcp.c0.example.net. type=SRV",
      "2026-08-23 16:45:00.100000000  [INFO] buildcage dns discovery name=_mongodb._tcp.c0.example.net. type=SRV",
      "2026-08-23 16:45:00.200000000  [INFO] buildcage dns discovery name=_mongodb._tcp.c0.example.net. type=TXT",
    ]);
    expect(events.length).toBe(2);
    expect(events.map((e) => e.queryType).join(",")).toBe("SRV,TXT");
  });

  it("reads a blocked service name as a block that names its own remedy", async () => {
    // Which names are service names is decided in the Corefile; this only
    // reads the verb it logged them under.
    const { events } = await scanDnsLog([
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns service-denied name=_mongodb._tcp.c0.example.net. type=SRV",
    ]);
    expect(events.length).toBe(1);
    expect(events[0].action).toBe("block");
    expect(events[0].reason).toBe("dns-service-not-allowed");
    expect(events[0].queryType).toBe("SRV");
  });

  it("reports a blocked service name once, whatever it was asked as", async () => {
    // getaddrinfo(AF_UNSPEC) asks A and AAAA for one name; the report is about
    // the name, so it keeps the type it was first asked as.
    const { events } = await scanDnsLog([
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns service-denied name=_a._tcp.x.example. type=A",
      "2026-08-23 16:45:00.100000000  [INFO] buildcage dns service-denied name=_a._tcp.x.example. type=AAAA",
    ]);
    expect(events.length).toBe(1);
    expect(events[0].queryType).toBe("A");
  });

  it("calls a discovery lookup the same thing in audit mode", async () => {
    // No rule decided it either way, so there is nothing for audit to soften.
    const { events } = await scanDnsLog(
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
    expect((await scanDnsLog(noise)).headIntact).toBe(false);
  });
});

describe("a resolver line whose name CoreDNS escaped", () => {
  const at = (rest: string) => `2026-08-23 16:45:00.000000000  [INFO] buildcage dns ${rest}`;

  it("reads a blocked name with an escaped space as written", async () => {
    const { events, unparsed } = await scanDnsLog([
      at(String.raw`denied name=secret\ data.evil.com.`),
    ]);
    expect(unparsed).toBe(0);
    expect(events.length).toBe(1);
    expect(events[0].host).toBe(String.raw`secret\ data.evil.com`);
    expect(events[0].action).toBe("block");
  });

  it("dedupes an escaped name like any other", async () => {
    const { events } = await scanDnsLog([
      at(String.raw`allowed name=a\ b.example.com.`),
      at(String.raw`denied name=a\ b.example.com.`),
    ]);
    expect(events.length).toBe(1);
    expect(events[0].action).toBe("allow");
  });

  it("splits the type from an escaped discovery or service name", async () => {
    // The escape keeps a planted ` type=` inside the name.
    const { events, unparsed } = await scanDnsLog([
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
    const { events } = await scanDnsLog(names.map((n) => at(`denied name=${n}.`)));
    expect(events.map((e) => e.host)).toStrictEqual(names);
  });

  it("counts a decision line it cannot read", async () => {
    // CoreDNS writes neither a bare space nor a lone trailing backslash.
    const { events, unparsed } = await scanDnsLog([
      at("denied name=bad com."),
      at("service-denied name=_a._tcp.x com. type=SRV"),
      at("denied name=bad\\"),
    ]);
    expect(events.length).toBe(0);
    expect(unparsed).toBe(3);
  });

  it("does not count a reverse lookup or coredns' own output", async () => {
    const { unparsed } = await scanDnsLog([
      "2026-08-23 16:44:58.000000000  buildcage coredns starting",
      at("reverse name=1.255.19.198.in-addr.arpa."),
      at(String.raw`reverse name=a\ b.in-addr.arpa.`),
      "2026-08-23 16:45:00.000000000  [INFO] CoreDNS-1.14.7",
    ]);
    expect(unparsed).toBe(0);
  });
});

describe("lines the resolver log can carry", () => {
  it("skips a blank line", async () => {
    expect((await scanDnsLog(["", "   "])).events.length).toBe(0);
  });
});

describe("a resolver line whose stamp is not a date", () => {
  // s6-log writes the stamp, and the line shape only requires two fields
  // before the marker. An unreadable one is timed at 0 rather than NaN, which
  // would render as an empty cell.
  it("times the event at 0", async () => {
    const { events } = await scanDnsLog(["xx yy  buildcage dns allowed name=a.example.com."]);
    for (const event of events) expect(event.time).toBe(0);
  });
});
