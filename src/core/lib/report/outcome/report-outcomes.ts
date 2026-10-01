import { clientEndedNoise } from "#core/lib/log/traffic-event.ts";

import type { ReportData } from "../types.ts";
import type { OutcomeEmission } from "./annotate.ts";
import { describeBlockedOutcome } from "./blocked-outcome.ts";

export interface DescribeReportOutcomesOptions {
  failOnBlocked: boolean;
  /** Which action is reporting; see BuildBlockedMessageOptions.engineLabel. */
  engineLabel: "sandbox" | "proxy";
}

/**
 * Every annotation a finished report calls for, in the order they should be
 * emitted. Both actions build their annotations from here, so neither can grow
 * one the other lacks.
 *
 * The blocked-connections check always speaks, if only with level "none": it is
 * the one that decides the step's outcome. Anything after it is an aside about
 * traffic no rule decided, which fails nothing.
 */
export function describeReportOutcomes(
  report: ReportData,
  { failOnBlocked, engineLabel }: DescribeReportOutcomesOptions,
): OutcomeEmission[] {
  const emissions: OutcomeEmission[] = [
    describeBlockedOutcome({
      isAudit: report.parameters.mode === "audit",
      failOnBlocked,
      blockedCount: report.blockedCount,
      blockedRows: report.blocked,
      logLooksPlausible: report.logLooksPlausible,
      engineLabel,
    }),
  ];
  const undecided = describeUndecidedRequests(report, engineLabel);
  if (undecided) emissions.push(undecided);
  const failed = describeFailedConnections(report, engineLabel);
  if (failed) emissions.push(failed);
  return emissions;
}

/**
 * The warning for requests that never reached a rule, or undefined when there
 * were none.
 *
 * Neither host table holds them and `fail_on_blocked` does not either, so the
 * collapsed Communication details section is their only trace and a reader who
 * never opens it would not know a request had gone nowhere.
 *
 * The wording avoids "incomplete", which the report already uses for a log
 * whose beginning is gone (see describeBlockedOutcome) and under the same ⚠️:
 * two ⚠️ warnings about different things would otherwise read as one, and
 * "this report may not be a full record" is a far bigger claim than "one
 * request went nowhere".
 */
function describeUndecidedRequests(
  report: ReportData,
  engineLabel: "sandbox" | "proxy",
): OutcomeEmission | undefined {
  // The keepalive noise clientEndedNoise hides from Communication details is out
  // of the count too, so the two stay in step.
  const isNoise = clientEndedNoise(report.timeline);
  const count = report.timeline.filter(
    (event) => event.action === "incomplete" && !isNoise(event),
  ).length;
  if (count === 0) return undefined;
  return {
    level: "warning",
    shouldFail: false,
    message:
      `${count} request(s) buildcage ${engineLabel} could not act on, shown with ⚠️ in ` +
      "Communication details. Each ended before a whole request had arrived, so no rule decided " +
      "it and none reached an origin: the client closed, its own timeout expired, or this proxy " +
      "ran into an error while still reading. None of them fails the step. Bytes this proxy " +
      "would not read as a request are not among them: that is a refusal, and it is in Blocked " +
      "Hosts.",
  };
}

/**
 * The notice for connections that failed after the rules had passed on them, or
 * undefined when there were none.
 *
 * A notice where describeUndecidedRequests warns: these have a table of their
 * own, so it only has to say that the step passed although connections failed.
 *
 * `audit` enforces nothing, so nothing there was allowed by a rule and the
 * opening says only what happened, the same distinction actionFor makes between
 * an audited connection and an allowed one.
 *
 * "could not be reached" is deliberately absent: a connection that never
 * completed is a refusal wherever a certificate was going to be checked, and
 * the few that are not refusals have a table entry of their own to explain
 * them (see FAILURE_REASONS and docs/reference.md).
 */
function describeFailedConnections(
  report: ReportData,
  engineLabel: "sandbox" | "proxy",
): OutcomeEmission | undefined {
  const count = report.failed.reduce((total, row) => total + row.count, 0);
  if (count === 0) return undefined;
  const opening =
    report.parameters.mode === "audit"
      ? `${count} connection(s) buildcage ${engineLabel} recorded did not complete`
      : `${count} connection(s) failed after buildcage ${engineLabel} allowed them`;
  return {
    level: "notice",
    shouldFail: false,
    message:
      `${opening}, listed under Failed Connections. The origin broke off, answered nothing ` +
      "usable, or its name resolved nowhere upstream: no rule refused them and none can change " +
      "the outcome, so none of them fails the step.",
  };
}
