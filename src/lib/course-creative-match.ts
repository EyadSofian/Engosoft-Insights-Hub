import { courseFromMarketingName } from "./course-taxonomy";
import type { AdCreative } from "./types";

type CreativeCourseFields = Pick<AdCreative, "campaign" | "creativeName" | "ad" | "adset">;

/**
 * Resolve the course used by the creative library without changing financial
 * attribution. Campaign evidence stays authoritative; names below the campaign
 * are discovery fallbacks for otherwise unclassified creative resources.
 */
export function courseForCreative(creative: CreativeCourseFields, joinedCourse = ""): string {
  return (
    courseFromMarketingName(creative.campaign) ||
    joinedCourse ||
    courseFromMarketingName(creative.creativeName) ||
    courseFromMarketingName(creative.ad) ||
    courseFromMarketingName(creative.adset) ||
    ""
  );
}
