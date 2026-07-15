/**
 * Build a GitHub Actions annotation emitter. When `enabled` is false, every
 * method is a no-op — used to suppress annotations when this script isn't
 * running as the real report action (see main.js's `outputForAction`).
 *
 * @param {boolean} enabled
 * @returns {{ notice(message: string): void, warning(message: string): void, error(message: string): void }}
 */
export function createAnnotation(enabled) {
  if (!enabled) {
    return { notice() {}, warning() {}, error() {} };
  }
  return {
    notice(message) {
      console.log(`::notice::${message}`);
    },
    warning(message) {
      console.log(`::warning::${message}`);
    },
    error(message) {
      console.log(`::error::${message}`);
    },
  };
}
