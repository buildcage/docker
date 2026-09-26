import { describe, it, expect } from "vitest";

import { buildComposeEnv, type ComposeEnvOptions } from "./compose-env.ts";

const HOST_ADDRESSES = () => ["10.0.0.4", "172.17.0.1"];

function options(overrides: Partial<ComposeEnvOptions> = {}): ComposeEnvOptions {
  return {
    builderName: "buildcage",
    proxyMode: "restrict",
    proxyEngine: "universal",
    failOnCaResidue: true,
    imageRef: "ghcr.io/buildcage/docker@sha256:feedface",
    httpsRules: [],
    httpRules: [],
    ipRules: [],
    urlRules: [],
    tlsRules: [],
    knownBlockedRules: [],
    ...overrides,
  };
}

describe("buildComposeEnv", () => {
  it("carries every resolved input the engine reads", () => {
    const env = buildComposeEnv(
      options({
        builderName: "second",
        proxyMode: "audit",
        proxyEngine: "inspect",
        failOnCaResidue: false,
        httpsRules: ["registry.npmjs.org:443", "*.githubusercontent.com:443"],
        httpRules: ["deb.debian.org:80"],
        ipRules: ["10.0.0.0/8"],
        urlRules: ["GET https://api.github.com/repos/*"],
        tlsRules: ["*.example.com:443"],
        knownBlockedRules: ["telemetry.example.com:443"],
      }),
      {},
      HOST_ADDRESSES,
    );

    expect(env).toStrictEqual({
      BUILDER_NAME: "second",
      PROXY_MODE: "audit",
      PROXY_ENGINE: "inspect",
      FAIL_ON_CA_RESIDUE: "false",
      ALLOWED_HTTPS_RULES: "registry.npmjs.org:443\n*.githubusercontent.com:443",
      ALLOWED_HTTP_RULES: "deb.debian.org:80",
      ALLOWED_IP_RULES: "10.0.0.0/8",
      ALLOWED_URL_RULES: "GET https://api.github.com/repos/*",
      ALLOWED_TLS_RULES: "*.example.com:443",
      KNOWN_BLOCKED_RULES: "telemetry.example.com:443",
      BUILDCAGE_IMAGE_REF: "ghcr.io/buildcage/docker@sha256:feedface",
      EXTERNAL_RESOLVER: "",
      HOST_ADDRESSES: "10.0.0.4 172.17.0.1",
    });
  });

  it("passes the job environment through, so docker compose keeps working", () => {
    const env = buildComposeEnv(
      options(),
      { PATH: "/usr/bin", DOCKER_HOST: "unix:///x.sock" },
      () => [],
    );

    expect(env.PATH).toBe("/usr/bin");
    expect(env.DOCKER_HOST).toBe("unix:///x.sock");
  });

  // A resolver left to the step environment would be a previous step's choice,
  // not the action's.
  it("pins EXTERNAL_RESOLVER rather than inheriting it", () => {
    const env = buildComposeEnv(options(), { EXTERNAL_RESOLVER: "8.8.8.8" }, () => []);

    expect(env.EXTERNAL_RESOLVER).toBe("");
  });

  // A URL rule contains a space, unlike the others, so no rule list can be
  // space separated.
  it("separates every rule list by newline", () => {
    const env = buildComposeEnv(
      options({
        httpsRules: ["a:443", "b:443"],
        urlRules: ["GET https://a/x", "POST https://b/y"],
      }),
      {},
      () => [],
    );

    expect(env.ALLOWED_HTTPS_RULES).toBe("a:443\nb:443");
    expect(env.ALLOWED_URL_RULES).toBe("GET https://a/x\nPOST https://b/y");
  });
});
