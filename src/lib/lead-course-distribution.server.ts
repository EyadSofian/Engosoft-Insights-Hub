import { loadCrmRawByDomain, type CrmRawRow } from "./crm-odoo.server";
import { lostEventWindow } from "./crm-lost-events";
import { classifyLeadCourse, leadStage } from "./lead-course-distribution";
import { mainCategoryForCourse } from "./course-taxonomy";
import { odooConfig } from "./odoo.server";
import type { GlobalFilters } from "./types";

export interface CourseLeadRecord {
  id: string;
  contact: string;
  createdAt: string;
  recordType: string;
  stage: string;
  actualStage: string;
  course: string;
  rawCategory: string;
  specialty: string;
  verified: boolean;
  priority: string;
  salesperson: string;
  salesTeam: string;
  source: string;
  company: string;
  phone: string;
  email: string;
  odooUrl: string;
}

export interface CourseLeadGroup {
  label: string;
  count: number;
  hot: number;
  unverified: number;
  stages: Record<string, number>;
}

export interface CourseLeadDistribution {
  total: number;
  unverified: number;
  stages: string[];
  byCourse: CourseLeadGroup[];
  bySpecialty: CourseLeadGroup[];
  detail: { rows: CourseLeadRecord[]; total: number; page: number; pageSize: number } | null;
  period: { from: string; to: string };
  source: string;
  fetchedAt: string;
}

const cache = new Map<string, { expiresAt: number; promise: Promise<CrmRawRow[]> }>();

function dateRows(filters: GlobalFilters): Promise<CrmRawRow[]> {
  const bounds = lostEventWindow(filters.from, filters.to);
  const domain: unknown[] = [];
  if (bounds.start) domain.push(["create_date", ">=", bounds.start]);
  if (bounds.end) domain.push(["create_date", "<", bounds.end]);
  const key = `${bounds.start ?? ""}|${bounds.end ?? ""}`;
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) return existing.promise;
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
  const promise = loadCrmRawByDomain(domain, { attempts: 2, timeoutMs: 90_000 });
  cache.set(key, { expiresAt: now + 60_000, promise });
  void promise.catch(() => cache.delete(key));
  return promise;
}

function toRecord(row: CrmRawRow): CourseLeadRecord {
  const rawCategory = row["Course Categories"] || "";
  const classification = classifyLeadCourse(rawCategory);
  const id = row.__odoo_id;
  return {
    id,
    contact: row["اسم جهة الاتصال"] || `#${id}`,
    createdAt: row["أنشئ في"] || "",
    recordType: row["Record Type"] || "",
    stage: leadStage(row["Business Status"] || "", row.Stage || ""),
    actualStage: row.Stage || "",
    course: classification.course,
    rawCategory,
    specialty: classification.specialty,
    verified: classification.verified,
    priority: row.Priority || "",
    salesperson: row.Salesperson || "",
    salesTeam: row["Sales Team"] || "",
    source: row.Source || "",
    company: row.Company || "",
    phone: row.Phone || row.Mobile || "",
    email: row.Email || "",
    odooUrl: `${odooConfig().url}/web#id=${encodeURIComponent(id)}&model=crm.lead&view_type=form`,
  };
}

function grouped(records: CourseLeadRecord[], key: "course" | "specialty") {
  const groups = new Map<string, CourseLeadGroup>();
  for (const record of records) {
    const label = record[key];
    const group = groups.get(label) ?? { label, count: 0, hot: 0, unverified: 0, stages: {} };
    group.count++;
    if (record.priority === "Hot") group.hot++;
    if (!record.verified) group.unverified++;
    group.stages[record.stage] = (group.stages[record.stage] ?? 0) + 1;
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function leadCourseDistribution(
  filters: GlobalFilters,
  detail?: { dimension: "course" | "specialty"; label: string; stage?: string; page: number },
): Promise<CourseLeadDistribution> {
  const raw = await dateRows(filters);
  const rows = raw
    .filter((row) => row.__odoo_id && ["lead", "opportunity"].includes(row["Record Type"]))
    .map(toRecord)
    .filter((row) => {
      const day = row.createdAt.slice(0, 10);
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
      if (filters.company && row.company !== filters.company) return false;
      if (filters.course && row.course !== filters.course) return false;
      if (filters.mainCategory && mainCategoryForCourse(row.course) !== filters.mainCategory) return false;
      if (filters.salesTeam && row.salesTeam !== filters.salesTeam) return false;
      if (filters.salesperson && row.salesperson !== filters.salesperson) return false;
      if (filters.source && row.source !== filters.source) return false;
      return true;
    });
  const stages = [...new Set(rows.map((row) => row.stage))].sort((a, b) => {
    const rank = (value: string) => value === "Lost" ? 98 : value === "Archived" ? 99 : 0;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const pageSize = 50;
  const detailRows = detail
    ? rows
        .filter((row) => row[detail.dimension] === detail.label && (!detail.stage || row.stage === detail.stage))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    : null;
  return {
    total: rows.length,
    unverified: rows.filter((row) => !row.verified).length,
    stages,
    byCourse: grouped(rows, "course"),
    bySpecialty: grouped(rows, "specialty"),
    detail: detailRows
      ? {
          rows: detailRows.slice((detail!.page - 1) * pageSize, detail!.page * pageSize),
          total: detailRows.length,
          page: detail!.page,
          pageSize,
        }
      : null,
    period: { from: filters.from || "", to: filters.to || "" },
    source: "Odoo CRM · Course Categories · creation date",
    fetchedAt: new Date().toISOString(),
  };
}
