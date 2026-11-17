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
    { course: "BIM", salesperson: "Sara", usdPaid: 150 },
    { course: "BIM", salesperson: "", usdPaid: 100 },
    { course: "PMP", salesperson: "Sara", usdPaid: 200 },
  ],
  availability: { crm: true, orders: true, collections: true },
};

describe("course seller leaderboard", () => {
  it("ranks by signed course collections, dedupes orders and leads, and includes unassigned money in the total", () => {
    const report = buildCourseSellerRanking(input);
    expect(report.totalCollected).toBe(500);
    expect(report.rows).toEqual([
      {
        key: "mr amr",
        name: "Mr. Amr",
        rank: 1,
        leads: 3,
        won: 1,
        winRate: 100 / 3,
        orders: 1,
        collected: 250,
        collectionShare: 50,
      },
      {
        key: "sara",
        name: "Sara",
        rank: 2,
        leads: 0,
        won: 0,
        winRate: null,
        orders: 1,
        collected: 150,
        collectionShare: 30,
      },
      {
        key: "",
        name: "",
        rank: null,
        leads: 0,
        won: 0,
        winRate: null,
        orders: 1,
        collected: 100,
        collectionShare: 20,
      },
    ]);
  });

  it("does not fall back to sale orders when collections are unavailable", () => {
    const report = buildCourseSellerRanking({
      ...input,
      availability: { crm: false, orders: true, collections: false },
    });
    expect(report.totalCollected).toBeNull();
    expect(report.rows[0]).toMatchObject({
      rank: null,
      leads: null,
      winRate: null,
      orders: 1,
      collected: null,
      collectionShare: null,
    });
  });

  it("uses the complete course denominator even when only one seller is displayed", () => {
    const report = buildCourseSellerRanking({
      ...input,
      orders: [],
      crm: [],
      lost: [],
      collections: [{ course: "BIM", salesperson: "Sara", usdPaid: 150 }],
      courseCollections: input.collections,
    });
    expect(report.totalCollected).toBe(500);
    expect(report.rows[0]?.collectionShare).toBe(30);
  });
});
