// Server-only: workbook or Google Sheet to a reviewable draft.
//
// The path is fixed and one-directional:
//
//   source -> preview -> validation -> draft -> approval -> published
//
// Reading the sheet is never part of rendering a page. A price only reaches a
// report after somebody looked at a preview and pressed publish, which is what
// keeps a typo in a spreadsheet from silently rewriting what the compliance
// report calls a breach.
import Papa from "papaparse";
import { parsePriceWorkbook, type ParseResult, type ParsedSheet } from "./price-book-parser.ts";
import { readXlsx } from "./xlsx-reader.server.ts";
import { checksum, createPriceBook } from "./pricing-db.server.ts";
import type { PriceBook, PriceSourceType } from "./pricing-types.ts";

/** Hard ceiling on an uploaded workbook. A price list is tens of kilobytes. */
export const MAX_WORKBOOK_BYTES = 8 * 1024 * 1024;

export interface ImportPreview {
  ok: boolean;
  sourceType: PriceSourceType;
  sourceName: string;
  sourceUrl: string;
  sourceChecksum: string;
  sheets: string[];
  parse: ParseResult;
  summary: {
    sourceRows: number;
    accepted: number;
    rejected: number;
    duplicateCodes: number;
    needsReview: number;
    onHold: number;
    unmapped: number;
    errors: number;
    warnings: number;
  };
  /** Ambiguous dates a person has to resolve before offers can be published. */
  unresolvedDates: { sheet: string; raw: string; dayFirst: string; monthFirst: string }[];
  error: string;
}

const emptyPreview = (sourceType: PriceSourceType): ImportPreview => ({
  ok: false,
  sourceType,
  sourceName: "",
  sourceUrl: "",
  sourceChecksum: "",
  sheets: [],
  parse: {
    items: [],
    sourceRowCount: 0,
    rejectedRowCount: 0,
    duplicateCodes: [],
    issues: [],
    sheetsSeen: [],
    offerWindows: [],
    counts: {
      individual: 0,
      bundle: 0,
      level: 0,
      offer: 0,
      incentive: 0,
      requiresReview: 0,
      onHold: 0,
      compositeCodes: 0,
    },
  },
  summary: {
    sourceRows: 0,
    accepted: 0,
    rejected: 0,
    duplicateCodes: 0,
    needsReview: 0,
    onHold: 0,
    unmapped: 0,
    errors: 0,
    warnings: 0,
  },
  unresolvedDates: [],
  error: "",
});

