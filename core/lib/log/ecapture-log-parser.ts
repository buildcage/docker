/**
 * Parses ecapture's `tls -m text` output (see docs/security.md's Run Action
 * HTTPS communication logs section). Each event spans multiple lines: a
 * "PID:.. TID:.. Comm:.. FD:.. WRITE|READ (N bytes):" header, the raw bytes,
 * then a "probe=..." terminator. A WRITE block holds the request line + Host
 * header; the matching READ (same PID+TID+FD) holds the response status
 * line. Non-matching blocks (HTTP/2, etc.) are silently skipped.
 *
 * Only method/host/path/status ever leave the parser — the only point
 * between ecapture's captured plaintext and the Job Summary.
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
 * One forward pass over ecapture's text-mode output, in capture order. A
 * WRITE with no matching READ is still emitted, with `status` undefined.
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

  // Unmatched requests still surface, with no status.
  for (const { method, host, path } of pending.values()) {
    entries.push({ method, url: `https://${host}${path}` });
  }

  return entries;
}
