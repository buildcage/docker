/**
 * Safely extract a message from a caught value of unknown shape — a plain
 * `Error` most of the time, but `catch` doesn't guarantee that.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
