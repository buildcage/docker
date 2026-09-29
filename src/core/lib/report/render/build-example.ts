import type { AggregatedEntry } from "#core/lib/log/aggregate.ts";

import {
  exampleStepHead,
  restrictExampleBlock,
  type ExampleStepOptions,
} from "./restrict-example.ts";

const ruleTypeToParam: Record<string, string> = {
  HTTPS: "allowed_https_rules",
  HTTP: "allowed_http_rules",
  IP: "allowed_ip_rules",
};

export type AuditedRow = Pick<AggregatedEntry, "host" | "port" | "ruleType">;

/**
 * actionRef is the ref (tag or commit SHA) this action was invoked with.
 * Both actions' action.yml lives at the repo root, not in a subdirectory, so
 * the example's `uses:` never has an action-name path segment.
 */
export function buildRestrictExample(
  auditedRows: AuditedRow[] | null | undefined,
  actionRepo: string,
  actionRef?: string,
  step: ExampleStepOptions = {},
): string {
  if (!auditedRows || auditedRows.length === 0) return "";

  // A Set per parameter: a host can be both reached and failed in one run.
  const groups = new Map<string, Set<string>>();
  for (const r of auditedRows) {
    const param = ruleTypeToParam[r.ruleType];
    if (!param) continue;
    if (!groups.has(param)) groups.set(param, new Set());
    groups.get(param)!.add(`${r.host}:${r.port}`);
  }

  if (groups.size === 0) return "";

  let yaml = exampleStepHead(actionRepo, actionRef, step);
  yaml += "    proxy_mode: restrict\n";
  // universal is no longer the default engine, so the snippet must name it to
  // reproduce this run; pasted without it, restrict would fall back to inspect.
  yaml += "    proxy_engine: universal\n";
  for (const [param, rules] of groups) {
    yaml += `    ${param}: >-\n`;
    for (const rule of rules) {
      yaml += `      ${rule}\n`;
    }
  }

  return restrictExampleBlock(yaml);
}
