import { describe, it, expect } from "vitest";

import { ruleHost, sniHost, splitHostPort } from "./authority.ts";

describe("splitHostPort", () => {
  it("reports no port as undefined", () => {
    expect(splitHostPort("example.com")).toStrictEqual({ host: "example.com", port: undefined });
    expect(splitHostPort("")).toStrictEqual({ host: "", port: undefined });
  });

  it("reports a trailing colon as a present but empty port", () => {
    expect(splitHostPort("example.com:")).toStrictEqual({ host: "example.com", port: "" });
  });

  it("splits at the last colon, so a port always wins over anything before it", () => {
    expect(splitHostPort("a:b:443")).toStrictEqual({ host: "a:b", port: "443" });
  });

  describe("IPv6 literals", () => {
    it("splits a bracketed address with a port", () => {
      expect(splitHostPort("[::1]:443")).toStrictEqual({ host: "[::1]", port: "443" });
      expect(splitHostPort("[2001:db8::1]:8443")).toStrictEqual({
        host: "[2001:db8::1]",
        port: "8443",
      });
    });

    it("leaves a bracketed address with no port intact", () => {
      expect(splitHostPort("[::1]")).toStrictEqual({ host: "[::1]", port: undefined });
      expect(splitHostPort("[2001:db8::1]")).toStrictEqual({
        host: "[2001:db8::1]",
        port: undefined,
      });
    });
  });

  // A leading colon is not a separator either: there is no host before it, so
  // the whole thing is treated as the host rather than as a bare port.
  it("does not split on a leading colon", () => {
    expect(splitHostPort(":443")).toStrictEqual({ host: ":443", port: undefined });
  });
});

describe("ruleHost", () => {
  it("lowercases ASCII letters only", () => {
    expect(ruleHost("Registry.NPMJS.org")).toBe("registry.npmjs.org");
    expect(ruleHost("BÜCHER.example")).toBe("bÜcher.example");
  });

  it("drops one trailing dot", () => {
    expect(ruleHost("example.com.")).toBe("example.com");
    expect(ruleHost("example.com..")).toBe("example.com.");
  });
});

describe("sniHost", () => {
  it("lowercases ASCII and keeps a trailing dot", () => {
    expect(sniHost("Registry.NPMJS.org.")).toBe("registry.npmjs.org.");
  });
});
