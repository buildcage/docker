/**
 * Log parsing library for ecapture's `tls -m text` output (see
 * docs/security.md's Run Action HTTPS communication logs section). Unlike
 * haproxy-log-parser.ts's single-line-per-decision format, each captured
 * event spans multiple lines: a "PID:.. TID:.. Comm:.. FD:.. WRITE|READ (N
 * bytes):" header followed by the raw bytes ecapture observed, terminated by
 * a "probe=..." annotation line. A WRITE block holds the request (an HTTP/1.x
 * request line plus a Host header); the following READ block on the same
 * PID+TID+FD holds the response (an HTTP/1.x status line). HTTP/2 traffic's
 * HPACK-compressed headers don't match either pattern and are silently
 * skipped — never emitted as (mis-)parsed data.
 *
 * Only method/host/path/status are ever extracted into AllowedRequest — the
 * raw block content (which can include Authorization headers or response
 * bodies) is discarded once matched against, never retained or exposed. This
 * is the only point standing between ecapture's captured plaintext and
 * anything this data is later rendered into (a GitHub Job Summary), so it
 * must stay narrow.
 */
import type { AllowedRequest } from "./vertex-log.ts";

const ansiEscapePattern = /\x1b\[[0-9;]*m/g;
const blockHeaderPattern = /PID:(\d+)\s+TID:(\d+)\s+Comm:\S+\s+FD:(\d+)\s+(WRITE|READ)\s+\(\d+\s+bytes\):/;
const blockTerminatorPattern = /^\s*probe=/i;
const requestLinePattern = /^(\S+)\s+(\S+)\s+HTTP\/1\.[01]/;
const hostHeaderPattern = /^Host:\s*([^\s\\]+)/i;
const responseLinePattern = /^HTTP\/1\.[01]\s+(\d{3})/;

interface PendingRequest {
  method: string;
  path: string;
  host: string;
}

interface Block {
  key: string;
  direction: "WRITE" | "READ";
  lines: string[];
}

/**
 * Single forward pass over ecapture's text-mode output. Returns every
 * request/response pair it could reconstruct, in the order captured. A WRITE
 * block with no matching READ (connection reset, blocked before a response,
 * end of log) is still emitted, with `status` left undefined — mirroring how
 * the explicit engine's own AllowedRequest already treats a missing status.
 *
 * Synchronous (unlike haproxy-log-parser.ts's scanHaproxyLog): ecapture's log
 * is always read directly off the runner host's own filesystem (see
 * run/src/lib/isolated-exec.ts's readEcaptureLog), never streamed from a
 * `docker exec`, so there's no AsyncIterable source to support here.
 */
export function scanEcaptureLog(lines: Iterable<string>): AllowedRequest[] {
  const pending = new Map<string, PendingRequest>();
  const entries: AllowedRequest[] = [];
  let current: Block | null = null;

  const finalizeCurrent = () => {
    if (!current) return;
    const block = current;
    current = null;
    if (block.direction === "WRITE") {
      const reqMatch = block.lines[0]?.match(requestLinePattern);
      if (!reqMatch) return;
      const host = block.lines.slice(1).map((l) => l.match(hostHeaderPattern)?.[1]).find(Boolean);
      if (!host) return;
      pending.set(block.key, { method: reqMatch[1], path: reqMatch[2], host });
    } else {
      const resMatch = block.lines[0]?.match(responseLinePattern);
      if (!resMatch) return;
      const req = pending.get(block.key);
      if (!req) return;
      pending.delete(block.key);
      entries.push({ method: req.method, url: `https://${req.host}${req.path}`, status: Number(resMatch[1]) });
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(ansiEscapePattern, "");
    const headerMatch = line.match(blockHeaderPattern);
    if (headerMatch) {
      finalizeCurrent();
      const [, pid, tid, fd, direction] = headerMatch;
      current = { key: `${pid}:${tid}:${fd}`, direction: direction as "WRITE" | "READ", lines: [] };
      continue;
    }
    if (!current) continue;
    if (blockTerminatorPattern.test(line)) {
      finalizeCurrent();
      continue;
    }
    current.lines.push(line);
  }
  finalizeCurrent();

  // Requests that never saw a matching response (still in `pending`) are
  // surfaced too, rather than silently dropped, with no status — appended
  // after every matched pair since insertion order (a Map) is chronological.
  for (const { method, host, path } of pending.values()) {
    entries.push({ method, url: `https://${host}${path}` });
  }

  return entries;
}
