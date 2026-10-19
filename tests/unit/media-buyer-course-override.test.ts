import { describe, expect, it } from "vitest";
import { mediaBuyerForCampaign } from "../../src/lib/media-buyers";

describe("course ownership overrides legacy media-buyer tags", () => {
  it.each(["Auto", "Automotive", "BIM", "CMRP"])("assigns %s to Shazly even with SAYED", (course) => {
    expect(mediaBuyerForCampaign(course, `${course}-18/10/26-SAYED`)).toBe("shazly");
  });
  it("keeps the campaign-name rule for other courses", () => {
    expect(mediaBuyerForCampaign("PMP", "PMP-18/10/26-SAYED")).toBe("sayed");
    expect(mediaBuyerForCampaign("CFM", "CFM-18/10/26-SH")).toBe("shazly");
  });
});
