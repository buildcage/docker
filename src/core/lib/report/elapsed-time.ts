/**
 * Formats a duration in seconds as clock digits, for the inspect engine's
 * report: every event is timestamped relative to when the proxy itself
 * started, not shown as an absolute time.
 */

interface Parts {
  hours: number;
  minutes: number;
  seconds: number;
  ms: number;
}

function toParts(elapsedSeconds: number): Parts {
  const totalMs = Math.max(0, Math.round(elapsedSeconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return { hours, minutes, seconds, ms };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/**
 * MM:SS.mmm, widening to HH:MM:SS.mmm only once elapsed reaches an hour --
 * a build that runs a few minutes never carries a leading "00:" that never
 * changes. Negative input (clock/measurement noise) clamps to zero.
 */
export function formatElapsedVariable(elapsedSeconds: number): string {
  const { hours, minutes, seconds, ms } = toParts(elapsedSeconds);
  if (hours === 0) return `${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}`;
}

/**
 * Always HH:MM:SS.mmm, fully zero-padded, so a machine-read field's shape
 * never changes between a short and a long run. Same clamping.
 */
export function formatElapsedFixed(elapsedSeconds: number): string {
  const { hours, minutes, seconds, ms } = toParts(elapsedSeconds);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)}`;
}
