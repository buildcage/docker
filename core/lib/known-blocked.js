/**
 * Shared logic for the `known_blocked_rules` input (run/report actions):
 * domains expected to be blocked intentionally, so a blocked connection
 * matching one of these rules doesn't fail the step even when
 * fail_on_blocked is true. Rules use the same wildcard/~regex syntax as
 * allowed_*_rules (see core/shared/lib/rules.js) but are never sent to the
 * container's ACL — they only affect this action's own pass/fail decision
 * and Job Summary rendering.
 */
import { convertRule } from "../shared/lib/rules.js";

/**
 * Parse+validate `known_blocked_rules` input into raw rule strings.
 *
 * @param {string|undefined} rulesInput
 * @returns {string[]}
 * @throws {Error} if any rule has invalid wildcard/regex syntax
 */
export function parseKnownBlockedRules(rulesInput) {
  const rules = rulesInput?.trim().split(/\s+/).filter(Boolean) ?? [];
  rules.forEach(convertRule); // validate eagerly; throws on bad wildcard/regex syntax
  return rules;
}

/**
 * Tag each aggregated blocked-hosts row with `expected: boolean` — true iff
 * its `host:port` matches at least one known_blocked_rules pattern.
 *
 * @param {{host:string, port:string, ruleType:string, reason:string, count:number}[]} blockedRows
 * @param {string[]} knownBlockedRules - as returned by parseKnownBlockedRules
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
 * @param {{blockedCount: number, blockedRows: object[], knownBlockedRulesUsed: boolean, engineLabel: "sandbox"|"proxy"}} params
 * @returns {string}
 */
export function buildBlockedMessage({ blockedCount, blockedRows, knownBlockedRulesUsed, engineLabel }) {
  const base = `${blockedCount} blocked connection(s) detected by buildcage ${engineLabel}`;
  if (!knownBlockedRulesUsed) return base;
  const unexpected = blockedRows.filter((row) => !row.expected).length;
  const expected = blockedRows.length - unexpected;
  if (expected === 0) return base;
  if (unexpected === 0) return `${base}, all matched known_blocked_rules (expected)`;
  return `${base} (${unexpected} of ${blockedRows.length} distinct blocked host(s) unmatched by known_blocked_rules)`;
}
