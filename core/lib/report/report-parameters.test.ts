import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { buildReportParameters } from "./report-parameters.ts";

describe("buildReportParameters", () => {
  it("tokenizes each rules field and passes mode through", () => {
    assert.deepEqual(
      buildReportParameters({
        PROXY_MODE: "restrict",
        ALLOWED_HTTPS_RULES: "a.com:443 b.com:443",
        ALLOWED_HTTP_RULES: "c.com:80",
        ALLOWED_IP_RULES: "",
        KNOWN_BLOCKED_RULES: "noisy.example.com:443",
      }),
      {
        mode: "restrict",
        allowedHttpsRules: ["a.com:443", "b.com:443"],
        allowedHttpRules: ["c.com:80"],
        allowedIpRules: [],
        knownBlockedRules: ["noisy.example.com:443"],
      },
    );
  });

  it('defaults mode to "restrict" when unset', () => {
    assert.equal(buildReportParameters({}).mode, "restrict");
  });

  it("returns empty arrays for unset rules fields", () => {
    const params = buildReportParameters({ PROXY_MODE: "audit" });
    assert.deepEqual(params.allowedHttpsRules, []);
    assert.deepEqual(params.allowedHttpRules, []);
    assert.deepEqual(params.allowedIpRules, []);
    assert.deepEqual(params.knownBlockedRules, []);
  });
});

reportResults();
