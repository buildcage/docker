import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { exitOnFatalError } from "#core/lib/actions/fatal.ts";

import { runSetupStep } from "./lib/setup-step.ts";

// Untested by design, down to the end of the file: the self-invocation guard a
// test can never be inside. The step itself is setup-step.ts, tested there.
/* v8 ignore start */
// Node resolves symlinks in import.meta.url but not in argv, and the runner
// may reach the checkout through one.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSetupStep(process.env).catch(exitOnFatalError("setup"));
}
/* v8 ignore stop */
