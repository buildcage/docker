import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { IPV4_CIDR, IPV4_OR_CIDR, isIpRuleAddress, OCTET_RE } from "./ipv4.ts";

describe("OCTET_RE", () => {
  const cases: [string, boolean][] = [
    ["0", true],
    ["9", true],
    ["10", true],
    ["99", true],
    ["100", true],
    ["199", true],
    ["200", true],
    ["249", true],
    ["250", true],
    ["255", true],
    ["256", false],
    ["300", false],
    ["00", false],
    ["01", false],
    ["010", false],
    ["", false],
    ["1a", false],
    ["-1", false],
  ];
  for (const [octet, expected] of cases) {
    it(`${expected ? "accepts" : "refuses"} "${octet}"`, () => {
      expect(OCTET_RE.test(octet)).toBe(expected);
    });
  }
});

describe("IPV4_OR_CIDR", () => {
  const cases: [string, boolean][] = [
    ["10.0.0.1", true],
    ["0.0.0.0", true],
    ["255.255.255.255", true],
    ["10.0.0.0/0", true],
    ["10.0.0.0/8", true],
    ["10.0.0.0/32", true],
    ["010.0.0.1", false],
    ["10.0.0.256", false],
    ["999.1.1.1", false],
    ["1.2.3", false],
    ["1.2.3.4.5", false],
    ["10.0.0.0/33", false],
    ["10.0.0.0/08", false],
    ["10.0.0.0/", false],
    ["example.com", false],
  ];
  for (const [address, expected] of cases) {
    it(`${expected ? "accepts" : "refuses"} ${address}`, () => {
      expect(IPV4_OR_CIDR.test(address)).toBe(expected);
    });
  }
});

describe("IPV4_CIDR", () => {
  it("requires a prefix", () => {
    expect(IPV4_CIDR.test("10.0.0.0/8")).toBe(true);
    expect(IPV4_CIDR.test("10.0.0.0")).toBe(false);
  });
});

describe("isIpRuleAddress", () => {
  const cases: [string, boolean][] = [
    ["10.0.0.5", true],
    ["10.0.0.0/24", true],
    ["10.0.0.*", true],
    ["10.0.?.1", true],
    ["10.**", true],
    ["**", true],
    ["*.*.*.*", true],
    ["010.0.0.1", false],
    ["256.0.0.1", false],
    ["10.0.0.0/33", false],
    ["10.0.*.010", false],
    ["10.0.*.256", false],
    ["10.0.*", false],
    ["*", false],
    ["10.0.0.*.1", false],
    ["db-primary", false],
  ];
  for (const [host, expected] of cases) {
    it(`${expected ? "accepts" : "refuses"} ${host}`, () => {
      expect(isIpRuleAddress(host)).toBe(expected);
    });
  }
});

reportResults();
