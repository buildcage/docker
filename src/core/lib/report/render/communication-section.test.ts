import { describe, it, expect } from "vitest";

import {
  COMMUNICATION_DETAILS_CLOSE,
  COMMUNICATION_DETAILS_OPEN,
  wrapCommunicationDetails,
} from "./communication-section.ts";

describe("wrapCommunicationDetails", () => {
  it("opens and closes the section around the body, unchanged", () => {
    expect(wrapCommunicationDetails("the body\n")).toBe(
      `\n${COMMUNICATION_DETAILS_OPEN}the body\n${COMMUNICATION_DETAILS_CLOSE}`,
    );
  });

  it("leaves a blank line ahead of the section, so it does not join the table above it", () => {
    expect(wrapCommunicationDetails("x").startsWith("\n<details>")).toBe(true);
  });

  it("is found again by searching for the opening text", () => {
    const report = `## A report\n${wrapCommunicationDetails("a line\n")}\n*footer*\n`;
    const openAt = report.indexOf(COMMUNICATION_DETAILS_OPEN);
    expect(openAt).not.toBe(-1);
    const bodyStart = openAt + COMMUNICATION_DETAILS_OPEN.length;
    expect(report.slice(bodyStart, report.indexOf(COMMUNICATION_DETAILS_CLOSE, bodyStart))).toBe(
      "a line\n",
    );
  });
});
