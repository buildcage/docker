import { describe, it, expect } from "vitest";

import type { TrafficEvent } from "#core/lib/log/traffic-event.ts";

import { annotateKnownBlocked } from "./aggregate.ts";

describe("annotateKnownBlocked", () => {
  const block = (overrides: Partial<TrafficEvent> = {}): TrafficEvent => ({
    time: 1,
    action: "block",
    protocol: "https",
    host: "evil.example.com",
    port: 443,
    reason: "not in allowlist",
    ...overrides,
  });

  const request = (overrides: Partial<TrafficEvent> = {}): TrafficEvent =>
    block({
      host: "api.example.com",
      method: "POST",
      url: "https://api.example.com/telemetry",
      ...overrides,
    });

  it("marks a row as not expected when no rules are given, keeping the aggregated fields", () => {
    const [result] = annotateKnownBlocked([block(), block(), block()], []);
    expect(result.expected).toBe(false);
    expect(result.host).toBe("evil.example.com");
    expect(result.port).toBe("443");
    expect(result.ruleType).toBe("HTTPS");
    expect(result.reason).toBe("not in allowlist");
    expect(result.count).toBe(3);
  });

  it("marks a row as expected whichever host rule syntax matched it", () => {
    for (const rule of [
      "evil.example.com:443",
      "*.example.com:443",
      "~^evil\\.example\\.com:443$",
    ]) {
      expect(annotateKnownBlocked([block()], [rule])[0].expected, rule).toBe(true);
    }
  });

  it("matches the host whatever its case, as the proxy does", () => {
    const shouted = block({ host: "EVIL.Example.COM" });
    for (const rule of [
      "evil.example.com:443",
      "*.example.com:443",
      "~^evil\\.example\\.com:443$",
    ]) {
      expect(annotateKnownBlocked([shouted], [rule])[0].expected, rule).toBe(true);
    }
  });

  it("matches a refused name with a rule that names no port", () => {
    // The block has no port at all, nothing having been connected to, so the
    // rule that declares it expected names none either.
    const dns = block({ host: "_mongodb._tcp.c0.example.net", port: undefined, protocol: "dns" });
    expect(annotateKnownBlocked([dns], ["_mongodb._tcp.c0.example.net"])[0].expected).toBe(true);
    expect(
      annotateKnownBlocked([dns], ["~^_mongodb[.]_tcp[.]c0[.]example[.]net$"])[0].expected,
    ).toBe(true);
  });

  it("matches a refused name in the escaped form the resolver logged", () => {
    // The Corefile matches the same escaped text.
    const dns = block({
      host: String.raw`secret\ data.evil.com`,
      port: undefined,
      protocol: "dns",
    });
    expect(annotateKnownBlocked([dns], ["*.evil.com"])[0].expected).toBe(true);
  });

  it("still lets a port-less rule match a connection that has one", () => {
    // It reads as ":*", so a connection on any port is covered too.
    expect(annotateKnownBlocked([block()], ["evil.example.com"])[0].expected).toBe(true);
  });

  it("does not match when the port differs", () => {
    expect(annotateKnownBlocked([block({ port: 80 })], ["evil.example.com:443"])[0].expected).toBe(
      false,
    );
  });

  it("names the rule that matched, with its port completed", () => {
    expect(annotateKnownBlocked([block()], ["*.example.com"])[0].expectedBy).toBe(
      "*.example.com:*",
    );
  });

  it("leaves expectedBy unset when no rule matched", () => {
    expect(annotateKnownBlocked([block()], ["other.example.com:443"])[0].expectedBy).toBe(
      undefined,
    );
  });

  it("names the first of several matching rules", () => {
    const result = annotateKnownBlocked([block()], ["*.example.com:443", "evil.example.com:443"]);
    expect(result[0].expectedBy).toBe("*.example.com:443");
  });

  it("annotates each row independently across a mixed list", () => {
    const result = annotateKnownBlocked(
      [block({ host: "known.example.com" }), block({ host: "unknown.example.com" })],
      ["known.example.com:443"],
    );
    const known = result.find((row) => row.host === "known.example.com")!;
    const unknown = result.find((row) => row.host === "unknown.example.com")!;
    expect(known.expected).toBe(true);
    expect(unknown.expected).toBe(false);
  });

  describe("URL rules", () => {
    it("matches a blocked request on method, host and path", () => {
      const [row] = annotateKnownBlocked([request()], ["POST https://api.example.com/telemetry"]);
      expect(row.expected).toBe(true);
      expect(row.expectedBy).toBe("POST https://api.example.com/telemetry");
    });

    it("matches the host whatever its case, but not the path", () => {
      const rule = ["POST https://api.example.com/telemetry"];
      const upperHost = request({
        host: "API.Example.com",
        url: "https://API.Example.com/telemetry",
      });
      expect(annotateKnownBlocked([upperHost], rule)[0].expected).toBe(true);
      const upperPath = request({ url: "https://api.example.com/Telemetry" });
      expect(annotateKnownBlocked([upperPath], rule)[0].expected).toBe(false);
    });

    it("does not match when the method differs", () => {
      expect(
        annotateKnownBlocked(
          [request({ method: "GET" })],
          ["POST https://api.example.com/telemetry"],
        )[0].expected,
      ).toBe(false);
    });

    it("does not match when the path differs", () => {
      expect(
        annotateKnownBlocked(
          [request({ url: "https://api.example.com/secret" })],
          ["POST https://api.example.com/telemetry"],
        )[0].expected,
      ).toBe(false);
    });

    it("ignores the query string, as the proxy's path matcher does", () => {
      expect(
        annotateKnownBlocked(
          [request({ url: "https://api.example.com/telemetry?v=2" })],
          ["POST https://api.example.com/telemetry"],
        )[0].expected,
      ).toBe(true);
    });

    it("matches any method and a path wildcard with a * rule", () => {
      const event = request({
        method: "GET",
        host: "noisy.example.com",
        url: "https://noisy.example.com/health/live",
      });
      expect(annotateKnownBlocked([event], ["* https://noisy.example.com/**"])[0].expected).toBe(
        true,
      );
    });

    it("treats a pathless URL rule as any path on the host", () => {
      const event = request({ url: "https://api.example.com/anything/here" });
      expect(annotateKnownBlocked([event], ["POST https://api.example.com"])[0].expected).toBe(
        true,
      );
    });

    it("does not match across schemes, as the proxy buckets rules by scheme", () => {
      // A plaintext HTTP request that happens to be on 443 is not what an
      // https rule acknowledges.
      const httpOn443 = request({ protocol: "http", url: "http://api.example.com/telemetry" });
      expect(
        annotateKnownBlocked([httpOn443], ["* https://api.example.com/telemetry"])[0].expected,
      ).toBe(false);
      const httpRule = request({
        protocol: "http",
        port: 80,
        url: "http://api.example.com/telemetry",
      });
      expect(
        annotateKnownBlocked([httpRule], ["POST http://api.example.com/telemetry"])[0].expected,
      ).toBe(true);
    });

    it("never matches a block with no method or path (a host-level refusal)", () => {
      const refusal = block({ host: "api.example.com" });
      expect(
        annotateKnownBlocked([refusal], ["POST https://api.example.com/telemetry"])[0].expected,
      ).toBe(false);
    });

    it("matches a ~ regex URL rule against the scheme it names", () => {
      const plain = request({
        protocol: "http",
        port: 80,
        url: "http://api.example.com/telemetry",
      });
      expect(
        annotateKnownBlocked([plain], ["POST ~^http://api\\.example\\.com/tele.*$"])[0].expected,
      ).toBe(true);
      expect(
        annotateKnownBlocked([plain], ["POST ~^https://api\\.example\\.com/tele.*$"])[0].expected,
      ).toBe(false);
      // https? covers both, each on its own default port.
      for (const event of [plain, request()]) {
        expect(
          annotateKnownBlocked([event], ["POST ~^https?://api\\.example\\.com/tele.*$"])[0]
            .expected,
        ).toBe(true);
      }
    });

    it("matches a ~ regex URL rule, port optional on the default port", () => {
      expect(
        annotateKnownBlocked([request()], ["POST ~^https://api\\.example\\.com/tele.*$"])[0]
          .expected,
      ).toBe(true);
    });

    it("matches a ~ regex URL rule carrying a non-default port", () => {
      const event = request({ port: 8443, url: "https://api.example.com:8443/telemetry" });
      expect(
        annotateKnownBlocked([event], ["POST ~^https://api\\.example\\.com:8443/tele.*$"])[0]
          .expected,
      ).toBe(true);
    });

    it("marks a host row expected only when every request under it matched", () => {
      const [row] = annotateKnownBlocked(
        [request(), request({ url: "https://api.example.com/secret" })],
        ["POST https://api.example.com/telemetry"],
      );
      expect(row.count).toBe(2);
      expect(row.expected).toBe(false);
    });

    it("marks the row expected when every request under it matched", () => {
      const [row] = annotateKnownBlocked(
        [request(), request({ url: "https://api.example.com/telemetry?x=1" })],
        ["POST https://api.example.com/telemetry"],
      );
      expect(row.count).toBe(2);
      expect(row.expected).toBe(true);
    });

    it("names the earliest matching rule across a row's requests", () => {
      // The first request matches the second rule, the second request the
      // first; the row is grouped under the earliest-written rule regardless.
      const [row] = annotateKnownBlocked(
        [
          request({ url: "https://api.example.com/a" }),
          request({ url: "https://api.example.com/b" }),
        ],
        ["POST https://api.example.com/b", "POST https://api.example.com/a"],
      );
      expect(row.expected).toBe(true);
      expect(row.expectedBy).toBe("POST https://api.example.com/b");
    });
  });
});
