import { describe, it, expect, vi } from "vitest";

import { annotate, createAnnotation } from "./annotation.ts";

describe("createAnnotation", () => {
  describe("enabled", () => {
    it("notice() logs a ::notice:: line", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      createAnnotation(true).notice("hello");
      expect(log.mock.calls.length).toBe(1);
      expect(log.mock.calls[0][0]).toBe("::notice::hello");
    });

    it("error() logs an ::error:: line", () => {
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

  it("escapes a newline so the rest of a message cannot become a workflow command", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    createAnnotation(true).error("bad body\n::add-mask::x\r50%");
    expect(log.mock.calls[0][0]).toBe("::error::bad body%0A::add-mask::x%0D50%25");
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

describe("annotate", () => {
  it("emits without having to be enabled, so a library-layer warning is never silently dropped", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    annotate.notice("a");
    annotate.warning("b");
    annotate.error("c");
    expect(log.mock.calls.map((c) => c[0])).toStrictEqual([
      "::notice::a",
      "::warning::b",
      "::error::c",
    ]);
  });
});
