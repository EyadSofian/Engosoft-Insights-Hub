// Monthly sales targets per salesperson.
//
// Source of record: the management workbook ("Mahfouz Aug Target.xlsx"), one
// sheet per month. Values are transcribed here rather than read from a file so
// the dashboard has no runtime dependency on a spreadsheet nobody deploys.
//
// Two properties of the workbook are load-bearing and must survive any edit:
//
// 1. Some employees are spelled differently there than in Odoo — the workbook
//    carries the full legal name (`… Saeed Hassan Al-Gamal`) or a role suffix
//    (`(website)`) where Odoo carries the short one. Those are declared in
//    `aliases`, never guessed, because a fuzzy match across name lengths puts
//    one person's target on another.
// 2. A blank target is not zero. Maternity leave and the Operation staff are
//    deliberately untargeted while still producing sales, so `target: null`
//    means "no target published" and is reported as an em dash, while
//    `target: 0` means a real zero (a team leader carrying no personal quota).
// Explicit `.ts` so `node --experimental-strip-types` can run the guard script
// against this module directly, the same way `legacy-datasets.ts` imports.
import { normalizePersonName } from "./person-name.ts";

export interface SalesTarget {
  /** Employee id as written in the workbook — the stable identity across renames. */
  employeeId: string;
  /** Workbook spelling, used as the display label when no employee row matched. */
  name: string;
  /** Other spellings of the same person that appear in Odoo. */
  aliases: string[];
  teamLeader: string;
  supervisor: string;
  branch: string;
  /** Monthly target in USD. `null` = deliberately untargeted, not zero. */
  target: number | null;
  note: string;
}

/**
 * Targets by month (`YYYY-MM`). Add the next month as a new key; never edit a
 * past month, because achievement for a closed month has already been reported.
 */
