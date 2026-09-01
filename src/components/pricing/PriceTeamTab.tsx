import { useMemo } from "react";
import { AlertTriangle, BellRing, ChevronLeft, ShieldCheck, UsersRound } from "lucide-react";
import { Card, EmptyState, Pill, Skeleton } from "@/components/ui-bits";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import { bandText, type CatalogEntry } from "./pricing-ui";
import type { ComplianceResponse } from "./PriceComplianceTab";

export function PriceTeamTab({
  data,
  catalog,
  loading,
  onOpenSalesperson,
  onSendDigest,
  sending,
  canWrite,
}: {
  data?: ComplianceResponse;
  catalog?: CatalogEntry[];
  loading: boolean;
  onOpenSalesperson: (salesperson: string) => void;
  onSendDigest: () => void;
  sending: boolean;
  canWrite: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  const incentives = useMemo(
    () =>
      (catalog ?? [])
        .flatMap((entry) =>
          entry.prices
            .filter((price) => price.active && price.scope === "incentive")
            .map((price) => ({ entry, price })),
        )
        .slice(0, 18),
    [catalog],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-text">
              <UsersRound size={18} className="text-brand" aria-hidden="true" />
              <h2 className="text-[16px] font-bold">
                {ar ? "الالتزام حسب موظف المبيعات" : "Compliance by salesperson"}
              </h2>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              {ar
                ? "مرتب حسب قيمة الفارق. افتح الموظف لمراجعة فواتيره المخالفة."
                : "Ordered by price gap. Open a salesperson to review their breached invoices."}
            </p>
          </div>
          <button
            type="button"
            onClick={onSendDigest}
            disabled={!canWrite || sending}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-[12px] font-semibold text-text transition hover:bg-surface-2 disabled:opacity-50"
          >
            <BellRing size={14} aria-hidden="true" />
            {sending
              ? ar
                ? "جارٍ الإرسال…"
                : "Sending…"
              : ar
                ? "إرسال ملخص المخالفات"
                : "Send breach digest"}
          </button>
        </div>

        {loading && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        )}

        {!loading && !data?.bySalesperson.length && (
          <div className="p-4">
            <EmptyState
              label={ar ? "لا توجد مخالفات مسجلة على الموظفين" : "No salesperson breaches found"}
            />
          </div>
        )}

        {!loading && !!data?.bySalesperson.length && (
          <div className="divide-y divide-border">
            {data.bySalesperson.map((row, index) => {
              const compliance = row.lines ? Math.max(0, 1 - row.breaches / row.lines) : 1;
              const severe = compliance < 0.75;
              return (
                <article key={row.salesperson} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`grid size-8 place-items-center rounded-full text-[11px] font-black ${
                            severe ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <h3 className="truncate text-[14px] font-bold text-text">
                          {row.salesperson}
                        </h3>
                        <Pill tone={severe ? "danger" : "warning"}>
                          {fmtPct(compliance * 100, 0)} {ar ? "التزام" : "compliance"}
                        </Pill>
                      </div>
                      <p className="mt-2 text-[11px] text-text-muted">
                        {fmtNum(row.lines)} {ar ? "بند مفحوص" : "audited lines"} ·{" "}
                        {fmtNum(row.breaches)} {ar ? "تحت الحد الأدنى" : "below the floor"}
                      </p>
                    </div>
                    <div className="text-end">
                      <div
                        className={`text-[20px] font-black tabular-nums ${severe ? "text-danger" : "text-warning"}`}
                      >
                        {fmtNum(Math.round(row.leakage))}
                      </div>
                      <div className="text-[10px] text-text-subtle">
                        {ar ? "قيمة فارق مجمعة" : "aggregate price gap"}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${severe ? "bg-danger" : "bg-warning"}`}
                      style={{ width: `${Math.max(4, compliance * 100)}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenSalesperson(row.salesperson)}
                    className="mt-3 inline-flex min-h-9 items-center gap-1 text-[12px] font-bold text-brand hover:underline"
                  >
                    {ar ? "فتح فواتير الموظف" : "Open salesperson invoices"}
                    <ChevronLeft size={14} className="rtl:rotate-0" aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="self-start overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            {incentives.length ? (
              <ShieldCheck size={17} className="text-success" aria-hidden="true" />
            ) : (
              <AlertTriangle size={17} className="text-warning" aria-hidden="true" />
            )}
            <h2 className="text-[15px] font-bold text-text">
              {ar ? "قواعد الحافز المنشورة" : "Published incentive rules"}
            </h2>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            {ar
              ? "مرجع سريع للحوافز المرتبطة بالبيع داخل السعر المعتمد."
              : "Quick reference for incentives attached to approved pricing."}
          </p>
        </div>
        {!incentives.length ? (
          <div className="p-4">
            <EmptyState label={ar ? "لا توجد قواعد حافز منشورة" : "No incentive rules published"} />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {incentives.map(({ entry, price }) => (
              <div key={price.id} className="px-5 py-3">
                <div className="text-[12px] font-semibold text-text">{entry.courseName}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-text-muted">
                    {price.note || (ar ? "حافز بيع" : "Sales incentive")}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-success">
                    {bandText(price, lang)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
