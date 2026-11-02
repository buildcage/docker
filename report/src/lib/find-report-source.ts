import { describeDockerFailure } from "#core/lib/actions/docker-error.ts";
import type { Docker } from "#core/lib/docker/client.ts";
import { REPORT_SOURCE_LABEL } from "#report/report-source.ts";

import { ReportError } from "./errors.ts";

/**
 * Locates the report-source container purely via Docker metadata: the
 * Compose project this builder-name derives to, plus buildcage's own label.
 * Anything other than exactly one match is an error rather than a guess:
 * reporting on the wrong container would report on the wrong build.
 */
export function findReportSourceContainer(
  docker: Docker,
  projectName: string,
  builderName: string,
): string {
  const filters = [
    `label=com.docker.compose.project=${projectName}`,
    `label=${REPORT_SOURCE_LABEL}=true`,
  ];
  const ids = find(docker, filters);
  if (ids.length === 1) return ids[0];
  // A status filter lists stopped containers too, which plain `docker ps` leaves out.
  if (ids.length === 0 && find(docker, [...filters, "status=exited", "status=dead"]).length > 0) {
    throw new ReportError(
      `The buildcage container for builder-name ${JSON.stringify(builderName)} has stopped, and its proxy with it. ` +
        "The report cannot read the proxy log, and nothing recorded what the build reached after the proxy stopped.",
      "CONTAINER_STOPPED",
    );
  }
  throw new ReportError(
    `Expected exactly one buildcage container for builder-name ${JSON.stringify(builderName)}, found ${ids.length}. ` +
      "Did the setup step run first, with the same builder-name?",
    "CONTAINER_NOT_FOUND",
  );
}

function find(docker: Docker, filters: string[]): string[] {
  try {
    return docker.findContainers(filters);
  } catch (e) {
    throw new ReportError(
      describeDockerFailure(e, { operation: "docker ps" }),
      "DOCKER_UNAVAILABLE",
    );
  }
}
