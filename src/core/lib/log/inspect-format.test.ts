// The proxy writes these lines and this parser reads them, with nothing else
// holding the two together: a field moved on one side and not the other leaves
// a report that says the build reached nothing at all.
import { describe, it, expect } from "vitest";

import { generateHaproxyConfig } from "../acl/haproxy-config.ts";
import { scanInspectLog } from "./inspect.ts";

const OPTIONS = {
  httpsRules: ["registry.npmjs.org:443"],
  httpRules: ["b.example.com:80"],
  ipRules: ["10.0.0.5:5432"],
  tlsRules: ["db.example.com:443"],
  proxyAddress: "198.19.255.1",
};

/** Long enough that the rendered line runs past haproxy's own 1024-byte default. */
const PATH = `/pkg.tgz?token=${"a".repeat(1200)}`;

/** One representative value per log-format token. A token with no value here
 *  throws, so a new field cannot quietly go uncovered. */
const SAMPLES: Record<string, string> = {
  "%[date(0,ms)]": "1787471975123",
  "%HM": "GET",
  "%ST": "200",
  "%B": "708",
  "%ts": "--",
  "%[var(txn.reason)]": "-",
  "%[ssl_bc_err]": "-",
  "%[dst]": "10.200.0.100",
  "%[dst_port]": "9443",
  "%[var(txn.host_log)]": "registry.npmjs.org",
  "%[var(txn.pathq)]": PATH,
  "%[var(txn.proto)]": "tls",
  "%[var(txn.sni)]": "db.example.com",
  "%[ssl_fc_sni,regsub([^A-Za-z0-9._-],_,g)]": "registry.npmjs.org",
  "%[fc_err_name]": "-",
  "%[var(txn.would_refuse),regsub([^A-Za-z0-9._-],_,g)]": "-",
};

// The inner alternative is the character class a regsub argument carries, so
// the `]` closing it does not end the token.
const TOKEN = /%(?:\[(?:[^[\]]|\[[^[\]]*\])*\]|[A-Za-z]+)/g;

/** The strings the generator emits for one directive, unquoted, in config order. */
function logFormats(config: string, directive = "log-format"): string[] {
  return config
    .split("\n")
    .filter((line) => line.trim().startsWith(`${directive} "buildcage`))
    .map((line) => line.slice(line.indexOf('"') + 1, line.lastIndexOf('"')));
}

function render(
  format: string,
  overrides: Record<string, string> = {},
  named: { reason?: string } = {},
): string {
  const all =
    named.reason === undefined ? overrides : { ...overrides, "%[var(txn.reason)]": named.reason };
  return format.replace(TOKEN, (token) => {
    const sample = all[token] ?? SAMPLES[token];
    if (sample === undefined) throw new Error(`log-format token with no sample: ${token}`);
    return sample;
  });
}

const FORMATS = logFormats(generateHaproxyConfig(OPTIONS));
const EXTENDED_FORMATS = logFormats(
  generateHaproxyConfig({
    ...OPTIONS,
    extension: { requestRules: () => [], responseRules: () => [] },
  }),
);
const [PASSTHROUGH, HTTPS, HTTP] = [
  FORMATS.find((f) => f.includes(" pass ")) ?? "",
  FORMATS.find((f) => f.includes(" https ")) ?? "",
  FORMATS.find((f) => f.includes(" http ")) ?? "",
];

