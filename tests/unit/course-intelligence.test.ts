import { describe, expect, it } from "vitest";
import { buildCampaignProductMix, buildCourseVariants } from "@/lib/course-intelligence.server";

/**
 * Minimal rows shaped like the real ones. Only the fields these two functions
 * read are populated; everything else is irrelevant to what is under test.
 */
const accounting = (over: Record<string, unknown>) =>
  ({
    movement: "",
    isCreditNote: false,
    product: "",
    productCode: "",
    quantity: 0,
    usdPaid: 0,
    course: "PMP",
    campaignKey: "",
    campaignName: "",
    ...over,
  }) as never;

const invoiced = (over: Record<string, unknown>) =>
  ({
    orderRef: "",
    product: "",
    course: "PMP",
    campaignKey: "",
    campaignName: "",
    ...over,
  }) as never;

const data = (acc: unknown[], inv: unknown[] = []): Parameters<typeof buildCourseVariants>[0] =>
  ({ accounting: acc, invoiced: inv }) as never;

describe("course variants — what was actually sold inside the family", () => {
  it("groups sold products and ranks them by collected revenue", () => {
    const variants = buildCourseVariants(
      data([
        accounting({
          movement: "INV/1",
          product: "PMP + Exam",
          productCode: "109",
          quantity: 1,
          usdPaid: 1500,
        }),
        accounting({
          movement: "INV/2",
          product: "PMP Recorded",
          productCode: "108",
          quantity: 1,
          usdPaid: 500,
        }),
      ]),
      "PMP",
    );

    expect(variants.map((v) => v.displayName)).toEqual(["PMP + Exam", "PMP Recorded"]);
    expect(variants[0]!.revenue).toBe(1500);
    expect(variants[0]!.revenueShare).toBeCloseTo(0.75, 5);
    expect(variants[1]!.revenueShare).toBeCloseTo(0.25, 5);
  });

  it("counts one invoice once, however many lines it has", () => {
    // An invoice with three lines is one invoice. The drill-down counts by
    // distinct movement and this must agree with it.
    const variants = buildCourseVariants(
      data([
        accounting({
          movement: "INV/7",
          product: "PMP + Exam",
          productCode: "109",
          usdPaid: 100,
        }),
        accounting({
          movement: "INV/7",
          product: "PMP + Exam",
          productCode: "109",
          usdPaid: 200,
        }),
      ]),
      "PMP",
    );
    expect(variants[0]!.invoices).toBe(1);
    expect(variants[0]!.revenue).toBe(300);
  });

  it("counts one sales order once", () => {
    const variants = buildCourseVariants(
      data(
        [],
        [
          invoiced({ orderRef: "SO/1", product: "PMP + Exam" }),
          invoiced({ orderRef: "SO/1", product: "PMP + Exam" }),
          invoiced({ orderRef: "SO/2", product: "PMP + Exam" }),
        ],
      ),
      "PMP",
    );
    expect(variants[0]!.salesOrders).toBe(2);
  });

  it("excludes credit notes from the invoice count", () => {
    const variants = buildCourseVariants(
      data([
        accounting({
          movement: "INV/1",
          product: "PMP + Exam",
          usdPaid: 1000,
        }),
        accounting({
          movement: "RINV/1",
          product: "PMP + Exam",
          isCreditNote: true,
          usdPaid: -1000,
        }),
      ]),
      "PMP",
    );
    expect(variants[0]!.invoices).toBe(1);
    // The refund still moves the money.
    expect(variants[0]!.revenue).toBe(0);
  });

  it("never reports a variant ROAS", () => {
    // Ad spend attaches to a campaign, and a campaign sells several variants.
    // courseSpend / variantRevenue is an invented number that looks real.
    const variants = buildCourseVariants(
      data([accounting({ movement: "INV/1", product: "PMP + Exam", usdPaid: 900 })]),
      "PMP",
    );
    expect(variants[0]!.roas).toBe("NOT_MEASURABLE");
    expect(Object.keys(variants[0]!)).not.toContain("spend");
  });

  it("marks a product with no code as unresolved rather than guessing one", () => {
    const variants = buildCourseVariants(
      data([accounting({ movement: "INV/1", product: "PMP Something", usdPaid: 10 })]),
      "PMP",
    );
    expect(variants[0]!.resolutionStatus).toBe("raw");
    expect(variants[0]!.productCode).toBe("");
  });

  it("keeps every raw name that folded into one coded variant", () => {
    // Two spellings, one product code: the code wins, both names are kept.
    const variants = buildCourseVariants(
      data([
        accounting({
          movement: "INV/1",
          product: "PMP + Exam",
          productCode: "109",
          usdPaid: 10,
        }),
        accounting({
          movement: "INV/2",
          product: "PMP+Exam Online",
          productCode: "109",
          usdPaid: 10,
        }),
      ]),
      "PMP",
    );
    expect(variants).toHaveLength(1);
    expect(variants[0]!.rawProductNames).toEqual(["PMP + Exam", "PMP+Exam Online"]);
    expect(variants[0]!.resolutionStatus).toBe("coded");
  });

  it("ignores rows belonging to another course family", () => {
    const variants = buildCourseVariants(
      data([
        accounting({ movement: "INV/1", product: "PMP + Exam", usdPaid: 100 }),
        accounting({
          movement: "INV/2",
          product: "CFM + Exam",
          course: "CFM",
          usdPaid: 999,
        }),
      ]),
      "PMP",
    );
    expect(variants).toHaveLength(1);
    expect(variants[0]!.displayName).toBe("PMP + Exam");
  });
});

