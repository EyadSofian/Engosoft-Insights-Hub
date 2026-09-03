/**
 * Odoo's roster, used to decide what an employee is called on screen.
 *
 * Every other source names a person the way whoever created the account typed
 * it. Odoo HR holds the legal name, and `hr.employee.user_id` ties it to the
 * Odoo user the CRM, invoices and targets all reference. So the name the tab
 * shows is Odoo HR's, cut to three parts — `Ahmed  El-Shiekh` is filed under
 * `ahmed.shabaan@engosoft.com`, whose HR record reads `Ahmed Shaaban Ali
 * Muhammad`, and the tab now says `Ahmed Shaaban Ali` for both.
 *
 * Two rules keep this from renaming the wrong row:
 *
 *  - Portal users (`share`) are never touched. Every unmatched "salesperson"
 *    on Egyptian and KSA leads turns out to be a self-registered customer, not
 *    staff; their names are none of this module's business.
 *  - A fuzzy match must be unique. Odoo has both `Ahmed Ali Shaaban` and
 *    `Ahmed Shaaban Ali Muhammad`; a name that could be either is left alone
 *    rather than attached to whichever sorted first.
 *
 * The lookup is keyed on the same normalization the metrics use, so it can be
 * applied to a display name without disturbing the key any join runs on.
 */

import { normalizePersonName } from "./person-name.ts";
import { integrationPersonMatchScore } from "./integration-person.ts";
import { namePartCount, threePartName } from "./person-display-name.ts";
import { odooConfigured, searchRead, m2oId, type M2O } from "./odoo.server.ts";

const TTL_MS = 6 * 60 * 60 * 1000;

interface OdooUserRow {
  id: number;
  name: string;
  /** True for portal and public accounts — customers, not employees. */
  share: boolean;
}

interface OdooEmployeeRow {
  id: number;
  name: string;
  user_id: M2O;
  active: boolean;
}

export interface DirectoryPerson {
  /** Odoo user id, when the person reached us through a user account. */
  userId: number;
  /** The spelling Odoo HR holds, whole. */
  legalName: string;
  /**
   * Every spelling Odoo knows this person by — the HR name and the login name.
   * A two-part name from the PBX or Chatwoot may only overlap one of them:
   * `Mohamad Mohsen` is in the Odoo login, not in the HR record.
   */
  spellings: string[];
  /** What the screen shows: `legalName` cut to three parts. */
  displayName: string;
  /** True once HR supplied the name; false when only the login name existed. */
  fromHr: boolean;
}

export interface EmployeeDirectory {
  /**
   * The three-part name for a person, or the name unchanged when Odoo has
   * nothing to say about them. Never throws and never returns empty.
   */
  displayNameFor(rawName: string): string;
  /** Whether Odoo answered. False means every name is passed through as-is. */
  readonly ok: boolean;
  readonly error?: string;
  /** People Odoo itself records with fewer than three parts. */
  readonly shortInOdoo: string[];
  readonly people: DirectoryPerson[];
}

const passthrough = (error?: string): EmployeeDirectory => ({
  displayNameFor: (rawName: string) => String(rawName ?? "").trim(),
  ok: false,
  error,
  shortInOdoo: [],
  people: [],
});

let cache: { expiresAt: number; value: EmployeeDirectory } | null = null;
let inFlight: Promise<EmployeeDirectory> | null = null;

