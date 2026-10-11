import { describe, expect, it } from "vitest";
import { isLostOpportunity, leadLifecycleBucket } from "../../src/lib/lead-course-distribution";

describe("lead and opportunity lost distinction", () => {
  it("counts a lost lead separately from a lost opportunity", () => {
    expect(leadLifecycleBucket("lead", "Lost")).toBe("lead_lost");
    expect(isLostOpportunity("lead", "Lost")).toBe(false);
    expect(leadLifecycleBucket("opportunity", "Lost")).toBe("opportunity");
    expect(isLostOpportunity("opportunity", "Lost")).toBe(true);
    expect(isLostOpportunity("opportunity", "Lost / خسارة")).toBe(true);
  });

  it("does not classify open or won opportunities as lost", () => {
    expect(isLostOpportunity("opportunity", "Open")).toBe(false);
    expect(isLostOpportunity("opportunity", "Won")).toBe(false);
  });
});
