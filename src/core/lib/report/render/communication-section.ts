/** The `💬 Communication details` section's own markup. */

export const COMMUNICATION_DETAILS_OPEN =
  "<details>\n<summary>\u{1F4AC} Communication details</summary>\n\n";
export const COMMUNICATION_DETAILS_CLOSE = "</details>\n";

export function wrapCommunicationDetails(body: string): string {
  return `\n${COMMUNICATION_DETAILS_OPEN}${body}${COMMUNICATION_DETAILS_CLOSE}`;
}

/** What a traffic report says where the Job Summary's size limit cut its communication log. */
export function communicationTruncationNote(artifactAvailable: boolean): string {
  const rest = artifactAvailable
    ? "the buildcage-traffic artifact uploaded for this run has the rest"
    : "set upload_traffic_artifact: true to get the rest as a downloadable artifact";
  return `_…truncated: the full communication log exceeded GitHub's Job Summary size limit; ${rest}._\n\n`;
}
