import { ActionError, errorMessage } from "#core/lib/errors.ts";

import { annotate } from "./annotation.ts";

/**
 * The handler each entry point hands to `main().catch(...)`.
 *
 * An ActionError already says something a user can act on, so it is printed as
 * it stands; anything else is a bug or an environment failure and is labelled
 * as unexpected, with `context` naming which step it escaped from.
 *
 * Shared because every entry point needs the same two arms, and an entry point
 * is exactly where a divergence would go unnoticed: nothing runs it but a
 * real workflow.
 */
export function exitOnFatalError(context: string): (err: unknown) => never {
  return (err: unknown) => {
    if (err instanceof ActionError) {
      annotate.error(err.message);
    } else {
      annotate.error(`Unexpected error in ${context}: ${errorMessage(err)}`);
    }
    process.exit(1);
  };
}
