import { describe, it, expect } from "vitest";

import type { Docker } from "#core/lib/docker/client.ts";
import { REPORT_SOURCE_LABEL } from "#report/report-source.ts";

import { ReportError } from "./errors.ts";
import { findReportSourceContainer } from "./find-report-source.ts";

const PROJECT = "buildcage-0123456789ab";
const BUILDER = "buildcage";

/** Only findContainers is reached; the rest of the interface is unused here.
 *  Each lookup takes the next result, and the last one repeats. */
function fakeDocker(...results: (string[] | Error)[]): {
  docker: Docker;
  filters: string[][];
} {
  const filters: string[][] = [];
  return {
    filters,
    docker: {
      findContainers(f) {
        const result = results[Math.min(filters.length, results.length - 1)];
        filters.push(f);
        if (result instanceof Error) throw result;
        return result;
      },
    } as Docker,
  };
}

function thrown(run: () => unknown): ReportError {
  try {
    run();
  } catch (e) {
    return e as ReportError;
  }
  throw new Error("did not throw");
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

  it("says the container stopped when only a stopped one matches", () => {
    const { docker, filters } = fakeDocker([], ["abc123"]);

    const error = thrown(() => findReportSourceContainer(docker, PROJECT, BUILDER));

    expect(error).toBeInstanceOf(ReportError);
    expect(error.code).toBe("CONTAINER_STOPPED");
    expect(error.message).toContain('builder-name "buildcage" has stopped');
    expect(filters[1]).toStrictEqual([...filters[0], "status=exited", "status=dead"]);
  });

  it("blames Docker when the lookup for a stopped container fails", () => {
    const { docker } = fakeDocker(
      [],
      Object.assign(new Error("exit 1"), { status: 1, stderr: "Cannot connect to the daemon" }),
    );

    expect(thrown(() => findReportSourceContainer(docker, PROJECT, BUILDER)).code).toBe(
      "DOCKER_UNAVAILABLE",
    );
  });

  it("looks for a stopped container only when no running one matches", () => {
    const { docker, filters } = fakeDocker(["abc123", "def456"]);

    expect(() => findReportSourceContainer(docker, PROJECT, BUILDER)).toThrow(/found 2/);
    expect(filters.length).toBe(1);
  });
});
