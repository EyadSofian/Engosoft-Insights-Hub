import { useEffect, useState } from "react";
import { ExternalLink, Lock } from "lucide-react";
import { DetailPanel, DetailSection, DetailStat } from "@/components/DetailPanel";
import { Notice, Skeleton } from "@/components/ui-bits";
import { fmtPct, useI18n } from "@/lib/i18n";
import { RowStatusBadge } from "./StatusBadge";
import {
  auditReasonLabel,
  fmtMoney,
  matchLabel,
  methodLabel,
  type AuditRow,
  type OdooInvoiceVerification,
} from "./pricing-ui";

interface InvoicePayload {
  lines: AuditRow[];
  payment: {
    method: string;
    raw: string[];
    breakdown: { method: string; raw: string; amount: number }[];
    source: string;
  } | null;
  odooRecordUrl: string;
  odooVerification: OdooInvoiceVerification;
  error?: string;
}

const unavailable = (movement: string): InvoicePayload => ({
  lines: [],
  payment: null,
  odooRecordUrl: "",
  odooVerification: {
    status: "unavailable",
    recordId: null,
    exactName: movement,
    companyId: null,
    companyName: "",
    state: "",
    moveType: "",
    auditedLineCount: 0,
    verifiedLineCount: null,
    allAuditedLinesMatched: null,
  },
  error: "Could not load the invoice.",
});

/**
 * One invoice, opened over the table.
 *
 * A drill-down that navigated would cost the reader their filters, their sort
 * and their place in a 200-row list, so this opens as a panel and the table
 * stays exactly where it was underneath.
 */
