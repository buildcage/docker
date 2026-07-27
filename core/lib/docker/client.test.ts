import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { createDocker, parseContainerIds } from "./client.ts";

describe("parseContainerIds", () => {
  it("splits one ID per line", () => {
    assert.deepEqual(parseContainerIds("abc123\ndef456\n"), ["abc123", "def456"]);
  });

  it("returns an empty array for empty output", () => {
    assert.deepEqual(parseContainerIds(""), []);
  });

  it("drops blank lines and trims whitespace", () => {
    assert.deepEqual(parseContainerIds("\n  abc123  \n\n"), ["abc123"]);
  });
});

// Records every invocation's argv and returns a scripted response per call,
// so each test can assert both "what was run" and "what came back".
function fakeRun(responses: string[]): { run: (args: string[]) => string; calls: string[][] } {
  const calls: string[][] = [];
  let i = 0;
  return {
    calls,
    run(args: string[]) {
      calls.push(args);
      return responses[i++] ?? "";
    },
  };
}

describe("createDocker", () => {
  it("findContainers ANDs every filter and parses the ID list", () => {
    const { run, calls } = fakeRun(["abc123\ndef456\n"]);
    const ids = createDocker(run).findContainers(["label=a=1", "label=b=2"]);
    assert.deepEqual(ids, ["abc123", "def456"]);
    assert.deepEqual(calls, [["ps", "--filter", "label=a=1", "--filter", "label=b=2", "--format", "{{.ID}}"]]);
  });

  it("copyFromContainer runs a docker cp with containerId:containerPath -> hostPath", () => {
    const { run, calls } = fakeRun([""]);
    createDocker(run).copyFromContainer("abc123", "/opt/buildcage/scripts/report-action.js", "/tmp/report-action.js");
    assert.deepEqual(calls, [["cp", "abc123:/opt/buildcage/scripts/report-action.js", "/tmp/report-action.js"]]);
  });

  it("readFile runs docker exec cat and returns its stdout", () => {
    const { run, calls } = fakeRun(["log contents\n"]);
    const text = createDocker(run).readFile("abc123", "/var/log/haproxy/current");
    assert.equal(text, "log contents\n");
    assert.deepEqual(calls, [["exec", "abc123", "cat", "/var/log/haproxy/current"]]);
  });

  it("readEnv runs docker inspect and parses the Env JSON array", () => {
    const { run, calls } = fakeRun(['["PROXY_MODE=restrict","FOO=bar"]']);
    const env = createDocker(run).readEnv("abc123");
    assert.deepEqual(env, { PROXY_MODE: "restrict", FOO: "bar" });
    assert.deepEqual(calls, [["inspect", "abc123", "--format", "{{json .Config.Env}}"]]);
  });

  it("exec runs docker exec with the given argv and returns its stdout", () => {
    const { run, calls } = fakeRun(["histories output"]);
    const out = createDocker(run).exec("abc123", ["buildctl", "debug", "histories", "--format", "{{json .}}"]);
    assert.equal(out, "histories output");
    assert.deepEqual(calls, [["exec", "abc123", "buildctl", "debug", "histories", "--format", "{{json .}}"]]);
  });
});

reportResults();
