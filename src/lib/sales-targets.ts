// Monthly sales targets per salesperson.
//
// Source of record: `All sales report AUG from 1-8 till 25-8-2026 all (1).numbers`,
// first Numbers sheet `Report Total Sales `, received 2026-08-28. Values are
// transcribed here rather than read at runtime so the dashboard has no deploy
// dependency on a workbook stored in one person's iCloud Drive.
//
// Two properties of the workbook are load-bearing and must survive any edit:
//
// 1. The displayed `name` is Odoo's current `res.users` name. Where the workbook
//    carries the HR/legal name (`Ahmed Shaaban Ali Muhammad`) or a role suffix
//    (`(website)`), that spelling is an explicit alias. The mapping was checked
//    against live `hr.employee.user_id` on 2026-08-28; it is never fuzzy-guessed.
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
  /** Odoo's current salesperson display name. */
  name: string;
  /** HR/workbook spellings that resolve to the same Odoo salesperson. */
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
      name: "Abdullah Mohsen Abdelhamed Saeed Hassan eljamal",
      aliases: [
        "Abdullah Mohsen Abdul Hamid Saeed Hassan Al-Gamal",
        "Mr.Abdullah Mohsen Abdul Hamid Saeed Hassan Al-Gamal",
        "Abdullah Mohsen Abdul Hamid",
      ],
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
      target: 7773,
      note: "",
    },
    {
      employeeId: "637",
      name: "Moaz Ali Mohammed",
      aliases: [],
      teamLeader: "Hady Mahmoud Fahmy",
      supervisor: "Bahaa Ramadan",
      branch: "Egypt",
      target: 1904,
      note: "",
    },

    // Team leader: Nader Aziz — Supervisor: Asmaa Fathy
    {
      employeeId: "292",
      // Workbook/HR name → live Odoo user, verified through hr.employee.user_id.
      name: "Ahmed El-Shiekh",
      aliases: ["Ahmed Shaaban Ali Muhammad"],
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
      name: "AHMED FAROUK",
      aliases: [
        "Ahmed Farouk Mohamed Mohamed Abdel Dayem",
        "Mr.Ahmed Farouk Mohamed Mohamed Abdel Dayem",
        "Ahmed Farouk Mohamed Mohamed",
      ],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 6000,
      note: "",
    },
    {
      employeeId: "631",
      name: "Ahmed Ehab Hosny Ahmed",
      aliases: [],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 6000,
      note: "",
    },
    {
      employeeId: "619",
      name: "Hazem Talat",
      aliases: ["Hazem talaat", "Hazem Taalat Abdel Azem"],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 6000,
      note: "",
    },
    {
      employeeId: "632",
      name: "Mahmoud Hassan Elsayed Amer",
      aliases: ["mahmoud hassan elsayed amer (website)"],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 12000,
      note: "مبيعات الموقع",
    },
    {
      employeeId: "418",
      name: "Nader Aziz",
      aliases: ["Mr.Nader Refaat Aziz Naguib", "Nader Refaat Aziz Naguib"],
      teamLeader: "Nader Aziz",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: null,
      note: "لا يوجد تارجت شخصي منشور في الشيت المحدّث",
    },
    {
      employeeId: "457",
      name: "Mennatallah walid",
      aliases: ["Mennatallah walid Mohamed Fathy", "Miss.Mennatallah walid Mohamed Fathy"],
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
      target: 2323,
      note: "",
    },
    {
      employeeId: "235",
      name: "Mohamed Sami Mahmoud Abdel Hamid",
      aliases: ["Mr.Muhammad Samy Mahmoud Abdel Hamid"],
      teamLeader: "Asmaa Fathy",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: 3000,
      note: "",
    },

    // Website salespeople listed separately in the workbook. The report calls
    // employee 381 “Direct Website”; Odoo's linked user is Amira.
    {
      employeeId: "381",
      name: "Amira Muhammad Salah al-Din Awad",
      aliases: ["Direct Website"],
      teamLeader: "Website",
      supervisor: "Asmaa Fathy",
      branch: "Egypt",
      target: null,
      note: "مبيعات الموقع بدون تارجت منشور",
    },

    // Operation — Mahfouz Afify. They produce sales but carry no quota, so they
    // must appear with an explicit reason instead of looking like a data gap.
    // Odoo shortens several of these names, so the aliases matter here too:
    // without them an Operation seller reads as "no target published" instead
    // of "deliberately untargeted", which are very different answers.
    ...(
      [
        ["642", "Ahmed Alaa Sayed Mostafa", []],
        ["303", "Ahmed Hesham", ["Ahmed Hisham Abdel kader Mohamed Abdel Moneim"]],
        ["244", "Ramy Emad", ["Rami Emad Al-Sayed Fathi Al-Sayed Mohamed"]],
        ["472", "Wafaa Ahmed Adel Ahmed", []],
        ["399", "mennaallah magdy", ["Menna Tullah Magdy Saleh Mahmoud"]],
        ["417", "Abdulrahman Adel", ["Abdul Rahman Adel Ali Hassan"]],
        ["261", "Abdulrahman Tareq Abdullwahab", ["Abdul Rahman Tarik Abdul Wahab"]],
        ["529", "Mahmoud Abdel Naser sayed Mahmoud", []],
        ["350", "Asmaa Fathy", ["Asmaa Fathi Saleh Abdel Rahman"]],
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

/** A real calendar month, shared by the API and the month-creation UI. */
export function isTargetMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export interface MonthlyTargetRoster {
  /** The month the manager asked to view or prepare. */
  month: string;
  /** Whether this month is already stored/published as its own roster. */
  exists: boolean;
  /** The prior roster copied only as a starting point for a new month. */
  basisMonth: string;
  /** Detached rows: editing a draft must never mutate a historic month. */
  rows: SalesTarget[];
}

const cloneTarget = (row: SalesTarget): SalesTarget => ({ ...row, aliases: [...row.aliases] });

/**
 * Resolve a month without inventing a target history.
 *
 * A new month begins with the newest earlier roster as an explicitly labelled
 * draft. Saving it writes a complete, independent monthly roster, so changing
 * September can never change the already-reported August achievement.
 */
export function targetRosterForMonth(
  month: string,
  source: TargetSource = SALES_TARGETS,
): MonthlyTargetRoster {
  const months = targetMonths(source);
  const current = source[month];
  if (current?.length) {
    return { month, exists: true, basisMonth: month, rows: current.map(cloneTarget) };
  }

  const basisMonth = months.filter((candidate) => candidate < month).at(-1) ?? months.at(-1) ?? "";
  return {
    month,
    exists: false,
    basisMonth,
    rows: (source[basisMonth] ?? []).map(cloneTarget),
  };
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
