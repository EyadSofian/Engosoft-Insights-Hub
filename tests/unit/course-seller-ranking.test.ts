import { describe, expect, it } from "vitest";
import { buildCourseSellerRanking } from "@/lib/course-seller-ranking";

const input = {
  course: "BIM",
  crm: [
    { id: "1", course: "BIM", salesperson: "Mr. Amr", isWon: true },
    { id: "1", course: "BIM", salesperson: "Mr. Amr", isWon: true },
    { id: "2", course: " BIM ", salesperson: "mr amr", isWon: false },
    { id: "3", course: "PMP", salesperson: "Sara", isWon: false },
  ],
  lost: [{ id: "4", course: "BIM", salesperson: "MR AMR" }],
  orders: [
    { course: "BIM", salesperson: "Mr Amr", orderRef: "S1", usdSales: 400 },
    { course: "BIM", salesperson: "Mr Amr", orderRef: "S1", usdSales: 100 },
    { course: "PMP", salesperson: "Mr Amr", orderRef: "S1", usdSales: 800 },
    { course: "BIM", salesperson: "Sara", orderRef: "S2", usdSales: 600 },
    { course: "BIM", salesperson: "", orderRef: "S3", usdSales: 1000 },
  ],
  collections: [
    { course: "BIM", salesperson: "Mr. Amr", usdPaid: 300 },
    { course: "BIM", salesperson: "mr amr", usdPaid: -50 },
  ],
  availability: { crm: true, orders: true, collections: true },
};

describe("course seller leaderboard", () => {
  it("ranks by course order-line value, dedupes orders and leads, and keeps collections separate", () => {
    const report = buildCourseSellerRanking(input);
    expect(report.rankBy).toBe("sales");
    expect(report.rows).toEqual([
      {
        key: "sara",
        name: "Sara",
        rank: 1,
        leads: 0,
        won: 0,
        winRate: null,
        orders: 1,
        sales: 600,
        collected: 0,
      },
      {
        key: "mr amr",
        name: "Mr. Amr",
        rank: 2,
        leads: 3,
        won: 1,
        winRate: 100 / 3,
        orders: 1,
        sales: 500,
        collected: 250,
      },
      {
        key: "",
        name: "",
        rank: null,
        leads: 0,
        won: 0,
        winRate: null,
        orders: 1,
        sales: 1000,
        collected: 0,
      },
    ]);
  });

  it("does not show zero for missing feeds, and ranks on collections only when available", () => {
    const report = buildCourseSellerRanking({
      ...input,
      availability: { crm: false, orders: false, collections: true },
    });
    expect(report.rankBy).toBe("collected");
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      rank: 1,
      leads: null,
      winRate: null,
      sales: null,
      orders: null,
      collected: 250,
    });
  });
});
