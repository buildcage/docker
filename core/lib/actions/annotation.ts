export interface Annotation {
  notice(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

/**
 * Build a GitHub Actions annotation emitter. When `enabled` is false, every
 * method is a no-op — used to suppress annotations when this script isn't
 * running as the real action.
 */
export function createAnnotation(enabled: boolean): Annotation {
  if (!enabled) {
    return { notice() {}, warning() {}, error() {} };
  }
  return {
    notice(message: string) {
      console.log(`::notice::${message}`);
    },
    warning(message: string) {
      console.log(`::warning::${message}`);
    },
    error(message: string) {
      console.log(`::error::${message}`);
    },
  };
}
