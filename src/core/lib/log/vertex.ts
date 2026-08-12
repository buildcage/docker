import { type AllowedRequest, parseAllowedRequestsFromText } from "./proxy-request-text.ts";

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
  // mirroring build-histories.ts's selectAllRefs's line-by-line
  // parsing, concatenate them into one vertexes/logs view rather than
  // assume a single blob (a lone JSON.parse on the whole text would throw
  // on the second document). Not deduplicated by digest: the existing
  // `!v.started || !v.completed` skip below already drops each vertex's
  // earlier partial occurrence(s) within a single document, preserving the
  // array-order semantics the ordering below (and its tests) depend on.
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
