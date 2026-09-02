import { useMemo, useState } from "react";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { InvoiceDetailPanel } from "./InvoiceDetailPanel";
import { fmtMoney, type AuditRow, type OdooInvoiceVerification } from "./pricing-ui";

const invoiceDate = (row: AuditRow): string =>
  row.paymentDate || row.invoiceDate || row.saleDate || "";

/**
 * The handful of invoices worth interrupting the price list for.
 *
 * The rows arrive already ordered by severity and then by the size of the gap,
 * so the first six unique invoices are the six conversations to have today.
 * Deliberately a short list and not a second table — the full set is one tab
 * away, and repeating it here would only push the price list off the screen.
 */
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
      const body = (await response.json()) as {
        odooRecordUrl?: string;
        odooVerification?: OdooInvoiceVerification;
      };
      if (!response.ok || body.odooVerification?.status !== "matched" || !body.odooRecordUrl) {
        throw new Error(body.odooVerification?.status || "unavailable");
      }
      if (popup) popup.location.href = body.odooRecordUrl;
      else window.open(body.odooRecordUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      popup?.close();
      const reason = error instanceof Error ? error.message : "unavailable";
      setOpenError(
        ar
          ? reason === "not_found"
            ? `لم يتم العثور على الفاتورة ${movement} في أودو؛ لم يتم إنشاء رابط تقديري.`
            : reason === "ambiguous"
              ? `يوجد أكثر من سجل برقم ${movement} في أودو؛ أوقفنا الفتح حتى تتم المراجعة.`
              : "تعذر التحقق من الفاتورة مباشرةً في أودو الآن؛ لم يتم إنشاء رابط تقديري."
          : reason === "not_found"
            ? `Invoice ${movement} was not found in Odoo. No guessed link was created.`
            : "Odoo could not be verified. No guessed link was created.",
      );
    } finally {
      setOpeningOdoo("");
    }
  };

  if (!loading && !invoices.length) return null;

  return (
    <section
      className="overflow-hidden rounded-xl border bg-surface"
      style={{ borderColor: "color-mix(in oklab, var(--danger) 28%, transparent)" }}
      aria-labelledby="critical-invoices-heading"
    >
      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b px-3.5 py-2.5 sm:px-4"
        style={{
          background: "var(--danger-soft)",
          borderColor: "color-mix(in oklab, var(--danger) 18%, transparent)",
        }}
      >
        <h2
          id="critical-invoices-heading"
          className="flex items-center gap-2 text-[13px] font-bold text-text"
        >
          <TriangleAlert size={16} style={{ color: "var(--danger)" }} aria-hidden="true" />
          {ar ? "فواتير تحتاج تدخّلًا اليوم" : "Invoices needing action today"}
        </h2>
        <p className="text-[11px] text-text-muted">
          {ar
            ? `أكبر ${invoices.length} حالة بيع تحت الحد الأدنى من ${total} بندًا مخالفًا`
            : `The ${invoices.length} worst of ${total} lines sold below the floor`}
        </p>
      </div>

      {loading ? (
        <div className="divide-y divide-border">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-[52px]" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {invoices.map(({ row, count }) => (
            <li
              key={row.invoiceNumber}
              className="grid gap-x-4 gap-y-1.5 px-3.5 py-2.5 sm:px-4 lg:grid-cols-[minmax(140px,0.85fr)_minmax(200px,1.3fr)_minmax(190px,1fr)_auto] lg:items-center"
            >
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-text">
                  <bdi>{row.salesperson || (ar ? "بدون موظف محدد" : "No salesperson")}</bdi>
                </div>
                <div className="num text-[10.5px] text-text-subtle">
                  <bdi>{row.invoiceNumber}</bdi> · <bdi>{invoiceDate(row) || "—"}</bdi>
                </div>
              </div>

              <div className="min-w-0 text-[12px]">
                <span className="truncate text-text">
                  <bdi>{row.productName}</bdi>
                </span>
                {count > 1 && (
                  <span className="num text-text-subtle">
                    {" "}
                    · {ar ? `و${count - 1} بندًا آخر` : `+${count - 1} more`}
                  </span>
                )}
              </div>

              <div className="num min-w-0 text-[12px]">
                <span className="font-semibold" style={{ color: "var(--danger)" }}>
                  {fmtMoney(row.actualUnitPrice, row.currency, lang)}
                </span>
                <span className="mx-1.5 text-text-subtle" aria-hidden="true">
                  ↓
                </span>
                <span className="text-text-muted">
                  {ar ? "الحد " : "floor "}
                  {fmtMoney(row.allowedMinimum, row.currency, lang)}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setOpenInvoice(row.invoiceNumber)}
                  className="inline-flex min-h-8 cursor-pointer items-center rounded-lg border border-border px-2.5 text-[11.5px] font-semibold text-text transition-colors hover:bg-surface-2"
                >
                  {ar ? "التفاصيل" : "Details"}
                </button>
                <button
                  type="button"
                  onClick={() => void openInOdoo(row.invoiceNumber)}
                  disabled={openingOdoo === row.invoiceNumber}
                  className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold text-white transition-opacity disabled:opacity-55"
                  style={{ background: "var(--ink)" }}
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  {openingOdoo === row.invoiceNumber
                    ? ar
                      ? "جارٍ الفتح…"
                      : "Opening…"
                    : ar
                      ? "فتح في أودو"
                      : "Open in Odoo"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!!openError && (
        <p
          className="border-t border-border px-4 py-2 text-[11px]"
          style={{ color: "var(--danger)" }}
        >
          {openError}
        </p>
      )}
      {!!openInvoice && (
        <InvoiceDetailPanel movement={openInvoice} onClose={() => setOpenInvoice("")} />
      )}
    </section>
  );
}
