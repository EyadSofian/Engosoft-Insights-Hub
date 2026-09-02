import {
  companyContext,
  m2oId,
  m2oName,
  odooCall,
  odooCallWithPolicy,
  odooConfigured,
  type M2O,
} from "../odoo.server.ts";

interface OdooField {
  type?: string;
}

interface OdooTrainingPackage {
  id: number;
  name?: string | false;
  display_name?: string | false;
  active?: boolean;
  company_id?: M2O;
  currency_id?: M2O;
  total_price?: number;
  final_price?: number;
  num_courses_display?: number;
  product_ids?: number[];
  attendee_product_ids?: number[];
  write_date?: string | false;
}

export interface TrainingPackage {
  id: number;
  name: string;
  active: boolean;
  specialization: string;
  companyId: number | null;
  companyName: string;
  currency: string;
  listPrice: number | null;
  finalPrice: number | null;
  courseCount: number;
  recordedCourseCount: number;
  attendanceCourseCount: number;
  updatedAt: string;
}

const finitePrice = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
};

export function inferPackageSpecialization(name: string): string {
  if (/\bBIM\b/i.test(name)) return "BIM all";
  if (/interior|architecture|decor/i.test(name)) return "Architecture & Decor";
  if (/mechanical|electrical|automotive|MEP/i.test(name)) return "Mech & Elec";
  if (/road|infrastructure|civil|steel/i.test(name)) return "Civil Courses";
  if (/management|PMP|PMI|business/i.test(name)) return "Management";
  return "Others";
}

/** Pure mapper kept separate so the custom-module contract can be tested. */
export function mapTrainingPackages(rows: OdooTrainingPackage[]): TrainingPackage[] {
  return rows
    .map((row) => {
      const name = String(row.name || row.display_name || "").trim();
      const recordedCourseCount = Array.isArray(row.product_ids) ? row.product_ids.length : 0;
      const attendanceCourseCount = Array.isArray(row.attendee_product_ids)
        ? row.attendee_product_ids.length
        : 0;
      return {
        id: Number(row.id),
        name,
        active: row.active !== false,
        specialization: inferPackageSpecialization(name),
        companyId: m2oId(row.company_id) || null,
        companyName: m2oName(row.company_id),
        currency: m2oName(row.currency_id),
        listPrice: finitePrice(row.total_price),
        finalPrice: finitePrice(row.final_price),
        courseCount: Math.max(
          Number(row.num_courses_display ?? 0) || 0,
          recordedCourseCount,
          attendanceCourseCount,
        ),
        recordedCourseCount,
        attendanceCourseCount,
        updatedAt: String(row.write_date || "").slice(0, 10),
      };
    })
    .filter((row) => row.id > 0 && row.name && row.active);
}

let cache: { expiresAt: number; value: TrainingPackage[] } | null = null;
const CACHE_MS = 5 * 60_000;

/** Read the authoritative package names and prices from Engosoft's Odoo module. */
export async function listTrainingPackages(): Promise<TrainingPackage[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  if (!odooConfigured()) return [];

  const metadata = await odooCall<Record<string, OdooField>>("training.package", "fields_get", [], {
    attributes: ["type"],
    context: companyContext({ active_test: false }),
  });
  if (!metadata.id || !metadata.name) return [];

  const fields = [
    "id",
    "name",
    "display_name",
    "active",
    "company_id",
    "currency_id",
    "total_price",
    "final_price",
    "num_courses_display",
    "product_ids",
    "attendee_product_ids",
    "write_date",
  ].filter((field) => !!metadata[field]);
  // The price catalogue must remain usable if Odoo is slow. The module only
  // holds a small package master, so one bounded search_read is sufficient.
  const rows = await odooCallWithPolicy<OdooTrainingPackage[]>(
    "training.package",
    "search_read",
    [[], fields],
    {
      limit: 500,
      order: "id desc",
      context: companyContext({ active_test: false }),
    },
    { attempts: 2, timeoutMs: 15_000 },
  );
  const value = mapTrainingPackages(rows);
  cache = { expiresAt: Date.now() + CACHE_MS, value };
  return value;
}
