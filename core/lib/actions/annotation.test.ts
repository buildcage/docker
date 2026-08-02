import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createAnnotation } from "./annotation.ts";

describe("createAnnotation", () => {
  describe("enabled", () => {
    it("notice() logs a ::notice:: line", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(true).notice("hello");
      assert.equal(log.mock.calls.length, 1);
      assert.equal(log.mock.calls[0][0], "::notice::hello");
    });

    it("error() logs a ::error:: line", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(true).error("boom");
      assert.equal(log.mock.calls.length, 1);
      assert.equal(log.mock.calls[0][0], "::error::boom");
    });

    it("warning() logs a ::warning:: line", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(true).warning("careful");
      assert.equal(log.mock.calls.length, 1);
      assert.equal(log.mock.calls[0][0], "::warning::careful");
    });
  });

  describe("disabled", () => {
    it("notice() logs nothing", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(false).notice("hello");
      assert.equal(log.mock.calls.length, 0);
    });

    it("error() logs nothing", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(false).error("boom");
      assert.equal(log.mock.calls.length, 0);
    });

    it("warning() logs nothing", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(false).warning("careful");
      assert.equal(log.mock.calls.length, 0);
    });
  });
});
