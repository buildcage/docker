import { describe, it, expect } from "vitest";

import { readGhcrBasicAuth } from "./docker-credentials.ts";

describe("readGhcrBasicAuth", () => {
  const mockReadFileSync = (content: string) => (_path: string, _enc: string) => content;

  it("returns auth when auths['ghcr.io'].auth is present", () => {
    const config = JSON.stringify({ auths: { "ghcr.io": { auth: "dGVzdDp0b2tlbg==" } } });
    const result = readGhcrBasicAuth({}, mockReadFileSync(config));
    expect(result).toBe("dGVzdDp0b2tlbg==");
  });

  it("normalizes https:// prefix and trailing slash in key", () => {
    const config = JSON.stringify({ auths: { "https://ghcr.io/": { auth: "dGVzdA==" } } });
    const result = readGhcrBasicAuth({}, mockReadFileSync(config));
    expect(result).toBe("dGVzdA==");
  });

  it("returns null when ghcr.io entry is absent", () => {
    const config = JSON.stringify({ auths: { "docker.io": { auth: "dGVzdA==" } } });
    expect(readGhcrBasicAuth({}, mockReadFileSync(config))).toBe(null);
  });

  it("returns null when the ghcr.io entry has no auth (credsStore environment)", () => {
    const config = JSON.stringify({ auths: { "ghcr.io": {} } });
    expect(readGhcrBasicAuth({}, mockReadFileSync(config))).toBe(null);
  });

  it("returns null when auths is absent", () => {
    const config = JSON.stringify({ credsStore: "desktop" });
    expect(readGhcrBasicAuth({}, mockReadFileSync(config))).toBe(null);
  });

  it("returns null on file read error (not logged in at all)", () => {
    const throwingRead = () => {
      throw new Error("ENOENT");
    };
    expect(readGhcrBasicAuth({}, throwingRead)).toBe(null);
  });

  it("returns null on invalid JSON", () => {
    expect(readGhcrBasicAuth({}, mockReadFileSync("not json"))).toBe(null);
  });

  it("uses DOCKER_CONFIG env var to resolve config path", () => {
    let capturedPath: string | undefined;
    const readSpy = (p: string) => {
      capturedPath = p;
      return JSON.stringify({ auths: {} });
    };
    readGhcrBasicAuth({ DOCKER_CONFIG: "/custom/docker" }, readSpy);
    expect(
      capturedPath?.startsWith("/custom/docker"),
      `expected path under DOCKER_CONFIG, got: ${capturedPath}`,
    ).toBeTruthy();
  });
});
