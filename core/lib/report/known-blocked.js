// @ts-nocheck
/**
 * Shared logic for `known_blocked_rules`: domains expected to be blocked,
 * so a matching blocked connection doesn't fail the step even when
 * fail_on_blocked is true. Never sent to the container's ACL — only
 * affects this action's pass/fail decision and Job Summary rendering.
 */
import { convertRule } from "../../shared/lib/rules.js";

/**
 * Tag each aggregated blocked-hosts row with `expected: boolean` — true iff
 * its `host:port` matches at least one known_blocked_rules pattern.
 *
 * @param {{host:string, port:string, ruleType:string, reason:string, count:number}[]} blockedRows
 * @param {string[]} knownBlockedRules - as returned by parseAndValidateRules
 * @returns {({host:string, port:string, ruleType:string, reason:string, count:number, expected:boolean})[]}
 */
export function annotateKnownBlocked(blockedRows, knownBlockedRules) {
  const matchers = knownBlockedRules.map((rule) => new RegExp(convertRule(rule)));
  return blockedRows.map((row) => ({
    ...row,
    expected: matchers.some((re) => re.test(`${row.host}:${row.port}`)),
  }));
}

/**
 * Decide whether blocked connections should fail the step.
 *
 * `blockedRows` must already be annotated via annotateKnownBlocked. Uses
 * per-row matching rather than count arithmetic because `blockedCount`'s
 * meaning differs by proxy engine (transparent: total blocked events;
 * explicit: aggregated row count — see setup/docker/explicit/scripts/report.js),
 * so subtracting summed row counts from it isn't reliable. An empty
 * `blockedRows` with a nonzero `blockedCount` (malformed/incomplete report
 * data) is treated as unexpected too (fail closed).
 *
 * @param {{isAudit: boolean, failOnBlocked: boolean, blockedCount: number, blockedRows: object[]}} params
 * @returns {{level: "none"|"notice"|"error", shouldFail: boolean}}
 */
export function determineBlockedOutcome({ isAudit, failOnBlocked, blockedCount, blockedRows }) {
  if (!blockedCount) return { level: "none", shouldFail: false };
  if (isAudit) return { level: "notice", shouldFail: false };
  const hasUnexpected = blockedRows.length === 0 || blockedRows.some((row) => !row.expected);
  if (failOnBlocked && hasUnexpected) return { level: "error", shouldFail: true };
  return { level: "notice", shouldFail: false };
}

/**
 * Build the annotation message text for a blocked-connections check.
 *
 * In audit mode the text always stays the fixed-format base string,
 * regardless of known_blocked_rules matching — audit mode's pass/fail
 * outcome is unaffected by matching (see determineBlockedOutcome), so
 * varying the notice text there would be misleading and would silently
 * break any tooling that matches the old fixed-format notice.
 *
 * @param {{blockedCount: number, blockedRows: object[], engineLabel: "sandbox"|"proxy", isAudit: boolean}} params
 * @returns {string}
 */
export function buildBlockedMessage({ blockedCount, blockedRows, engineLabel, isAudit }) {
  const base = `${blockedCount} blocked connection(s) detected by buildcage ${engineLabel}`;
  if (isAudit) return base;
  const unexpected = blockedRows.filter((row) => !row.expected).length;
  if (unexpected === blockedRows.length) return base; // nothing matched (incl. known_blocked_rules unset)
  if (unexpected === 0) return `${base}, all matched known_blocked_rules (expected)`;
  return `${base} (${unexpected} of ${blockedRows.length} distinct blocked host(s) unmatched by known_blocked_rules)`;
}

/**
 * Single entry point composing the three functions above. Both
 * run/src/lib/report.js and report/src/main.js call this once and thread
 * the result through their table rendering and annotation code, rather
 * than each recomputing annotateKnownBlocked independently.
 *
 * @param {{mode: string|null, blockedCount?: number, sections?: {blocked?: object[]}}} report
 * @param {{knownBlockedRules: string[], failOnBlocked: boolean, engineLabel: "sandbox"|"proxy"}} options
 * @returns {{blockedRows: object[], showExpected: boolean, outcome: {level: string, shouldFail: boolean}, message: string|null}}
 */
export function evaluateBlockedReport(report, { knownBlockedRules, failOnBlocked, engineLabel }) {
  const isAudit = report.mode === "audit";
  const blockedRows = annotateKnownBlocked(report.sections?.blocked ?? [], knownBlockedRules);
  const outcome = determineBlockedOutcome({ isAudit, failOnBlocked, blockedCount: report.blockedCount ?? 0, blockedRows });
  const message = outcome.level === "none"
    ? null
    : buildBlockedMessage({ blockedCount: report.blockedCount ?? 0, blockedRows, engineLabel, isAudit });
  return { blockedRows, showExpected: knownBlockedRules.length > 0, outcome, message };
}
