import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import type { Maybe, PerfRow } from "@/lib/types";
import { DataTable, type Col } from "./DataTable";
import {
  AcosPill,
  AdSetOriginBadge,
  CountPct,
  InferredCourse,
  PlatformBadges,
  RoasCell,
} from "./metric-bits";

const EM = "—";
const maybeNum = (n: Maybe, fmt: (v: number) => string) =>
  n === null || !isFinite(n) ? <span className="text-text-subtle">{EM}</span> : fmt(n);
/** Sort keys must be numbers; nulls sink to the bottom in either direction. */
const sortMaybe = (n: Maybe) => (n === null || !isFinite(n) ? -Infinity : n);

export function PerfTable({
  rows,
  unknownAdsetKey,
  grain,
  onRowClick,
  csvFilename,
}: {
  rows: PerfRow[];
  unknownAdsetKey?: string;
  grain: "campaign" | "adset" | "ad";
  onRowClick?: (r: PerfRow) => void;
  csvFilename: string;
}) {
  const { t, lang } = useI18n();

  const nameOf = (r: PerfRow) =>
    r.key === unknownAdsetKey ? t("unknown_adset") : r.name || EM;

  const cols: Col<PerfRow>[] = [
    {
      key: "name",
      header: grain === "campaign" ? t("campaign") : grain === "adset" ? t("ad_set") : t("ad_name"),
      sticky: true,
      width: "220px",
      sortValue: (r) => nameOf(r),
      render: (r) => (
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`truncate max-w-[200px] ${r.key === unknownAdsetKey ? "text-text-muted italic" : ""}`}
            title={nameOf(r)}
          >
            {nameOf(r)}
          </span>
          {grain === "adset" && r.key !== unknownAdsetKey && <AdSetOriginBadge origin={r.adsetOrigin} />}
        </div>
      ),
    },
    {
      key: "platform",
      header: t("platform"),
      sortValue: (r) => r.platforms.join(","),
      render: (r) => <PlatformBadges platforms={r.platforms} />,
    },
    {
      key: "course",
      header: t("course"),
      sortValue: (r) => r.course,
      render: (r) => <InferredCourse course={r.course} inferred={r.courseInferred} />,
    },
    { key: "spend", header: t("spend"), align: "right", sortValue: (r) => r.spend, render: (r) => fmtUSD(r.spend) },
    {
      key: "impressions",
      header: t("impressions"),
      align: "right",
      sortValue: (r) => r.impressions,
      render: (r) => fmtNum(r.impressions),
    },
    { key: "clicks", header: t("clicks"), align: "right", sortValue: (r) => r.clicksAll, render: (r) => fmtNum(r.clicksAll) },
    {
      key: "ctrAll",
      header: t("ctr_all"),
      align: "right",
      sortValue: (r) => sortMaybe(r.ctrAll),
      render: (r) => maybeNum(r.ctrAll, (v) => fmtPct(v, 2)),
    },
    {
      key: "ctrLink",
      header: t("ctr_link"),
      align: "right",
      sortValue: (r) => sortMaybe(r.ctrLink),
      // Snapchat does not report link clicks; this stays an em dash, never 0.
      render: (r) => maybeNum(r.ctrLink, (v) => fmtPct(v, 2)),
    },
    {
      key: "platformLeads",
      header: t("platform_leads"),
      align: "right",
      sortValue: (r) => sortMaybe(r.platformLeads),
      render: (r) => maybeNum(r.platformLeads, fmtNum),
    },
    { key: "crmLeads", header: t("crm_leads"), align: "right", sortValue: (r) => r.crmLeads, render: (r) => fmtNum(r.crmLeads) },
    {
      key: "won",
      header: t("won"),
      align: "right",
      sortValue: (r) => r.won,
      render: (r) => <CountPct count={r.won} pct={r.conversionRate} />,
    },
    {
      key: "lost",
      header: t("lost_count"),
      align: "right",
      sortValue: (r) => r.lost,
      render: (r) => <CountPct count={r.lost} pct={r.lostRate} />,
    },
    { key: "revenue", header: t("revenue"), align: "right", sortValue: (r) => r.revenue, render: (r) => fmtUSD(r.revenue) },
    {
      key: "revenuePerLead",
      header: t("revenue_per_lead"),
      align: "right",
      sortValue: (r) => sortMaybe(r.revenuePerLead),
      render: (r) => maybeNum(r.revenuePerLead, fmtUSDFull),
    },
    {
      key: "cpl",
      header: t("cpl"),
      align: "right",
      sortValue: (r) => sortMaybe(r.cpl),
      render: (r) => maybeNum(r.cpl, fmtUSDFull),
    },
    {
      key: "cpa",
      header: t("cpa"),
      align: "right",
      sortValue: (r) => sortMaybe(r.cpa),
      render: (r) => maybeNum(r.cpa, fmtUSDFull),
    },
    {
      key: "roas",
      header: t("roas"),
      align: "right",
      sortValue: (r) => sortMaybe(r.roas),
      render: (r) => (
        <RoasCell
          roas={r.roas}
          spend={r.spend}
          partialSpend={r.partialSpend}
          spendDateMin={r.spendDateMin}
          spendDateMax={r.spendDateMax}
        />
      ),
    },
    {
      key: "acos",
      header: t("acos"),
      align: "right",
      sortValue: (r) => sortMaybe(r.acos),
      render: (r) => <AcosPill acos={r.acos} />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      cols={cols}
      searchable={(r) => `${nameOf(r)} ${r.course}`}
      initialSort={{ key: "spend", dir: -1 }}
      onRowClick={onRowClick}
      csvFilename={csvFilename}
      maxHeight={620}
      csvRow={(r) => ({
        [lang === "ar" ? "الاسم" : "name"]: nameOf(r),
        platform: r.platforms.join("|"),
        course: r.course,
        course_inferred: r.courseInferred ? "yes" : "no",
        adset_origin: r.adsetOrigin ?? "",
        spend: r.spend.toFixed(2),
        impressions: r.impressions,
        clicks: r.clicksAll,
        link_clicks: r.linkClicks ?? "",
        ctr_all: r.ctrAll?.toFixed(4) ?? "",
        ctr_link: r.ctrLink?.toFixed(4) ?? "",
        platform_leads: r.platformLeads ?? "",
        crm_leads: r.crmLeads,
        won: r.won,
        conversion_rate: r.conversionRate?.toFixed(2) ?? "",
        lost: r.lost,
        lost_rate: r.lostRate?.toFixed(2) ?? "",
        revenue: r.revenue.toFixed(2),
        revenue_per_lead: r.revenuePerLead?.toFixed(2) ?? "",
        cpl: r.cpl?.toFixed(2) ?? "",
        cpa: r.cpa?.toFixed(2) ?? "",
        roas: r.roas?.toFixed(4) ?? "",
        acos: r.acos?.toFixed(2) ?? "",
        spend_from: r.spendDateMin,
        spend_to: r.spendDateMax,
        partial_spend: r.partialSpend ? "yes" : "no",
      })}
    />
  );
}
