import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAnnotation } from "./annotation.js";

describe("createAnnotation", () => {
  describe("enabled", () => {
    it("notice() logs a ::notice:: line", (t) => {
      const log = t.mock.method(console, "log", () => {});
      createAnnotation(true).notice("hello");
      assert.equal(log.mock.calls.length, 1);
      assert.equal(log.mock.calls[0].arguments[0], "::notice::hello");
    });

    it("error() logs a ::error:: line", (t) => {
      const log = t.mock.method(console, "log", () => {});
      createAnnotation(true).error("boom");
      assert.equal(log.mock.calls.length, 1);
      assert.equal(log.mock.calls[0].arguments[0], "::error::boom");
    });
  });

  describe("disabled", () => {
    it("notice() logs nothing", (t) => {
      const log = t.mock.method(console, "log", () => {});
      createAnnotation(false).notice("hello");
      assert.equal(log.mock.calls.length, 0);
    });

    it("error() logs nothing", (t) => {
      const log = t.mock.method(console, "log", () => {});
      createAnnotation(false).error("boom");
      assert.equal(log.mock.calls.length, 0);
    });
  });
});
