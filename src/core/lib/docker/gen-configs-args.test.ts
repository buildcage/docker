import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

/** The words init-cfg passes after `gen-configs.js`, one per continuation line. */
function initCfgArgs(engine: string): string[] {
  const text = read(`docker/${engine}/files/s6-scripts/init-cfg`);
  const match =
    /qjs --std -m \/opt\/buildcage\/scripts\/gen-configs\.js \\\n((?:.*\\\n)*.*)\n/.exec(text);
  expect(match, "init-cfg's gen-configs.js call").not.toBeNull();
  return match![1].split("\\\n").map((arg) => arg.trim());
}

/** The names a generator destructures `scriptArgs.slice(1)` into, in order. */
function scriptArgNames(path: string): string[] {
  const match = /const \[([^\]]*)\] = scriptArgs\.slice\(1\);/.exec(read(path));
  expect(match, `${path}'s scriptArgs destructuring`).not.toBeNull();
  return match![1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

// What each value init-cfg passes is read as; positional, so only the order
// ties the two together.
const MEANING: Record<string, string> = {
  "/etc/haproxy/haproxy.cfg": "haproxyOut",
  "/etc/coredns/Corefile": "corefileOut",
  '"$GATEWAY"': "proxyAddress",
  '"$HOST_ADDR_FILE"': "hostAddressFile",
  '"${PROXY_MODE:-restrict}"': "mode",
  '"$ALLOWED_HTTPS_RULES"': "httpsInput",
  '"$ALLOWED_HTTP_RULES"': "httpInput",
  '"$ALLOWED_IP_RULES"': "ipInput",
  '"$ALLOWED_TLS_RULES"': "tlsInput",
  '"$ALLOWED_URL_RULES"': "urlInput",
};

describe("the config generators' command line", () => {
  for (const [engine, script] of [
    ["inspect", "src/core/scripts/lib/inspect-configs.qjs.ts"],
    ["universal", "src/core/scripts/gen-configs-universal.qjs.ts"],
  ]) {
    it(`reads each argument ${engine}'s init-cfg passes as what it is`, () => {
      expect(initCfgArgs(engine).map((arg) => MEANING[arg] ?? arg)).toStrictEqual(
        scriptArgNames(script),
      );
    });
  }
});
