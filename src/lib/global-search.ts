/* -------------------------------------------------------------------------
   ONE PLACE TO LOOK THINGS UP

   Simplifying the navigation only works if nothing became harder to reach. A
   reader types what they call the thing — in Arabic, in English, in Arabizi, or
   with a typo — and this finds it.

   Everything here is pure: normalisation, scoring and the destination registry.
   The dialog renders what these functions return, and the server endpoint uses
   the same scorer over campaign, creative and course names, so a match means
   the same thing wherever it was found.
------------------------------------------------------------------------- */

/**
 * Arabic, reduced to what a searcher actually typed.
 *
 * Hamza forms, the two yaas and the taa marbuta are the three differences that
 * make an exact match fail for a word the reader spelled correctly, so they are
 * folded together; tashkeel and tatweel carry no search meaning and go.
 * Display text is never touched — this only builds the index.
 */
export function normalizeArabic(value: string): string {
  return value
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه");
}

/** The comparable form of any term: Arabic folded, case and punctuation dropped. */
export function normalizeTerm(value: string): string {
  return normalizeArabic(value.toLowerCase())
    .replace(/[_\-./\\|،,:;()[\]{}'"«»؟?!@#$%^&*+=~`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every whitespace-separated word of a normalized string. */
export function terms(value: string): string[] {
  return normalizeTerm(value).split(" ").filter(Boolean);
}

/**
 * How close two words are, 0 (unrelated) to 1 (the same word).
 *
 * Prefix and containment score highest because that is what typing half a name
 * is; below that it falls back to edit distance, so "campain", "campagn" and
 * "revenu" still reach their destination. Short queries are held to a stricter
 * distance — with two characters, one edit is a different word.
 */
export function wordScore(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (candidate === query) return 1;
  if (candidate.startsWith(query)) return 0.92;
  if (candidate.includes(query)) return 0.78;
  const allowed = query.length <= 3 ? 0 : query.length <= 5 ? 1 : 2;
  if (!allowed) return 0;
  const distance = editDistance(query, candidate, allowed);
  if (distance > allowed) return 0;
  return 0.72 - distance * 0.12;
}

/** Levenshtein distance, abandoned as soon as it passes `limit`. */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      best = Math.min(best, current[j]);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

/**
 * How well a haystack of terms answers a query. Every query word has to find
 * something — "cfm video" must not match a campaign that only knows "video" —
 * and the score is the average of each word's best match.
 */
export function matchScore(query: string, haystack: readonly string[]): number {
  const words = terms(query);
  if (!words.length) return 0;
  const candidates = haystack.flatMap((entry) => {
    const normalized = normalizeTerm(entry);
    return normalized ? [normalized, ...normalized.split(" ")] : [];
  });
  if (!candidates.length) return 0;
  let total = 0;
  for (const word of words) {
    let best = 0;
    for (const candidate of candidates) {
      best = Math.max(best, wordScore(word, candidate));
      if (best === 1) break;
    }
    if (!best) return 0;
    total += best;
  }
  return total / words.length;
}

export type SearchCategory = "report" | "campaign" | "creative" | "course";

export interface SearchDestination {
  id: string;
  /** English title, shown when the reader is in English. */
  title: string;
  /** Arabic title, shown when the reader is in Arabic. */
  titleAr: string;
  route: string;
  search?: Record<string, string>;
  category: SearchCategory;
  /** What this report answers, one line. */
  hint?: { ar: string; en: string };
  /** Everything a reader might type for it: both languages, Arabizi, old names, typos. */
  keywords: string[];
}

export interface SearchHit<T> {
  item: T;
  score: number;
}

/** The registry, ranked. Reports are the destinations a manager reaches for most. */
export function searchDestinations(
  query: string,
  registry: readonly SearchDestination[],
  limit = 8,
): SearchHit<SearchDestination>[] {
  const hits: SearchHit<SearchDestination>[] = [];
  for (const item of registry) {
    const score = matchScore(query, [item.title, item.titleAr, ...item.keywords]);
    if (score > 0.5) hits.push({ item, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit);
}

/** The same scorer over any named entity — campaigns, creatives, courses. */
export function searchNamed<T extends { name: string; extra?: string[] }>(
  query: string,
  items: readonly T[],
  limit = 6,
): SearchHit<T>[] {
  const hits: SearchHit<T>[] = [];
  for (const item of items) {
    const score = matchScore(query, [item.name, ...(item.extra ?? [])]);
    if (score > 0.55) hits.push({ item, score });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit);
}
