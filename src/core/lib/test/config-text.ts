/**
 * Readers and builders for the acl tests that look at generated config
 * text. Runs under QuickJS as well as vitest, like the tests that use it.
 */
import { generateHaproxyConfig } from "../acl/haproxy-config.ts";
import type { InspectStageExtension } from "../acl/haproxy-inspect-stage.ts";
import type { RuleInputs } from "../acl/haproxy-rules.ts";
import { PROXY_ADDRESS } from "../log/proxy-address.ts";
import { expect } from "./test-shim.ts";

/** One rule of every kind a host:port list takes. */
export const FULL_RULES = {
  httpsRules: ["a.example.com:443"],
  httpRules: ["b.example.com:80"],
  ipRules: ["10.0.0.5:5432"],
  tlsRules: ["db.example.com:443"],
} satisfies RuleInputs;

/**
 * One top-level section, from its header line (`frontend http_in`) up to the
 * next line that starts at column 0. Throws when there is no such section, so
 * a renamed one fails the test instead of matching nothing.
 */
export function section(config: string, header: string): string {
  const lines = config.split("\n");
  const start = lines.indexOf(header);
  if (start === -1) throw new Error(`no section ${header}`);
  let end = start + 1;
  while (end < lines.length && !/^\S/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
}

/** A duration directive's value in seconds (`timeout client 30s`, `... 1m`). */
export function seconds(text: string, directive: string): number {
  const match = new RegExp(`${directive} (\\d+)(s|m)\\b`).exec(text);
  if (!match) throw new Error(`no ${directive}`);
  return Number(match[1]) * (match[2] === "m" ? 60 : 1);
}

/** A defaults-style `timeout <name>` value as written. */
export function timeout(text: string, name: string): string {
  const match = new RegExp(`\\n    timeout ${name} (\\S+)\\n`).exec(text);
  if (!match) throw new Error(`no timeout ${name}`);
  return match[1];
}

/** Asserts that every needle is present and that each first occurrence follows the previous one. */
export function expectInOrder(text: string, needles: string[]): void {
  const positions = needles.map((needle) => text.indexOf(needle));
  expect(needles.filter((_, i) => positions[i] === -1)).toStrictEqual([]);
  expect(positions).toStrictEqual([...positions].sort((a, b) => a - b));
}

function stage(
  header: string,
  inputs: RuleInputs,
  mode: "restrict" | "audit",
  extension?: InspectStageExtension,
): string {
  // Cut from the whole config, so the stage gets exactly the context the generator gives it.
  const config = generateHaproxyConfig({ ...inputs, mode, extension, proxyAddress: PROXY_ADDRESS });
  return section(config, header).trimEnd();
}

/** The TLS stage for these rules, as the generated config carries it. */
export function tlsStage(
  inputs: RuleInputs,
  mode: "restrict" | "audit" = "restrict",
  extension?: InspectStageExtension,
): string {
  return stage("frontend https_in", inputs, mode, extension);
}

/** The plaintext stage for these rules, as the generated config carries it. */
export function plainStage(
  inputs: RuleInputs,
  mode: "restrict" | "audit" = "restrict",
  extension?: InspectStageExtension,
): string {
  return stage("frontend http_in", inputs, mode, extension);
}
