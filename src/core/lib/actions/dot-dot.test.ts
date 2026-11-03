import { describe, expect, it } from "vitest";

import { hasDotDotAfterStart } from "./dot-dot.ts";

describe("hasDotDotAfterStart", () => {
  it.each([
    "x",
    "a/b",
    "../x",
    "../../x",
    "./../x",
    "..",
    "../",
    "..//x",
    "..//../x",
    "a/..b",
    "a/b..",
  ])("accepts %j", (path) => {
    expect(hasDotDotAfterStart(path)).toBe(false);
  });

  it.each([
    "a/../b",
    "a/..",
    "../a/../b",
    "/a/../b",
    "/..",
    "//..",
    "~/../x",
    "$HOME/..",
    "a/./../b",
  ])("refuses %j", (path) => {
    expect(hasDotDotAfterStart(path)).toBe(true);
  });
});