export const SALES_TARGETS: Record<string, SalesTarget[]> = {
  "2026-08": [
    // Saudi Branch — Manager: Mahfouz Afify
    {
      employeeId: "335",
      name: "Abdullah Mohsen Abdul Hamid Saeed Hassan Al-Gamal",
      // Odoo transliterates the surname differently ("Abdelhamed … eljamal").
      // Verified against a live /api/teams response, not guessed.
      aliases: ["Abdullah Mohsen Abdelhamed Saeed Hassan eljamal", "Abdullah Mohsen Abdul Hamid"],
      teamLeader: "Mahfouz Afify",
      supervisor: "Mahfouz Afify",
      branch: "Saudi Branch",
      target: 10000,
      note: "",
    },

    // Team leader: Bahaa Ramdan — Supervisor: Bahaa Ramadan
    {
      employeeId: "238",
      name: "Sabrin Ebrahim Ali",
      aliases: [],
      teamLeader: "Bahaa Ramdan",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 7364,
      note: "",
    },
    {
      employeeId: "338",
      name: "Basma kamal ali Ibrahim alroby",
      aliases: [],
      teamLeader: "Bahaa Ramdan",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 9000,
      note: "",
    },
    {
      employeeId: "482",
      name: "Mr.Mohamad Abdullah Mohamad Mohsen",
      aliases: [],
      teamLeader: "Bahaa Ramdan",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 9000,
      note: "",
    },
    {
      employeeId: "503",
      name: "Menna Tullah Mustafa Ali Mustafa",
      aliases: [],
      teamLeader: "Bahaa Ramdan",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 9000,
      note: "",
    },
    {
      employeeId: "606",
      name: "Eslam Khaled Abdelmonem",
      aliases: [],
      teamLeader: "Bahaa Ramdan",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 9000,
      note: "",
    },
    {
      employeeId: "346",
      name: "Sherif Waleed Ahmed Mohamed",
      aliases: [],
      teamLeader: "Bahaa Ramdan",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 9000,
      note: "",
    },
    {
      employeeId: "630",
      name: "Yasmin Gaber Farghaly",
      aliases: [],
      teamLeader: "Bahaa Ramdan",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 4912,
      note: "",
    },

    // Team leader: Ahmed Saeed — Supervisor: Bahaa Ramadan
    {
      employeeId: "595",
      name: "Ahmed Saeed Ahmed Ibrahim",
      aliases: [],
      teamLeader: "Ahmed Saeed",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 4000,
      note: "",
    },
    {
      employeeId: "633",
      name: "Mariam Said Abdelfatah",
      aliases: [],
      teamLeader: "Ahmed Saeed",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 3000,
      note: "",
    },
    {
      employeeId: "635",
      name: "Mustafa Reda Abdelglel",
      aliases: [],
      teamLeader: "Ahmed Saeed",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 3000,
      note: "",
    },

    // Team leader: Hady Mahmoud Fahmy — Supervisor: Bahaa Ramadan
    {
      employeeId: "319",
      name: "Hady Mahmnoud Fahmy Elhenawy",
      aliases: [],
      teamLeader: "Hady Mahmoud Fahmy",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 3000,
      note: "",
    },
    {
      employeeId: "602",
      name: "Hessein Mohamed Abdullah",
      aliases: [],
      teamLeader: "Hady Mahmoud Fahmy",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 9000,
      note: "",
    },
    {
      employeeId: "637",
      name: "moaz ali mohammed",
      aliases: [],
      teamLeader: "Hady Mahmoud Fahmy",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 3000,
      note: "",
    },

    // Team leader: Nader Aziz — Supervisor: Asmaa Fathy
    {
      employeeId: "292",
      name: "Ahmed Shaaban Ali Muhammad",
      aliases: [],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 4000,
      note: "",
    },
    {
      employeeId: "558",
      name: "Dalia Mohamed Abdelfattah Ibrahim",
      aliases: [],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 6000,
      note: "",
    },
    {
      employeeId: "378",
      name: "Ahmed Farouk Mohamed Mohamed Abdel Dayem",
      // Odoo carries only the first two name parts, in capitals.
      aliases: ["AHMED FAROUK", "Ahmed Farouk Mohamed Mohamed"],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 6000,
      note: "",
    },
    {
      employeeId: "631",
      name: "Ahmed Ehab hosny ahmed",
      aliases: [],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 6000,
      note: "",
    },
    {
      employeeId: "619",
      name: "Hazem talaat",
      // One `a` fewer in Odoo — enough for the normalizer to treat them as two
      // different people, which is precisely why aliases are declared.
      aliases: ["Hazem Talat"],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 6000,
      note: "",
    },
    {
      employeeId: "632",
      name: "mahmoud hassan elsayed amer (website)",
      aliases: ["mahmoud hassan elsayed amer"],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 12000,
      note: "مبيعات الموقع",
    },
    {
      employeeId: "418",
      name: "Nader Aziz",
      aliases: [],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      // A real zero, not a blank: the team leader carries the team's target, not
      // a personal one, so his achievement must read 0 rather than an em dash.
      target: 0,
      note: "تارجت الفريق وليس شخصي",
    },
    {
      employeeId: "457",
      name: "Mennatallah walid Mohamed Fathy",
      aliases: [],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: null,
      note: "أجازة وضع",
    },

    // Nesting team: Asmaa Fathy
    {
      employeeId: "638",
      name: "Mahmoud Mohamed Mahmoud",
      aliases: [],
      teamLeader: "Asmaa Fathy",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 3000,
      note: "",
    },
    {
      employeeId: "235",
      name: "Mohamed Sami Mahmoud Abdel Hamid",
      aliases: [],
      teamLeader: "Asmaa Fathy",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 3000,
      note: "",
    },

    // Operation — Mahfouz Afify. They produce sales but carry no quota, so they
    // must appear with an explicit reason instead of looking like a data gap.
    // Odoo shortens several of these names, so the aliases matter here too:
    // without them an Operation seller reads as "no target published" instead
    // of "deliberately untargeted", which are very different answers.
    ...(
      [
        ["642", "Ahmed Alaa Sayed Mostafa", []],
        ["303", "Ahmed Hisham Abdel kader Mohamed Abdel Moneim", ["Ahmed Hesham"]],
        ["244", "Rami Emad Al-Sayed Fathi Al-Sayed Mohamed", []],
        ["472", "Wafaa Ahmed Adel Ahmed", []],
        ["417", "Abdul Rahman Adel Ali Hassan", ["Abdulrahman Adel"]],
        ["261", "Abdulrahman Tareq Abdullwahab", []],
        ["529", "Mahmoud Abdel Naser sayed Mahmoud", []],
      ] as const
    ).map(([employeeId, name, aliases]): SalesTarget => ({
      employeeId,
      name,
      aliases: [...aliases],
      teamLeader: "Operation",
      supervisor: "Mahfouz Afify",
      branch: "Egypt",
      target: null,
      note: "موظفي العمليات ليهم مبيعات وليس لهم تارجت",
    })),
  ],
};

/**
 * A month-keyed set of quotas. The seed below is the default; the server merges
 * PostgreSQL overrides on top and passes the result in, so every function here
 * stays pure and directly testable.
 */
export type TargetSource = Record<string, SalesTarget[]>;

/** Months that carry a published target, oldest first. */
export function targetMonths(source: TargetSource = SALES_TARGETS): string[] {
  return Object.keys(source).sort();
}

/** Every spelling that must resolve to this person. */
export function targetNameKeys(entry: SalesTarget): string[] {
  return [entry.name, ...entry.aliases].map(normalizePersonName).filter(Boolean);
}

/**
 * Normalized name → target, for one month. A name declared twice in the same
 * month is a workbook error: the first entry wins and the duplicate is returned
 * so the caller can surface it rather than silently overwriting a quota.
 */
export function targetIndexForMonth(
  month: string,
  source: TargetSource = SALES_TARGETS,
): {
  byName: Map<string, SalesTarget>;
  duplicates: string[];
} {
  const byName = new Map<string, SalesTarget>();
  const duplicates: string[] = [];
  for (const entry of source[month] ?? []) {
    for (const key of targetNameKeys(entry)) {
      if (byName.has(key)) {
        duplicates.push(entry.name);
        continue;
      }
      byName.set(key, entry);
    }
  }
  return { byName, duplicates };
}

