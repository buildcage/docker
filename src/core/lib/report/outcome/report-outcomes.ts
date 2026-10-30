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
 * emitted. An action adds its own annotation only for a check of its own.
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
      proxyAnswered: report.proxyAnswered,
      restarts: report.restarts,
      engineLabel,
    }),
  ];
  const undecided = describeUndecidedRequests(report, engineLabel);
  if (undecided) emissions.push(undecided);
  const failed = describeFailedConnections(report, engineLabel);
  if (failed) emissions.push(failed);
  return emissions;
}

/** Requests that never reached a rule, less the keepalive noise Communication details hides. */
export function countUndecidedRequests(report: ReportData): number {
  const isNoise = clientEndedNoise(report.timeline);
  return report.timeline.filter((event) => event.action === "incomplete" && !isNoise(event)).length;
}

/**
 * The warning for requests that never reached a rule, or undefined when there
 * were none.
 *
 * Neither host table holds them and `fail-on-blocked` does not either, so the
 * collapsed Communication details section is their only trace and a reader who
 * never opens it would not know a request had gone nowhere.
 *
 * The wording avoids "incomplete", which the report already uses for logs
 * that are not a full record (see describeBlockedOutcome): two warnings about
 * different things would otherwise read as one, and "this report may not be a
 * full record" is a far bigger claim than "one request went nowhere".
 */
function describeUndecidedRequests(
  report: ReportData,
  engineLabel: "sandbox" | "proxy",
): OutcomeEmission | undefined {
  const count = countUndecidedRequests(report);
  if (count === 0) return undefined;
  return {
    level: "warning",
    shouldFail: false,
    message:
      `${count} request(s) buildcage ${engineLabel} could not act on, shown with ⚠️ in ` +
      "Communication details. Each ended before a whole request had arrived, so no rule decided " +
      "it and none reached an origin: the client closed or failed the TLS handshake, its own " +
      "timeout expired, or this proxy ran into an error while still reading. None of them " +
      "fails the step. Bytes this proxy would not read as a request are not among them: those " +
      "are blocked, and they are in Blocked Hosts.",
  };
}

/**
 * The notice for connections that failed after the rules had passed on them, or
 * undefined when there were none.
 *
 * A notice where describeUndecidedRequests warns: these are in a host table, so
 * it only has to say that the step passed although connections failed.
 *
 * `audit` enforces nothing, so nothing there was allowed by a rule and the
 * opening says only what happened, the same distinction actionFor makes between
 * an audited connection and an allowed one.
 *
 * "could not be reached" is deliberately absent: a connection that never
 * completed is a block wherever a certificate was going to be checked, and
 * the few that are not blocks have a table entry of their own to explain
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
      `${opening}, listed with ⚠️ under Failed Hosts. The origin broke off, answered nothing ` +
      "usable, or its name resolved nowhere upstream: no rule blocked them and none can change " +
      "the outcome, so none of them fails the step.",
  };
}
