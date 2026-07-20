import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownTable } from "./markdown-table.js";

describe("markdownTable", () => {
  const row = (overrides = {}) => ({
    host: "example.com",
    port: "443",
    ruleType: "HTTPS",
    reason: "not in allowlist",
    count: 2,
    ...overrides,
  });

  it("renders a default 3-column table (Host, Rule, Count)", () => {
    const table = markdownTable([row()]);
    assert.equal(
      table,
      "| Host | Rule | Count |\n| --- | --- | ---: |\n| example.com:443 | HTTPS | 2 |",
    );
  });

  it("adds a Reason column when showReason is true", () => {
    const table = markdownTable([row()], { showReason: true });
    assert.match(table, /^\| Host \| Rule \| Reason \| Count \|/);
    assert.match(table, /\| example\.com:443 \| HTTPS \| not in allowlist \| 2 \|/);
  });

  it("adds an Expected column with a checkmark when showExpected is true and the row matched", () => {
    const table = markdownTable([row({ expected: true })], { showExpected: true });
    assert.match(table, /^\| Host \| Rule \| Count \| Expected \|/);
    assert.match(table, /\| example\.com:443 \| HTTPS \| 2 \| ✅ \|/);
  });

  it("leaves the Expected cell blank when the row did not match", () => {
    const table = markdownTable([row({ expected: false })], { showExpected: true });
    assert.match(table, /\| example\.com:443 \| HTTPS \| 2 \| {2}\|/);
  });

  it("renders all 5 columns when both showReason and showExpected are true", () => {
    const table = markdownTable([row({ expected: true })], { showReason: true, showExpected: true });
    assert.match(table, /^\| Host \| Rule \| Reason \| Count \| Expected \|/);
    assert.match(table, /\| example\.com:443 \| HTTPS \| not in allowlist \| 2 \| ✅ \|/);
  });

  it("renders only the header rows for an empty list", () => {
    const table = markdownTable([]);
    assert.equal(table, "| Host | Rule | Count |\n| --- | --- | ---: |");
  });
});
