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
});
