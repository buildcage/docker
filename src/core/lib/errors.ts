/**
 * Base class for an action's own "intentional" errors — a caught failure
 * whose message is safe to print directly via ::error::, as opposed to an
 * unexpected one. A top-level catch checks `instanceof ActionError`.
 * `name` is derived from `new.target`, so a subclass needs no constructor
 * of its own to get its own name.
 */
export class ActionError<Code extends string = string> extends Error {
  code: Code;

  constructor(message: string, code: Code) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * Safely extract a message from a caught value of unknown shape — a plain
 * `Error` most of the time, but `catch` doesn't guarantee that.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
