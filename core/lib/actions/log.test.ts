import { describe, it, assert, reportResults } from "../test/test-shim.ts";
import { wrapLogGroup } from "./log.ts";

describe("wrapLogGroup", () => {
  it("wraps non-empty log text in a group-open/content/group-close triple", () => {
    assert.deepEqual(wrapLogGroup("Title", "line1\nline2\n"), [
      "::group::Title",
      "line1\nline2\n",
      "::endgroup::",
    ]);
  });

  it("returns an empty array for empty log text", () => {
    assert.deepEqual(wrapLogGroup("Title", ""), []);
  });
});

reportResults();
