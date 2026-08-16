/**
 * Which course an employee is strongest and weakest at.
 *
 * Split out of the profile builder so the ranking rule can be tested directly:
 * it only fires on a sample large enough to judge, which live data rarely
 * reproduces on demand.
 *
 * The rule this file exists to enforce is that **a course nobody converted is
 * never "best"**. Taking the plain maximum over the reliable courses meant that
 * an employee with a single judgeable course sitting at 0% had it announced as
 * their best conversion, while the "needs support" card — which required a
 * second course before it would say anything — stayed empty. The two headline
 * cards then read as the exact opposite of what the numbers said.
 */
export interface RankableCourse {
  key: string;
  conversionRate: number | null;
  leads: number;
  sampleStatus: "reliable" | "insufficient";
}

export interface CourseInsights<T extends RankableCourse> {
  /** Highest converting course with a judgeable sample and a rate above zero. */
  best: T | null;
  /**
   * Lowest converting course with a judgeable sample, as long as it is not the
   * same row already shown as the best one. A single reliable course still
   * qualifies — that is the case a manager most needs to see.
   */
  needsSupport: T | null;
}

export function rankCourseInsights<T extends RankableCourse>(courses: T[]): CourseInsights<T> {
  const reliable = courses.filter((course) => course.sampleStatus === "reliable");

  // Both ends break ties on the larger sample, which means the opposite thing on
  // each side and has to be spelled out rather than derived by reversing one
  // list: the strongest course should be the one proven over more leads, and the
  // weakest should be the one wasting more of them.
  const best =
    [...reliable]
      .sort(
        (left, right) =>
          (right.conversionRate ?? -1) - (left.conversionRate ?? -1) || right.leads - left.leads,
      )
      .find((course) => (course.conversionRate ?? 0) > 0) ?? null;

  const weakest =
    [...reliable].sort(
      (left, right) =>
        (left.conversionRate ?? Infinity) - (right.conversionRate ?? Infinity) ||
        right.leads - left.leads,
    )[0] ?? null;

  return {
    best,
    needsSupport: weakest && weakest.key !== best?.key ? weakest : null,
  };
}
