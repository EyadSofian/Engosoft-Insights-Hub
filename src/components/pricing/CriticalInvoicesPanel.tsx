import { useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, FileSearch, UserRound } from "lucide-react";
import { Card, Pill, Skeleton } from "@/components/ui-bits";
import { fmtNum, useI18n } from "@/lib/i18n";
import { InvoiceDialog } from "./PriceComplianceTab";
import { auditReasonLabel, fmtMoney, type AuditRow } from "./pricing-ui";

function invoiceDate(row: AuditRow): string {
  return row.paymentDate || row.invoiceDate || row.saleDate || "";
}

export function CriticalInvoicesPanel({
  rows,
  total,
  loading,
}: {
  rows: AuditRow[];
  total: number;
  loading: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [openInvoice, setOpenInvoice] = useState("");
  const [openingOdoo, setOpeningOdoo] = useState("");
  const [openError, setOpenError] = useState("");
  const invoices = useMemo(() => {
    const unique = new Map<string, { row: AuditRow; count: number }>();
    for (const row of rows) {
      const current = unique.get(row.invoiceNumber);
      unique.set(row.invoiceNumber, {
        row: current?.row ?? row,
        count: (current?.count ?? 0) + 1,
      });
    }
    return [...unique.values()].slice(0, 6);
  }, [rows]);

  const openInOdoo = async (movement: string) => {
    setOpeningOdoo(movement);
    setOpenError("");
    const popup = window.open("", "_blank");
    try {
      const response = await fetch(`/api/pricing/invoices/${encodeURIComponent(movement)}`);
      const body = (await response.json()) as { odooSearchUrl?: string };
      if (!response.ok || !body.odooSearchUrl) throw new Error("missing-link");
      if (popup) popup.location.href = body.odooSearchUrl;
      else window.open(body.odooSearchUrl, "_blank", "noopener,noreferrer");
    } catch {
      popup?.close();
      setOpenError(
        ar ? "تعذر فتح الفاتورة في أودو. افتح التفاصيل وحاول مرة أخرى." : "Could not open Odoo.",
      );
    } finally {
      setOpeningOdoo("");
    }
  };

  return (
    <Card className="overflow-hidden border-danger/25 p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-danger/15 bg-danger-soft/35 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-danger text-white shadow-sm">
            <AlertTriangle size={17} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-[14px] font-black text-text">
              {ar ? "فواتير حرجة تحتاج تدخّلًا" : "Critical invoices requiring action"}
            </h2>
            <p className="mt-0.5 text-[10px] text-text-muted">
              {ar
                ? "بيع تحت الحد الأدنى المعتمد — راجع الموظف والفاتورة مباشرة."
                : "Sales below the approved floor — review the owner and invoice."}
            </p>
          </div>
        </div>
        <Pill tone="danger">
          {fmtNum(total)} {ar ? "مخالفة" : "breaches"}
        </Pill>
      </div>

      {loading ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : invoices.length ? (
        <div className="space-y-2 p-3">
          {invoices.map(({ row, count }) => (
            <article
              key={row.invoiceNumber}
              className="relative grid gap-3 overflow-hidden rounded-2xl border border-danger/20 bg-surface px-4 py-3 shadow-sm lg:grid-cols-[minmax(180px,0.9fr)_minmax(240px,1.35fr)_minmax(240px,1.1fr)_auto] lg:items-center"
            >
              <span className="absolute inset-y-0 start-0 w-1 bg-danger" aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-danger">
                  <UserRound size={12} aria-hidden="true" />
                  {ar ? "مسؤول الفاتورة" : "Invoice owner"}
                </div>
                <h3 className="mt-1 truncate text-[13px] font-black text-text">
                  {row.salesperson || (ar ? "بدون موظف محدد" : "No salesperson")}
                </h3>
                <div className="mt-1">
                  <Pill tone="danger">
                    {fmtNum(count)} {ar ? "بند مخالف" : "breached lines"}
                  </Pill>
                </div>
              </div>

              <div className="min-w-0 rounded-xl bg-danger-soft/35 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-[11px] text-text">{row.invoiceNumber}</strong>
                  <span className="shrink-0 text-[9px] tabular-nums text-text-subtle">
                    {invoiceDate(row) || "—"}
                  </span>
                </div>
                <div className="mt-1 truncate text-[10px] text-text-muted">
                  {row.productName}
                  {count > 1
                    ? ` · ${ar ? `و${fmtNum(count - 1)} بنود أخرى` : `+${count - 1} more`}`
                    : ""}
                </div>
              </div>

              <div className="min-w-0">
                <div className="text-[11px] font-black tabular-nums text-danger">
                  {ar ? "سعر البيع" : "Sold"} {fmtMoney(row.actualUnitPrice, row.currency, lang)}
                  <span className="mx-1.5 text-text-subtle">←</span>
                  {ar ? "الحد الأدنى" : "floor"} {fmtMoney(row.allowedMinimum, row.currency, lang)}
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-text-muted">
                  {auditReasonLabel(row, lang)}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:min-w-[230px]">
                <button
                  type="button"
                  onClick={() => setOpenInvoice(row.invoiceNumber)}
                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface text-[10px] font-bold text-text hover:bg-surface-2"
                >
                  <FileSearch size={13} aria-hidden="true" />
                  {ar ? "عرض التفاصيل" : "Details"}
                </button>
                <button
                  type="button"
                  onClick={() => void openInOdoo(row.invoiceNumber)}
                  disabled={openingOdoo === row.invoiceNumber}
                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-[#10262d] px-2 text-[10px] font-bold text-white disabled:opacity-55"
                >
                  <ExternalLink size={13} aria-hidden="true" />
                  {openingOdoo === row.invoiceNumber
                    ? ar
                      ? "جاري الفتح…"
                      : "Opening…"
                    : ar
                      ? "فتح في أودو"
                      : "Open in Odoo"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="px-5 py-5 text-center text-[11px] text-success">
          {ar ? "لا توجد فواتير حرجة في الفترة الحالية." : "No critical invoices in this period."}
        </div>
      )}

      {!!openError && <div className="px-5 pb-3 text-[10px] text-danger">{openError}</div>}
      {!!openInvoice && <InvoiceDialog movement={openInvoice} onClose={() => setOpenInvoice("")} />}
    </Card>
  );
}
