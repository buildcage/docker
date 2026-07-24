import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { parseIdentifier } from "./parse-identifier.ts";

describe("parseIdentifier", () => {
  it("fills in the default port when none is present", () => {
    assert.deepEqual(parseIdentifier("https://allowed.example.com/"), {
      scheme: "https",
      host: "allowed.example.com",
      port: "443",
    });
    assert.deepEqual(parseIdentifier("http://allowed.example.com/"), {
      scheme: "http",
      host: "allowed.example.com",
      port: "80",
    });
  });

  it("keeps an explicit non-default port", () => {
    assert.deepEqual(parseIdentifier("https://allowed.example.com:8443/"), {
      scheme: "https",
      host: "allowed.example.com",
      port: "8443",
    });
  });

  it("returns null for non-http(s) identifiers", () => {
    assert.equal(parseIdentifier("docker-image://docker.io/library/alpine:latest"), null);
  });
});

reportResults();
