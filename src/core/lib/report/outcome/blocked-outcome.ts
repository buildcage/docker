import type { ExpectedFlag } from "../build/aggregate.ts";

export interface BlockedOutcome {
  level: "none" | "notice" | "error";
  shouldFail: boolean;
}

export interface DetermineBlockedOutcomeOptions {
  isAudit: boolean;
  failOnBlocked: boolean;
  blockedCount: number;
  blockedRows: ExpectedFlag[];
  /** See ReportDataCommon.logLooksPlausible. */
  logLooksPlausible: boolean;
}

/**
 * Decide whether blocked connections should fail the step.
 *
 * `blockedRows` must already be annotated via annotateKnownBlocked. An empty
 * `blockedRows` with a nonzero `blockedCount` is treated as unexpected too
 * (fail closed).
 *
 * An implausible log decides on its own: what survived says nothing about
 * what was dropped, so known_blocked_rules cannot clear the step.
 */
export function determineBlockedOutcome({
  isAudit,
  failOnBlocked,
  blockedCount,
  blockedRows,
  logLooksPlausible,
}: DetermineBlockedOutcomeOptions): BlockedOutcome {
  if (!logLooksPlausible) {
    if (isAudit) return { level: "notice", shouldFail: false };
    return failOnBlocked
      ? { level: "error", shouldFail: true }
      : { level: "notice", shouldFail: false };
  }
  if (!blockedCount) return { level: "none", shouldFail: false };
  if (isAudit) return { level: "notice", shouldFail: false };
  const hasUnexpected = blockedRows.length === 0 || blockedRows.some((row) => !row.expected);
  if (failOnBlocked && hasUnexpected) return { level: "error", shouldFail: true };
  return { level: "notice", shouldFail: false };
}

export interface BuildBlockedMessageOptions {
  blockedCount: number;
  blockedRows: ExpectedFlag[];
  engineLabel: "sandbox" | "proxy";
  isAudit: boolean;
}

/**
 * The resolver logs every name against the rules, so a name that was only
 * looked up and never connected to is counted too.
 */
const COUNT_NOUN = "connection(s) and lookup(s)";

/**
 * Build the annotation message text for a blocked-connections check.
 *
 * In audit mode the text always stays the fixed-format base string,
 * regardless of known_blocked_rules matching: audit mode's pass/fail
 * outcome is unaffected by matching (see determineBlockedOutcome), so
 * varying the notice text there would be misleading.
 */
export function buildBlockedMessage({
  blockedCount,
  blockedRows,
  engineLabel,
  isAudit,
}: BuildBlockedMessageOptions): string {
  const base = `${blockedCount} blocked ${COUNT_NOUN} detected by buildcage ${engineLabel}`;
  if (isAudit) return base;
  const unexpected = blockedRows.filter((row) => !row.expected).length;
  if (unexpected === blockedRows.length) return base; // nothing matched (incl. known_blocked_rules unset)
  if (unexpected === 0) return `${base}, all matched known_blocked_rules (expected)`;
  return `${base} (${unexpected} of ${blockedRows.length} distinct blocked host(s) unmatched by known_blocked_rules)`;
}

export interface DescribedBlockedOutcome extends BlockedOutcome {
  message: string;
}

export interface DescribeBlockedOutcomeOptions {
  isAudit: boolean;
  failOnBlocked: boolean;
  blockedCount: number;
  blockedRows: ExpectedFlag[];
  logLooksPlausible: boolean;
  engineLabel: "sandbox" | "proxy";
}

/** Combines the pass/fail decision with its annotation message. */
export function describeBlockedOutcome({
  isAudit,
  failOnBlocked,
  blockedCount,
  blockedRows,
  logLooksPlausible,
  engineLabel,
}: DescribeBlockedOutcomeOptions): DescribedBlockedOutcome {
  const outcome = determineBlockedOutcome({
    isAudit,
    failOnBlocked,
    blockedCount,
    blockedRows,
    logLooksPlausible,
  });
  const base = buildBlockedMessage({ blockedCount, blockedRows, engineLabel, isAudit });
  if (logLooksPlausible) return { ...outcome, message: base };
  // audit's notice keeps the fixed-format opening buildBlockedMessage
  // promises, so the warning is appended rather than replacing it.
  if (isAudit) {
    return {
      ...outcome,
      message: `${base}, but the logs are incomplete and this is not a full record`,
    };
  }
  // Plural: the resolver keeps a log of its own, and either can be the truncated one.
  const incomplete = `buildcage ${engineLabel} logs are incomplete, so this report is not a full record of what ran`;
  // Not the whole count when the log is incomplete, hence "still recorded".
  const counted = blockedCount
    ? `${incomplete} (${blockedCount} blocked ${COUNT_NOUN} still recorded)`
    : incomplete;
  // Enumerated, not attributed: logLooksPlausible collapses several conditions
  // into one flag, and only the benign reading is the reader's to act on.
  const message =
    `${counted}. Either the logs don't begin where a real run does, one carries a line the ` +
    "report cannot read, or the proxy dropped lines it could not write (or could not say whether " +
    "it had). A missing beginning was either removed or rotated out by traffic heavy enough to " +
    "fill the 100 MB of log kept, which takes a few hundred thousand ordinary requests or a few " +
    "thousand made as long as a request can be: the report's own tables still count what " +
    "survived, per host.";
  return { ...outcome, message };
}
