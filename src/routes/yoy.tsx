import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarOff } from "lucide-react";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { Card, ErrorState, EmptyState, PageHeader, SectionTitle, Skeleton } from "@/components/ui-bits";
import type { DataHealth, Maybe, YoyPoint, YoyResult } from "@/lib/types";

export const Route = createFileRoute("/yoy")({ component: Yoy });

interface Resp extends YoyResult {
  years: number[];
  rowsPerYear: { year: number; ads: number; crm: number; invoiced: number; sales: number }[];
  health: DataHealth;
}

const MONTHS = {
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

function Yoy() {
  const { t, lang } = useI18n();
  // Year-over-year is a property of the whole sheet, not of the active window,
  // so this endpoint deliberately ignores the global filters.
  const { data, isLoading, error, refetch } = useQuery<Resp>({
    queryKey: ["yoy"],
    queryFn: async () => {
      const res = await fetch("/api/yoy");
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("yoy")}
        subtitle={data ? `${data.currentYear} ${lang === "ar" ? "مقابل" : "vs"} ${data.previousYear}` : undefined}
      />

      {isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : !data.available ? (
        <>
          <Card>
            <div className="py-8 text-center">
              <CalendarOff size={30} className="text-text-subtle mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm font-medium text-text mb-1">
                {lang === "ar"
                  ? `لا توجد بيانات كافية لعام ${data.previousYear}`
                  : `Not enough ${data.previousYear} data`}
              </p>
              <p className="text-xs text-text-muted max-w-md mx-auto leading-relaxed">{t("yoy_empty")}</p>
            </div>
          </Card>

          <Card>
            <SectionTitle hint={lang === "ar" ? "تغطية البيانات المتاحة لكل عام" : "Available data coverage per year"}>
              {lang === "ar" ? "تغطية البيانات" : "Data coverage"}
            </SectionTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[460px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="text-start py-2">{lang === "ar" ? "العام" : "Year"}</th>
                    <th className="text-end py-2">{lang === "ar" ? "إعلانات" : "Ads"}</th>
                    <th className="text-end py-2">{t("crm_leads")}</th>
                    <th className="text-end py-2">{t("full_invoiced")}</th>
                    <th className="text-end py-2">{t("sales")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rowsPerYear.map((r) => (
                    <tr key={r.year} className="border-t border-border">
                      <td className="py-2.5 num font-medium">{r.year}</td>
                      <td className="py-2.5 text-end num">{fmtNum(r.ads)}</td>
                      <td className="py-2.5 text-end num">{fmtNum(r.crm)}</td>
                      <td className="py-2.5 text-end num">{fmtNum(r.invoiced)}</td>
                      <td className="py-2.5 text-end num">{fmtNum(r.sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-text-muted mt-3 leading-relaxed">
              {lang === "ar"
                ? "لن تُعرض أي نسبة نمو مقابل أساس صفري — الرقم في تلك الحالة بلا معنى، لذلك تظهر شرطة."
                : "No growth percentage is rendered against a zero baseline — that number is meaningless, so it shows an em dash."}
            </p>
          </Card>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {data.ytd.map((m) => (
              <Card key={m.metric}>
                <div className="text-[11px] uppercase tracking-wide text-text-muted">{m.metric}</div>
                <div className="num text-xl font-semibold mt-1">
                  {m.metric === "spend" || m.metric === "revenue" ? fmtUSD(m.current) : fmtNum(m.current)}
                </div>
                <div className="text-[11px] text-text-muted mt-1">
                  {data.previousYear}:{" "}
                  {m.metric === "spend" || m.metric === "revenue" ? fmtUSD(m.previous) : fmtNum(m.previous)}
                </div>
                <Growth value={m.growth} />
              </Card>
            ))}
          </div>

          <MonthTable title={t("spend")} points={data.spend} money />
          <MonthTable title={t("revenue")} points={data.revenue} money />
          <MonthTable title={t("crm_leads")} points={data.leads} />
          <MonthTable title={t("won")} points={data.won} />

          <Card>
            <SectionTitle>{t("by_course")}</SectionTitle>
            {data.byCourse.length === 0 ? (
              <EmptyState label={t("no_data")} compact />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[460px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                      <th className="text-start py-2">{t("course")}</th>
                      <th className="text-end py-2">{data.currentYear}</th>
                      <th className="text-end py-2">{data.previousYear}</th>
                      <th className="text-end py-2">{t("growth")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCourse.slice(0, 20).map((c) => (
                      <tr key={c.key} className="border-t border-border">
                        <td className="py-2.5">{c.key}</td>
                        <td className="py-2.5 text-end num">{fmtUSD(c.current)}</td>
                        <td className="py-2.5 text-end num">{fmtUSD(c.previous)}</td>
                        <td className="py-2.5 text-end">
                          <Growth value={c.growth} inline />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function MonthTable({ title, points, money }: { title: string; points: YoyPoint[]; money?: boolean }) {
  const { lang } = useI18n();
  const fmt = money ? fmtUSD : fmtNum;
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted">
              <th className="text-start py-2">{lang === "ar" ? "الشهر" : "Month"}</th>
              <th className="text-end py-2">{lang === "ar" ? "الحالي" : "Current"}</th>
              <th className="text-end py-2">{lang === "ar" ? "السابق" : "Previous"}</th>
              <th className="text-end py-2">{lang === "ar" ? "الفرق" : "Delta"}</th>
              <th className="text-end py-2">%</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={p.key} className="border-t border-border">
                <td className="py-2">{MONTHS[lang][i]}</td>
                <td className="py-2 text-end num">{fmt(p.current)}</td>
                <td className="py-2 text-end num">{fmt(p.previous)}</td>
                <td className="py-2 text-end num">{fmt(p.delta)}</td>
                <td className="py-2 text-end">
                  <Growth value={p.growth} inline />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** An em dash where the baseline was zero — a growth % there is not a fact. */
function Growth({ value, inline }: { value: Maybe; inline?: boolean }) {
  if (value === null || !isFinite(value))
    return <span className={`text-text-subtle num ${inline ? "" : "block mt-1 text-[11px]"}`}>—</span>;
  const good = value >= 0;
  return (
    <span
      className={`num font-semibold ${inline ? "text-[13px]" : "block mt-1 text-[11px]"}`}
      style={{ color: good ? "var(--success)" : "var(--danger)" }}
    >
      {good ? "+" : ""}
      {fmtPct(value, 1)}
    </span>
  );
}