function build(users: OdooUserRow[], employees: OdooEmployeeRow[]): EmployeeDirectory {
  // Prefer the live HR record when a user has more than one — a rehire keeps
  // the archived row, and it is the archived one that carries the old name.
  const hrByUser = new Map<number, OdooEmployeeRow>();
  for (const employee of employees) {
    const userId = m2oId(employee.user_id);
    if (!userId) continue;
    const held = hrByUser.get(userId);
    if (!held || (employee.active && !held.active)) hrByUser.set(userId, employee);
  }

  const people: DirectoryPerson[] = [];
  // One entry per spelling we might be handed: the login name and the HR name
  // both point at the same person.
  const byExactName = new Map<string, { person: DirectoryPerson; rank: number }>();

  /**
   * `rank` is how strong a claim on a spelling is. An HR record tied to an Odoo
   * user (2) outranks a loose HR record with none (1), because it is the user
   * the CRM, the invoices and the targets all reference. Odoo carries stub
   * duplicates — three inactive `Asmaa Fathy` rows beside the real
   * `Asmaa Fathi Saleh Abdel Rahman` — and without the ranking each stub would
   * look like a second person laying claim to the name and cancel the rename.
   */
  const remember = (spelling: string, person: DirectoryPerson, rank: number) => {
    const key = normalizePersonName(spelling);
    if (!key) return;
    const held = byExactName.get(key);
    if (!held) {
      byExactName.set(key, { person, rank });
      return;
    }
    if (rank > held.rank) {
      byExactName.set(key, { person, rank });
      return;
    }
    if (rank < held.rank) return;
    // Same standing, two different people: neither can be renamed safely.
    if (held.person.displayName !== person.displayName) {
      byExactName.set(key, {
        person: { ...held.person, displayName: "", legalName: "" },
        rank,
      });
    }
  };

  for (const user of users) {
    if (user.share) continue; // A customer, not a colleague.
    const hr = hrByUser.get(user.id);
    const legalName = (hr?.name || user.name || "").trim();
    if (!legalName) continue;
    const person: DirectoryPerson = {
      userId: user.id,
      legalName,
      spellings: [...new Set([legalName, user.name, hr?.name].filter(Boolean) as string[])],
      displayName: threePartName(legalName),
      fromHr: Boolean(hr),
    };
    people.push(person);
    remember(user.name, person, 2);
    if (hr) remember(hr.name, person, 2);
  }

  // HR records with no Odoo user still name someone the PBX or Chatwoot may
  // report on, so they are searchable even though no CRM row can reference them.
  for (const employee of employees) {
    if (m2oId(employee.user_id)) continue;
    const legalName = (employee.name || "").trim();
    if (!legalName) continue;
    const person: DirectoryPerson = {
      userId: 0,
      legalName,
      spellings: [legalName],
      displayName: threePartName(legalName),
      fromHr: true,
    };
    people.push(person);
    remember(legalName, person, 1);
  }

  const resolvable = people.filter((person) => person.displayName);

  const fuzzyCache = new Map<string, string>();
  const fuzzyMatch = (rawName: string): string => {
    const held = fuzzyCache.get(rawName);
    if (held !== undefined) return held;
    let best: DirectoryPerson | null = null;
    let bestScore = 0;
    let tied = false;
    for (const person of resolvable) {
      const score = person.spellings.reduce(
        (best, spelling) => Math.max(best, integrationPersonMatchScore(rawName, spelling)),
        0,
      );
      if (!score) continue;
      if (score > bestScore) {
        best = person;
        bestScore = score;
        tied = false;
      } else if (score === bestScore && best && best.displayName !== person.displayName) {
        tied = true;
      }
    }
    // An ambiguous short name keeps its own spelling; guessing here is how one
    // person's calls end up under another person's row.
    const resolved = best && !tied ? best.displayName : "";
    fuzzyCache.set(rawName, resolved);
    return resolved;
  };

  const displayNameFor = (rawName: string): string => {
    const raw = String(rawName ?? "").trim();
    if (!raw) return raw;
    const exact = byExactName.get(normalizePersonName(raw))?.person;
    if (exact?.displayName) return exact.displayName;
    if (exact) return raw; // Known, but the spelling is shared by two people.
    return fuzzyMatch(raw) || raw;
  };

  const shortInOdoo = [
    ...new Set(
      resolvable
        .filter((person) => person.userId > 0)
        .filter((person) => namePartCount(person.legalName) < 3)
        .map((person) => person.legalName),
    ),
  ].sort();

  return { displayNameFor, ok: true, shortInOdoo, people: resolvable };
}

/**
 * The roster, cached for six hours. HR names change when a record is corrected,
 * not on the timescale a dashboard refreshes at, and this runs on every load of
 * the employee tab.
 */
export async function getEmployeeDirectory(): Promise<EmployeeDirectory> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  if (inFlight) return inFlight;
  if (!odooConfigured()) return passthrough("Odoo is not configured");

  inFlight = (async () => {
    try {
      // `active_test: false` on both sides: a resigned employee still owns last
      // quarter's invoices, and their row must keep their name.
      const [users, employees] = await Promise.all([
        searchRead<OdooUserRow>("res.users", [], ["name", "share"], {
          context: { active_test: false },
        }),
        searchRead<OdooEmployeeRow>("hr.employee", [], ["name", "user_id", "active"], {
          context: { active_test: false },
        }),
      ]);
      const value = build(users, employees);
      cache = { expiresAt: Date.now() + TTL_MS, value };
      return value;
    } catch (error) {
      const value = passthrough(error instanceof Error ? error.message : String(error));
      // A brief negative cache: the tab is worth showing with raw names, and
      // retrying Odoo on every request would make a slow outage a slow page.
      cache = { expiresAt: Date.now() + 60_000, value };
      return value;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test seam: `build` without a network. */
export const buildEmployeeDirectoryForTest = build;
