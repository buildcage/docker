import { describe, it, expect, reportResults } from "../test/test-shim.ts";
import { wrapLogGroup } from "./log.ts";

describe("wrapLogGroup", () => {
  it("wraps non-empty log text in a group-open/content/group-close triple", () => {
    expect(wrapLogGroup("Title", "line1\nline2\n")).toStrictEqual([
      "::group::Title",
      "line1\nline2\n",
      "::endgroup::",
    ]);
  });

  it("returns an empty array for empty log text", () => {
    expect(wrapLogGroup("Title", "")).toStrictEqual([]);
  });
});

reportResults();