describe("the generated log-format and this parser describe the same line", () => {
  it("emits one format per frontend that logs", () => {
    expect(FORMATS.length).toBe(3);
    expect(PASSTHROUGH === "").toBe(false);
    expect(HTTPS === "").toBe(false);
    expect(HTTP === "").toBe(false);
  });

  it("writes a failed client handshake in the https line's own format", () => {
    expect(logFormats(generateHaproxyConfig(OPTIONS), "error-log-format")).toStrictEqual([HTTPS]);
  });

  it("reads a failed client handshake as undecided, named by its SNI", async () => {
    const line = render(HTTPS, {
      "%HM": "<BADREQ>",
      "%ST": "0",
      "%B": "0",
      "%ts": "PR",
      "%[fc_err_name]": "SSL_HANDSHAKE",
    });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("incomplete");
    expect(e.reason).toBe("client-tls-failed");
    expect(e.host).toBe("registry.npmjs.org");
  });

  it("reads a client that broke off after a completed handshake by how it ended", async () => {
    // haproxy's own words for a corrupt record once the handshake is done.
    const line = render(HTTPS, {
      "%HM": "<BADREQ>",
      "%ST": "400",
      "%B": "0",
      "%ts": "CR",
      "%[fc_err_name]": "SSL_FATAL",
    });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("incomplete");
    expect(e.reason).toBe("client-aborted");
  });

  it("never reads the proxy's own TLS trouble as a refusal", async () => {
    const line = render(HTTPS, {
      "%HM": "<BADREQ>",
      "%ST": "0",
      "%B": "0",
      "%ts": "PR",
      "%[fc_err_name]": "SSL_TOO_MANY",
    });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("incomplete");
  });

  it("keeps the trailing dot of the SNI that names a failed handshake", async () => {
    const line = render(HTTPS, {
      "%HM": "<BADREQ>",
      "%ST": "0",
      "%B": "0",
      "%ts": "PR",
      "%[fc_err_name]": "SSL_HANDSHAKE",
      "%[ssl_fc_sni,regsub([^A-Za-z0-9._-],_,g)]": "Registry.npmjs.org.",
    });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.host).toBe("registry.npmjs.org.");
  });

  it("reads a request it parsed by its own outcome, whatever the connection error", async () => {
    const line = render(HTTPS, { "%[fc_err_name]": "SSL_HANDSHAKE" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("allow");
    expect(e.reason).toBeUndefined();
  });

  it("still reads an unreadable request after a completed handshake as a refusal", async () => {
    // HTTP/2 framing the proxy could not read logs the same way, minus fcerr.
    const line = render(HTTPS, { "%HM": "<BADREQ>", "%ST": "0", "%B": "0", "%ts": "PR" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("block");
    expect(e.reason).toBe("bad-request");
  });

  it("reads every field of a request line back out of where it was written", async () => {
    const line = render(HTTPS);
    // Guards the sample itself, which has to reach past the default line length.
    expect(line.length > 1024).toBe(true);

    const { events, unparsed } = await scanInspectLog([line]);
    expect(unparsed).toBe(0);
    expect(events.length).toBe(1);
    const [e] = events;
    expect(e.time).toBe(1787471975.123);
    expect(e.action).toBe("allow");
    expect(e.protocol).toBe("https");
    expect(e.method).toBe("GET");
    expect(e.host).toBe("registry.npmjs.org");
    expect(e.port).toBe(9443);
    expect(e.status).toBe(200);
    expect(e.bytes).toBe(708);
    expect(e.destination).toBe("10.200.0.100:9443");
    expect(e.url).toBe(`https://registry.npmjs.org${PATH}`);
  });

  it("reads a plain request line the same way", async () => {
    const [e] = (await scanInspectLog([render(HTTP)])).events;
    expect(e.protocol).toBe("http");
    expect(e.url).toBe(`http://registry.npmjs.org${PATH}`);
    expect(e.status).toBe(200);
  });

  it("keeps a Host padded past any real name whole, down to its registered domain", async () => {
    const host = `registry.npmjs.org.${"a".repeat(300)}.attacker.example`;
    const line = render(HTTPS, {
      "%ST": "403",
      "%B": "0",
      "%ts": "PR--",
      "%[var(txn.host_log)]": host,
    });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.host).toBe(host);
    expect(e.url).toBe(`https://${host}${PATH}`);
  });

  it("reads a refusal the config named out of the reason field", async () => {
    const line = render(
      HTTPS,
      { "%ts": "PR--", "%ST": "403", "%B": "0" },
      { reason: "internal-address" },
    );
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("block");
    expect(e.reason).toBe("internal-address");
    expect(e.status === undefined).toBe(true);
  });

  it("reads an upstream resolution failure as failed, not as a refusal", async () => {
    const line = render(
      HTTPS,
      { "%ts": "PR--", "%ST": "502", "%B": "0" },
      { reason: "dns-failed" },
    );
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("failed");
    expect(e.reason).toBe("dns-failed");
    expect(e.status === undefined).toBe(true);
  });

  it("names a failure the config left unnamed from the termination phase", async () => {
    const line = render(HTTPS, { "%ts": "SH--", "%ST": "502", "%B": "0" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("failed");
    expect(e.reason).toBe("origin-no-response");
  });

  // Both end in the same termination state, so the field is the only thing
  // between them. Both are refusals: this proxy completed neither connection,
  // so it authenticated neither origin.
  it("tells an origin it would not trust from one it could not reach", async () => {
    const connect = { "%ts": "SC--", "%ST": "503", "%B": "0" };
    const [connectFailed] = (
      await scanInspectLog([render(HTTPS, { ...connect, "%[ssl_bc_err]": "-" })])
    ).events;
    expect(connectFailed.reason).toBe("origin-connect-failed");
    expect(connectFailed.action).toBe("block");

    const [untrusted] = (
      await scanInspectLog([render(HTTPS, { ...connect, "%[ssl_bc_err]": "167772294" })])
    ).events;
    expect(untrusted.reason).toBe("origin-untrusted");
    expect(untrusted.action).toBe("block");
  });

  it("names a timeout in the same phase for the connection, not for the certificate", async () => {
    // `s` is this proxy's own timeout running out, which judged no certificate,
    // so it must not be reported as one it would not trust.
    const line = render(HTTPS, {
      "%ts": "sC--",
      "%ST": "504",
      "%B": "0",
      "%[ssl_bc_err]": "167772294",
    });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.reason).toBe("origin-connect-failed");
    expect(e.action).toBe("block");
  });

  it("leaves a passthrough this proxy could not connect for a failure, not a refusal", async () => {
    // That stage relays the handshake for the build to judge, so a connection
    // it never made hid no certificate and no rule can change the outcome.
    const line = render(PASSTHROUGH, { "%ts": "SC--", "%B": "0" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.reason).toBe("origin-unreachable");
    expect(e.action).toBe("failed");
  });

  it("leaves a plaintext connection this proxy could not make a failure too", async () => {
    // origin_plain verifies nothing (see haproxy-sections.ts), so there was no
    // certificate for a connection that never completed to have hidden. The
    // stage logs `tlserr` all the same, and it means nothing here.
    const line = render(HTTP, { "%ts": "sC--", "%ST": "503", "%B": "0" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.reason).toBe("origin-unreachable");
    expect(e.action).toBe("failed");
  });

  // What a client that finished the handshake and then left produces, and what
  // bytes haproxy could not read as a request produce too: with no request to
  // log, every field one would have comes out empty.
  const NO_REQUEST = {
    "%HM": "<BADREQ>",
    "%ST": "400",
    "%B": "0",
    "%[var(txn.host_log)]": "-",
    "%[var(txn.pathq)]": "-",
  };

  it("takes the host of a connection closed before its request from the SNI", async () => {
    const line = render(HTTPS, { ...NO_REQUEST, "%ts": "CR" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("incomplete");
    expect(e.host).toBe("registry.npmjs.org");
    expect(e.port).toBe(9443);
    expect(e.reason).toBe("client-aborted");
    expect(e.destination).toBe("10.200.0.100:9443");
    expect(e.method === undefined).toBe(true);
    expect(e.url === undefined).toBe(true);
    expect(e.status === undefined).toBe(true);
  });

  it("tells a client that closed from one that waited out its own timeout", async () => {
    const line = render(HTTPS, { ...NO_REQUEST, "%ts": "cR", "%ST": "408" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("incomplete");
    expect(e.reason).toBe("client-timeout");
  });

  it("reads haproxy's own 400 as a refusal, named by the handshake", async () => {
    const line = render(HTTPS, { ...NO_REQUEST, "%ts": "PR" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("block");
    expect(e.host).toBe("registry.npmjs.org");
    expect(e.reason).toBe("bad-request");
    expect(e.url === undefined).toBe(true);
  });

  it("reads a request that carried no Host the same way, path and all", async () => {
    // The config names this one, the request having parsed far enough for its
    // rules to run; see haproxy-inspect-stage.ts.
    const line = render(
      HTTPS,
      { "%ST": "400", "%B": "0", "%ts": "PR", "%[var(txn.host_log)]": "-" },
      { reason: "missing-host-header" },
    );
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("block");
    expect(e.host).toBe("registry.npmjs.org");
    expect(e.reason).toBe("missing-host-header");
    // The request line did parse, and the path is the whole record of what was
    // asked for. Its URL names the same host the row does.
    expect(e.method).toBe("GET");
    expect(e.url).toBe(`https://registry.npmjs.org:9443${PATH}`);
  });

  it("refuses a request that named no host in audit too, where no rule would have", async () => {
    // There is nothing to resolve and nothing to connect to, so the stage
    // denies it in either mode, as the universal engine does.
    const line = render(
      HTTPS,
      { "%ST": "400", "%B": "0", "%ts": "PR", "%[var(txn.host_log)]": "-" },
      { reason: "missing-host-header" },
    );
    const [e] = (await scanInspectLog([line], true)).events;
    expect(e.action).toBe("block");
    expect(e.reason).toBe("missing-host-header");
  });

  // The log rewrites only whitespace, quotes and control characters, so a
  // Host of the build's own choosing reaches the log as sent. Reading the
  // authority to decide whether one arrived would let a sender move its own
  // refusals out of both tables and out of fail_on_blocked, by writing the very
  // text the log prints for a Host that never came.
  it.each(["-evil.example.com", "-", "--", "-:443", "-/evil.example.com"])(
    "leaves a refusal whose sender chose the Host %j a block",
    async (host) => {
      const line = render(HTTPS, {
        "%ST": "403",
        "%B": "0",
        "%ts": "PR",
        "%[var(txn.host_log)]": host,
      });
      const [e] = (await scanInspectLog([line])).events;
      expect(e.action).toBe("block");
      expect(e.reason).toBe("not-allowed");
      expect(e.url).toBe(`https://${host}${PATH}`);
    },
  );

  // A phase that implies a request was being processed cannot be reached
  // without one, but nothing in the log makes the two fields agree. Whatever
  // pair arrives, a line carrying no request must not become a host: `--` is
  // the empty Host and path, and a table row naming it says nothing a reader
  // could act on.
  it("never reads a line with no request in it as an allowed host, in any state", async () => {
    const states = "CcSsPRIDUKL-"
      .split("")
      .flatMap((cause) => "RQCHDLT-".split("").map((phase) => `${cause}${phase}--`));
    for (const state of states) {
      for (const isAudit of [false, true]) {
        const line = render(HTTPS, { ...NO_REQUEST, "%ts": state });
        const [e] = (await scanInspectLog([line], isAudit)).events;
        expect(`${state}: ${e.action} ${e.host}`).toBe(
          `${state}: ${state[0] === "P" ? "block" : "incomplete"} registry.npmjs.org`,
        );
      }
    }
  });

  it("names a phase R neither the client nor this proxy ended as no request at all", async () => {
    // `RR` is haproxy running out of a resource while reading the request: its
    // own doing and not a decision, so it is neither allowed nor refused.
    const line = render(HTTPS, { ...NO_REQUEST, "%ts": "RR" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("incomplete");
    expect(e.reason).toBe("no-request");
    expect(e.host).toBe("registry.npmjs.org");
  });

  it("falls back to the address when the handshake carried no SNI", async () => {
    // A name-based client always sends one, so a handshake without it was
    // aimed at an address the build wrote out itself, which only an ip rule
    // could have passed.
    const line = render(HTTPS, {
      ...NO_REQUEST,
      "%ts": "CR",
      "%[ssl_fc_sni,regsub([^A-Za-z0-9._-],_,g)]": "-",
    });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.host).toBe("10.200.0.100");
    expect(e.protocol).toBe("tcp");
  });

  it("names a plain-stage connection by the address the build wrote out", async () => {
    const line = render(HTTP, { ...NO_REQUEST, "%ts": "PR" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("block");
    expect(e.reason).toBe("bad-request");
    expect(e.protocol).toBe("tcp");
    expect(e.host).toBe("10.200.0.100");
  });

  it("names no host where the address is the proxy's own, which every name resolves to", async () => {
    for (const stage of [HTTP, HTTPS]) {
      const line = render(stage, {
        ...NO_REQUEST,
        "%ts": "CR",
        "%[dst]": "198.19.255.1",
        "%[ssl_fc_sni,regsub([^A-Za-z0-9._-],_,g)]": "-",
      });
      const { events, unparsed } = await scanInspectLog([line]);
      expect(unparsed).toBe(0);
      const [e] = events;
      expect(e.action).toBe("incomplete");
      expect(e.protocol).toBe(stage === HTTP ? "http" : "https");
      expect(e.host).toBe("(unknown)");
      // Still recorded; it is just not a host the build asked for.
      expect(e.destination).toBe("198.19.255.1:9443");
    }
  });

  it("leaves a client that abandoned an allowed request an ordinary exchange", async () => {
    const line = render(HTTPS, { "%ts": "CD--" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("allow");
    expect(e.url).toBe(`https://registry.npmjs.org${PATH}`);
  });

  it("names a passthrough refusal the same way, though it has no status at all", async () => {
    const line = render(PASSTHROUGH, { "%ts": "PR", "%B": "0" }, { reason: "internal-address" });
    const [e] = (await scanInspectLog([line])).events;
    expect(e.action).toBe("block");
    expect(e.reason).toBe("internal-address");
  });

  it("reads every field of a passthrough line, which has no request in it", async () => {
    const { events, unparsed } = await scanInspectLog([render(PASSTHROUGH)]);
    expect(unparsed).toBe(0);
    const [e] = events;
    expect(e.protocol).toBe("tls");
    expect(e.host).toBe("db.example.com");
    expect(e.port).toBe(9443);
    expect(e.bytes).toBe(708);
    expect(e.destination).toBe("10.200.0.100:9443");
    expect(e.url === undefined).toBe(true);
  });

  it("refuses to render a field it has never been shown", () => {
    expect(() => render("buildcage %[var(txn.unknown)]")).toThrow("no sample");
  });

  describe("with an extension", () => {
    const [https, http] = [
      EXTENDED_FORMATS.find((f) => f.includes(" https ")) ?? "",
      EXTENDED_FORMATS.find((f) => f.includes(" http ")) ?? "",
    ];

    it("adds its field to both request formats and nothing else", () => {
      expect(EXTENDED_FORMATS.length).toBe(3);
      expect(EXTENDED_FORMATS.filter((f) => f.includes(" wr=")).length).toBe(2);
    });

    it("still reads the rest of the line where it was", async () => {
      for (const format of [https, http]) {
        const [e] = (await scanInspectLog([render(format)])).events;
        expect(e.action).toBe("allow");
        expect(e.host).toBe("registry.npmjs.org");
        expect(e.wouldRefuse).toBe(undefined);
      }
    });

    it("names the refusal restrict made", async () => {
      const line = render(
        https,
        { "%ST": "403", "%B": "0", "%ts": "PR" },
        { reason: "example-refusal" },
      );
      const [e] = (await scanInspectLog([line])).events;
      expect(e.action).toBe("block");
      expect(e.reason).toBe("example-refusal");
      expect(e.wouldRefuse).toBe(undefined);
    });

    it("keeps the refusal restrict would have made where the request came to nothing", async () => {
      const line = render(
        https,
        {
          "%ST": "502",
          "%B": "0",
          "%ts": "PR",
          "%[var(txn.would_refuse),regsub([^A-Za-z0-9._-],_,g)]": "example-refusal",
        },
        { reason: "dns-failed" },
      );
      const [e] = (await scanInspectLog([line], true)).events;
      expect(e.reason).toBe("dns-failed");
      expect(e.wouldRefuse).toBe("example-refusal");
    });

    it("notes the refusal restrict would have made of a request audit let through", async () => {
      const line = render(https, {
        "%[var(txn.would_refuse),regsub([^A-Za-z0-9._-],_,g)]": "example-refusal",
      });
      const [e] = (await scanInspectLog([line], true)).events;
      expect(e.action).toBe("audit");
      expect(e.status).toBe(200);
      expect(e.wouldRefuse).toBe("example-refusal");
    });
  });
});
