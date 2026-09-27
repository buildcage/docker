import { describe, it, expect } from "vitest";

import { reportParams } from "#core/lib/test/report-data.node.ts";

import { buildInspectReportData } from "./inspect.ts";

const START = "buildcage haproxy starting 1787471970000";
const ALLOWED =
  "buildcage 1787471975 https GET 200 708 ts=-- reason=- tlserr=- dst=104.16.1.34:443 host=registry.npmjs.org /pkg";
const REFUSED =
  "buildcage 1787471976 https POST 403 0 ts=PR reason=- tlserr=- dst=1.2.3.4:443 host=evil.example.com /exfil?d=SECRET";
const TLS_PASS =
  "buildcage 1787471977 pass tls 3421 ts=-- reason=- dst=10.0.0.9:5432 sni=db.example.com";
/** A handshake the client completed and then walked away from, leaving the
 *  proxy's own address as the destination and the SNI as the only name. */
const ABORTED =
  "buildcage 1787471978 https <BADREQ> 400 0 ts=CR reason=- tlserr=- dst=198.19.255.1:443 sni=untrusted-ca.example.com host=- -";
/** Bytes haproxy answered 400 to itself, having read no request out of them:
 *  `-` is both the host and the target it never had. */
const BAD_REQUEST =
  "buildcage 1787471979 http <BADREQ> 400 0 ts=PR reason=- tlserr=- dst=198.19.255.1:8080 host=- -";
/** A request that parsed and carried no `Host`, which the stage refuses ahead
 *  of the rules: there is nothing to match and nothing to resolve. */
const NO_HOST =
  "buildcage 1787471979 http GET 400 0 ts=PR reason=missing-host-header tlserr=- dst=198.19.255.1:8080 host=- /x";
/** An origin that took the connection and never sent usable headers. */
const ORIGIN_FAILED =
  "buildcage 1787471980 https GET 502 0 ts=SH reason=- tlserr=- dst=104.16.1.34:443 host=registry.npmjs.org /slow";
/** What the resolver service echoes before CoreDNS starts. */
const DNS_START = "2026-08-23 16:44:58.000000000  buildcage coredns starting";

