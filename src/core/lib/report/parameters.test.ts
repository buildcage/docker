import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { buildReportParameters } from "./parameters.ts";

describe("buildReportParameters", () => {
  it("tokenizes each rules field and passes mode through", () => {
    expect(
      buildReportParameters({
        PROXY_MODE: "restrict",
        ALLOWED_HTTPS_RULES: "a.com:443 b.com:443",
        ALLOWED_HTTP_RULES: "c.com:80",
        ALLOWED_IP_RULES: "",
        ALLOW_TLS_RULES: "d.example.com:8443",
        KNOWN_BLOCKED_RULES: "noisy.example.com:443",
      }),
    ).toStrictEqual({
      mode: "restrict",
      allowedHttpsRules: ["a.com:443", "b.com:443"],
      allowedHttpRules: ["c.com:80"],
      allowedIpRules: [],
      allowTlsRules: ["d.example.com:8443"],
      knownBlockedRules: ["noisy.example.com:443"],
    });
  });

  it('defaults mode to "restrict" when unset', () => {
    expect(buildReportParameters({}).mode).toBe("restrict");
  });

  it("returns empty arrays for unset rules fields", () => {
    const params = buildReportParameters({ PROXY_MODE: "audit" });
    expect(params.allowedHttpsRules).toStrictEqual([]);
    expect(params.allowedHttpRules).toStrictEqual([]);
    expect(params.allowedIpRules).toStrictEqual([]);
    expect(params.allowTlsRules).toStrictEqual([]);
    expect(params.knownBlockedRules).toStrictEqual([]);
  });
});

reportResults();
