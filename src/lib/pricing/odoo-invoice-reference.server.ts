import { odooConfig, searchRead, type M2O } from "@/lib/odoo.server";

export type OdooInvoiceMatchStatus = "matched" | "not_found" | "ambiguous" | "unavailable";

export interface OdooInvoiceVerification {
  status: OdooInvoiceMatchStatus;
  recordId: number | null;
  exactName: string;
  companyId: number | null;
  companyName: string;
  state: string;
  moveType: string;
  auditedLineCount: number;
  verifiedLineCount: number | null;
  allAuditedLinesMatched: boolean | null;
}

interface OdooMoveRow {
  id: number;
  name?: string | false;
  move_type?: string | false;
  state?: string | false;
  company_id?: M2O;
}

interface OdooMoveLineRow {
  id: number;
}

const referenceCache = new Map<
  string,
  { expiresAt: number; record: OdooMoveRow | null; ambiguous: boolean }
>();
const CACHE_TTL_MS = 5 * 60_000;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function company(move: OdooMoveRow): { id: number | null; name: string } {
  return Array.isArray(move.company_id)
    ? { id: Number(move.company_id[0]) || null, name: clean(move.company_id[1]) }
    : { id: null, name: "" };
}

/** Canonical Odoo web-client record URL. It is only called after an exact RPC match. */
export function buildOdooInvoiceRecordUrl(
  baseUrl: string,
  recordId: number,
  companyId: number | null,
): string {
  if (!/^https?:\/\//i.test(baseUrl) || !Number.isInteger(recordId) || recordId <= 0) return "";
  const base = baseUrl.replace(/\/+$/, "");
  const hash = new URLSearchParams({
    id: String(recordId),
    model: "account.move",
    view_type: "form",
    ...(companyId ? { cids: String(companyId) } : {}),
  });
  return `${base}/web#${hash.toString()}`;
}

async function exactMove(invoiceNumber: string): Promise<{
  record: OdooMoveRow | null;
  ambiguous: boolean;
}> {
  const cached = referenceCache.get(invoiceNumber);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const matches = await searchRead<OdooMoveRow>(
    "account.move",
    [
      ["name", "=", invoiceNumber],
      ["move_type", "in", ["out_invoice", "out_refund"]],
    ],
    ["id", "name", "move_type", "state", "company_id"],
    { limit: 3, context: { active_test: false } },
  );
  const exact = matches.filter((move) => clean(move.name) === invoiceNumber);
  const result = {
    record: exact.length === 1 ? exact[0] : null,
    ambiguous: exact.length > 1,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  referenceCache.set(invoiceNumber, result);
  return result;
}

/**
 * Verifies both the invoice name and the stored audit line ids against live Odoo.
 * No URL is returned for a missing or ambiguous record.
 */
export async function verifyOdooInvoice(
  rawInvoiceNumber: string,
  rawLineIds: Array<string | number>,
): Promise<{ verification: OdooInvoiceVerification; recordUrl: string }> {
  const invoiceNumber = clean(rawInvoiceNumber).slice(0, 120);
  const lineIds = [
    ...new Set(
      rawLineIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ];

  try {
    const { record, ambiguous } = await exactMove(invoiceNumber);
    if (!record) {
      return {
        verification: {
          status: ambiguous ? "ambiguous" : "not_found",
          recordId: null,
          exactName: invoiceNumber,
          companyId: null,
          companyName: "",
          state: "",
          moveType: "",
          auditedLineCount: lineIds.length,
          verifiedLineCount: null,
          allAuditedLinesMatched: null,
        },
        recordUrl: "",
      };
    }

    let verifiedLineCount: number | null = 0;
    if (lineIds.length) {
      try {
        const verifiedLines = await searchRead<OdooMoveLineRow>(
          "account.move.line",
          [
            ["id", "in", lineIds],
            ["move_id", "=", record.id],
          ],
          ["id"],
          { limit: lineIds.length, context: { active_test: false } },
        );
        verifiedLineCount = verifiedLines.length;
      } catch {
        // The invoice itself is still an exact match; line verification is reported as unavailable.
        verifiedLineCount = null;
      }
    }

    const moveCompany = company(record);
    return {
      verification: {
        status: "matched",
        recordId: record.id,
        exactName: clean(record.name),
        companyId: moveCompany.id,
        companyName: moveCompany.name,
        state: clean(record.state),
        moveType: clean(record.move_type),
        auditedLineCount: lineIds.length,
        verifiedLineCount,
        allAuditedLinesMatched:
          verifiedLineCount === null ? null : verifiedLineCount === lineIds.length,
      },
      recordUrl: buildOdooInvoiceRecordUrl(odooConfig().url, record.id, moveCompany.id),
    };
  } catch {
    return {
      verification: {
        status: "unavailable",
        recordId: null,
        exactName: invoiceNumber,
        companyId: null,
        companyName: "",
        state: "",
        moveType: "",
        auditedLineCount: lineIds.length,
        verifiedLineCount: null,
        allAuditedLinesMatched: null,
      },
      recordUrl: "",
    };
  }
}
