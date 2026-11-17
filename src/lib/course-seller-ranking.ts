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
  orders: readonly Pick<InvoicedRow, "course" | "salesperson" | "orderRef" | "usdSales">[];
  collections: readonly Pick<AccountingRow, "course" | "salesperson" | "usdPaid">[];
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
      sales: number;
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
      sales: 0,
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
      p.sales += row.usdSales;
    }
  }
  if (availability.collections) {
    for (const row of input.collections) {
      if (isCourse(row.course)) seller(row.salesperson).collected += row.usdPaid;
    }
  }
  // Use the course's signed order-line values, not whole orders that can contain other courses.
  const rankBy = availability.orders ? "sales" : availability.collections ? "collected" : null;
  let rank = 0;
  return {
    availability,
    rankBy,
    rows: [...people]
      .sort(
        ([aKey, a], [bKey, b]) =>
          Number(!aKey) - Number(!bKey) ||
          (rankBy ? b[rankBy] - a[rankBy] : 0) ||
          b.leads - a.leads ||
          a.name.localeCompare(b.name),
      )
      .map(([key, p]) => ({
        key,
        name: p.name,
        rank: key && rankBy && p[rankBy] > 0 ? ++rank : null,
        leads: availability.crm ? p.leads : null,
        won: availability.crm ? p.won : null,
        winRate: availability.crm && p.leads ? (100 * p.won) / p.leads : null,
        orders: availability.orders ? p.orderRefs.size : null,
        sales: availability.orders ? p.sales : null,
        collected: availability.collections ? p.collected : null,
      })),
  };
}

export type CourseSellerRanking = ReturnType<typeof buildCourseSellerRanking>;
