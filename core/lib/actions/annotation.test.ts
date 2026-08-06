import { describe, it, expect, vi } from "vitest";
import { createAnnotation } from "./annotation.ts";

describe("createAnnotation", () => {
  describe("enabled", () => {
    it("notice() logs a ::notice:: line", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(true).notice("hello");
      expect(log.mock.calls.length).toBe(1);
      expect(log.mock.calls[0][0]).toBe("::notice::hello");
    });

    it("error() logs a ::error:: line", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(true).error("boom");
      expect(log.mock.calls.length).toBe(1);
      expect(log.mock.calls[0][0]).toBe("::error::boom");
    });

    it("warning() logs a ::warning:: line", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(true).warning("careful");
      expect(log.mock.calls.length).toBe(1);
      expect(log.mock.calls[0][0]).toBe("::warning::careful");
    });
  });

  describe("disabled", () => {
    it("notice() logs nothing", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(false).notice("hello");
      expect(log.mock.calls.length).toBe(0);
    });

    it("error() logs nothing", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(false).error("boom");
      expect(log.mock.calls.length).toBe(0);
    });

    it("warning() logs nothing", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(false).warning("careful");
      expect(log.mock.calls.length).toBe(0);
    });
  });
});
