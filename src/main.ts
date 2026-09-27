import { fileURLToPath } from "node:url";

import { exitOnFatalError } from "#core/lib/actions/fatal.ts";

import { runSetupStep } from "./lib/setup-step.ts";

// Untested by design, down to the end of the file: the self-invocation guard a
// test can never be inside. The step itself is setup-step.ts, tested there.
/* v8 ignore start */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSetupStep(process.env).catch(exitOnFatalError("setup"));
}
/* v8 ignore stop */
