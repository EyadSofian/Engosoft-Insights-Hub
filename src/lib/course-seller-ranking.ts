import { normalizePersonName } from "./person-name";
import type { AccountingRow, CrmLeadRow, InvoicedRow, LostRow } from "./types";

export interface CourseSellerAvailability {
  crm: boolean;
  orders: boolean;
  collections: boolean;
}

export function buildCourseSellerRanking(input: {
  course: string;
  crm: readonly Pick<CrmLeadRow, "id" | "course" | "salesperson" | "isWon">[];
  lost: readonly Pick<LostRow, "id" | "course" | "salesperson">[];
  orders: readonly Pick<InvoicedRow, "course" | "salesperson" | "orderRef">[];
  collections: readonly Pick<AccountingRow, "course" | "salesperson" | "usdPaid">[];
  /** Same course and reporting filters, without seller/team filters. */
  courseCollections?: readonly Pick<AccountingRow, "course" | "usdPaid">[];
  period?: { from?: string; to?: string };
  availability: CourseSellerAvailability;
}) {
  const courseKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const isCourse = (value: string) => courseKey(value) === courseKey(input.course);
  const { availability } = input;
  const people = new Map<
    string,
    {
      name: string;
      leads: number;
      won: number;
      orderRefs: Set<string>;
      collected: number;
    }
  >();
  const seller = (name: string) => {
    const key = normalizePersonName(name);
    const existing = people.get(key);
    if (existing) return existing;
    const person = {
      name: key ? name.trim() : "",
      leads: 0,
      won: 0,
      orderRefs: new Set<string>(),
      collected: 0,
    };
    people.set(key, person);
    return person;
  };
  if (availability.crm) {
    const seen = new Set<string>();
    for (const row of input.crm) {
      if (!isCourse(row.course) || (row.id && seen.has(row.id))) continue;
      if (row.id) seen.add(row.id);
      const p = seller(row.salesperson);
      p.leads++;
      if (row.isWon) p.won++;
    }
    for (const row of input.lost) {
      if (!isCourse(row.course) || (row.id && seen.has(row.id))) continue;
      if (row.id) seen.add(row.id);
      seller(row.salesperson).leads++;
    }
  }
  if (availability.orders) {
    for (const row of input.orders) {
      if (!isCourse(row.course)) continue;
      const p = seller(row.salesperson);
      if (row.orderRef) p.orderRefs.add(row.orderRef);
    }
  }
  if (availability.collections) {
    for (const row of input.collections) {
      if (isCourse(row.course)) seller(row.salesperson).collected += row.usdPaid;
    }
  }
  const totalCollected = availability.collections
    ? (input.courseCollections ?? input.collections)
        .filter((row) => isCourse(row.course))
        .reduce((sum, row) => sum + row.usdPaid, 0)
    : null;
  let rank = 0;
  return {
    availability,
    period: input.period,
    totalCollected,
    rows: [...people]
      .sort(
        ([aKey, a], [bKey, b]) =>
          Number(!aKey) - Number(!bKey) ||
          b.collected - a.collected ||
          b.leads - a.leads ||
          a.name.localeCompare(b.name),
      )
      .map(([key, p]) => ({
        key,
        name: p.name,
        rank: key && availability.collections && p.collected > 0 ? ++rank : null,
        leads: availability.crm ? p.leads : null,
        won: availability.crm ? p.won : null,
        winRate: availability.crm && p.leads ? (100 * p.won) / p.leads : null,
        orders: availability.orders ? p.orderRefs.size : null,
        collected: availability.collections ? p.collected : null,
        collectionShare:
          totalCollected !== null && totalCollected > 0
            ? (100 * p.collected) / totalCollected
            : null,
      })),
  };
}

export type CourseSellerRanking = ReturnType<typeof buildCourseSellerRanking>;
