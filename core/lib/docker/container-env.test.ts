import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { parseDockerInspectEnv } from "./container-env.ts";

describe("parseDockerInspectEnv", () => {
  it("parses a JSON array of KEY=VALUE strings into a map", () => {
    assert.deepEqual(parseDockerInspectEnv('["FOO=bar","PROXY_MODE=restrict"]'), {
      FOO: "bar",
      PROXY_MODE: "restrict",
    });
  });

  it("returns an empty object for an empty array", () => {
    assert.deepEqual(parseDockerInspectEnv("[]"), {});
  });

  it("keeps everything after the first '=' as the value, including further '='s", () => {
    assert.deepEqual(parseDockerInspectEnv('["FOO=a=b=c"]'), { FOO: "a=b=c" });
  });

  it("preserves embedded newlines (multi-line rule values)", () => {
    assert.deepEqual(parseDockerInspectEnv('["ALLOWED_HTTPS_RULES=a.com:443\\nb.com:443"]'), {
      ALLOWED_HTTPS_RULES: "a.com:443\nb.com:443",
    });
  });

  it("skips entries with no '='", () => {
    assert.deepEqual(parseDockerInspectEnv('["MALFORMED","OK=1"]'), { OK: "1" });
  });
});

reportResults();
