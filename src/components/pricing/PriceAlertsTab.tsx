import { useState } from "react";
import { BellRing, Link2, Send, TriangleAlert } from "lucide-react";
import { Card, EmptyState, Notice, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import {
  fmtMoney,
  matchLabel,
  methodLabel,
  severityLabel,
  severityTone,
  statusLabel,
  writeJson,
  type AuditRow,
  type AuthState,
  type PriceItem,
} from "./pricing-ui";

export interface ExceptionsResponse {
  configured: boolean;
  auth: AuthState;
  alerts: (AuditRow & { alertKey: string })[];
  total: number;
  bySeverity: Record<string, number>;
  unlinked: { total: number; items: PriceItem[] };
  error: string;
}

const SEVERITY_ORDER = ["critical", "warning", "needs_review", "informational"] as const;

const SEVERITY_MEANING: Record<string, { ar: string; en: string }> = {
  critical: {
    ar: "أقل من الحد الأدنى المنشور بفارق كبير",
    en: "Well under the published floor",
  },
  warning: {
    ar: "أقل من الحد الأدنى المنشور بفارق محدود",
    en: "Slightly under the published floor",
  },
  needs_review: {
    ar: "منتج أو طريقة دفع غير معروفة — ليست مخالفة",
    en: "Unknown product or payment method — not a breach",
  },
  informational: {
    ar: "بيع أعلى من السعر الرسمي — للعلم فقط",
    en: "Sold above list — information only",
  },
};

/**
 * The alerts tab.
 *
 * Grouped by what the reader is being asked to do rather than by status, and
 * `needs review` is kept visually apart from a breach: a product nobody has
 * linked yet is a gap in the data, and presenting it beside a genuine discount
 * breach is how a report loses its credibility.
 */
export function PriceAlertsTab({
  data,
  loading,
  onSendDigest,
  sending,
  canWrite,
  adminCode,
}: {
  data?: ExceptionsResponse;
  loading: boolean;
  onSendDigest: () => void;
  sending: boolean;
  canWrite: boolean;
  adminCode: string;
}) {
  const { lang, t } = useI18n();
  const [linking, setLinking] = useState<PriceItem | null>(null);
  const [productId, setProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const grouped = SEVERITY_ORDER.map((severity) => ({
    severity,
    rows: (data?.alerts ?? []).filter((row) => row.severity === severity),
  })).filter((group) => group.rows.length);

  const link = async () => {
    if (!linking) return;
    setBusy(true);
    setError("");
    try {
      await writeJson(
        "/api/pricing/mappings",
        "POST",
        {
          mappings: [
            {
              priceItemId: linking.id,
              odooProductId: Number(productId),
              odooProductCode: linking.normalizedProductCode,
              matchType: "manual",
              confidence: 1,
            },
          ],
        },
        adminCode,
      );
      setNote(
        lang === "ar"
          ? "تم اعتماد الربط. شغّل إعادة التحليل عشان البنود دي تتحكم من جديد."
          : "Link approved. Re-run the audit so these lines are judged again.",
      );
      setLinking(null);
      setProductId("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The link could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {!!data?.error && <Notice tone="warning">{data.error}</Notice>}
      {!!error && <Notice tone="danger">{error}</Notice>}
      {!!note && <Notice tone="info">{note}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {SEVERITY_ORDER.map((severity) => (
            <Pill key={severity} tone={severityTone(severity)}>
              {severityLabel(severity, lang)} · {fmtNum(data?.bySeverity[severity] ?? 0)}
            </Pill>
          ))}
        </div>
        <button
          type="button"
          onClick={onSendDigest}
          disabled={!canWrite || sending}
          title={
            lang === "ar"
              ? "يرسل الحالات الجديدة فقط. التكرار ممنوع بمفتاح البند + نسخة الأسعار + الحالة."
              : "Sends only findings nobody has been told about. De-duplicated by line, price-book version and verdict."
          }
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={15} aria-hidden="true" />
          {sending
            ? lang === "ar"
              ? "جارٍ الإرسال…"
              : "Sending…"
            : lang === "ar"
              ? "إرسال ملخص التنبيهات"
              : "Send the digest"}
        </button>
      </div>

      {loading && <Skeleton className="h-64 w-full rounded-2xl" />}

      {!loading && !grouped.length && (
        <EmptyState
          label={lang === "ar" ? "لا توجد تنبيهات في هذه الفترة" : "No alerts in this period"}
        />
      )}

      {grouped.map((group) => (
        <Card key={group.severity}>
          <SectionTitle hint={SEVERITY_MEANING[group.severity]?.[lang]}>
            <span className="inline-flex items-center gap-2">
              {group.severity === "critical" ? (
                <TriangleAlert size={16} aria-hidden="true" />
              ) : (
                <BellRing size={16} aria-hidden="true" />
              )}
              {severityLabel(group.severity, lang)}
              <Pill tone={severityTone(group.severity)}>{group.rows.length}</Pill>
            </span>
          </SectionTitle>

          <ul className="space-y-2">
            {group.rows.map((row) => (
              <li key={row.invoiceLineId} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-text">
                      {row.productName}{" "}
                      <span className="font-normal text-text-subtle">
                        ({row.productCode || "—"})
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
                      <span>{row.invoiceNumber}</span>
                      <span aria-hidden="true">·</span>
                      <span>{row.salesperson || "—"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{methodLabel(row.paymentMethod, lang)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{row.paymentDate || row.invoiceDate || "—"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{matchLabel(row.matchType, lang)}</span>
                    </div>
                  </div>
                  <div className="text-end">
                    <Pill tone={severityTone(row.severity)}>
                      {statusLabel(row.complianceStatus, lang)}
                    </Pill>
                    <div className="mt-1 text-[13px] font-semibold tabular-nums text-text">
                      {fmtMoney(row.actualUnitPrice, row.currency, lang)}
                      {row.allowedMinimum !== null && (
                        <span className="ms-1 text-[11px] font-normal text-text-muted">
                          / {fmtMoney(row.allowedMinimum, row.currency, lang)}
                        </span>
                      )}
                    </div>
                    {row.variancePercent !== null && row.variancePercent > 0 && (
                      <div className="text-[11px] text-danger tabular-nums">
                        −{fmtPct(row.variancePercent * 100, 1)}
                      </div>
                    )}
                  </div>
                </div>
                <p className="mt-1.5 text-[12px] leading-snug text-text-muted">{row.reason}</p>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {/* --- rows waiting to be linked ----------------------------------- */}
      <Card>
        <SectionTitle
          hint={
            lang === "ar"
              ? "صفوف أسعار بدون منتج أودو مؤكد. البنود اللي بتقابلها في الفواتير بتتحسب «تحتاج ربط»، ومش بتطلع مخالفة."
              : "Price rows with no confirmed Odoo product. Invoice lines that hit them are listed as needing a link, never as a breach."
          }
          action={
            <Pill tone={data?.unlinked.total ? "warning" : "success"}>
              {fmtNum(data?.unlinked.total ?? 0)}
            </Pill>
          }
        >
          <span className="inline-flex items-center gap-2">
            <Link2 size={16} aria-hidden="true" />
            {lang === "ar" ? "تحتاج ربط" : "Needs linking"}
          </span>
        </SectionTitle>

        {!data?.unlinked.items.length && (
          <EmptyState label={lang === "ar" ? "كل الصفوف مربوطة" : "Every row is linked"} />
        )}

        {!!data?.unlinked.items.length && (
          <div className="hscroll">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-subtle">
                  <th className="py-2 text-start font-semibold">{t("pb_code")}</th>
                  <th className="py-2 text-start font-semibold">
                    {lang === "ar" ? "الدورة" : "Course"}
                  </th>
                  <th className="py-2 text-start font-semibold">
                    {lang === "ar" ? "المصدر" : "Source"}
                  </th>
                  <th className="py-2 text-start font-semibold" />
                </tr>
              </thead>
              <tbody>
                {data.unlinked.items.slice(0, 40).map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="py-2 tabular-nums">{item.rawProductCode || "—"}</td>
                    <td className="py-2">{item.courseName}</td>
                    <td className="py-2 text-text-subtle">
                      {item.sourceSheet}:{item.sourceRow}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => {
                          setLinking(item);
                          setProductId("");
                        }}
                        className="min-h-9 cursor-pointer rounded-lg border border-border px-2.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {lang === "ar" ? "ربط بمنتج" : "Link a product"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {linking && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={lang === "ar" ? "ربط منتج" : "Link a product"}
          onClick={(event) => {
            if (event.target === event.currentTarget) setLinking(null);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-surface p-5">
            <h2 className="text-[15px] font-semibold text-text">{linking.courseName}</h2>
            <p className="mt-1 text-[12px] text-text-muted">
              {lang === "ar"
                ? "اكتب معرّف المنتج في أودو. الربط بيتسجل باسمك في السجل، وبيُستخدم في المطابقة بعد كده."
                : "Enter the Odoo product id. The link is recorded against your name and used for matching from then on."}
            </p>
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-[11px] font-medium text-text-muted">Odoo product id</span>
              <input
                type="number"
                inputMode="numeric"
                value={productId}
                onChange={(event) => setProductId(event.target.value)}
                className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px] tabular-nums"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLinking(null)}
                className="min-h-11 cursor-pointer rounded-lg border border-border px-3 text-[13px]"
              >
                {lang === "ar" ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                disabled={busy || !Number(productId)}
                onClick={() => void link()}
                className="min-h-11 cursor-pointer rounded-lg px-4 text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--brand)" }}
              >
                {lang === "ar" ? "اعتماد الربط" : "Approve link"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
