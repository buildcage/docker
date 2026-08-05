import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { buildDockerCpArgs } from "./cp-args.ts";

describe("buildDockerCpArgs", () => {
  it("builds a `docker cp <container>:<containerPath> <hostPath>` argv", () => {
    assert.deepEqual(
      buildDockerCpArgs({
        containerName: "buildcage-proxy-abcd1234",
        containerPath: "/opt/buildcage/bin/runc",
        hostPath: "/tmp/x/runc",
      }),
      ["cp", "buildcage-proxy-abcd1234:/opt/buildcage/bin/runc", "/tmp/x/runc"],
    );
  });
});

reportResults();
