import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { parseDockerInspectEnv } from "./container-env.ts";

describe("parseDockerInspectEnv", () => {
  it("parses a JSON array of KEY=VALUE strings into a map", () => {
    expect(parseDockerInspectEnv('["FOO=bar","PROXY_MODE=restrict"]')).toStrictEqual({
      FOO: "bar",
      PROXY_MODE: "restrict",
    });
  });

  it("returns an empty object for an empty array", () => {
    expect(parseDockerInspectEnv("[]")).toStrictEqual({});
  });

  it("keeps everything after the first '=' as the value, including further '='s", () => {
    expect(parseDockerInspectEnv('["FOO=a=b=c"]')).toStrictEqual({ FOO: "a=b=c" });
  });

  it("preserves embedded newlines (multi-line rule values)", () => {
    expect(parseDockerInspectEnv('["ALLOWED_HTTPS_RULES=a.com:443\\nb.com:443"]')).toStrictEqual({
      ALLOWED_HTTPS_RULES: "a.com:443\nb.com:443",
    });
  });

  it("skips entries with no '='", () => {
    expect(parseDockerInspectEnv('["MALFORMED","OK=1"]')).toStrictEqual({ OK: "1" });
  });
});

reportResults();
