import { describeDockerFailure } from "#core/lib/actions/docker-error.ts";
import type { Docker } from "#core/lib/docker/client.ts";
import { REPORT_SOURCE_LABEL } from "#report/report-source.ts";

import { ReportError } from "./errors.ts";

/**
 * Locates the report-source container purely via Docker metadata: the
 * Compose project this builder_name derives to, plus buildcage's own label.
 * Anything other than exactly one match is an error rather than a guess:
 * reporting on the wrong container would report on the wrong build.
 */
export function findReportSourceContainer(
  docker: Docker,
  projectName: string,
  builderName: string,
): string {
  let ids: string[];
  try {
    ids = docker.findContainers([
      `label=com.docker.compose.project=${projectName}`,
      `label=${REPORT_SOURCE_LABEL}=true`,
    ]);
  } catch (e) {
    throw new ReportError(
      describeDockerFailure(e, { operation: "docker ps" }),
      "DOCKER_UNAVAILABLE",
    );
  }
  if (ids.length !== 1) {
    throw new ReportError(
      `Expected exactly one buildcage container for builder_name ${JSON.stringify(builderName)}, found ${ids.length}. ` +
        "Did the setup step run first, with the same builder_name?",
      "CONTAINER_NOT_FOUND",
    );
  }
  return ids[0];
}
