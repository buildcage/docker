import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { parseIdentifier } from "./parse-identifier.ts";

describe("parseIdentifier", () => {
  it("fills in the default port when none is present", () => {
    expect(parseIdentifier("https://allowed.example.com/")).toStrictEqual({
      scheme: "https",
      host: "allowed.example.com",
      port: "443",
    });
    expect(parseIdentifier("http://allowed.example.com/")).toStrictEqual({
      scheme: "http",
      host: "allowed.example.com",
      port: "80",
    });
  });

  it("keeps an explicit non-default port", () => {
    expect(parseIdentifier("https://allowed.example.com:8443/")).toStrictEqual({
      scheme: "https",
      host: "allowed.example.com",
      port: "8443",
    });
  });

  it("returns null for non-http(s) identifiers", () => {
    expect(parseIdentifier("docker-image://docker.io/library/alpine:latest")).toBe(null);
  });
});

reportResults();
