import { parseIdentifier } from "./parse-identifier.ts";
import { aggregate, type AggregatedEntry } from "./aggregate.ts";

/**
 * Parse `buildctl debug histories --format '{{json .}}'`'s newline-delimited
 * JSON output and return every build's ref, oldest first. A workflow may run
 * several builds against the same long-lived buildcage container before
 * calling the report action once, and each is its own independent build
 * history record, so a table sourced from only the "latest" ref would
 * silently omit every earlier build's steps. Each record's `CreatedAt` is a
 * protobuf-style `{seconds, nanos}` object (not an ISO string), so records
 * are ordered numerically rather than by string.
 *
 */
interface CreatedAt {
  seconds: number;
  nanos?: number;
}

export function selectAllRefs(historiesText: string): string[] {
  // Keyed by ref: buildctl reports each build's history record more than
  // once as it progresses (e.g. started, then completed), so the same ref
  // can appear on multiple lines — the last one wins, though CreatedAt is
  // fixed at build start and doesn't actually change across those lines.
  const byRef = new Map<string, CreatedAt>();
  for (const line of historiesText.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const record = event.record;
    const createdAt = record?.CreatedAt;
    if (!record?.Ref || !createdAt) continue;
    byRef.set(record.Ref, createdAt);
  }
  return [...byRef.entries()].sort((a, b) => compareCreatedAt(a[1], b[1])).map(([ref]) => ref);
}

function compareCreatedAt(a: CreatedAt, b: CreatedAt): number {
  if (a.seconds !== b.seconds) return a.seconds - b.seconds;
  return (a.nanos || 0) - (b.nanos || 0);
}

// Matches vertex names for Dockerfile RUN instructions. The bracketed prefix
// is either just the step counter ("[2/2] RUN ...", single-stage) or a
// build-stage identifier followed by it — named ("[stage1 2/2] RUN ...") or
// auto-numbered anonymous stages ("[stage-0 2/2] RUN ...") alike. The step
// counter itself is right-padded with a leading space when its digit count is
// shorter than the build's total ("[ 2/15]" vs "[10/15]"). None of this needs
// picking apart here: the N/M counter itself is never used (see stageKeyOf()
// below, which extracts only the stage identifier, for ordering), so any
// bracketed content followed by "RUN " is a match.
const runVertexPattern = /^\[([^\]]+)\]\s+RUN\s/;

// The bracketed prefix is either "N/M" alone or "stageID N/M" (whitespace-
// separated — see runVertexPattern above); the step counter is always the
// last whitespace-separated token, so whatever (if anything) precedes it is
// the stage identifier. Using `.split(/\s+/)` rather than a character-class
// regex on the stage name means this doesn't need to know Docker's `AS
// <name>` grammar at all, and can't misparse the padded step counter itself
// as a stage name the way a generic `\S+` capture would.
function stageKeyOf(bracketContent: string): string {
  const parts = bracketContent.trim().split(/\s+/);
  return parts.length > 1 ? parts[0] : "";
}

const proxyRequestsHeader = "proxy network requests:";
const requestLineDetailPattern = /^-\s+(\S+)\s+(\S+?)(?:\s+->\s+(\d+))?$/;

/**
 * Scan arbitrary text for a "proxy network requests:" block and return its
 * raw entries, in order, with no host/port resolution or aggregation. Used
 * by parseVertexAllowedLog() below, applied to a single RUN vertex's own
 * isolated stderr (decoded from `buildctl debug logs --progress=rawjson`),
 * for both the per-command breakdown and the host-aggregated allowed table.
 *
 */
export interface AllowedRequest {
  method: string;
  url: string;
  status?: number;
}

export function parseAllowedRequestsFromText(text: string): AllowedRequest[] {
  const entries: AllowedRequest[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== proxyRequestsHeader) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const m = lines[j].match(requestLineDetailPattern);
      if (!m) break;
      const [, method, url, status] = m;
      entries.push(
        status === undefined ? { method, url } : { method, url, status: Number(status) },
      );
    }
  }
  return entries;
}

