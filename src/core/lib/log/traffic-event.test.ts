import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { isRedundantBlockedDns, type TrafficEvent } from "./traffic-event.ts";

function event(
  partial: Partial<TrafficEvent> & Pick<TrafficEvent, "protocol" | "action" | "host">,
): TrafficEvent {
  return { time: 0, ...partial };
}

describe("isRedundantBlockedDns", () => {
  it("is redundant once a blocked request for the same host also appears", () => {
    const dns = event({ protocol: "dns", action: "block", host: "notallowed.example.com" });
    const request = event({ protocol: "https", action: "block", host: "notallowed.example.com" });
    expect(isRedundantBlockedDns(dns, [dns, request])).toBe(true);
  });

  it("is not redundant when the DNS block is its only trace", () => {
    const dns = event({
      protocol: "dns",
      action: "block",
      host: "secret-in-a-name.attacker.example",
    });
    expect(isRedundantBlockedDns(dns, [dns])).toBe(false);
  });

  it("is not made redundant by a blocked request for a different host", () => {
    const dns = event({ protocol: "dns", action: "block", host: "a.example.com" });
    const request = event({ protocol: "https", action: "block", host: "b.example.com" });
    expect(isRedundantBlockedDns(dns, [dns, request])).toBe(false);
  });

  it("only a blocked non-dns record for the same host counts, not an allowed one", () => {
    const dns = event({ protocol: "dns", action: "block", host: "a.example.com" });
    const request = event({ protocol: "https", action: "allow", host: "a.example.com" });
    expect(isRedundantBlockedDns(dns, [dns, request])).toBe(false);
  });

  it("ignores a second DNS record for the same host", () => {
    // Two refused DNS records (e.g. the plain name and a search-domain
    // variant of it) do not make each other redundant -- only a non-dns
    // block does.
    const dns1 = event({ protocol: "dns", action: "block", host: "blocked.example.com" });
    const dns2 = event({ protocol: "dns", action: "block", host: "blocked.example.com" });
    expect(isRedundantBlockedDns(dns1, [dns1, dns2])).toBe(false);
  });

  it("does not apply to a non-dns or non-blocked event", () => {
    const request = event({ protocol: "https", action: "block", host: "a.example.com" });
    const allowedDns = event({ protocol: "dns", action: "allow", host: "a.example.com" });
    expect(isRedundantBlockedDns(request, [request])).toBe(false);
    expect(isRedundantBlockedDns(allowedDns, [allowedDns, request])).toBe(false);
  });
});

reportResults();
