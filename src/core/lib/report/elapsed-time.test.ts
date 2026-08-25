import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import { formatElapsedVariable, formatElapsedFixed } from "./elapsed-time.ts";

describe("formatElapsedVariable", () => {
  it("renders zero", () => {
    expect(formatElapsedVariable(0)).toBe("00:00.000");
  });

  it("renders sub-second precision", () => {
    expect(formatElapsedVariable(0.512)).toBe("00:00.512");
  });

  it("stays MM:SS.mmm right up to the hour boundary", () => {
    expect(formatElapsedVariable(3599.999)).toBe("59:59.999");
  });

  it("widens to HH:MM:SS.mmm at exactly one hour", () => {
    expect(formatElapsedVariable(3600)).toBe("01:00:00.000");
  });

  it("keeps widening past one hour", () => {
    expect(formatElapsedVariable(2 * 3600 + 5 * 60 + 3.25)).toBe("02:05:03.250");
  });

  it("clamps a negative duration to zero rather than rendering a sign", () => {
    expect(formatElapsedVariable(-0.5)).toBe("00:00.000");
  });
});

describe("formatElapsedFixed", () => {
  it("is always HH:MM:SS.mmm, even at zero", () => {
    expect(formatElapsedFixed(0)).toBe("00:00:00.000");
  });

  it("does not widen further past an hour -- the shape never changes", () => {
    expect(formatElapsedFixed(3600)).toBe("01:00:00.000");
    expect(formatElapsedFixed(25 * 3600)).toBe("25:00:00.000");
  });

  it("clamps a negative duration to zero", () => {
    expect(formatElapsedFixed(-1)).toBe("00:00:00.000");
  });
});

reportResults();
