import { describe, it, expect } from "vitest";

import { DEFAULT_BUILDER_NAME } from "#report/report-source.ts";

import { readBuilderName, readSetupInputs, resolveProxyMode } from "./inputs.ts";

/** Stands in for core.getInput, which returns "" for anything unset. */
function inputs(values: Record<string, string> = {}): (name: string) => string {
  return (name) => values[name] ?? "";
}

describe("readBuilderName", () => {
  it("returns the input when set", () => {
    expect(readBuilderName(inputs({ builder_name: "mine" }))).toBe("mine");
  });

  it("falls back to the shared default when unset", () => {
    expect(readBuilderName(inputs())).toBe(DEFAULT_BUILDER_NAME);
  });

  // action.yml's own default supplies "buildcage" in a real run, so an empty
  // string only happens outside the Actions runtime, where the fallback has
  // to produce the same name the other two steps derive.
  it("treats an empty input as unset rather than as a builder named ''", () => {
    expect(readBuilderName(inputs({ builder_name: "" }))).toBe(DEFAULT_BUILDER_NAME);
  });
});

describe("readSetupInputs", () => {
  it("defaults proxy_engine to inspect", () => {
    expect(readSetupInputs(inputs()).proxyEngine).toBe("inspect");
  });

  it("keeps an explicit proxy_engine", () => {
    expect(readSetupInputs(inputs({ proxy_engine: "universal" })).proxyEngine).toBe("universal");
  });

  it("rejects an unknown engine before any other input", () => {
    expect(() => readSetupInputs(inputs({ proxy_engine: "nope", proxy_mode: "Audit" }))).toThrow(
      /Invalid proxy_engine/,
    );
  });

  it("rejects the removed transparent alias", () => {
    expect(() => readSetupInputs(inputs({ proxy_engine: "transparent" }))).toThrow(
      /transparent has been renamed/,
    );
  });

  it("reads builder_name", () => {
    expect(readSetupInputs(inputs({ builder_name: "mine" })).builderName).toBe("mine");
  });

  it("reads fail_on_ca_residue", () => {
    expect(readSetupInputs(inputs({ fail_on_ca_residue: "false" })).failOnCaResidue).toBe(false);
  });

  // A typo read as false would let a copy of the CA into the image unannounced.
  it("rejects a fail_on_ca_residue that is not a boolean", () => {
    expect(() => readSetupInputs(inputs({ fail_on_ca_residue: "no" }))).toThrow(
      'Invalid fail_on_ca_residue: "no". Must be true or false.',
    );
  });

  it("defaults proxy_mode to restrict", () => {
    expect(readSetupInputs(inputs()).proxyMode).toBe("restrict");
  });

  it("keeps an explicit proxy_mode", () => {
    expect(readSetupInputs(inputs({ proxy_mode: "audit" })).proxyMode).toBe("audit");
  });

  it("rejects an unknown proxy_mode before any rule", () => {
    expect(() =>
      readSetupInputs(inputs({ proxy_mode: "Audit", allowed_https_rules: "no-port" })),
    ).toThrow(/Invalid proxy_mode/);
  });

  it("returns empty rule lists when nothing is set", () => {
    expect(readSetupInputs(inputs())).toStrictEqual({
      proxyEngine: "inspect",
      builderName: DEFAULT_BUILDER_NAME,
      proxyMode: "restrict",
      failOnCaResidue: true,
      httpsRules: [],
      httpRules: [],
      ipRules: [],
      urlRules: [],
      tlsRules: [],
      knownBlockedRules: [],
    });
  });

  it("parses every rule kind", () => {
    const parsed = readSetupInputs(
      inputs({
        allowed_https_rules: "a.example.com:443",
        allowed_http_rules: "b.example.com:80",
        allowed_ip_rules: "10.0.0.5:5432",
        allowed_tls_rules: "db.example.com:443",
        allowed_url_rules: "GET https://a.example.com/pkg.json",
        known_blocked_rules: "*.sury.org:*",
      }),
    );
    expect(parsed.httpsRules).toStrictEqual(["a.example.com:443"]);
    expect(parsed.httpRules).toStrictEqual(["b.example.com:80"]);
    expect(parsed.ipRules).toStrictEqual(["10.0.0.5:5432"]);
    expect(parsed.tlsRules).toStrictEqual(["db.example.com:443"]);
    expect(parsed.knownBlockedRules).toStrictEqual(["*.sury.org:*"]);
  });

  // URL rules reach the container as their raw text; only it re-compiles them.
  it("returns URL rules as their raw text, not the compiled form", () => {
    const parsed = readSetupInputs(
      inputs({ allowed_url_rules: "GET https://a.example.com/pkg.json" }),
    );
    expect(parsed.urlRules).toStrictEqual(["GET https://a.example.com/pkg.json"]);
  });

  it("rejects a malformed rule rather than passing it to the container", () => {
    expect(() => readSetupInputs(inputs({ allowed_https_rules: "no-port" }))).toThrow();
  });

  // Compiled at setup on every engine, even the two that ignore them, so a
  // typo fails here rather than silently doing nothing inside the container.
  it("rejects a malformed URL rule even though only inspect enforces one", () => {
    expect(() => readSetupInputs(inputs({ allowed_url_rules: "GET not-a-url" }))).toThrow(
      expect.objectContaining({ code: "INVALID_RULES" }),
    );
  });

  it("rejects a rule the setup parser accepts but the container would refuse", () => {
    expect(() => readSetupInputs(inputs({ allowed_https_rules: "10.0.0.0/8:443" }))).toThrow(
      expect.objectContaining({ code: "INVALID_RULES" }),
    );
  });
});

describe("resolveProxyMode", () => {
  it("defaults to restrict when unset or blank", () => {
    expect(resolveProxyMode(undefined)).toBe("restrict");
    expect(resolveProxyMode("  ")).toBe("restrict");
  });

  it("accepts both modes", () => {
    expect(resolveProxyMode("audit")).toBe("audit");
    expect(resolveProxyMode("restrict")).toBe("restrict");
  });

  // Anything else would enforce a run meant only to record.
  it("rejects anything else, a differently cased mode included", () => {
    for (const mode of ["Audit", "RESTRICT", "enforce"]) {
      expect(() => resolveProxyMode(mode)).toThrow(
        expect.objectContaining({ code: "INVALID_PROXY_MODE" }),
      );
    }
  });
});
