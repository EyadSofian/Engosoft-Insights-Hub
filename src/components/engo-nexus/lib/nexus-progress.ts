/**
 * The progress labels shown while a turn runs.
 *
 * These are NOT decoration and they are not a fake typewriter. They describe,
 * in order, the pipeline a diagnostic turn genuinely executes: read the live
 * data, compare the periods, review the evidence, build the recommendation.
 * A DEEP executive turn really does run for tens of seconds doing exactly that,
 * and a bare spinner for that long is indistinguishable from a hang.
 *
 * They never claim a step has finished — each is a present participle, because
 * the panel cannot observe step completion unless the agent emits a `progress`
 * payload, in which case that payload's own label is used instead.
 */
export function progressLabels(lang: "ar" | "en"): string[] {
  return lang === "ar"
    ? [
        "جاري قراءة البيانات الحية…",
        "جاري مقارنة الفترات…",
        "جاري مراجعة الأدلة…",
        "جاري بناء التوصية…",
      ]
    : [
        "Reading live data…",
        "Comparing periods…",
        "Reviewing the evidence…",
        "Building the recommendation…",
      ];
}