describe("campaign × product mix — answering 'الحملة دي باعت إيه؟' from invoices", () => {
  it("reports the product mix a campaign actually sold", () => {
    // The spec's worked example: 3 invoices, $2,000, split 1,500 / 500.
    const mix = buildCampaignProductMix(
      data([
        accounting({
          movement: "INV/1",
          campaignKey: "c1",
          campaignName: "PMP-Aug",
          product: "PMP + Exam",
          usdPaid: 1500,
        }),
        accounting({
          movement: "INV/2",
          campaignKey: "c1",
          campaignName: "PMP-Aug",
          product: "PMP Recorded",
          usdPaid: 500,
        }),
      ]),
      "PMP",
    );

    expect(mix).toHaveLength(1);
    expect(mix[0]!.campaignName).toBe("PMP-Aug");
    expect(mix[0]!.products.map((p) => [p.product, p.revenue])).toEqual([
      ["PMP + Exam", 1500],
      ["PMP Recorded", 500],
    ]);
  });

  it("drops a row with no campaign rather than inventing one", () => {
    const mix = buildCampaignProductMix(
      data([accounting({ movement: "INV/1", product: "PMP + Exam", usdPaid: 100 })]),
      "PMP",
    );
    expect(mix).toEqual([]);
  });

  it("keys a campaign by its key, not its display name", () => {
    // Two spellings of one campaign must not become two campaigns.
    const mix = buildCampaignProductMix(
      data([
        accounting({
          movement: "INV/1",
          campaignKey: "c1",
          campaignName: "PMP-Aug",
          product: "PMP + Exam",
          usdPaid: 100,
        }),
        accounting({
          movement: "INV/2",
          campaignKey: "c1",
          campaignName: "pmp-aug ",
          product: "PMP + Exam",
          usdPaid: 100,
        }),
      ]),
      "PMP",
    );
    expect(mix).toHaveLength(1);
    expect(mix[0]!.products[0]!.revenue).toBe(200);
    expect(mix[0]!.products[0]!.invoices).toBe(2);
  });

  it("de-duplicates invoices and orders inside a campaign too", () => {
    const mix = buildCampaignProductMix(
      data(
        [
          accounting({
            movement: "INV/9",
            campaignKey: "c1",
            campaignName: "A",
            product: "PMP + Exam",
            usdPaid: 50,
          }),
          accounting({
            movement: "INV/9",
            campaignKey: "c1",
            campaignName: "A",
            product: "PMP + Exam",
            usdPaid: 50,
          }),
        ],
        [
          invoiced({
            orderRef: "SO/3",
            campaignKey: "c1",
            campaignName: "A",
            product: "PMP + Exam",
          }),
          invoiced({
            orderRef: "SO/3",
            campaignKey: "c1",
            campaignName: "A",
            product: "PMP + Exam",
          }),
        ],
      ),
      "PMP",
    );
    expect(mix[0]!.products[0]!.invoices).toBe(1);
    expect(mix[0]!.products[0]!.salesOrders).toBe(1);
  });

  it("ranks campaigns by the revenue they actually produced", () => {
    const mix = buildCampaignProductMix(
      data([
        accounting({
          movement: "INV/1",
          campaignKey: "small",
          campaignName: "Small",
          product: "PMP + Exam",
          usdPaid: 100,
        }),
        accounting({
          movement: "INV/2",
          campaignKey: "big",
          campaignName: "Big",
          product: "PMP + Exam",
          usdPaid: 900,
        }),
      ]),
      "PMP",
    );
    expect(mix.map((m) => m.campaignName)).toEqual(["Big", "Small"]);
  });
});
