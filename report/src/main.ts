import { fileURLToPath } from "node:url";

import { exitOnFatalError } from "#core/lib/actions/fatal.ts";

import { runReportStep } from "./lib/report-step.ts";

// Untested by design, down to the end of the file: the self-invocation guard a
// test can never be inside. The step itself is report-step.ts, tested there.
/* v8 ignore start */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runReportStep(process.env).catch(exitOnFatalError("report"));
}
/* v8 ignore stop */
