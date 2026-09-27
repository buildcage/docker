import { describe, it, expect } from "vitest";

import { findReportSourceContainer } from "./find-report-source.ts";
import { ReportError } from "./errors.ts";
import { REPORT_SOURCE_LABEL } from "../../../src/report/report-source.ts";
import type { Docker } from "#core/lib/docker/client.ts";

const PROJECT = "buildcage-0123456789ab";
const BUILDER = "buildcage";

/** Only findContainers is reached; the rest of the interface is unused here. */
function fakeDocker(result: string[] | Error): {
  docker: Docker;
  filters: string[][];
} {
  const filters: string[][] = [];
  return {
    filters,
    docker: {
      findContainers(f) {
        filters.push(f);
        if (result instanceof Error) throw result;
        return result;
      },
    } as Docker,
  };
}

describe("findReportSourceContainer", () => {
  it("matches on the compose project and buildcage's own label", () => {
    const { docker, filters } = fakeDocker(["abc123"]);

    expect(findReportSourceContainer(docker, PROJECT, BUILDER)).toBe("abc123");
    expect(filters).toStrictEqual([
      [`label=com.docker.compose.project=${PROJECT}`, `label=${REPORT_SOURCE_LABEL}=true`],
    ]);
  });

  it("refuses to guess when the setup step left no container behind", () => {
    const { docker } = fakeDocker([]);

    const error = (() => {
      try {
        findReportSourceContainer(docker, PROJECT, BUILDER);
      } catch (e) {
        return e as ReportError;
      }
    })();

    expect(error).toBeInstanceOf(ReportError);
    expect(error!.code).toBe("CONTAINER_NOT_FOUND");
    expect(error!.message).toContain("found 0");
  });

  // Reporting on the wrong container would report on the wrong build.
  it("refuses to guess when more than one container matches", () => {
    const { docker } = fakeDocker(["abc123", "def456"]);

    expect(() => findReportSourceContainer(docker, PROJECT, BUILDER)).toThrow(/found 2/);
  });

  it("blames Docker when the lookup itself fails", () => {
    const { docker } = fakeDocker(
      Object.assign(new Error("exit 1"), { status: 1, stderr: "Cannot connect to the daemon" }),
    );

    const error = (() => {
      try {
        findReportSourceContainer(docker, PROJECT, BUILDER);
      } catch (e) {
        return e as ReportError;
      }
    })();

    expect(error!.code).toBe("DOCKER_UNAVAILABLE");
    expect(error!.message).toContain("docker ps");
  });
});
