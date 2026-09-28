// Nothing else ties the universal template's log formats to this parser. Kept
// out of haproxy-cfg-template.test.ts, which also runs under qjs.
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { scanHaproxyLog } from "./haproxy.ts";

const TEMPLATE = readFileSync(
  new URL("../../../../docker/universal/files/haproxy.cfg.template", import.meta.url),
  "utf8",
);

/** One representative value per format token. A token with no value here
 *  throws, so a new field cannot quietly go uncovered. */
const SAMPLES: Record<string, string> = {
  "%[date(0,ms)]": "1787471975123",
  "%[var(txn.decision)]": "ALLOWED",
  "%[var(txn.rule_type)]": "HTTPS",
  "%[var(txn.target)]": "github.com:443",
  "%[var(txn.reason)]": "-",
  "%[dst]": "198.19.255.1",
  "%[dst_port]": "80",
  "%B": "708",
  "%ts": "--",
};

const TOKEN = /%(?:\[[^\]]*\]|[A-Za-z]+)/g;

/** The log-format strings in the template, unquoted, in config order. */
const FORMATS = TEMPLATE.split("\n")
  .filter((l) => l.trim().startsWith('log-format "'))
  .map((l) => l.slice(l.indexOf('"') + 1, l.lastIndexOf('"')).replaceAll('\\"', '"'));
const [OUTBOUND, HTTP_IN] = FORMATS;

function render(fmt: string, overrides: Record<string, string> = {}): string {
  return fmt.replace(TOKEN, (token) => {
    const sample = overrides[token] ?? SAMPLES[token];
    if (sample === undefined) throw new Error(`log-format token with no sample: ${token}`);
    return sample;
  });
}

/** What http_in prints where no request parsed: no rule set a variable. */
const NO_REQUEST = {
  "%[var(txn.decision)]": "-",
  "%[var(txn.target)]": "-",
  "%[var(txn.reason)]": "-",
  "%B": "0",
};

describe("the universal template's log formats and this parser describe the same line", () => {
  it("has one format for outbound_proxy and one for http_in", () => {
    expect(FORMATS.length).toBe(2);
  });

  it("reads every field of a decision line back out of where it was written", async () => {
    const { events, unparsed } = await scanHaproxyLog([render(OUTBOUND)], false);
    expect(unparsed).toBe(0);
    expect(events).toStrictEqual([
      {
        time: 1787471975.123,
        action: "allow",
        protocol: "https",
        host: "github.com",
        port: 443,
        bytes: 708,
      },
    ]);
  });

  it("reads a request http_in decided the same way", async () => {
    const line = render(HTTP_IN, {
      "%[var(txn.decision)]": "BLOCKED",
      "%[var(txn.target)]": "evil.example.com:80",
      "%[var(txn.reason)]": "not-allowed",
      "%B": "0",
      "%ts": "PR",
    });
    const { events, unparsed } = await scanHaproxyLog([line], false);
    expect(unparsed).toBe(0);
    expect(events).toStrictEqual([
      {
        time: 1787471975.123,
        action: "block",
        protocol: "http",
        host: "evil.example.com",
        port: 80,
        reason: "not-allowed",
      },
    ]);
  });

  it("names no host for a request with no Host, whose target is the address", async () => {
    const line = render(HTTP_IN, {
      "%[var(txn.decision)]": "BLOCKED",
      "%[var(txn.target)]": "198.19.255.1:80",
      "%[var(txn.reason)]": "missing-host-header",
      "%B": "0",
      "%ts": "PR",
    });
    const [e] = (await scanHaproxyLog([line], false)).events;
    expect(e.host).toBe("(unknown)");
    expect(e.reason).toBe("missing-host-header");
  });

  // ssh or git:// to a name: bytes haproxy would not read as a request.
  it("reads bytes refused as no request as a refusal, in either mode", async () => {
    for (const isAudit of [false, true]) {
      const line = render(HTTP_IN, { ...NO_REQUEST, "%ts": "PR", "%[dst_port]": "22" });
      const { events, unparsed } = await scanHaproxyLog([line], isAudit);
      expect(unparsed).toBe(0);
      expect(events).toStrictEqual([
        {
          time: 1787471975.123,
          action: "block",
          protocol: "http",
          host: "(unknown)",
          port: 22,
          reason: "bad-request",
        },
      ]);
    }
  });

  // A client waiting for the server to speak first, or one that never sends.
  it("reads a connection the client ended before any request as undecided", async () => {
    const line = render(HTTP_IN, { ...NO_REQUEST, "%ts": "CR", "%[dst_port]": "25" });
    const [e] = (await scanHaproxyLog([line], false)).events;
    expect(e.action).toBe("incomplete");
    expect(e.reason).toBe("client-aborted");
    expect(e.host).toBe("(unknown)");
    expect(e.port).toBe(25);
  });

  it("refuses to render a field it has never been shown", () => {
    expect(() => render("buildcage %[var(txn.unknown)]")).toThrow("no sample");
  });
});
