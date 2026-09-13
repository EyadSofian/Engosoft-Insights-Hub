import { describe, expect, it } from "vitest";
import { courseForCreative } from "../../src/lib/course-creative-match";

const creative = (overrides: Partial<Parameters<typeof courseForCreative>[0]> = {}) => ({
  campaign: "",
  creativeName: "",
  ad: "",
  adset: "",
  ...overrides,
});

describe("course creative matching", () => {
  it("reads the course from the campaign name", () => {
    expect(courseForCreative(creative({ campaign: "CFM -9/9/26-SAYED" }))).toBe("CFM");
  });

  it("falls back to the creative label when the campaign is unclassified", () => {
    expect(
      courseForCreative(
        creative({
          campaign: "Saudi lead generation",
          creativeName: "PMP exam preparation - reel 03",
        }),
      ),
    ).toBe("PMP");
  });

  it("uses the joined CRM course before lower-level names", () => {
    expect(
      courseForCreative(creative({ campaign: "Generic leads", ad: "Auto profile" }), "BIM"),
    ).toBe("BIM");
  });

  it("does not let a lower-level name override a declared campaign course", () => {
    expect(
      courseForCreative(
        creative({ campaign: "PMP-1/7/26-sayed", creativeName: "Auto profile concept" }),
      ),
    ).toBe("PMP");
  });
});
