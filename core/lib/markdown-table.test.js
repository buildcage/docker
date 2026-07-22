import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownTable } from "./markdown-table.js";

describe("markdownTable", () => {
  it("renders headers, a left-aligned divider row, and cells pulled by key", () => {
    const table = markdownTable(
      [{ key: "a", title: "A" }, { key: "b", title: "B" }],
      [{ a: "1", b: "2" }],
    );
    assert.equal(table, "| A | B |\n| --- | --- |\n| 1 | 2 |");
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
    assert.equal(table, "| A | B | C |\n| ---: | :---: | --- |\n| 1 | 2 | 3 |");
  });

  it("renders only the header rows for an empty row list", () => {
    const table = markdownTable([{ key: "a", title: "A" }], []);
    assert.equal(table, "| A |\n| --- |");
  });
});
