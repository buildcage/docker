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
