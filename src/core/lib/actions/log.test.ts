import { describe, it, expect, vi } from "vitest";

import { logRules, withLogGroup, withLogGroupAsync, wrapLogGroup } from "./log.ts";

describe("logRules", () => {
  it("marks an empty rule list on the label line, so the block isn't silently blank", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logRules("Allowed HTTPS", []);
    expect(log.mock.calls.length).toBe(1);
    expect(log.mock.calls[0][0]).toBe("Allowed HTTPS rules: (none)");
  });

  it("logs one indented line per rule, in order, under a plain label line", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logRules("Allowed HTTPS", ["example.com:443", "*.example.org:443"]);
    expect(log.mock.calls.map((c) => c[0])).toStrictEqual([
      "Allowed HTTPS rules:",
      "  example.com:443",
      "  *.example.org:443",
    ]);
  });
});

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

describe("withLogGroup", () => {
  it("prints the markers around what fn prints, in order", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    withLogGroup("Title", () => {
      console.log("body");
    });
    expect(log.mock.calls.map((c) => c[0])).toStrictEqual([
      "::group::Title",
      "body",
      "::endgroup::",
    ]);
  });

  it("returns fn's value", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(withLogGroup("Title", () => 42)).toBe(42);
  });

  it("closes the group before letting fn's error through", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() =>
      withLogGroup("Title", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(log.mock.calls.map((c) => c[0])).toStrictEqual(["::group::Title", "::endgroup::"]);
  });

  it("closes the group before the caller's next line, without awaiting", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    withLogGroup("Title", () => {
      console.log("body");
    });
    console.log("after");
    expect(log.mock.calls.map((c) => c[0])).toStrictEqual([
      "::group::Title",
      "body",
      "::endgroup::",
      "after",
    ]);
  });
});

describe("withLogGroupAsync", () => {
  it("closes the group only once the awaited work is done", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await withLogGroupAsync("Title", async () => {
      await Promise.resolve();
      console.log("body");
    });
    expect(log.mock.calls.map((c) => c[0])).toStrictEqual([
      "::group::Title",
      "body",
      "::endgroup::",
    ]);
  });

  it("returns the awaited value", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(withLogGroupAsync("Title", () => Promise.resolve(42))).resolves.toBe(42);
  });

  it("closes the group before letting a rejection through", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      withLogGroupAsync("Title", () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(log.mock.calls.map((c) => c[0])).toStrictEqual(["::group::Title", "::endgroup::"]);
  });
});
