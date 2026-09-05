import { describe, expect, it } from "vitest";
import {
  presentationMode,
  campaignPresentationMode,
  productPresentationMode,
  moreControl,
  sortRows,
  filterRows,
  TABLE_INITIAL_ROWS,
  TABLE_PAGE_SIZE,
} from "@/components/engo-nexus/lib/nexus-layout";

describe("presentation mode — the boundaries, exactly", () => {
  it("renders nothing for an empty collection", () => {
    expect(presentationMode(0)).toBe("empty");
    expect(presentationMode(-1)).toBe("empty");
    expect(presentationMode(Number.NaN)).toBe("empty");
  });

  it("uses cards up to three", () => {
    expect(presentationMode(1)).toBe("cards");
    expect(presentationMode(2)).toBe("cards");
    expect(presentationMode(3)).toBe("cards");
  });

  it("switches to a carousel at four and stays to eight", () => {
    expect(presentationMode(4)).toBe("carousel");
    expect(presentationMode(8)).toBe("carousel");
  });

  it("switches to a table at nine and beyond", () => {
    // The case that mattered: seventeen campaigns must never be seventeen cards.
    expect(presentationMode(9)).toBe("table");
    expect(presentationMode(17)).toBe("table");
    expect(presentationMode(25)).toBe("table");
    expect(presentationMode(100)).toBe("table");
  });

  it("uses the same rule for campaigns and products", () => {
    for (const n of [0, 1, 3, 4, 8, 9, 25]) {
      expect(campaignPresentationMode(n)).toBe(productPresentationMode(n));
    }
  });
});

describe("the show-more control", () => {
  it("stays hidden when everything is already visible", () => {
    expect(moreControl(5, 5, "ar").show).toBe(false);
    expect(moreControl(3, 10, "ar").show).toBe(false);
  });

  it("offers the next page when many remain", () => {
    const control = moreControl(25, TABLE_INITIAL_ROWS, "ar");
    expect(control.show).toBe(true);
    expect(control.remaining).toBe(20);
    expect(control.label).toContain(String(TABLE_PAGE_SIZE));
  });

  it("offers 'show all' when the remainder fits in one page", () => {
    expect(moreControl(12, 5, "ar").label).toBe("عرض الكل (12)");
    expect(moreControl(12, 5, "en").label).toBe("Show all (12)");
  });
});

describe("local sorting never invents a business ranking", () => {
  const rows = [
    { name: "a", revenue: 100, roas: 9, spend: 10, won: 1 },
    { name: "b", revenue: 900, roas: 2, spend: 50, won: 7 },
    { name: "c", revenue: 500, roas: 5, spend: 30, won: 3 },
  ];

  it("keeps the backend order when no sort is applied", () => {
    // The incoming order IS the business ranking.
    expect(sortRows(rows, null).map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("sorts by each allowed key, descending", () => {
    expect(sortRows(rows, "revenue").map((r) => r.name)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, "roas").map((r) => r.name)).toEqual(["a", "c", "b"]);
    expect(sortRows(rows, "spend").map((r) => r.name)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, "won").map((r) => r.name)).toEqual(["b", "c", "a"]);
  });

  it("puts unmeasurable values last rather than treating them as zero", () => {
    const withNull = [
      { name: "x", revenue: null },
      { name: "y", revenue: 5 },
    ];
    expect(sortRows(withNull, "revenue").map((r) => r.name)).toEqual(["y", "x"]);
  });

  it("does not mutate the input", () => {
    const original = [...rows];
    sortRows(rows, "revenue");
    expect(rows).toEqual(original);
  });
});

describe("local filters are slices of the backend ranking", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ n: i }));

  it("returns everything for 'all'", () => {
    expect(filterRows(rows, "all")).toHaveLength(10);
  });

  it("takes the top three for 'best'", () => {
    expect(filterRows(rows, "best").map((r) => r.n)).toEqual([0, 1, 2]);
  });

  it("takes the bottom three for 'worst', worst first", () => {
    expect(filterRows(rows, "worst").map((r) => r.n)).toEqual([9, 8, 7]);
  });

  it("leaves a short list alone whatever the filter", () => {
    const short = [{ n: 1 }, { n: 2 }];
    expect(filterRows(short, "best")).toHaveLength(2);
    expect(filterRows(short, "worst")).toHaveLength(2);
  });
});
