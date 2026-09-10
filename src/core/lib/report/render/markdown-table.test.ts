import { describe, it, expect } from "vitest";
import { markdownTable } from "./markdown-table.ts";

describe("markdownTable", () => {
  it("renders headers, a left-aligned divider row, and cells pulled by key", () => {
    const table = markdownTable(
      [
        { key: "a", title: "A" },
        { key: "b", title: "B" },
      ],
      [{ a: "1", b: "2" }],
    );
    expect(table).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("supports right and center alignment per column", () => {
    const table = markdownTable(
      [
        { key: "a", title: "A", align: "right" },
        { key: "b", title: "B", align: "center" },
        { key: "c", title: "C" },
      ],
      [{ a: 1, b: 2, c: 3 }],
    );
    expect(table).toBe("| A | B | C |\n| ---: | :---: | --- |\n| 1 | 2 | 3 |");
  });

  it("renders only the header rows for an empty row list", () => {
    const table = markdownTable([{ key: "a", title: "A" }], []);
    expect(table).toBe("| A |\n| --- |");
  });

  it('renders an absent cell as empty, not as "undefined"', () => {
    const table = markdownTable(
      [
        { key: "a", title: "A" },
        { key: "b", title: "B" },
      ],
      [{ a: "1" }],
    );
    expect(table).toBe("| A | B |\n| --- | --- |\n| 1 |  |");
  });

  describe("cell escaping", () => {
    const oneCell = (value: string) =>
      markdownTable([{ key: "a", title: "A" }], [{ a: value }]).split("\n")[2];

    it("escapes a '|' so a host cannot open cells of its own", () => {
      // What a forged Host header reaches the log as, verbatim.
      const row = oneCell("evil.example|HTTPS|-|1|x|:443");
      expect(row).toBe("| evil.example\\|HTTPS\\|-\\|1\\|x\\|:443 |");
      // Still one cell: the row's `|` count is the two delimiters and nothing more.
      expect(row.match(/(?<!\\)\|/g)).toHaveLength(2);
    });

    it("escapes angle brackets so a host cannot inject raw HTML", () => {
      expect(oneCell("a<details>b")).toBe("| a\\<details\\>b |");
    });

    it("escapes brackets so a host cannot render as a link", () => {
      expect(oneCell("[click](https://evil.example)")).toBe(
        "| \\[click\\](https://evil.example) |",
      );
    });

    it("escapes backticks, asterisks and underscores", () => {
      expect(oneCell("a`b`c*d*e_f_")).toBe("| a\\`b\\`c\\*d\\*e\\_f\\_ |");
    });

    it("escapes a backslash without double-escaping what follows", () => {
      expect(oneCell("a\\|b")).toBe("| a\\\\\\|b |");
    });

    it("collapses a newline, which no backslash could keep inside the row", () => {
      expect(oneCell("a\r\nb\nc")).toBe("| a b c |");
    });

    it("leaves the characters an ordinary host is made of alone", () => {
      expect(oneCell("sub.example-host.com:9443")).toBe("| sub.example-host.com:9443 |");
    });
  });
});
