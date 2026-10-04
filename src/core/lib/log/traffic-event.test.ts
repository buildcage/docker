import { describe, it, expect } from "vitest";

import { connectedHosts, isRedundantDns, type TrafficEvent } from "./traffic-event.ts";

function event(
  partial: Partial<TrafficEvent> & Pick<TrafficEvent, "protocol" | "action" | "host">,
): TrafficEvent {
  return { time: 0, ...partial };
}

/** The check as a caller makes it: index the timeline, then ask about one event. */
function redundant(subject: TrafficEvent, timeline: TrafficEvent[]): boolean {
  return isRedundantDns(subject, connectedHosts(timeline));
}

describe("isRedundantDns", () => {
  it("is redundant once a refused request for the same host also appears", () => {
    const dns = event({ protocol: "dns", action: "block", host: "notallowed.example.com" });
    const request = event({ protocol: "https", action: "block", host: "notallowed.example.com" });
    expect(redundant(dns, [dns, request])).toBe(true);
  });

  it("is not redundant when the lookup is its only trace", () => {
    const dns = event({
      protocol: "dns",
      action: "block",
      host: "secret-in-a-name.attacker.example",
    });
    expect(redundant(dns, [dns])).toBe(false);
  });

  it("is not made redundant by a request for a different host", () => {
    const dns = event({ protocol: "dns", action: "block", host: "a.example.com" });
    const request = event({ protocol: "https", action: "block", host: "b.example.com" });
    expect(redundant(dns, [dns, request])).toBe(false);
  });

  it("keeps a refused lookup that an allowed request contradicts", () => {
    const dns = event({ protocol: "dns", action: "block", host: "a.example.com" });
    const request = event({ protocol: "https", action: "allow", host: "a.example.com" });
    expect(redundant(dns, [dns, request])).toBe(false);
  });

  it("drops a resolved lookup once anything connected on it", () => {
    const dns = event({ protocol: "dns", action: "allow", host: "a.example.com" });
    const request = event({ protocol: "https", action: "allow", host: "a.example.com" });
    expect(redundant(dns, [dns, request])).toBe(true);
  });

  it("keeps a lookup whose only connection ended before a request", () => {
    // What a client that cannot trust the CA leaves, and no table lists it.
    const dns = event({ protocol: "dns", action: "allow", host: "a.example.com" });
    const ended = event({
      protocol: "https",
      action: "incomplete",
      host: "a.example.com",
      reason: "client-tls-failed",
    });
    expect(redundant(dns, [dns, ended])).toBe(false);
  });

  it("drops a lookup once a connection sent its name with a trailing dot", () => {
    const dns = event({ protocol: "dns", action: "allow", host: "a.example.com" });
    const pass = event({ protocol: "tls", action: "allow", host: "a.example.com." });
    expect(redundant(dns, [dns, pass])).toBe(true);
  });

  it("ignores a second DNS record for the same host", () => {
    // Two records for one name (the plain name and a search-domain variant of
    // it, say) do not make each other redundant. Only a connection does.
    const dns1 = event({ protocol: "dns", action: "block", host: "blocked.example.com" });
    const dns2 = event({ protocol: "dns", action: "block", host: "blocked.example.com" });
    expect(redundant(dns1, [dns1, dns2])).toBe(false);
  });

  it("never applies to a discovery lookup, whose name nothing connects to", () => {
    // A service name resolves to the proxy like any other, so a client that
    // did connect to one must not take the row carrying the type away.
    const lookup = event({
      protocol: "dns",
      action: "discovery",
      host: "_http._tcp.deb.debian.org",
      queryType: "SRV",
    });
    const request = event({ protocol: "http", action: "allow", host: "_http._tcp.deb.debian.org" });
    expect(redundant(lookup, [lookup, request])).toBe(false);
  });

  it("does not apply to a non-dns event", () => {
    const request = event({ protocol: "https", action: "block", host: "a.example.com" });
    expect(redundant(request, [request])).toBe(false);
  });
});

describe("connectedHosts", () => {
  it("indexes only what was connected to, split by outcome", () => {
    const connected = connectedHosts([
      event({ protocol: "https", action: "allow", host: "allowed.example.com" }),
      event({ protocol: "https", action: "block", host: "refused.example.com" }),
      event({ protocol: "dns", action: "block", host: "lookup.example.com" }),
    ]);
    expect([...connected.any].sort().join(",")).toBe("allowed.example.com,refused.example.com");
    expect([...connected.blocked].join(",")).toBe("refused.example.com");
  });
});
