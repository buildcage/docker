import { describe, it, expect } from "vitest";

import { scanHaproxyLog } from "./haproxy.ts";

/** A decision line in the format the log-format template emits. */
const line = (
  decision: string,
  ruleType: string,
  target: string,
  reason: string,
  bytes: string | number = 0,
  ms = 1787471970000,
) => `buildcage ${ms} [${decision}] (${ruleType}) "${target}" ${reason} ${bytes}`;

const MARKER = "buildcage haproxy starting 1787471970000";

describe("scanHaproxyLog", () => {
  it("reads an ALLOWED line as an allowed event when isAudit is false", async () => {
    const { events } = await scanHaproxyLog(
      [line("ALLOWED", "HTTPS", "example.com:443", "-", 1200)],
      false,
    );
    expect(events).toStrictEqual([
      {
        time: 1787471970,
        action: "allow",
        protocol: "https",
        host: "example.com",
        port: 443,
        bytes: 1200,
      },
    ]);
  });

  it("reads an AUDIT line as an audited event when isAudit is true", async () => {
    const { events } = await scanHaproxyLog([line("AUDIT", "HTTP", "any.com:80", "-", 42)], true);
    expect(events[0].action).toBe("audit");
    expect(events[0].protocol).toBe("http");
    expect(events[0].bytes).toBe(42);
  });

  it("reads a BLOCKED line as a block event carrying its reason and no bytes", async () => {
    const { events } = await scanHaproxyLog(
      [line("BLOCKED", "IP", "10.0.0.1:443", "ip-not-allowed", 0)],
      false,
    );
    expect(events[0]).toStrictEqual({
      time: 1787471970,
      action: "block",
      protocol: "tcp",
      host: "10.0.0.1",
      port: 443,
      reason: "ip-not-allowed",
    });
  });

  it("reads a dns-failed BLOCKED line as a failed event, not a block", async () => {
    const { events } = await scanHaproxyLog(
      [line("BLOCKED", "HTTPS", "absent.com:443", "dns-failed")],
      false,
    );
    expect(events[0].action).toBe("failed");
    expect(events[0].reason).toBe("dns-failed");
  });

  it("drops an ALLOWED line in audit mode (not the decision this mode records)", async () => {
    const { events } = await scanHaproxyLog([line("ALLOWED", "HTTPS", "a.com:443", "-")], true);
    expect(events).toStrictEqual([]);
  });

  it("drops an AUDIT line in restrict mode", async () => {
    const { events } = await scanHaproxyLog([line("AUDIT", "HTTPS", "a.com:443", "-")], false);
    expect(events).toStrictEqual([]);
  });

  it("leaves bytes unset when the field is `-`", async () => {
    const { events } = await scanHaproxyLog(
      [line("ALLOWED", "HTTPS", "a.com:443", "-", "-")],
      false,
    );
    expect(events[0].bytes).toBeUndefined();
  });

  it("maps a rule kind it does not know to a tcp connection", async () => {
    // The template overwrites its UNKNOWN default on every path that logs, so
    // this guards the fallback rather than a line the proxy writes.
    const { events } = await scanHaproxyLog(
      [line("BLOCKED", "UNKNOWN", "10.0.0.9:1234", "-")],
      false,
    );
    expect(events[0].protocol).toBe("tcp");
  });

  /** http_in's line for a connection no request parsed on. */
  const noRequest = (ts: string, dst = "198.19.255.1:22") =>
    `buildcage 1787471970000 [-] (HTTP) "-" - 0 ts=${ts} dst=${dst}`;

  it("reads bytes the HTTP stage refused as no request as a refusal, in audit too", async () => {
    for (const isAudit of [false, true]) {
      const { events, unparsed } = await scanHaproxyLog([noRequest("PR")], isAudit);
      expect(unparsed).toBe(0);
      expect(events).toStrictEqual([
        {
          time: 1787471970,
          action: "block",
          protocol: "http",
          host: "(unknown)",
          port: 22,
          reason: "bad-request",
        },
      ]);
    }
  });

  it("leaves a connection the client ended before a request undecided", async () => {
    const { events } = await scanHaproxyLog(
      [noRequest("CR"), noRequest("cR"), noRequest("RR")],
      false,
    );
    expect(events.map((e) => `${e.action} ${e.reason}`)).toStrictEqual([
      "incomplete client-aborted",
      "incomplete client-timeout",
      "incomplete no-request",
    ]);
  });

  it("keeps an address other than the proxy's own as the host", async () => {
    const [e] = (await scanHaproxyLog([noRequest("PR", "10.0.0.9:25")], false)).events;
    expect(e.host).toBe("10.0.0.9");
    expect(e.port).toBe(25);
  });

  it("reads a decided line from the HTTP stage, ignoring what it appends", async () => {
    const { events, unparsed } = await scanHaproxyLog(
      [
        `${line("BLOCKED", "HTTP", "198.19.255.1:80", "missing-host-header")} ts=PR dst=198.19.255.1:80`,
        `${line("ALLOWED", "HTTP", "a.com:80", "-", 12)} ts=-- dst=198.19.255.1:80`,
      ],
      false,
    );
    expect(unparsed).toBe(0);
    expect(
      events.map((e) => `${e.action} ${e.host}:${e.port} ${e.reason ?? e.bytes}`),
    ).toStrictEqual(["block (unknown):80 missing-host-header", "allow a.com:80 12"]);
  });

  it("keeps an address the build wrote out itself as the host", async () => {
    const { events } = await scanHaproxyLog(
      [line("BLOCKED", "IP", "198.19.255.10:22", "ip-not-allowed")],
      false,
    );
    expect(events[0].host).toBe("198.19.255.10");
  });

  it("counts a line whose every field is empty but carries no state as unparsed", async () => {
    // Nothing says who ended it or where it was going, so it is not read as
    // anything at all.
    const { events, unparsed } = await scanHaproxyLog(
      ['buildcage 1790532433493 [-] (-) "-" - 0'],
      false,
    );
    expect(events).toStrictEqual([]);
    expect(unparsed).toBe(1);
  });

  it("reads a target with no port as a portless event", async () => {
    const { events } = await scanHaproxyLog(
      [line("BLOCKED", "HTTPS", "a.example.com", "not-allowed")],
      false,
    );
    expect(events[0].host).toBe("a.example.com");
    expect(events[0].port).toBeUndefined();
  });

  it("ignores non-decision lines without counting them as gaps", async () => {
    const { events, unparsed } = await scanHaproxyLog(
      ["some random log line", "[2024] other"],
      false,
    );
    expect(events).toStrictEqual([]);
    expect(unparsed).toBe(0);
  });

  it("counts a decision line it cannot read, since it may have been a refusal", async () => {
    const log = [
      line("ALLOWED", "HTTPS", "example.com:443", "-", 10),
      `buildcage 1787471970001 [BLOCKED] (HTTPS) "bad.com:4buildcage 1787471970002 [BLOCKED] (HTTPS) "worse.com:443" not-allowed 0`,
      MARKER,
    ];
    const { events, unparsed } = await scanHaproxyLog(log, false);
    expect(events.length).toBe(1);
    expect(unparsed).toBe(1);
  });

  it("reads startedAt from the startup marker's millisecond epoch", async () => {
    const { startedAt } = await scanHaproxyLog([MARKER], false);
    expect(startedAt).toBe(1787471970);
  });

  it("leaves startedAt undefined when the marker carries no stamp", async () => {
    const { startedAt, headIntact } = await scanHaproxyLog(["buildcage haproxy starting"], false);
    expect(startedAt).toBeUndefined();
    expect(headIntact).toBe(false);
  });

  it("accepts a real AsyncIterable, not just an array", async () => {
    async function* lines(): AsyncGenerator<string> {
      yield line("ALLOWED", "HTTPS", "async.com:443", "-", 5);
    }
    const { events } = await scanHaproxyLog(lines(), false);
    expect(events[0].host).toBe("async.com");
  });

  it("headIntact is false for empty log text", async () => {
    expect((await scanHaproxyLog("".split("\n"), false)).headIntact).toBe(false);
  });

  it("headIntact is false when the log has only decision lines", async () => {
    const { headIntact } = await scanHaproxyLog(
      [line("ALLOWED", "HTTPS", "a.com:443", "-")],
      false,
    );
    expect(headIntact).toBe(false);
  });

  it("headIntact is true when the log opens with the startup marker", async () => {
    const { headIntact } = await scanHaproxyLog(
      [MARKER, line("ALLOWED", "HTTPS", "a.com:443", "-")],
      false,
    );
    expect(headIntact).toBe(true);
  });

  it("headIntact ignores blank lines when deciding", async () => {
    expect((await scanHaproxyLog("\n\n  \n".split("\n"), false)).headIntact).toBe(false);
  });

  it("headIntact ignores the marker if it is not the first non-blank line", async () => {
    const log = [line("ALLOWED", "HTTPS", "a.com:443", "-"), MARKER];
    const { headIntact } = await scanHaproxyLog(log, false);
    expect(headIntact).toBe(false);
  });

  it("refuses a line carrying anything after the fields it expects", async () => {
    const appended = `${line("ALLOWED", "HTTPS", "a.com:443", "-", 1)} and more`;
    const { events, unparsed } = await scanHaproxyLog([appended], false);
    expect(events).toStrictEqual([]);
    expect(unparsed).toBe(1);
  });
});
