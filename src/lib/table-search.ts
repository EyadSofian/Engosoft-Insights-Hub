import { normalizeArabic } from "./global-search";

const MONTHS: Record<string, string> = {
  jan: "january",
  feb: "february",
  mar: "march",
  apr: "april",
  jun: "june",
  jul: "july",
  aug: "august",
  sep: "september",
  sept: "september",
  oct: "october",
  nov: "november",
  dec: "december",
};

/** Search-only normalization. Never changes display names, grouping, or metrics. */
export function searchTerms(value: string): string[] {
  return normalizeArabic(value.normalize("NFKC").toLocaleLowerCase())
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((term) => MONTHS[term] || term);
}

export function tableSearchMatcher(query: string): (value: string) => boolean {
  const wanted = searchTerms(query.slice(0, 500));
  if (!wanted.length) return () => true;
  return (value) => {
    const tokens = searchTerms(value);
    const indexed = tokens.join(" ");
    // Ad2 must not match Ad1 merely because its date contains "20".
    return wanted.every((term) =>
      /^\d{1,4}$/.test(term) ? tokens.includes(term) : indexed.includes(term),
    );
  };
}