function summarize(
  parse: ParseResult,
  base: ImportPreview,
  extras: Partial<ImportPreview>,
): ImportPreview {
  const unresolved = parse.offerWindows.filter((window) => window.dayFirst !== window.monthFirst);
  const seen = new Set<string>();
  return {
    ...base,
    ...extras,
    ok: true,
    parse,
    summary: {
      sourceRows: parse.sourceRowCount,
      accepted: parse.items.length,
      rejected: parse.rejectedRowCount,
      duplicateCodes: parse.duplicateCodes.length,
      needsReview: parse.counts.requiresReview,
      onHold: parse.counts.onHold,
      unmapped: parse.items.filter((item) => !item.odooProductId).length,
      errors: parse.issues.filter((issue) => issue.severity === "error").length,
      warnings: parse.issues.filter((issue) => issue.severity === "warning").length,
    },
    unresolvedDates: unresolved.filter((window) => {
      const key = `${window.sheet}${window.raw}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    sheets: parse.sheetsSeen,
  };
}

export interface PreviewOptions {
  offerDateReading?: "day_first" | "month_first" | "unresolved";
  baseCurrency?: string;
  localCurrency?: string;
}

/** Preview a workbook that was uploaded to the import screen. */
export function previewWorkbook(
  bytes: Buffer,
  fileName: string,
  options: PreviewOptions = {},
): ImportPreview {
  const base = emptyPreview("xlsx");
  if (bytes.length > MAX_WORKBOOK_BYTES) {
    return { ...base, error: `The file is larger than ${MAX_WORKBOOK_BYTES / (1024 * 1024)} MB.` };
  }
  try {
    const workbook = readXlsx(bytes);
    if (!workbook.sheets.length) return { ...base, error: "The workbook contains no sheets." };
    const parse = parsePriceWorkbook(workbook.sheets, options);
    return summarize(parse, base, {
      sourceName: fileName,
      sourceChecksum: checksum(bytes),
    });
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : "The workbook could not be read.",
    };
  }
}

/* --- Google Sheets --------------------------------------------------------- */

const SHEET_ID_PATTERN = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;

export function googleSheetId(url: string): string {
  const trimmed = url.trim();
  const match = trimmed.match(SHEET_ID_PATTERN);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(trimmed) ? trimmed : "";
}

/**
 * Read one tab as CSV.
 *
 * The same visualization endpoint the rest of the dashboard uses, with the same
 * cache-busting parameter: Google's CDN ignores a no-cache header, so without a
 * unique parameter an import can silently preview last week's prices.
 */
async function fetchTab(sheetId: string, tab: string, bust: number): Promise<ParsedSheet | null> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&_cb=${bust}`;
  const response = await fetch(url, {
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return null;
  const text = await response.text();
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
  const rows = (parsed.data ?? []).map((row) =>
    (row ?? []).map((cell) => {
      const value = String(cell ?? "").trim();
      if (!value) return "";
      // gviz quotes everything; recover numbers so the price cells read as prices.
      const numeric = Number(value.replace(/,/g, ""));
      return /^-?[\d,]+(\.\d+)?$/.test(value) && Number.isFinite(numeric) ? numeric : value;
    }),
  );
  return { name: tab, rows };
}

/**
 * Preview a Google Sheet.
 *
 * The tab names have to be supplied because the CSV endpoint has no listing
 * call, and it answers an unknown tab name with the workbook's *first* tab
 * rather than an error — so a silent fallback would import one sheet six times.
 * Each response is checked against the tab that was asked for.
 */
export async function previewGoogleSheet(
  url: string,
  tabs: string[],
  options: PreviewOptions = {},
): Promise<ImportPreview> {
  const base = emptyPreview("google_sheet");
  const sheetId = googleSheetId(url);
  if (!sheetId) return { ...base, error: "That does not look like a Google Sheets URL." };
  if (!tabs.length) return { ...base, error: "Name at least one tab to import." };

  const bust = Date.now();
  const sheets: ParsedSheet[] = [];
  const failed: string[] = [];
  const signatures = new Map<string, string>();

  for (const tab of tabs.slice(0, 20)) {
    try {
      const sheet = await fetchTab(sheetId, tab, bust);
      if (!sheet || !sheet.rows.length) {
        failed.push(tab);
        continue;
      }
      // Two tabs returning identical content means the endpoint fell back to
      // the first tab for a name that does not exist.
      const signature = JSON.stringify(sheet.rows.slice(0, 3));
      const clash = signatures.get(signature);
      if (clash) {
        failed.push(`${tab} (returned the same content as "${clash}" — check the tab name)`);
        continue;
      }
      signatures.set(signature, tab);
      sheets.push(sheet);
    } catch {
      failed.push(tab);
    }
  }

  if (!sheets.length) {
    return {
      ...base,
      error: `None of the named tabs could be read: ${failed.join(", ")}. The sheet also has to be shared as "anyone with the link can view".`,
    };
  }

  const parse = parsePriceWorkbook(sheets, options);
  if (failed.length) {
    parse.issues.unshift({
      sheet: failed.join(", "),
      row: 0,
      severity: "warning",
      code: "tab_unreadable",
      message: "Some tabs could not be read and are not part of this draft.",
      detail: failed.join(", "),
    });
  }
  return summarize(parse, base, {
    sourceName: `Google Sheet ${sheetId.slice(0, 8)}…`,
    sourceUrl: `https://docs.google.com/spreadsheets/d/${sheetId}`,
    sourceChecksum: checksum(JSON.stringify(sheets)),
  });
}

/* --- commit ---------------------------------------------------------------- */

export interface CommitInput {
  name: string;
  effectiveFrom: string;
  effectiveTo: string;
  taxInclusive: boolean;
  baseCurrency: string;
  notes: string;
}

/**
 * Turn a reviewed preview into a draft book.
 *
 * Always a draft, never a publish. Nothing this creates changes a report until
 * an administrator publishes it, which is a separate, audited action.
 */
export async function commitPreview(
  preview: ImportPreview,
  input: CommitInput,
  actor: string,
): Promise<PriceBook> {
  if (!preview.ok || !preview.parse.items.length) {
    throw new Error("There is nothing to import from this preview.");
  }
  return createPriceBook(
    {
      name: input.name,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      sourceType: preview.sourceType,
      sourceName: preview.sourceName,
      sourceUrl: preview.sourceUrl,
      sourceChecksum: preview.sourceChecksum,
      taxInclusive: input.taxInclusive,
      baseCurrency: input.baseCurrency,
      notes: input.notes,
    },
    preview.parse.items,
    actor,
  );
}

/** The tabs the current Engosoft price workbook uses, offered as a default. */
export const DEFAULT_SHEET_TABS = [
  "Management",
  "Mech & Elec",
  "BIM all",
  "Architecture & Decor",
  "Civil Courses",
  "Others",
  "عروض ",
  "حافز ال 500 جنيه",
];
