import { describe, expect, it } from "vitest";
import { defaultHiddenColumns, type Col } from "../../src/components/DataTable";

describe("materials table visibility", () => {
  it("shows all nine requested columns in their original order", () => {
    const keys = [
      "adName",
      "spend",
      "leads",
      "cpl",
      "won",
      "lost",
      "conversion",
      "revenue",
      "roas",
    ];
    const cols: Col<object>[] = keys.map((key) => ({
      key,
      header: key,
      render: () => "",
      always: key === "adName",
    }));
    const hidden = defaultHiddenColumns(cols, 9);
    expect(cols.filter((col) => col.always || !hidden.has(col.key)).map((col) => col.key)).toEqual(
      keys,
    );
  });
});
