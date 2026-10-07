import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

import { buildTrafficRecords, writeTrafficFile } from "./traffic-output.ts";

const t = 1787471975;
const EVENTS: TrafficEvent[] = [
  {
    time: t + 2,
    action: "block",
    protocol: "https",
    host: "evil.example.com",
    port: 443,
    method: "POST",
    url: "https://evil.example.com/x",
    reason: "not-allowed",
  },
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
    destination: "203.0.113.10",
  },
  {
    time: t + 1,
    action: "allow",
    protocol: "tls",
    host: "db.example.com",
    port: 5432,
    bytes: 3421,
  },
  {
    time: t + 3,
    action: "block",
    protocol: "dns",
    host: "secret.attacker.example",
    reason: "dns-not-allowed",
  },
  { time: t + 4, action: "allow", protocol: "dns", host: "a.example.com" },
  {
    time: t + 5,
    action: "discovery",
    protocol: "dns",
    host: "_http._tcp.deb.debian.org",
    queryType: "SRV",
  },
];

describe("buildTrafficRecords", () => {
  const records = buildTrafficRecords(EVENTS, t);

  it("carries a discovery lookup with the record type it asked for", () => {
    // The summary keeps these out of its tables, so the artifact is the only
    // place a machine reader finds them.
    const r = records[records.length - 1];
    expect(r.action).toBe("discovery");
    expect(r.protocol).toBe("dns");
    expect(r.queryType).toBe("SRV");
    expect(r.port === undefined).toBe(true);
  });

  it("carries the fields that apply to a request", () => {
    const r = records[0];
    expect(r.time).toBe("2026-08-23T07:59:35.000Z");
    expect(r.action).toBe("allow");
    expect(r.protocol).toBe("https");
    expect(r.host).toBe("a.example.com");
    expect(r.port).toBe(443);
    expect(r.method).toBe("GET");
    expect(r.url).toBe("https://a.example.com/pkg");
    expect(r.status).toBe(200);
    expect(r.bytes).toBe(708);
  });

  it("carries the resolved destination when the event has one", () => {
    const r = records.find((r) => r.host === "a.example.com" && r.protocol === "https")!;
    expect(r.destination).toBe("203.0.113.10");
  });

  it("omits destination when the event has none", () => {
    const blocked = records.find((r) => r.action === "block" && r.protocol === "https")!;
    expect("destination" in blocked).toBe(false);
  });

  it("carries the refusal restrict would have made, and only where there was one", () => {
    const [noted, plain] = buildTrafficRecords(
      [
        { ...EVENTS[1], action: "audit", wouldRefuse: "example-refusal" },
        { ...EVENTS[1], action: "audit" },
      ],
      t,
    );
    expect(noted.wouldRefuse).toBe("example-refusal");
    expect("wouldRefuse" in plain).toBe(false);
  });

  it("keeps millisecond precision, not just whole seconds", () => {
    const [r] = buildTrafficRecords([{ ...EVENTS[1], time: t + 0.123 }], t);
    expect(r.time).toBe("2026-08-23T07:59:35.123Z");
  });

  it("carries elapsed time relative to when the proxy started, always fixed-width", () => {
    const r = records.find((r) => r.host === "a.example.com")!;
    expect(r.elapsed).toBe("00:00:00.000");
    const later = records.find((r) => r.host === "db.example.com")!;
    expect(later.elapsed).toBe("00:00:01.000");
  });

  it("omits elapsed entirely when there is no start time to be relative to", () => {
    const [r] = buildTrafficRecords([EVENTS[1]], undefined);
    expect("elapsed" in r).toBe(false);
  });

  it("omits what does not apply rather than reporting it as zero", () => {
    // A refusal has no status because nothing answered; consumers filter on
    // action, not on status.
    const blocked = records.find((r) => r.action === "block" && r.protocol === "https")!;
    expect(blocked.status === undefined).toBe(true);
    expect(blocked.bytes === undefined).toBe(true);
    expect(blocked.reason).toBe("not-allowed");
  });

  it("gives a passthrough bytes but no status, never having decrypted it", () => {
    const tls = records.find((r) => r.protocol === "tls")!;
    expect(tls.bytes).toBe(3421);
    expect(tls.status === undefined).toBe(true);
    expect(tls.url === undefined).toBe(true);
  });

  it("gives a name lookup neither a port nor a body", () => {
    const dns = records.find((r) => r.protocol === "dns")!;
    expect(dns.port === undefined).toBe(true);
    expect(dns.bytes === undefined).toBe(true);
  });

  it("keeps a name the build connected on, which the summary folds away", () => {
    // Read by machines, where the volume costs nothing. The summary drops a
    // lookup the request that followed already accounts for; this keeps both.
    expect(records.filter((r) => r.protocol === "dns").length).toBe(3);
  });

  it("orders by time, so the list reads as the sequence the build made", () => {
    expect(records.map((r) => r.time).join()).toBe(
      [...records]
        .map((r) => r.time)
        .sort()
        .join(),
    );
  });

  it("does not mutate the input order", () => {
    const input = [...EVENTS];
    buildTrafficRecords(input, t);
    expect(input[0].action).toBe("block");
  });
});

describe("writeTrafficFile", () => {
  it("writes indented JSON, since a person is meant to read it", () => {
    const file = join(mkdtempSync(join(tmpdir(), "buildcage-art-")), "traffic.json");
    writeTrafficFile(file, buildTrafficRecords(EVENTS, t));
    const text = readFileSync(file, "utf8");
    expect(text.includes('\n  {\n    "time"')).toBe(true);
    expect(JSON.parse(text).length).toBe(6);
  });
});
