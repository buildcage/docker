/**
 * Reads an s6-log directory as one time-ordered stream: the rotated archive
 * segments (`@<TAI64N>.<letter>`, oldest first) followed by `current`.
 *
 * s6-log rotates `current` once it crosses its configured size (see the
 * haproxy-log/coredns-log `run` scripts) by renaming it to `previous`, opening
 * a new `current`, then linking `previous` to `@<timestamp>.s` and unlinking
 * `previous`. A restarted s6-log does the same with what it finds, into
 * `@<timestamp>.u`. Each step keeps the file's inode, so the reader opens
 * `current` first and reads the archives up to the one that is the same file: a
 * rotation while the report reads then neither skips nor repeats a segment.
 */
import type { Docker } from "./client.ts";

/**
 * Takes the log directory as $1. Waits up to a second for `current`, which
 * is briefly missing mid-rotation and never there before s6-log first starts;
 * without it, every archive is read. Then reads each archive, oldest first and
 * `previous` last, until it reaches the file it opened as `current`, and lists
 * again until the listing stops changing, which catches `previous` turning
 * into an archive. Files are compared by device and inode, as `previous` and
 * its archive are the same file for a moment. An archive whose last line was
 * cut short, as by a killed s6-log, gets a line break so it does not swallow
 * the next segment's first line.
 */
const READ_SCRIPT = [
  'cd "$1" || exit 1',
  "i=0",
  "until command exec 3<current; do",
  "  i=$((i + 1))",
  "  if [ $i -ge 10 ]; then exec 3</dev/null; break; fi",
  "  sleep 0.1",
  "done 2>/dev/null",
  "last=$(stat -L -c %d:%i /proc/self/fd/3)",
  '[ -n "$last" ] || exit 1',
  'seen=" "',
  "listed=",
  "while :; do",
  "  now=$(ls -d @????????????????????????.? previous 2>/dev/null)",
  '  [ "$now" = "$listed" ] && break',
  "  listed=$now",
  "  for f in $now; do",
  '    command exec 4<"$f" 2>/dev/null || continue',
  "    id=$(stat -L -c %d:%i /proc/self/fd/4)",
  '    [ -n "$id" ] || exit 1',
  '    [ "$id" = "$last" ] && break',
  '    case $seen in *" $id "*) continue ;; esac',
  '    seen="$seen$id "',
  "    cat <&4 || exit 1",
  '    [ -z "$(tail -c 1 /proc/self/fd/4)" ] || echo',
  "  done",
  "done",
  "exec 4<&-",
  "cat <&3",
].join("\n");

/** Every line in `dir`'s segments, oldest first, read in one `docker exec`. */
export function readRotatedLog(
  docker: Docker,
  containerId: string,
  dir: string,
): AsyncIterable<string> {
  return docker.execLines(
    containerId,
    ["sh", "-c", READ_SCRIPT, "sh", dir],
    `docker exec reading ${dir}`,
  );
}
