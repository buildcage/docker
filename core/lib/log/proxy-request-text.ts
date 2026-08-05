const proxyRequestsHeader = "proxy network requests:";
const requestLineDetailPattern = /^-\s+(\S+)\s+(\S+?)(?:\s+->\s+(\d+))?$/;

/**
 * Scan arbitrary text for a "proxy network requests:" block and return its
 * raw entries, in order, with no host/port resolution or aggregation. Used
 * by vertex.ts's parseVertexAllowedLog(), applied to a single RUN
 * vertex's own isolated stderr (decoded from `buildctl debug logs
 * --progress=rawjson`), for both the per-command breakdown and the
 * host-aggregated allowed table.
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
