import { normalizePersonName } from "./person-name.ts";

const TOKEN_ALIASES: Record<string, string> = {
  abdallah: "abdullah",
  abdulrahman: "abdelrahman",
  ebrahim: "ibrahim",
  hesham: "hisham",
  hessein: "hussein",
  hessin: "hussein",
  ibraheem: "ibrahim",
  mahmnoud: "mahmoud",
  mohamad: "mohamed",
  mohammed: "mohamed",
  mohmed: "mohamed",
  muhammad: "mohamed",
  mustafa: "mostafa",
  sabreen: "sabrin",
  samy: "sami",
  sharif: "sherif",
  talaat: "talat",
  taalat: "talat",
  walid: "waleed",
};

const TITLES = new Set(["eng", "engineer", "mr", "mrs", "ms"]);

/**
 * A deliberately narrow cross-system identity normalizer.
 *
 * Odoo commonly carries a four- or five-part legal name while Yeastar and
 * Chatwoot use two names. We only collapse observed transliteration variants;
 * the primary data keys elsewhere remain exact.
 */
export function integrationPersonTokens(value: string): string[] {
  const normalized = normalizePersonName(value)
    .replace(/\babdel\s+naser\b/g, "abdelnaser")
    .replace(/\bel\s+shiekh\b/g, "elshiekh");
  return normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => !TITLES.has(token))
    .map((token) => TOKEN_ALIASES[token] || token);
}

/**
 * Returns true only when the shorter spelling has at least two tokens and is
 * wholly contained in the longer spelling. Callers must still require a
 * unique candidate before attaching metrics to an employee.
 */
export function integrationPersonNamesMatch(left: string, right: string): boolean {
  return integrationPersonMatchScore(left, right) > 0;
}

/** Prefix agreement is stronger than unordered containment. This lets
 * `Abdullah Mohsen` prefer the Odoo name that starts with those words over a
 * different long name that happens to contain both later on. */
export function integrationPersonMatchScore(left: string, right: string): number {
  const leftTokens = integrationPersonTokens(left);
  const rightTokens = integrationPersonTokens(right);
  if (leftTokens.length < 2 || rightTokens.length < 2) return 0;
  if (leftTokens.join(" ") === rightTokens.join(" ")) return 3;
  const [shorter, longer] =
    leftTokens.length <= rightTokens.length
      ? [leftTokens, rightTokens]
      : [rightTokens, leftTokens];
  if (shorter.every((token, index) => longer[index] === token)) return 2;
  const remaining = [...longer];
  for (const token of shorter) {
    const index = remaining.indexOf(token);
    if (index < 0) return 0;
    remaining.splice(index, 1);
  }
  return 1;
}
