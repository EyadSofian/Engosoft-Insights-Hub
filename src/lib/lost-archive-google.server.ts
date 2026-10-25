import { LOST_ARCHIVE_SHEET_ID, type ArchiveRow } from "./lost-archive-audit";

const TABS = ["Aug", "Sep", "Oct"] as const;
const CACHE_MS = 5 * 60 * 1000;
const REQUIRED = ["Course Categories", "Lost Reason", "Validate", "Salesperson"];

type SheetSnapshot = { rows: ArchiveRow[]; readAt: string };
let cache: SheetSnapshot | null = null;
let pending: Promise<SheetSnapshot> | null = null;

export function lostArchiveGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_AUDIT_REFRESH_TOKEN?.trim() &&
    (process.env.GOOGLE_SHEETS_CLIENT_ID?.trim() || process.env.GOOGLE_ADS_CLIENT_ID?.trim()) &&
    (process.env.GOOGLE_SHEETS_CLIENT_SECRET?.trim() ||
      process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()),
  );
}

export function parseLostArchiveTab(tab: string, values: unknown[][]): ArchiveRow[] {
  if (!TABS.includes(tab as (typeof TABS)[number])) throw new Error("Unknown Lost Archive tab");
  const [header, ...records] = values;
  const columns = Array.isArray(header) ? header.map((value) => String(value ?? "").trim()) : [];
  if (REQUIRED.some((column) => !columns.includes(column))) {
    throw new Error(`Lost Archive ${tab} headers changed`);
  }
  return records.flatMap((record, index) => {
    if (!Array.isArray(record)) return [];
    const row: ArchiveRow = { __sheet_month: tab };
    columns.forEach((column, position) => {
      if (column) row[column] = String(record[position] ?? "");
    });
    if (!/^(yes|no)$/i.test(row.Validate?.trim() ?? "")) return [];
    row.__stable_key = `2026-${tab}:${index + 2}`;
    return [row];
  });
}

async function refreshAccessToken(): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: (
        process.env.GOOGLE_SHEETS_CLIENT_ID ||
        process.env.GOOGLE_ADS_CLIENT_ID ||
        ""
      ).trim(),
      client_secret: (
        process.env.GOOGLE_SHEETS_CLIENT_SECRET ||
        process.env.GOOGLE_ADS_CLIENT_SECRET ||
        ""
      ).trim(),
      refresh_token: process.env.GOOGLE_SHEETS_AUDIT_REFRESH_TOKEN?.trim() ?? "",
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status})`);
  const body = (await response.json()) as { access_token?: unknown; scope?: unknown };
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("Google token refresh returned no access token");
  }
  return body.access_token;
}

async function fetchSnapshot(): Promise<SheetSnapshot> {
  const token = await refreshAccessToken();
  const params = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE" });
  for (const tab of TABS) params.append("ranges", `'${tab}'!A:Z`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${LOST_ARCHIVE_SHEET_ID}/values:batchGet?${params}`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`Google Sheets read failed (${response.status})`);
  const body = (await response.json()) as { valueRanges?: { values?: unknown[][] }[] };
  if (!Array.isArray(body.valueRanges) || body.valueRanges.length !== TABS.length) {
    throw new Error("Google Sheets response is incomplete");
  }
  const rows = body.valueRanges.flatMap((range, index) =>
    parseLostArchiveTab(TABS[index], range.values ?? []),
  );
  // A partial response must never masquerade as an improved quality score.
  for (const tab of TABS) {
    if (rows.filter((row) => row.__sheet_month === tab).length < 100) {
      throw new Error(`Lost Archive ${tab} read is incomplete`);
    }
  }
  return { rows, readAt: new Date().toISOString() };
}

/** Read-only Google Sheets API access; no database, file, or sheet writes. */
export async function readLostArchiveGoogle(): Promise<SheetSnapshot> {
  if (!lostArchiveGoogleConfigured())
    throw new Error("Google Sheets read-only OAuth is not configured");
  if (cache && Date.now() - Date.parse(cache.readAt) < CACHE_MS) return cache;
  pending ??= fetchSnapshot()
    .then((snapshot) => {
      cache = snapshot;
      return snapshot;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