/**
 * Parse `buildctl debug logs --progress=rawjson <ref>`'s single JSON object
 * into a per-RUN-vertex breakdown, ordered for human debugging: grouped by
 * build stage (each stage's vertices kept together, in `started` order),
 * with stages themselves ordered by their earliest vertex's `started` time.
 * Independent stages can run concurrently, with overlapping `started`
 * timestamps, so vertex.digest (not physical log position) is the only
 * reliable way to attribute a "proxy network requests:" block to the RUN
 * step that produced it.
 *
 */
interface Vertex {
  name: string;
  digest: string;
  started?: string;
  completed?: string;
}

interface LogLine {
  vertex: string;
  stream: number;
  timestamp: string;
  data: string;
}

export interface VertexAllowedEntry {
  command: string;
  started: string;
  completed: string;
  entries: AllowedRequest[];
}

export function parseVertexAllowedLog(rawJsonText: string): VertexAllowedEntry[] {
  // Usually a single JSON object, but buildctl can flush a large build's
  // rawjson history as several newline-separated JSON documents instead —
  // mirroring selectAllRefs's line-by-line parsing above, concatenate them
  // into one vertexes/logs view rather than assume a single blob (a lone
  // JSON.parse on the whole text would throw on the second document). Not
  // deduplicated by digest: the existing `!v.started || !v.completed` skip
  // below already drops each vertex's earlier partial occurrence(s) within
  // a single document, preserving the array-order semantics the ordering
  // below (and its tests) depend on.
  const vertexes: Vertex[] = [];
  const logs: LogLine[] = [];
  for (const line of rawJsonText.split("\n")) {
    if (!line.trim()) continue;
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    vertexes.push(...(data.vertexes || []));
    logs.push(...(data.logs || []));
  }

  const groups = new Map<string, Vertex[]>(); // stageKey -> vertex[]
  for (const v of vertexes) {
    if (!v.started || !v.completed) continue;
    const m = v.name.match(runVertexPattern);
    if (!m) continue;
    const stageKey = stageKeyOf(m[1]);
    if (!groups.has(stageKey)) groups.set(stageKey, []);
    groups.get(stageKey)!.push(v);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => Date.parse(a.started!) - Date.parse(b.started!));
  }
  const orderedGroups = [...groups.values()].sort(
    (a, b) => Date.parse(a[0].started!) - Date.parse(b[0].started!),
  );

  const logsByDigest = new Map<string, LogLine[]>();
  for (const l of logs) {
    if (l.stream !== 2) continue;
    if (!logsByDigest.has(l.vertex)) logsByDigest.set(l.vertex, []);
    logsByDigest.get(l.vertex)!.push(l);
  }

  return orderedGroups.flat().map((v) => {
    const stderrLogs = (logsByDigest.get(v.digest) || []).sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
    );
    const text = stderrLogs.map((l) => Buffer.from(l.data, "base64").toString("utf8")).join("");
    return {
      command: v.name,
      started: v.started!,
      completed: v.completed!,
      entries: parseAllowedRequestsFromText(text),
    };
  });
}

/**
 * Build the host-aggregated allowed/audited table from the same per-build
 * vertex data parseVertexAllowedLog() produces for the per-command breakdown.
 *
 * decision is "ALLOWED" (restrict mode) or "AUDIT" (audit mode).
 */
export interface HasEntries {
  entries: AllowedRequest[];
}

export function aggregateAllowedHosts(builds: HasEntries[][], decision: string): AggregatedEntry[] {
  const entries = [];
  for (const vertices of builds) {
    for (const { entries: vertexEntries } of vertices) {
      for (const { url } of vertexEntries) {
        const parsed = parseIdentifier(url);
        if (!parsed) continue;
        entries.push({
          decision,
          ruleType: parsed.scheme === "https" ? "HTTPS" : "HTTP",
          host: parsed.host,
          port: parsed.port,
          reason: "-",
        });
      }
    }
  }
  return aggregate(entries);
}
