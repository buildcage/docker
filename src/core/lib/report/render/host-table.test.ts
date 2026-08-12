import { describe, it, expect, reportResults } from "#core/lib/test/test-shim.ts";
import { renderHostTable } from "./host-table.ts";

describe("renderHostTable", () => {
  const row = (overrides = {}) => ({
    host: "example.com",
    port: "443",
    ruleType: "HTTPS",
    reason: "not in allowlist",
    count: 2,
    ...overrides,
  });

  it("renders a default 3-column table (Host, Rule, Count)", () => {
    const table = renderHostTable([row()]);
    expect(table).toBe(
      "| Host | Rule | Count |\n| --- | --- | ---: |\n| example.com:443 | HTTPS | 2 |",
    );
  });

  it("adds a Reason column when showReason is true", () => {
    const table = renderHostTable([row()], { showReason: true });
    expect(table).toMatch(/^\| Host \| Rule \| Reason \| Count \|/);
    expect(table).toMatch(/\| example\.com:443 \| HTTPS \| not in allowlist \| 2 \|/);
  });

  it("adds an Expected column with a checkmark when showExpected is true and the row matched", () => {
    const table = renderHostTable([row({ expected: true })], { showExpected: true });
    expect(table).toMatch(/^\| Host \| Rule \| Count \| Expected \|/);
    expect(table).toMatch(/\| example\.com:443 \| HTTPS \| 2 \| ✅ \|/);
  });

  it("leaves the Expected cell blank when the row did not match", () => {
    const table = renderHostTable([row({ expected: false })], { showExpected: true });
    expect(table).toMatch(/\| example\.com:443 \| HTTPS \| 2 \| {2}\|/);
  });

  it("renders all 5 columns when both showReason and showExpected are true", () => {
    const table = renderHostTable([row({ expected: true })], {
      showReason: true,
      showExpected: true,
    });
    expect(table).toMatch(/^\| Host \| Rule \| Reason \| Count \| Expected \|/);
    expect(table).toMatch(/\| example\.com:443 \| HTTPS \| not in allowlist \| 2 \| ✅ \|/);
  });

  it("renders only the header rows for an empty list", () => {
    const table = renderHostTable([]);
    expect(table).toBe("| Host | Rule | Count |\n| --- | --- | ---: |");
  });
});

reportResults();