export function InvoiceDetailPanel({
  movement,
  onClose,
}: {
  movement: string;
  onClose: () => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [data, setData] = useState<InvoicePayload | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    void (async () => {
      try {
        const response = await fetch(`/api/pricing/invoices/${encodeURIComponent(movement)}`);
        const body = (await response.json()) as InvoicePayload;
        if (live) setData(body);
      } catch {
        if (live) setData(unavailable(movement));
      }
    })();
    return () => {
      live = false;
    };
  }, [movement]);

  const owner = data?.lines[0]?.salesperson;
  const verified = data?.odooVerification.status === "matched" && Boolean(data.odooRecordUrl);

  return (
    <DetailPanel
      open
      onClose={onClose}
      title={<bdi className="num">{movement}</bdi>}
      subtitle={
        owner
          ? `${ar ? "مسؤول الفاتورة" : "Invoice owner"}: ${owner}`
          : data
            ? ar
              ? "بدون موظف محدد"
              : "No salesperson recorded"
            : undefined
      }
      footer={
        verified ? (
          <a
            href={data!.odooRecordUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] font-semibold text-brand transition-colors hover:bg-brand-soft"
          >
            <ExternalLink size={14} aria-hidden="true" />
            {ar ? "فتح السجل الموثّق في أودو" : "Open the verified Odoo record"}
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-text-subtle">
            <Lock size={13} aria-hidden="true" />
            {ar
              ? "لم يتم إنشاء رابط أودو لأن المطابقة لم تتأكد."
              : "No Odoo link: the match was not confirmed."}
          </span>
        )
      }
    >
      {!data && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      )}

      {!!data?.error && !data.lines.length && (
        <Notice tone="warning">
          {ar ? "تعذر تحميل بيانات الفاتورة كاملة. حاول مرة أخرى." : data.error}
        </Notice>
      )}

      {!!data?.payment && (
        <DetailSection title={ar ? "طريقة الدفع الفعلية" : "How it was settled"}>
          <div className="rounded-lg border border-border bg-surface-2/45 px-3 py-2.5 text-[12px]">
            <div className="font-semibold text-text">{methodLabel(data.payment.method, lang)}</div>
            <div className="mt-0.5 text-[11px] text-text-muted">
              {ar ? "مصدر التحقق" : "Source"}:{" "}
              {ar
                ? data.payment.source === "account_payment"
                  ? "سجل المدفوعات في أودو"
                  : data.payment.source === "payments_widget"
                    ? "تفاصيل سداد الفاتورة في أودو"
                    : "غير معروف"
                : data.payment.source}
            </div>
            {!!data.payment.breakdown.length && (
              <ul className="mt-1.5 space-y-0.5 text-[11px] text-text-muted">
                {data.payment.breakdown.map((entry, index) => (
                  <li key={`${entry.raw}${index}`} className="num flex justify-between gap-2">
                    <span>
                      {methodLabel(entry.method, lang)} — <bdi>{entry.raw || "—"}</bdi>
                    </span>
                    <span>{entry.amount}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DetailSection>
      )}

      {!!data?.odooVerification && (
        <div className="mt-3">
          <Notice tone={data.odooVerification.status === "matched" ? "info" : "warning"}>
            {data.odooVerification.status === "matched"
              ? ar
                ? `تمت مطابقة رقم الفاتورة مباشرةً مع سجل Odoo رقم ${data.odooVerification.recordId}${
                    data.odooVerification.allAuditedLinesMatched
                      ? `، وتطابقت البنود الـ${data.odooVerification.verifiedLineCount}.`
                      : data.odooVerification.verifiedLineCount === null
                        ? ". تعذر التحقق من البنود حاليًا."
                        : `، لكن تطابق ${data.odooVerification.verifiedLineCount} من ${data.odooVerification.auditedLineCount} بندًا فقط.`
                  }`
                : `Exact Odoo match: account.move #${data.odooVerification.recordId}.`
              : data.odooVerification.status === "not_found"
                ? ar
                  ? "رقم الفاتورة غير موجود في Odoo؛ لذلك لن يظهر أي رابط تقديري."
                  : "This invoice number was not found in Odoo. No guessed link is shown."
                : data.odooVerification.status === "ambiguous"
                  ? ar
                    ? "ظهر أكثر من سجل مطابق في Odoo؛ تم إيقاف الرابط حتى تتم المراجعة."
                    : "Multiple Odoo records matched; the link is disabled."
                  : ar
                    ? "تعذر التحقق المباشر من Odoo الآن؛ تم إيقاف الرابط بدلًا من تخمينه."
                    : "Live Odoo verification is unavailable; the link is disabled."}
          </Notice>
        </div>
      )}

      {!!data?.lines.length && (
        <DetailSection title={ar ? "بنود الفاتورة" : "Invoice lines"}>
          <ul className="space-y-2">
            {data.lines.map((line) => (
              <li key={line.invoiceLineId} className="rounded-lg border border-border px-3 py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 text-[12px] font-semibold text-text">
                    <bdi>{line.productName}</bdi>{" "}
                    <span className="num text-text-subtle">({line.productCode || "—"})</span>
                  </span>
                  <RowStatusBadge row={line} />
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <DetailStat
                    label={ar ? "سعر البيع" : "Sold at"}
                    value={fmtMoney(line.actualUnitPrice, line.currency, lang)}
                  />
                  <DetailStat
                    label={ar ? "الحد الأدنى" : "Floor"}
                    value={fmtMoney(line.allowedMinimum, line.currency, lang)}
                  />
                  <DetailStat
                    label={ar ? "قيمة التجاوز" : "Shortfall"}
                    value={
                      line.varianceAmount > 0
                        ? fmtMoney(line.varianceAmount, line.currency, lang)
                        : "—"
                    }
                    tone={line.varianceAmount > 0 ? "danger" : "muted"}
                  />
                  <DetailStat
                    label={ar ? "أقل بنسبة" : "Below by"}
                    value={
                      line.variancePercent !== null && line.variancePercent > 0
                        ? fmtPct(line.variancePercent * 100, 1)
                        : "—"
                    }
                    tone={line.varianceAmount > 0 ? "danger" : "muted"}
                  />
                </div>

                {line.pricingContext === "package" && (
                  <div className="mt-2 rounded-md border border-success/20 bg-success-soft px-2.5 py-2 text-[11px] leading-relaxed text-text-muted">
                    <span className="font-semibold text-success">
                      {ar ? "مرجع السعر: باقة على Odoo" : "Price source: Odoo package"}
                    </span>
                    {(line.odooPricelistName || line.pricingContextName) && (
                      <span>
                        {" "}
                        · <bdi>{line.odooPricelistName || line.pricingContextName}</bdi>
                      </span>
                    )}
                    {line.odooSaleOrderName && (
                      <span>
                        {" "}
                        · {ar ? "أمر البيع" : "Sales order"}{" "}
                        <bdi className="num">{line.odooSaleOrderName}</bdi>
                      </span>
                    )}
                  </div>
                )}

                <p className="mt-2 text-[11.5px] leading-relaxed text-text-muted">
                  {auditReasonLabel(line, lang)}
                </p>
                <p className="mt-1 text-[10.5px] text-text-subtle">
                  {matchLabel(line.matchType, lang)} · {ar ? "الكمية" : "Qty"}{" "}
                  <span className="num">{line.quantity}</span>
                </p>
              </li>
            ))}
          </ul>
        </DetailSection>
      )}
    </DetailPanel>
  );
}
