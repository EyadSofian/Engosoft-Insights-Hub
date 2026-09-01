import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Link2,
  RefreshCw,
  Send,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Card, EmptyState, Notice, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import {
  fmtMoney,
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

const SEVERITY_CARD: Record<string, string> = {
  critical: "border-danger/35 bg-danger-soft/50 text-danger",
  warning: "border-warning/35 bg-warning-soft/50 text-warning",
  needs_review: "border-brand/30 bg-brand-soft/45 text-brand",
  informational: "border-success/30 bg-success-soft/45 text-success",
};

const SOURCE_SHEET_AR: Record<string, string> = {
  Management: "الإدارة",
  "Mech & Elec": "الميكانيكا والكهرباء",
  "BIM all": "نمذجة معلومات البناء BIM",
  "Architecture & Decor": "العمارة والديكور",
  "Civil Courses": "الهندسة المدنية",
};

const sourceLabel = (value: string, arabic: boolean): string =>
  arabic ? SOURCE_SHEET_AR[value] || value : value;

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
  onResolveLinks,
  resolvingLinks,
}: {
  data?: ExceptionsResponse;
  loading: boolean;
  onSendDigest: () => void;
  sending: boolean;
  canWrite: boolean;
  adminCode: string;
  onResolveLinks: () => void;
  resolvingLinks: boolean;
}) {
  const { lang } = useI18n();
  const [linking, setLinking] = useState<PriceItem[] | null>(null);
  const [productId, setProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [activeSeverity, setActiveSeverity] = useState<string>("all");
  const [openCourse, setOpenCourse] = useState("");

  const unlinkedGroups = useMemo(() => {
    const groups = new Map<string, PriceItem[]>();
    for (const item of data?.unlinked.items ?? []) {
      const key = [
        item.normalizedProductCode || item.rawProductCode || "no-code",
        item.courseName || "—",
        item.sourceSheet || "—",
        item.sourceRow,
      ].join("::");
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.values()];
  }, [data?.unlinked.items]);

  const courseAlerts = useMemo(() => {
    const visible = (data?.alerts ?? []).filter(
      (row) => activeSeverity === "all" || row.severity === activeSeverity,
    );
    const groups = new Map<string, (AuditRow & { alertKey: string })[]>();
    for (const row of visible) {
      const key = `${row.productCode || "—"}::${row.productName || "—"}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()].sort(([, left], [, right]) => {
      const leftRank = Math.min(
        ...left.map((row) =>
          SEVERITY_ORDER.indexOf(row.severity as (typeof SEVERITY_ORDER)[number]),
        ),
      );
      const rightRank = Math.min(
        ...right.map((row) =>
          SEVERITY_ORDER.indexOf(row.severity as (typeof SEVERITY_ORDER)[number]),
        ),
      );
      return leftRank - rightRank || right.length - left.length;
    });
  }, [activeSeverity, data?.alerts]);

  const link = async () => {
    if (!linking) return;
    setBusy(true);
    setError("");
    try {
      await writeJson(
        "/api/pricing/mappings",
        "POST",
        {
          mappings: linking.map((item) => ({
            priceItemId: item.id,
            odooProductId: Number(productId),
            odooProductCode: item.normalizedProductCode,
            matchType: "manual",
            confidence: 1,
          })),
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
        <div>
          <h2 className="text-[16px] font-bold text-text">
            {lang === "ar" ? "نظرة سريعة على تنبيهات الأسعار" : "Price alerts overview"}
          </h2>
          <p className="mt-1 text-[11px] text-text-muted">
            {lang === "ar"
              ? "اختر نوع التنبيه، ثم افتح كرت الدورة لعرض التفاصيل."
              : "Choose an alert type, then open only the course you need."}
          </p>
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SEVERITY_ORDER.map((severity) => {
          const count = data?.bySeverity[severity] ?? 0;
          const active = activeSeverity === severity;
          return (
            <button
              type="button"
              key={severity}
              onClick={() => {
                setActiveSeverity(active ? "all" : severity);
                setOpenCourse("");
              }}
              className={`min-h-32 rounded-2xl border p-5 text-start transition-shadow hover:shadow-md ${SEVERITY_CARD[severity]} ${active ? "ring-2 ring-current ring-offset-2 ring-offset-[var(--surface)]" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-current/10">
                  {severity === "critical" ? (
                    <TriangleAlert size={17} aria-hidden="true" />
                  ) : severity === "informational" ? (
                    <ShieldCheck size={17} aria-hidden="true" />
                  ) : (
                    <CircleAlert size={17} aria-hidden="true" />
                  )}
                </span>
                <div className="text-[28px] font-black tabular-nums">{fmtNum(count)}</div>
              </div>
              <div className="text-[12px] font-bold">{severityLabel(severity, lang)}</div>
              <div className="mt-1 text-[10px] leading-relaxed opacity-80">
                {SEVERITY_MEANING[severity]?.[lang]}
              </div>
            </button>
          );
        })}
      </div>

      {loading && <Skeleton className="h-64 w-full rounded-2xl" />}

      {!loading && !courseAlerts.length && (
        <EmptyState
          label={lang === "ar" ? "لا توجد تنبيهات في هذه الفترة" : "No alerts in this period"}
        />
      )}

      {!loading && !!courseAlerts.length && (
        <div className="grid gap-3 lg:grid-cols-2">
          {courseAlerts.map(([key, rows]) => {
            const first = rows[0];
            const worst = [...rows].sort(
              (left, right) =>
                SEVERITY_ORDER.indexOf(left.severity as (typeof SEVERITY_ORDER)[number]) -
                SEVERITY_ORDER.indexOf(right.severity as (typeof SEVERITY_ORDER)[number]),
            )[0];
            const open = openCourse === key;
            return (
              <article
                key={key}
                className={`overflow-hidden rounded-2xl border ${SEVERITY_CARD[worst.severity]}`}
              >
                <button
                  type="button"
                  onClick={() => setOpenCourse(open ? "" : key)}
                  className="w-full cursor-pointer px-5 py-4 text-start"
                  aria-expanded={open}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        <Pill tone={severityTone(worst.severity)}>
                          {severityLabel(worst.severity, lang)}
                        </Pill>
                        <Pill tone="neutral">#{first.productCode || "—"}</Pill>
                      </div>
                      <h3 className="line-clamp-2 text-[14px] font-bold text-text">
                        {first.productName || "—"}
                      </h3>
                      <p className="mt-1 text-[11px] text-text-muted">
                        {rows.length}{" "}
                        {lang === "ar" ? "حالة على هذا الكورس" : "cases for this course"}
                      </p>
                    </div>
                    <div className="text-end">
                      <div className="text-[10px] font-semibold text-text-muted">
                        {lang === "ar" ? "بيع فعلي / أقل مسموح" : "Actual / floor"}
                      </div>
                      <div className="mt-1 text-[13px] font-black tabular-nums text-text">
                        {fmtMoney(worst.actualUnitPrice, worst.currency, lang)}
                        <span className="mx-1 text-text-subtle">/</span>
                        {fmtMoney(worst.allowedMinimum, worst.currency, lang)}
                      </div>
                      <span className="mt-2 inline-block text-current">
                        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                      </span>
                    </div>
                  </div>
                </button>

                {open && (
                  <div className="animate-in fade-in border-t border-current/15 bg-surface p-3 duration-200">
                    <div className="space-y-2">
                      {rows.map((row) => (
                        <div
                          key={row.invoiceLineId}
                          className="rounded-xl border border-border bg-surface-2/55 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="text-[12px] font-bold text-text">
                                {row.invoiceNumber}
                              </div>
                              <div className="mt-1 text-[10px] text-text-muted">
                                {row.salesperson || "—"} · {methodLabel(row.paymentMethod, lang)} ·{" "}
                                {row.paymentDate || row.invoiceDate || "—"}
                              </div>
                            </div>
                            <div className="text-end">
                              <Pill tone={severityTone(row.severity)}>
                                {statusLabel(row.complianceStatus, lang)}
                              </Pill>
                              {row.variancePercent !== null && row.variancePercent > 0 && (
                                <div className="mt-1 text-[11px] font-bold tabular-nums text-danger">
                                  −{fmtPct(row.variancePercent * 100, 1)}
                                </div>
                              )}
                            </div>
                          </div>
                          <p className="mt-2 text-[11px] leading-snug text-text-muted">
                            {row.reason}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* --- rows waiting to be linked ----------------------------------- */}
      <Card>
        <SectionTitle
          hint={
            lang === "ar"
              ? "تم ربط الأكواد المطابقة تلقائيًا. الظاهر هنا فقط أكواد مركبة أو صفوف بلا كود وتحتاج مراجعة قبل اعتماد منتج أودو."
              : "Price rows with no confirmed Odoo product. Invoice lines that hit them are listed as needing a link, never as a breach."
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onResolveLinks}
                disabled={!canWrite || resolvingLinks}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-[12px] font-semibold text-text transition hover:bg-surface-2 disabled:opacity-50"
              >
                <RefreshCw
                  size={14}
                  className={resolvingLinks ? "animate-spin" : ""}
                  aria-hidden="true"
                />
                {resolvingLinks
                  ? lang === "ar"
                    ? "جارٍ الربط…"
                    : "Linking…"
                  : lang === "ar"
                    ? "ربط الأكواد تلقائيًا"
                    : "Auto-link codes"}
              </button>
              <Pill tone={data?.unlinked.total ? "warning" : "success"}>
                {fmtNum(data?.unlinked.total ?? 0)}
              </Pill>
            </div>
          }
        >
          <span className="inline-flex items-center gap-2">
            <Link2 size={16} aria-hidden="true" />
            {lang === "ar" ? "أكواد تحتاج مراجعة الربط" : "Codes needing link review"}
          </span>
        </SectionTitle>

        {!data?.unlinked.items.length && (
          <EmptyState label={lang === "ar" ? "كل الصفوف مربوطة" : "Every row is linked"} />
        )}

        {!!unlinkedGroups.length && (
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            {unlinkedGroups.slice(0, 40).map((items) => {
              const item = items[0];
              return (
                <article
                  key={`${item.id}-${item.sourceRow}`}
                  className="rounded-2xl border border-border bg-surface-2/45 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Pill tone="neutral">{item.rawProductCode || "—"}</Pill>
                      <h3 className="mt-2 line-clamp-2 text-[13px] font-semibold text-text">
                        {item.courseName || (lang === "ar" ? "بدون اسم دورة" : "Unnamed course")}
                      </h3>
                    </div>
                    <Pill tone="warning">
                      {items.length} {lang === "ar" ? "قاعدة سعر" : "price rules"}
                    </Pill>
                  </div>
                  <p className="mt-2 text-[11px] text-text-subtle">
                    {sourceLabel(item.sourceSheet, lang === "ar")} · {lang === "ar" ? "صف" : "row"}{" "}
                    {item.sourceRow}
                  </p>
                  <button
                    type="button"
                    disabled={!canWrite}
                    onClick={() => {
                      setLinking(items);
                      setProductId("");
                    }}
                    className="mt-3 min-h-10 w-full cursor-pointer rounded-xl border border-border px-3 text-[12px] font-semibold text-text transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {lang === "ar" ? "ربط الكود بمنتج أودو" : "Link code to an Odoo product"}
                  </button>
                </article>
              );
            })}
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
            <h2 className="text-[15px] font-semibold text-text">{linking[0].courseName}</h2>
            <p className="mt-1 text-[12px] text-text-muted">
              {lang === "ar"
                ? `اكتب معرّف المنتج في أودو. سيتم تطبيق الربط على ${linking.length} قاعدة سعر وتسجيله في سجل المراجعة.`
                : `Enter the Odoo product id. This link will apply to ${linking.length} price rules and be recorded in the audit log.`}
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
