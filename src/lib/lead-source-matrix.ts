/** One Odoo CRM record belongs to exactly one source and one course cell. */
export interface SourceMatrixRecord {
  source: string;
  course: string;
}

export interface SourceMatrixRow {
  source: string;
  count: number;
  cells: Record<string, number>;
  featured: boolean;
}

export interface SourceMatrix {
  total: number;
  withoutSnapchat: number;
  unspecifiedSource: number;
  courses: string[];
  courseTotals: Record<string, number>;
  rows: SourceMatrixRow[];
}

export const UNSPECIFIED_SOURCE = "Unspecified source";

const SOURCE_ORDER = [
  "Facebook",
  "Instagram",
  "Phone Call",
  "Recommendation",
  "Snapchat",
  "TikTok",
  "Webinar",
  "Website",
  "WhatsApp",
  "WhatsApp Broadcast",
];
const COURSE_ORDER = [
  "CFM",
  "CMRP",
  "PMP",
  "BIM",
  "Interior",
  "Auto",
  "Arch",
  "Elec",
  "Infra",
  "Mech",
  "Other",
  "Struc",
];
const FEATURED = new Set(["Recommendation", "Snapchat", "Website", "WhatsApp Broadcast"]);

export function matrixSource(value: string): string {
  const source = value.trim().replace(/\s+/g, " ");
  if (!source) return UNSPECIFIED_SOURCE;
  const normalized = source.toLocaleLowerCase("en").replace(/[\s_-]+/g, "");
  const aliases: Record<string, string> = {
    facebook: "Facebook",
    instagram: "Instagram",
    phonecall: "Phone Call",
    recommendation: "Recommendation",
    recommendedfromcustomer: "Recommendation",
    recommendationsales: "Recommendation",
    snapchat: "Snapchat",
    tiktok: "TikTok",
    webinar: "Webinar",
    website: "Website",
    whatsapp: "WhatsApp",
    whatsappbroadcast: "WhatsApp Broadcast",
  };
  return aliases[normalized] ?? source;
}

export function buildLeadSourceMatrix(records: SourceMatrixRecord[]): SourceMatrix {
  const bySource = new Map<string, SourceMatrixRow>();
  const courseTotals: Record<string, number> = {};
  for (const record of records) {
    const source = matrixSource(record.source);
    const course = record.course || "غير محدد";
    const row = bySource.get(source) ?? {
      source,
      count: 0,
      cells: {},
      featured: FEATURED.has(source),
    };
    row.count++;
    row.cells[course] = (row.cells[course] ?? 0) + 1;
    courseTotals[course] = (courseTotals[course] ?? 0) + 1;
    bySource.set(source, row);
  }
  const sourceRank = (source: string) => {
    const index = SOURCE_ORDER.indexOf(source);
    return index < 0 ? SOURCE_ORDER.length : index;
  };
  const courseRank = (course: string) => {
    if (course === "غير محدد") return COURSE_ORDER.length + 1;
    const index = COURSE_ORDER.indexOf(course);
    return index < 0 ? COURSE_ORDER.length : index;
  };
  const rows = [...bySource.values()].sort(
    (a, b) =>
      sourceRank(a.source) - sourceRank(b.source) ||
      b.count - a.count ||
      a.source.localeCompare(b.source),
  );
  const courses = Object.keys(courseTotals).sort(
    (a, b) => courseRank(a) - courseRank(b) || a.localeCompare(b),
  );
  return {
    total: records.length,
    withoutSnapchat: records.length - (bySource.get("Snapchat")?.count ?? 0),
    unspecifiedSource: bySource.get(UNSPECIFIED_SOURCE)?.count ?? 0,
    courses,
    courseTotals,
    rows,
  };
}