export interface PersonTargets {
  /** The newest month's entry, used for the label, team and note. */
  entry: SalesTarget;
  /** One row per published month, whether or not that month sets a number. */
  monthly: { month: string; target: number | null }[];
}

/**
 * Every person who appears in any published month, keyed by normalized name and
 * by each declared alias, so a lookup by the Odoo spelling finds them.
 */
export function targetsByPerson(source: TargetSource = SALES_TARGETS): {
  byName: Map<string, PersonTargets>;
  duplicates: string[];
} {
  const byEmployee = new Map<string, PersonTargets>();
  const duplicates: string[] = [];
  for (const month of targetMonths(source)) {
    const seen = new Set<string>();
    for (const entry of source[month] ?? []) {
      if (seen.has(entry.employeeId)) {
        duplicates.push(`${entry.name} (${month})`);
        continue;
      }
      seen.add(entry.employeeId);
      const existing = byEmployee.get(entry.employeeId);
      if (existing) {
        // Months are walked oldest first, so the last write is the newest entry.
        existing.entry = entry;
        existing.monthly.push({ month, target: entry.target });
      } else {
        byEmployee.set(entry.employeeId, {
          entry,
          monthly: [{ month, target: entry.target }],
        });
      }
    }
  }

  const byName = new Map<string, PersonTargets>();
  for (const person of byEmployee.values()) {
    for (const key of targetNameKeys(person.entry)) {
      const clash = byName.get(key);
      if (clash && clash.entry.employeeId !== person.entry.employeeId) {
        duplicates.push(`${person.entry.name} ↔ ${clash.entry.name}`);
        continue;
      }
      byName.set(key, person);
    }
  }
  return { byName, duplicates };
}

/* --- calendar helpers ------------------------------------------------------ */

/** Days in a calendar month, from its `YYYY-MM` key. */
export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return 0;
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

/**
 * Fraction of `month` covered by the window, 0–1. An open-ended side means the
 * whole month on that side, which is what `range=all` should mean.
 */
export function monthCoverage(month: string, from?: string, to?: string): number {
  const total = daysInMonth(month);
  if (!total) return 0;
  const start = from && from > monthStart(month) ? from : monthStart(month);
  const end = to && to < monthEnd(month) ? to : monthEnd(month);
  if (end < start) return 0;
  const days =
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) +
    1;
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.min(1, days / total);
}

/** Every `YYYY-MM` the window touches. Undefined bounds fall back to `fallback`. */
export function monthsInWindow(
  from: string | undefined,
  to: string | undefined,
  fallback: string[],
): string[] {
  if (!from || !to) return [...fallback].sort();
  const first = from.slice(0, 7);
  const last = to.slice(0, 7);
  if (first > last) return [];
  const months: string[] = [];
  let [year, month] = first.split("-").map(Number);
  for (let guard = 0; guard < 240; guard += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= last) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export interface WindowTarget {
  /**
   * The quota as management published it, for the months the window covers.
   * This is the number an employee is measured against — it does not shrink
   * because the month is only half over.
   */
  target: number | null;
  /** Months in the window that carry a published target. */
  monthsCovered: string[];
  /**
   * Months the window spans that publish no target at all. A non-empty list
   * means achievement is being measured against part of the period only, so the
   * percentage must be labelled partial rather than presented as the month's
   * result.
   */
  monthsMissing: string[];
  /** True when every month the window spans publishes a target. */
  complete: boolean;
}

/**
 * A monthly quota measured against an arbitrary dashboard window.
 *
 * `target` is the published quota, whole, and it is what achievement divides by,
 * because "did he hit his $9,000?" is the question managers are asking.
 *
 * An earlier version prorated it by the days the window covers, so that a
 * half-month was measured against half a quota. That divided 16 days of revenue
 * by 16 days of quota and reported 141.5% for an employee who had collected
 * $6,573 of $9,000 — 73%. The quota does not shrink because the month is only
 * half over.
 */
export function windowTarget(
  monthlyTargets: { month: string; target: number | null }[],
  from?: string,
  to?: string,
): WindowTarget {
  const published = monthlyTargets.filter((row) => row.target !== null);
  const spanned = monthsInWindow(
    from,
    to,
    published.map((row) => row.month),
  );
  const spannedSet = new Set(spanned);
  const covered = published.filter(
    (row) => spannedSet.has(row.month) && monthCoverage(row.month, from, to) > 0,
  );
  if (!covered.length) {
    return { target: null, monthsCovered: [], monthsMissing: spanned, complete: false };
  }
  const publishedMonths = new Set(published.map((row) => row.month));
  const coverages = covered.map((row) => monthCoverage(row.month, from, to));
  return {
    target: covered.reduce((sum, row) => sum + (row.target ?? 0), 0),
    monthsCovered: covered.map((row) => row.month),
    monthsMissing: spanned.filter((month) => !publishedMonths.has(month)),
    complete: spanned.every((month) => publishedMonths.has(month)),
  };
}
