import type { AggregatedEntry } from "#core/lib/log/aggregate.ts";

import {
  exampleStepHead,
  exampleStepTail,
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
 * actionRef is the ref (tag or commit SHA) this action was invoked with. The
 * action.yml sits at the repo root, so `uses:` has no path segment.
 */
export function buildUniversalRestrictExample(
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
  // Pasted without it, restrict would run the default engine, inspect.
  yaml += "    proxy_engine: universal\n";
  for (const [param, rules] of groups) {
    yaml += `    ${param}: >-\n`;
    for (const rule of rules) {
      yaml += `      ${rule}\n`;
    }
  }
  yaml += exampleStepTail(step);

  return restrictExampleBlock(yaml);
}
