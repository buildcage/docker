// The universal template writes these lines and this parser reads them, with
// nothing else holding the two together. haproxy-cfg-template.test.ts reads the
// same file but also runs under qjs, so the check lives here instead.
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
  "%[dst_port]": "22",
  "%B": "708",
};

const TOKEN = /%(?:\[[^\]]*\]|[A-Za-z]+)/g;

/** The one `<directive> "..."` line in the template, unquoted. */
function format(directive: string): string {
  const lines = TEMPLATE.split("\n").filter((l) => l.trim().startsWith(`${directive} "`));
  expect(lines.length).toBe(1);
  const [line] = lines;
  return line.slice(line.indexOf('"') + 1, line.lastIndexOf('"')).replaceAll('\\"', '"');
}

function render(fmt: string, overrides: Record<string, string> = {}): string {
  return fmt.replace(TOKEN, (token) => {
    const sample = overrides[token] ?? SAMPLES[token];
    if (sample === undefined) throw new Error(`log-format token with no sample: ${token}`);
    return sample;
  });
}

describe("the universal template's log formats and this parser describe the same line", () => {
  it("reads every field of a decision line back out of where it was written", async () => {
    const { events, unparsed } = await scanHaproxyLog([render(format("log-format"))], false);
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

  // HAProxy writes this one for bytes it could not read as HTTP, before any
  // txn variable is set: ssh or git:// to a name, say.
  it("reads the error line as a refusal of an unnamed host, in either mode", async () => {
    for (const isAudit of [false, true]) {
      const { events, unparsed } = await scanHaproxyLog(
        [render(format("error-log-format"), { "%B": "0" })],
        isAudit,
      );
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

  it("refuses to render a field it has never been shown", () => {
    expect(() => render("buildcage %[var(txn.unknown)]")).toThrow("no sample");
  });
});
