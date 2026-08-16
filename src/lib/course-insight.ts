/**
 * Which course an employee is strongest and weakest at.
 *
 * Split out of the profile builder so the rule can be tested directly: live data
 * rarely reproduces a judgeable cohort on demand.
 *
 * **Both verdicts are read off the employee's own book.** The four summary cards
 * sit in one row and are read as one ranking, so they have to be drawn from one
 * population. They were not: the sales cards ranked the courses he invoices,
 * while the conversion cards ranked every course a lead had ever been routed to.
 * On a real profile in August 2026 that put "best sales: CFM $3,797.09" next to
 * "needs support: Management 0.0%, 8 decided of 12" — and Management was a
 * course he had no revenue in at all. The card said he was failing at it; what
 * the data supported was that twelve Management leads had been routed to a rep
 * whose sales were CFM, PMP, and Interior.
 *
 * So a course only becomes judgeable once he has actually sold it. Leads in
 * courses he has never sold are a routing fact, not a performance verdict, and
 * the profile reports them separately instead of ranking him on them.
 *
 * **The two cards still ask different questions and need different tests.**
 * Using one "reliable sample" flag for both produced two wrong answers at once:
 *
 * - PMP had 11 leads and 2 wins — his only converting course — but was rejected
 *   for having fewer than 5 decided leads, so the page announced that no course
 *   converted at all.
 * - CFM had 22 leads of which 16 were still open, 6 decided and all lost, while
 *   collecting $3,130. It was named the course needing support, when in truth
 *   three quarters of its cohort had simply not been decided yet.
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
  paidRevenue: number;
  invoices: number;
}

/**
 * Is this course part of what the employee actually sells?
 *
 * Money moving on his name is the primary proof, refunds included — a credit
 * note is still a seat he sold. But collections are dated by payment, so a
 * course he closed inside the window can still be waiting on its invoice; a win
 * is the same claim on a shorter clock, and keeps a genuinely sold course from
 * dropping out of his book on payment timing alone.
 *
 * One definition serves every card on the summary row. Ranking the money cards
 * on one population and the conversion cards on another is what put a course he
 * had never sold beside the course he sells most, as if they were comparable.
 */
export const isSoldCourse = (course: RankableCourse): boolean =>
  course.paidRevenue !== 0 || course.invoices > 0 || course.won > 0;

export type BestReason = "" | "no_book" | "no_sample" | "no_win_yet";
export type SupportReason = "" | "no_book" | "no_sample" | "cohort_still_open";

export interface CourseInsights<T extends RankableCourse> {
  /** Highest converting sold course, proven on a real cohort with a real win. */
  best: T | null;
  /** Weakest sold course whose cohort has actually been decided. */
  needsSupport: T | null;
  /** Why `best` is empty, so the UI never blames the sample size wrongly. */
  bestReason: BestReason;
  /** Why `needsSupport` is empty. */
  needsSupportReason: SupportReason;
}

const decidedShare = (course: RankableCourse): number =>
  course.leads > 0 ? (course.won + course.lost) / course.leads : 0;

export function rankCourseInsights<T extends RankableCourse>(courses: T[]): CourseInsights<T> {
  // Only his own book is judgeable. A course he has never sold cannot make him
  // look strong or weak, however its leads happen to have gone.
  const book = courses.filter(isSoldCourse);
  const sized = book.filter((course) => course.leads >= MIN_INSIGHT_LEADS);

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

  // An empty book and an unproven one are different problems: the first is a
  // rep with no sales at all, the second a rep whose sales are too new to judge.
  const emptyReason = book.length ? "no_sample" : "no_book";

  return {
    best,
    needsSupport,
    bestReason: best ? "" : sized.length ? "no_win_yet" : emptyReason,
    needsSupportReason: needsSupport ? "" : sized.length ? "cohort_still_open" : emptyReason,
  };
}