describe("buildInspectReportData", () => {
  it("puts everything in one timeline, oldest first", async () => {
    const dns = ["2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=z.example.com."];
    const r = await buildInspectReportData(
      [START, REFUSED, ALLOWED, TLS_PASS],
      dns,
      reportParams(),
      0,
    );
    expect(r.timeline.length).toBe(4);
    expect(r.timeline.every((e, i) => i === 0 || r.timeline[i - 1].time <= e.time)).toBe(true);
  });

  it("tables a failure the origin caused apart from what the rules refused", async () => {
    const r = await buildInspectReportData([START, ORIGIN_FAILED], [], reportParams(), 0);
    expect(r.failed.map((row) => `${row.host} ${row.reason}`)).toStrictEqual([
      "registry.npmjs.org origin-no-response",
    ]);
    expect(r.blocked).toStrictEqual([]);
    expect(r.passed).toStrictEqual([]);
  });

  it("leaves such a failure out of blockedCount", async () => {
    const r = await buildInspectReportData([START, ORIGIN_FAILED, REFUSED], [], reportParams(), 0);
    expect(r.blockedCount).toBe(1);
  });

  it("aggregates each side into host rows a rule could be written from", async () => {
    const r = await buildInspectReportData([START, ALLOWED, REFUSED], [], reportParams(), 0);
    expect(r.passed[0].host).toBe("registry.npmjs.org");
    expect(r.passed[0].port).toBe("443");
    expect(r.passed[0].ruleType).toBe("HTTPS");
    expect(r.blocked[0].host).toBe("evil.example.com");
    expect(r.blocked[0].reason).toBe("not-allowed");
  });

  it("drops a blocked DNS row from the tables once the same host's request is also blocked", async () => {
    // evil.example.com is REFUSED's host: the DNS-only record adds nothing a
    // reader could not already tell from the request row.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=evil.example.com.",
    ];
    const r = await buildInspectReportData([START, REFUSED], dns, reportParams(), 0);
    expect(r.blocked.length).toBe(1);
    expect(r.blocked[0].ruleType).toBe("HTTPS");
    // The raw timeline is untouched: only the host tables collapse it.
    expect(r.timeline.some((e) => e.protocol === "dns")).toBe(true);
  });

  it("keeps a blocked DNS row when the name was never actually requested", async () => {
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=secret-in-a-name.attacker.example.",
    ];
    const r = await buildInspectReportData([START], dns, reportParams(), 0);
    expect(r.blocked.length).toBe(1);
    expect(r.blocked[0].ruleType).toBe("DNS");
  });

  it("gives a passthrough the rule kind that would permit it", async () => {
    const r = await buildInspectReportData([START, TLS_PASS], [], reportParams(), 0);
    expect(r.passed[0].ruleType).toBe("TLS");
    expect(r.passed[0].host).toBe("db.example.com");
    expect(r.passed[0].port).toBe("5432");
  });

  it("does not count an origin's own 403 as blocked", async () => {
    // fail_on_blocked defaults to true, so a registry answering 403 to an
    // unauthenticated fetch would otherwise fail a build that was not blocked.
    const relayed =
      "buildcage 3 https GET 403 90 ts=-- reason=- tlserr=- dst=1.1.1.1:443 host=reg.example.com /pkg";
    const r = await buildInspectReportData([START, relayed], [], reportParams(), 0);
    expect(r.blockedCount).toBe(0);
  });

  it("counts every blocked event, not just the distinct hosts", async () => {
    const r = await buildInspectReportData([START, REFUSED, REFUSED], [], reportParams(), 0);
    expect(r.blocked.length).toBe(1);
    expect(r.blockedCount).toBe(2);
  });

  it("reports a name the resolver refused, which never reached the proxy", async () => {
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=SECRET.att.example.",
    ];
    const r = await buildInspectReportData([START], dns, reportParams(), 0);
    expect(r.blocked[0].ruleType).toBe("DNS");
    expect(r.blocked[0].reason).toBe("dns-not-allowed");
    expect(r.blockedCount).toBe(1);
  });

  it("keeps a resolved name out of the host tables", async () => {
    // The request that followed is already a row; listing both doubles it.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns allowed name=registry.npmjs.org.",
    ];
    const r = await buildInspectReportData([START, ALLOWED], dns, reportParams(), 0);
    expect(r.passed.length).toBe(1);
    // It is still in the timeline, which the job output is built from.
    expect(r.timeline.filter((e) => e.protocol === "dns").length).toBe(1);
  });

  it("keeps a discovery lookup out of both tables and out of blockedCount", async () => {
    // apt asks for this on every repository it fetches from and falls through
    // to the plain name, so counting it as blocked would fail a build that
    // worked, over a row no rule could take away.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns discovery name=_http._tcp.deb.debian.org. type=SRV",
    ];
    const r = await buildInspectReportData([START], dns, reportParams(), 0);
    expect(r.blocked.length).toBe(0);
    expect(r.blockedCount).toBe(0);
    expect(r.passed.length).toBe(0);
    // Recorded, not hidden: the details section reads the timeline.
    expect(r.timeline.length).toBe(1);
    expect(r.timeline[0].action).toBe("discovery");
    expect(r.timeline[0].queryType).toBe("SRV");
  });

  it("keeps a connection dropped before its request out of both tables", async () => {
    // Nothing left the proxy, so no rule can permit or refuse it: naming the
    // host would not remove the row, and blocking it would fail the build.
    const r = await buildInspectReportData([START, ABORTED], [], reportParams(), 0);
    expect(r.blocked.length).toBe(0);
    expect(r.blockedCount).toBe(0);
    expect(r.passed.length).toBe(0);
    expect(r.timeline.length).toBe(1);
    expect(r.timeline[0].action).toBe("incomplete");
    expect(r.timeline[0].host).toBe("untrusted-ca.example.com");
  });

  it("tables a request it refused before a whole one had arrived", async () => {
    // This proxy refused these rather than merely watched them end, so they
    // count like any other refusal. Neither row names the `-` the log prints
    // for a Host that never came: the plain stage has no SNI to name them by,
    // and the address is this proxy's own.
    const r = await buildInspectReportData([START, BAD_REQUEST, NO_HOST], [], reportParams(), 0);
    expect(r.blockedCount).toBe(2);
    expect(r.blocked.map((row) => `${row.host}:${row.port} ${row.reason}`).sort()).toStrictEqual([
      "(unknown):8080 bad-request",
      "(unknown):8080 missing-host-header",
    ]);
    expect(r.passed.length).toBe(0);
  });

  it("tables a refusal sent to an address the build wrote out as an IP row", async () => {
    // allowed_ip_rules is what would have passed it through, so that is the
    // rule kind the row names.
    const toResolver = BAD_REQUEST.replace("dst=198.19.255.1:8080", "dst=8.8.8.8:53");
    const r = await buildInspectReportData([START, toResolver], [], reportParams(), 0);
    expect(
      r.blocked.map((row) => `${row.host}:${row.port} ${row.ruleType} ${row.reason}`),
    ).toStrictEqual(["8.8.8.8:53 IP bad-request"]);
  });

  it("still blocks a refusal whose request did name a host", async () => {
    // Same termination state as the two above, told apart by the reason and
    // by the method haproxy logs where a request never parsed.
    const r = await buildInspectReportData([START, REFUSED], [], reportParams(), 0);
    expect(r.blockedCount).toBe(1);
    expect(r.blocked[0].host).toBe("evil.example.com");
  });

  it("leaves the DNS refusal for such a host standing, as the one actionable row", async () => {
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=untrusted-ca.example.com.",
    ];
    const r = await buildInspectReportData([START, ABORTED], dns, reportParams(), 0);
    expect(r.blocked[0].host).toBe("untrusted-ca.example.com");
    expect(r.blocked[0].reason).toBe("dns-not-allowed");
  });

  it("keeps a name that resolved and was never connected to", async () => {
    // The only evidence that a rule covers more than the build used.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns allowed name=unused.example.com.",
    ];
    const r = await buildInspectReportData([START, ALLOWED], dns, reportParams(), 0);
    expect(r.passed.some((row) => row.host === "unused.example.com")).toBe(true);
    expect(r.blocked.length).toBe(0);
  });

  it("keeps an audited name that was never connected to in audit mode", async () => {
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns allowed name=looked-up.example.com.",
    ];
    const r = await buildInspectReportData([START], dns, reportParams({ mode: "audit" }), 0);
    expect(r.passed.length).toBe(1);
    expect(r.passed[0].host).toBe("looked-up.example.com");
    expect(r.passed[0].ruleType).toBe("DNS");
  });

  it("says a refused service name takes a different remedy from an ordinary one", async () => {
    // Naming the service name in a rule silences the row without making the
    // record resolve. The host below it is what a rule is written against, so
    // the row has to say which kind of name it is.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns service-denied name=_mongodb._tcp.c0.example.net. type=SRV",
      "2026-08-23 16:45:01.000000000  [INFO] buildcage dns denied name=evil.example.com.",
    ];
    const r = await buildInspectReportData([START], dns, reportParams(), 0);
    const service = r.blocked.find((row) => row.host.startsWith("_mongodb"));
    const plain = r.blocked.find((row) => row.host === "evil.example.com");
    expect(service?.reason).toBe("dns-service-not-allowed");
    expect(plain?.reason).toBe("dns-not-allowed");
  });

  it("keeps a refused service name silenceable by known_blocked_rules", async () => {
    // Neither remedy makes the record resolve; this is the one that leaves the
    // rules alone, so it has to keep working on a name with no port.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns service-denied name=_mongodb._tcp.c0.example.net. type=SRV",
    ];
    const r = await buildInspectReportData(
      [START],
      dns,
      reportParams({ knownBlockedRules: ["_mongodb._tcp.c0.example.net:*"] }),
      0,
    );
    expect(r.blocked[0].expected).toBe(true);
  });

  it("lets a refused name be declared expected", async () => {
    // The row has no port, so without special handling no writable rule could
    // ever match it and fail_on_blocked would fail the job with no way out.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns denied name=telemetry.example.com.",
    ];
    const r = await buildInspectReportData(
      [START],
      dns,
      reportParams({ knownBlockedRules: ["telemetry.example.com:*"] }),
      0,
    );
    expect(r.blocked[0].expected).toBe(true);
  });

  it("marks everything as audited when nothing was being enforced", async () => {
    const r = await buildInspectReportData(
      [START, ALLOWED],
      [],
      reportParams({ mode: "audit" }),
      0,
    );
    expect(r.timeline[0].action).toBe("audit");
  });

  it("fails closed on a log with no startup marker", async () => {
    // An empty log means either "saw nothing" or "never ran"; only the marker
    // tells them apart, and reporting "nothing was blocked" for a proxy that
    // never started would be the dangerous reading.
    const missing = await buildInspectReportData([], [DNS_START], reportParams(), 0);
    expect(missing.logLooksPlausible).toBe(false);
    expect(missing.startedAt === undefined).toBe(true);

    const present = await buildInspectReportData([START], [DNS_START], reportParams(), 0);
    expect(present.logLooksPlausible).toBe(true);
    expect(present.startedAt).toBe(1787471970);
  });

  it("fails closed when a restart's marker is all that is left of the proxy log", async () => {
    // startedAt still reads from the second marker, so only the head check
    // notices the beginning is gone.
    const r = await buildInspectReportData([ALLOWED, START], [DNS_START], reportParams(), 0);
    expect(r.startedAt).toBe(1787471970);
    expect(r.logLooksPlausible).toBe(false);
  });

  it("fails closed on a proxy line it cannot read, wherever the log begins", async () => {
    // What survived says nothing about what the rest of the line said.
    const unreadable = REFUSED.slice(0, 40);
    const r = await buildInspectReportData(
      [START, ALLOWED, unreadable],
      [DNS_START],
      reportParams(),
      0,
    );
    expect(r.logLooksPlausible).toBe(false);
    expect(r.passed.length).toBe(1);
  });

  it.each([
    { droppedLogs: 1, what: "dropped a line" },
    { droppedLogs: undefined, what: "could not say whether it dropped one" },
  ])("fails closed when the proxy $what", async ({ droppedLogs }) => {
    // A dropped line leaves no gap either log shows, so only the count can
    // tell a whole log from one a flood thinned out.
    const r = await buildInspectReportData(
      [START, ALLOWED],
      [DNS_START],
      reportParams(),
      droppedLogs,
    );
    expect(r.logLooksPlausible).toBe(false);
    expect(r.passed.length).toBe(1);
  });

  it("fails closed when the resolver log lost its beginning, even with the proxy log whole", async () => {
    // A refused name reaches no proxy, so the resolver log is its only trace.
    const dns = [
      "2026-08-23 16:45:00.000000000  [INFO] buildcage dns allowed name=ok.example.com.",
    ];
    const r = await buildInspectReportData([START], dns, reportParams(), 0);
    expect(r.startedAt).toBe(1787471970);
    expect(r.logLooksPlausible).toBe(false);
  });
});
