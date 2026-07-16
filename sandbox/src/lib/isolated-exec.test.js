import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { writeRunScript, writeEnvDump, withScratchDir } from "./isolated-exec.js";

describe("writeRunScript", () => {
  it("wraps plain commands in a #!/bin/sh + set -e preamble", () => {
    withScratchDir((dir) => {
      const path = writeRunScript("echo hello", dir);
      const content = readFileSync(path, "utf8");
      assert.equal(content, "#!/bin/sh\nset -e\necho hello\n");
    });
  });

  it("leaves an input that already starts with a shebang untouched", () => {
    withScratchDir((dir) => {
      const script = "#!/usr/bin/env bash\necho custom-shebang\n";
      const path = writeRunScript(script, dir);
      assert.equal(readFileSync(path, "utf8"), script);
    });
  });

  it("writes the script as executable", () => {
    withScratchDir((dir) => {
      const path = writeRunScript("echo hi", dir);
      const mode = statSync(path).mode & 0o777;
      assert.equal(mode, 0o700);
    });
  });
});

describe("writeEnvDump", () => {
  it("writes NUL-separated KEY=VALUE pairs", () => {
    withScratchDir((dir) => {
      const path = writeEnvDump({ FOO: "bar", BAZ: "qux" }, dir);
      const content = readFileSync(path, "utf8");
      assert.equal(content, "FOO=bar\0BAZ=qux\0");
    });
  });

  it("skips undefined values", () => {
    withScratchDir((dir) => {
      const path = writeEnvDump({ FOO: "bar", SKIP: undefined }, dir);
      assert.equal(readFileSync(path, "utf8"), "FOO=bar\0");
    });
  });

  it("writes the env dump 0600 (it can hold secrets from the step's env:)", () => {
    withScratchDir((dir) => {
      const path = writeEnvDump({ SECRET: "s3cr3t" }, dir);
      const mode = statSync(path).mode & 0o777;
      assert.equal(mode, 0o600);
    });
  });
});

describe("withScratchDir", () => {
  it("removes the directory after the callback returns", () => {
    let capturedDir;
    withScratchDir((dir) => {
      capturedDir = dir;
      writeRunScript("echo hi", dir);
    });
    assert.throws(() => readFileSync(join(capturedDir, "run-script.sh")));
  });

  it("removes the directory even if the callback throws", () => {
    let capturedDir;
    assert.throws(() => {
      withScratchDir((dir) => {
        capturedDir = dir;
        throw new Error("boom");
      });
    });
    assert.throws(() => readFileSync(join(capturedDir, "run-script.sh")));
  });
});
