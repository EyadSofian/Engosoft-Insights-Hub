/**
 * Which course an employee is strongest and weakest at.
 *
 * Split out of the profile builder so the rule can be tested directly: live data
 * rarely reproduces a judgeable cohort on demand.
 *
 * **The two cards ask different questions and therefore need different tests.**
 * Using one "reliable sample" flag for both produced two wrong answers at once,
 * observed on a real profile in August 2026:
 *
 * - PMP had 11 leads and 2 wins — his only converting course — but was rejected
 *   for having fewer than 5 decided leads, so the page announced that no course
 *   converted at all.
 * - CFM had 22 leads of which 16 were still open, 6 decided and all lost, while
 *   collecting $3,130. It was named the course needing support, when in truth
 *   three quarters of its cohort had simply not been decided yet. Meanwhile
 *   Management — 11 leads, 6 decided, none won, no revenue at all — went unnamed.
 *
 * So strength is judged on evidence that conversion happens (a real cohort and
 * at least one win), and weakness on evidence that it is failing (a real cohort
 * that has actually been decided). A cohort still in play is neither.
 */

/** Below this, one lucky lead would decide the answer. */
export const MIN_INSIGHT_LEADS = 10;

/**
 * Share of a course's cohort that must be Won or Lost before the course can be
 * called weak. A monthly window is usually shorter than the sales cycle, so most
 * leads created in it are still open — counting those as failures marks every
 * employee down for deals they are still working.
 */
export const MIN_DECIDED_SHARE = 0.5;

export interface RankableCourse {
  key: string;
  conversionRate: number | null;
  leads: number;
  won: number;
  lost: number;
}

export type BestReason = "" | "no_sample" | "no_win_yet";
export type SupportReason = "" | "no_sample" | "cohort_still_open";

export interface CourseInsights<T extends RankableCourse> {
  /** Highest converting course proven on a real cohort with at least one win. */
  best: T | null;
  /** Weakest course whose cohort has actually been decided. */
  needsSupport: T | null;
  /** Why `best` is empty, so the UI never blames the sample size wrongly. */
  bestReason: BestReason;
  /** Why `needsSupport` is empty. */
  needsSupportReason: SupportReason;
  /**
   * Large lead piles carrying a label the company has never sold. Excluded from
   * both verdicts and reported instead, because they describe the CRM, not the
   * employee.
   */
  unsellable: T[];
}

const decidedShare = (course: RankableCourse): number =>
  course.leads > 0 ? (course.won + course.lost) / course.leads : 0;

/**
 * @param sellable Course keys the company has ever invoiced. A label with leads
 *   but no sale anywhere is not part of anyone's course package: "Management"
 *   carries 1,549 leads and 0 invoices in the whole history, so naming it as
 *   someone's weak course describes a mislabelled lead pile, not a seller who
 *   needs coaching. Pass `null` to skip the check.
 */
export function rankCourseInsights<T extends RankableCourse>(
  courses: T[],
  sellable: ReadonlySet<string> | null = null,
): CourseInsights<T> {
  const sellableOnly = sellable ? courses.filter((course) => sellable.has(course.key)) : courses;
  const unsellable = sellable
    ? courses.filter((course) => !sellable.has(course.key) && course.leads >= MIN_INSIGHT_LEADS)
    : [];
  const sized = sellableOnly.filter((course) => course.leads >= MIN_INSIGHT_LEADS);

  // Strength: a win actually happened, on a cohort big enough to mean something.
  const best =
    [...sized]
      .filter((course) => course.won > 0)
      .sort(
        (left, right) =>
          (right.conversionRate ?? -1) - (left.conversionRate ?? -1) || right.leads - left.leads,
      )[0] ?? null;

  // Weakness: the cohort has been decided, and it went badly. Ties break on the
  // larger cohort, because more decided leads is the bigger problem.
  const decided = sized.filter((course) => decidedShare(course) >= MIN_DECIDED_SHARE);
  const weakest =
    [...decided].sort(
      (left, right) =>
        (left.conversionRate ?? Infinity) - (right.conversionRate ?? Infinity) ||
        right.leads - left.leads,
    )[0] ?? null;
  const needsSupport = weakest && weakest.key !== best?.key ? weakest : null;

  return {
    best,
    needsSupport,
    bestReason: best ? "" : sized.length ? "no_win_yet" : "no_sample",
    needsSupportReason: needsSupport ? "" : sized.length ? "cohort_still_open" : "no_sample",
    unsellable: [...unsellable].sort((left, right) => right.leads - left.leads),
  };
}
