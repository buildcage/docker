import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { deriveProjectName, buildDockerCpArgs } from "./container.ts";

describe("buildDockerCpArgs", () => {
  it("builds a `docker cp <container>:<containerPath> <hostPath>` argv", () => {
    assert.deepEqual(
      buildDockerCpArgs({ containerName: "buildcage-proxy-abcd1234", containerPath: "/opt/buildcage/bin/runc", hostPath: "/tmp/x/runc" }),
      ["cp", "buildcage-proxy-abcd1234:/opt/buildcage/bin/runc", "/tmp/x/runc"],
    );
  });
});

describe("deriveProjectName", () => {
  it("returns the container name unchanged", () => {
    assert.equal(deriveProjectName("buildcage-proxy-abcd1234"), "buildcage-proxy-abcd1234");
  });

  it("matches docker compose's project-name character constraints", () => {
    assert.match(deriveProjectName("buildcage-proxy-abcd1234"), /^[a-z0-9][a-z0-9_-]*$/);
    assert.match(deriveProjectName("buildcage"), /^[a-z0-9][a-z0-9_-]*$/);
  });
});

reportResults();
