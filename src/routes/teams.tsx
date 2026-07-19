import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { Card, ErrorState, PageHeader, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import { CloseTime, CountPct } from "@/components/metric-bits";
import type { DataHealth, Maybe, TeamAgg, Totals } from "@/lib/types";

export const Route = createFileRoute("/teams")({ component: Teams });

interface Resp {
  teams: TeamAgg[];
  leaderboard: TeamAgg[];
  needsAttention: TeamAgg[];
  medianConversion: number;
  totals: Totals;
  health: DataHealth;
}

const EM = "—";
const maybe = (n: Maybe, fmt: (v: number) => string) =>
  n === null || !isFinite(n) ? <span className="text-text-subtle">{EM}</span> : fmt(n);

function Teams() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/teams");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("teams")}
        subtitle={
          lang === "ar"
            ? "الإيراد يُنسب عبر مندوب المبيعات ثم يُجمَّع للفريق، لأن عمود الفريق فارغ في أغلب صفوف الفواتير."
            : "Revenue is attributed through the salesperson then rolled up, because the team column is empty on most invoice rows."
        }
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <SectionTitle hint={lang === "ar" ? "٢٠ عميلاً فأكثر" : "20+ leads"}>
                {lang === "ar" ? "الأفضل تحويلاً" : "Top converters"}
              </SectionTitle>
              <PeopleList rows={data.leaderboard} tone="success" />
            </Card>
            <Card>
              <SectionTitle
                hint={
                  lang === "ar"
                    ? `٥٠ عميلاً فأكثر بنسبة إغلاق تحت الوسيط (${fmtPct(data.medianConversion, 1)})`
                    : `50+ leads with conversion below the median (${fmtPct(data.medianConversion, 1)})`
                }
              >
                {lang === "ar" ? "يحتاج متابعة" : "Needs attention"}
              </SectionTitle>
              <PeopleList rows={data.needsAttention} tone="danger" />
            </Card>
          </div>

          <Card padded={false}>
            <div className="p-4 sm:p-5 border-b border-border">
              <SectionTitle className="mb-0">{t("by_team")}</SectionTitle>
            </div>
            <div className="table-wrap" style={{ maxHeight: 620 }}>
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="sticky top-0 z-10">
                  <tr>
                    {[
                      t("team"),
                      t("crm_leads"),
                      t("won"),
                      t("lost_count"),
                      t("revenue"),
                      t("aov"),
                      t("revenue_per_lead"),
                      t("avg_close_time"),
                    ].map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide bg-surface-2 border-b border-border whitespace-nowrap text-text-muted ${
                          i === 0 ? "text-start sticky-col z-20" : "text-end"
                        }`}
                        style={i === 0 ? { background: "var(--surface-2)", width: 200 } : undefined}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.teams.map((team) => {
                    const isOpen = open.has(team.key);
                    return (
                      <Fragment key={team.key}>
                        <tr onClick={() => toggle(team.key)} className="group cursor-pointer">
                          <Cell sticky>
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} className="rtl:rotate-180" />}
                              <span className="truncate max-w-[150px]" title={team.name}>
                                {team.name}
                              </span>
                              <Pill tone="neutral">{team.people?.length ?? 0}</Pill>
                            </span>
                          </Cell>
                          <Cell align>{fmtNum(team.crmLeads)}</Cell>
                          <Cell align>
                            <CountPct count={team.won} pct={team.conversionRate} />
                          </Cell>
                          <Cell align>
                            <CountPct count={team.lost} pct={team.lostRate} />
                          </Cell>
                          <Cell align>{fmtUSD(team.revenue)}</Cell>
                          <Cell align>{maybe(team.avgOrder, fmtUSD)}</Cell>
                          <Cell align>{maybe(team.revenuePerLead, fmtUSDFull)}</Cell>
                          <Cell align>
                            <CloseTime days={team.avgCloseDays} sample={team.closeSample} inline />
                          </Cell>
                        </tr>
                        {isOpen &&
                          (team.people ?? []).map((p) => (
                            <tr key={team.key + p.key} className="group">
                              <Cell sticky>
                                <span className="ps-6 text-text-muted truncate block max-w-[170px]" title={p.name}>
                                  {p.name}
                                </span>
                              </Cell>
                              <Cell align muted>
                                {fmtNum(p.crmLeads)}
                              </Cell>
                              <Cell align muted>
                                <CountPct count={p.won} pct={p.conversionRate} />
                              </Cell>
                              <Cell align muted>
                                <CountPct count={p.lost} pct={p.lostRate} />
                              </Cell>
                              <Cell align muted>
                                {fmtUSD(p.revenue)}
                              </Cell>
                              <Cell align muted>
                                {maybe(p.avgOrder, fmtUSD)}
                              </Cell>
                              <Cell align muted>
                                {maybe(p.revenuePerLead, fmtUSDFull)}
                              </Cell>
                              <Cell align muted>
                                <CloseTime days={p.avgCloseDays} sample={p.closeSample} inline />
                              </Cell>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Cell({
  children,
  align,
  sticky,
  muted,
}: {
  children: React.ReactNode;
  align?: boolean;
  sticky?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2.5 border-b border-border align-middle bg-surface group-hover:bg-brand-soft transition-colors ${
        align ? "text-end num whitespace-nowrap" : ""
      } ${sticky ? "sticky-col" : ""} ${muted ? "text-text-muted" : ""}`}
    >
      {children}
    </td>
  );
}

function PeopleList({ rows, tone }: { rows: TeamAgg[]; tone: "success" | "danger" }) {
  const { t, lang } = useI18n();
  if (!rows.length) return <p className="text-sm text-text-muted py-4">{t("no_data")}</p>;
  return (
    <ol className="space-y-2">
      {rows.map((p, i) => (
        <li key={p.key} className="flex items-center justify-between gap-3 py-1.5 border-b border-border/60 last:border-0">
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="num text-[11px] text-text-subtle w-4 shrink-0">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[13px] truncate" title={p.name}>
                {p.name}
              </span>
              <span className="block text-[11px] text-text-muted">
                {p.parent} · {fmtNum(p.crmLeads)} {lang === "ar" ? "عميل" : "leads"}
              </span>
            </span>
          </span>
          <Pill tone={tone}>{fmtPct(p.conversionRate, 1)}</Pill>
        </li>
      ))}
    </ol>
  );
}
