import { describe, it, expect } from "vitest";

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
      "| Host | Rule | Count |\n| --- | --- | ---: |\n| `example.com:443` | HTTPS | 2 |",
    );
  });

  it("adds a Reason column when showReason is true", () => {
    const table = renderHostTable([row()], { showReason: true });
    expect(table).toMatch(/^\| Host \| Rule \| Reason \| Count \|/);
    expect(table).toMatch(/\| `example\.com:443` \| HTTPS \| not in allowlist \| 2 \|/);
  });

  it("renders only the header rows for an empty list", () => {
    const table = renderHostTable([]);
    expect(table).toBe("| Host | Rule | Count |\n| --- | --- | ---: |");
  });
});

describe("a host carrying markdown syntax", () => {
  it("stays one cell, so a forged Host header cannot write the rest of the row", () => {
    const md = renderHostTable(
      [
        {
          host: "evil.example|HTTPS|-|1|x|",
          port: "443",
          ruleType: "HTTPS",
          reason: "-",
          count: 1,
        },
      ],
      { showReason: true },
    );
    const row = md.split("\n")[2];
    expect(row).toBe("| `evil.example\\|HTTPS\\|-\\|1\\|x\\|:443` | HTTPS | - | 1 |");
  });
});

describe("a row carrying a note", () => {
  it("shows the note after the host, for a row standing for several", () => {
    const md = renderHostTable([
      {
        host: "*.sury.org:*",
        port: "-",
        ruleType: "DNS",
        reason: "dns-not-allowed",
        count: 12,
        note: "(12 hosts)",
      },
    ]);
    expect(md.includes("| `*.sury.org:*` (12 hosts) | DNS | 12 |")).toBe(true);
  });
});

describe("a row with no port", () => {
  it("shows the name alone, since a blocked name was never connected to", () => {
    const md = renderHostTable([
      { host: "attacker.example", port: "-", ruleType: "DNS", reason: "dns-not-allowed", count: 1 },
    ]);
    expect(md.includes("`attacker.example` |")).toBe(true);
    expect(md.includes("attacker.example:-")).toBe(false);
  });
});
