import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  Info,
  ReceiptText,
  UserRoundSearch,
  Users,
} from "lucide-react";
import {
  Card,
  ErrorState,
  KpiCard,
  Notice,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import {
  DashboardPageHeader,
  DataHealthSummary,
  InsightCard,
  InsightRow,
  KpiRow,
} from "@/components/dashboard-bits";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { FilterSummary } from "@/components/ads/FilterSummary";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { PerfRow, Platform } from "@/lib/types";

export const Route = createFileRoute("/media-buyers")({ component: MediaBuyers });

interface Buyer {
  id: "sayed" | "shazly";
  name: string;
  token: string;
  campaigns: number;
  platforms: Platform[];
  spend: number;
  revenue: number;
  impressions: number;
  clicksAll: number;
  platformLeads: number | null;
  crmLeads: number;
  won: number;
  lost: number;
  invoices: number;
  salesOrders: number;
  ctrAll: number | null;
  cpl: number | null;
  cpa: number | null;
  roas: number | null;
  conversionRate: number | null;
  lostRate: number | null;
  rows: PerfRow[];
}

interface Response {
  buyers: Buyer[];
  mapping: { sayed: string; shazly: string };
  coverage: {
    assignedCampaigns: number;
    unassignedCampaigns: number;
    unassignedSpend: number;
    ambiguousCampaigns: number;
    ambiguousSpend: number;
  };
}

function metricWinner(
  buyers: Buyer[],
  key: "roas" | "conversionRate" | "revenue" | "cpl",
  lower = false,
) {
  const eligible = buyers.filter(
    (buyer) => buyer[key] !== null && Number.isFinite(Number(buyer[key])),
  );
  return eligible.sort((a, b) =>
    lower ? Number(a[key]) - Number(b[key]) : Number(b[key]) - Number(a[key]),
  )[0]?.id;
}

function MediaBuyers() {
  const reportingPeriod = useReportingPeriod();
  const { lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Response>("/api/media-buyers");
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const wins = {
    roas: metricWinner(data.buyers, "roas"),
    cpl: metricWinner(data.buyers, "cpl", true),
    conversion: metricWinner(data.buyers, "conversionRate"),
    revenue: metricWinner(data.buyers, "revenue"),
  };

  // Page-level totals: plain sums over the buyers the response returned. The
  // blended ROAS divides the summed revenue by the summed spend rather than
  // averaging the two buyers' ratios, which would weight a small account the
  // same as a large one.
  const sum = (pick: (buyer: Buyer) => number) =>
    data.buyers.reduce((total, buyer) => total + pick(buyer), 0);
  const totals = {
    spend: sum((b) => b.spend),
    revenue: sum((b) => b.revenue),
    crmLeads: sum((b) => b.crmLeads),
    won: sum((b) => b.won),
    invoices: sum((b) => b.invoices),
    campaigns: sum((b) => b.campaigns),
    get roas() {
      return this.spend > 0 ? this.revenue / this.spend : null;
    },
  };
  const totalCampaigns = data.coverage.assignedCampaigns + data.coverage.unassignedCampaigns;
  const coveragePct =
    totalCampaigns > 0 ? (data.coverage.assignedCampaigns / totalCampaigns) * 100 : null;
  const bestBuyer = data.buyers.find((buyer) => buyer.id === wins.roas) ?? null;
  const cheapestBuyer = data.buyers.find((buyer) => buyer.id === wins.cpl) ?? null;

  return (
    <div className="space-y-5">
      <DashboardPageHeader
        icon={<UserRoundSearch size={20} />}
        title={lang === "ar" ? "تقييم الميديا بايرز" : "Media buyer evaluation"}
        subtitle={
          lang === "ar"
            ? "مقارنة شفافة بين سيد وشاذلي من الصرف حتى الفاتورة، بدون درجة مخفية أو حكم غير قابل للمراجعة."
            : "A transparent Sayed vs Shazly comparison from spend to paid invoice, with no opaque score."
        }
        period={reportingPeriod}
      />
      <FilterSummary />

      {/* What the two buyers add up to. Every figure is a sum over the buyers
          the response returned — nothing is recomputed and no buyer is
          re-scored; the per-buyer comparison below is unchanged. */}
      <KpiRow columns={5}>
        <KpiCard
          index={0}
          label={lang === "ar" ? "الإنفاق المُدار" : "Managed spend"}
          value={fmtUSDFull(totals.spend)}
          tone="danger"
          icon={<BadgeDollarSign size={15} />}
          sub={
            lang === "ar"
              ? `${fmtNum(totals.campaigns)} حملة منسوبة`
              : `${fmtNum(totals.campaigns)} attributed campaigns`
          }
        />
        <KpiCard
          index={1}
          label={lang === "ar" ? "الإيراد المرتبط" : "Attributed revenue"}
          value={fmtUSDFull(totals.revenue)}
          hero
          icon={<ChartNoAxesCombined size={15} />}
          sub={
            lang === "ar"
              ? `${fmtNum(totals.invoices)} فاتورة`
              : `${fmtNum(totals.invoices)} invoices`
          }
        />
        <KpiCard
          index={2}
          label={lang === "ar" ? "متوسط ROAS" : "Blended ROAS"}
          value={totals.roas === null ? "—" : `${totals.roas.toFixed(2)}×`}
          tone={
            totals.roas === null
              ? "neutral"
              : totals.roas >= 2
                ? "success"
                : totals.roas >= 1
                  ? "warning"
                  : "danger"
          }
          icon={<ChartNoAxesCombined size={15} />}
          sub={
            lang === "ar"
              ? "الإيراد المرتبط ÷ الإنفاق المُدار"
              : "Attributed revenue ÷ managed spend"
          }
        />
        <KpiCard
          index={3}
          label={lang === "ar" ? "العملاء المحتملون" : "Leads"}
          value={fmtNum(totals.crmLeads)}
          tone="brand"
          icon={<Users size={15} />}
          sub={lang === "ar" ? `${fmtNum(totals.won)} صفقة مغلقة` : `${fmtNum(totals.won)} closed`}
        />
        <KpiCard
          index={4}
          label={lang === "ar" ? "تغطية النسبة" : "Attribution coverage"}
          value={fmtPct(coveragePct, 1)}
          tone={coveragePct !== null && coveragePct < 80 ? "warning" : "success"}
          icon={<UserRoundSearch size={15} />}
          sub={
            lang === "ar"
              ? `${fmtNum(data.coverage.unassignedCampaigns)} حملة بلا مسؤول`
              : `${fmtNum(data.coverage.unassignedCampaigns)} campaigns unassigned`
          }
        />
      </KpiRow>

      <InsightRow>
        <InsightCard
          index={0}
          kind="best"
          eyebrow={lang === "ar" ? "أفضل ميديا باير" : "Top media buyer"}
          title={
            bestBuyer
              ? bestBuyer.name
              : lang === "ar"
                ? "لا يوجد ميديا باير مؤهل"
                : "No eligible media buyer"
          }
          value={bestBuyer?.roas != null ? `${bestBuyer.roas.toFixed(2)}×` : undefined}
          detail={
            bestBuyer
              ? lang === "ar"
                ? `${fmtUSDFull(bestBuyer.revenue)} إيراد من ${fmtUSDFull(bestBuyer.spend)} إنفاق عبر ${fmtNum(bestBuyer.campaigns)} حملة`
                : `${fmtUSDFull(bestBuyer.revenue)} from ${fmtUSDFull(bestBuyer.spend)} of spend across ${fmtNum(bestBuyer.campaigns)} campaigns`
              : undefined
          }
        />
        <InsightCard
          index={1}
          kind={data.coverage.unassignedSpend > 0 ? "attention" : "opportunity"}
          eyebrow={lang === "ar" ? "صرف بلا مسؤول" : "Spend without an owner"}
          title={
            data.coverage.unassignedSpend > 0
              ? lang === "ar"
                ? "جزء من الإنفاق غير منسوب لأي ميديا باير"
                : "Part of the spend is not attributed to any buyer"
              : lang === "ar"
                ? "كل الإنفاق منسوب لمسؤول"
                : "All spend has an owner"
          }
          value={
            data.coverage.unassignedSpend > 0
              ? fmtUSDFull(data.coverage.unassignedSpend)
              : undefined
          }
          detail={
            data.coverage.unassignedSpend > 0
              ? lang === "ar"
                ? `${fmtNum(data.coverage.unassignedCampaigns)} حملة لا تحمل علامة مسؤول في اسمها، فلا تدخل في المقارنة أدناه.`
                : `${fmtNum(data.coverage.unassignedCampaigns)} campaigns carry no owner tag in their name, so they are outside the comparison below.`
              : undefined
          }
        />
        <InsightCard
          index={2}
          kind="note"
          eyebrow={lang === "ar" ? "أقل تكلفة لكل عميل" : "Best cost per lead"}
          title={
            cheapestBuyer
              ? cheapestBuyer.name
              : lang === "ar"
                ? "لا توجد تكلفة قابلة للقياس"
                : "No measurable cost per lead"
          }
          value={cheapestBuyer?.cpl != null ? fmtUSDFull(cheapestBuyer.cpl) : undefined}
          detail={
            cheapestBuyer
              ? lang === "ar"
                ? `${fmtNum(cheapestBuyer.crmLeads)} عميل في أودو من ${fmtUSDFull(cheapestBuyer.spend)} إنفاق`
                : `${fmtNum(cheapestBuyer.crmLeads)} Odoo leads from ${fmtUSDFull(cheapestBuyer.spend)} of spend`
              : undefined
          }
        />
      </InsightRow>

      <div className="grid gap-4 xl:grid-cols-2">
        {data.buyers.map((buyer, buyerIndex) => (
          <Card
            key={buyer.id}
            className="overflow-hidden border-t-4"
            style={{ borderTopColor: buyer.id === "sayed" ? "#1E40AF" : "#D97706" }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-text">{buyer.name}</h2>
                  <Pill tone="brand">{buyer.token}</Pill>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {buyer.campaigns} {lang === "ar" ? "حملة" : "campaigns"} ·{" "}
                  {buyer.platforms.join(" + ") || "—"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {wins.roas === buyer.id && (
                  <Pill tone="success">{lang === "ar" ? "أفضل عائد" : "Best ROAS"}</Pill>
                )}
                {wins.cpl === buyer.id && (
                  <Pill tone="success">{lang === "ar" ? "أقل تكلفة ليد" : "Best CPL"}</Pill>
                )}
                {wins.conversion === buyer.id && (
                  <Pill tone="success">{lang === "ar" ? "أفضل إغلاق" : "Best conversion"}</Pill>
                )}
                {wins.revenue === buyer.id && (
                  <Pill tone="success">{lang === "ar" ? "أعلى إيراد" : "Top revenue"}</Pill>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiCard
                index={buyerIndex * 4}
                label={lang === "ar" ? "الإنفاق" : "Spend"}
                value={fmtUSDFull(buyer.spend)}
                icon={<BadgeDollarSign size={15} />}
              />
              <KpiCard
                index={buyerIndex * 4 + 1}
                label={lang === "ar" ? "ليدز المنصة" : "Platform leads"}
                value={buyer.platformLeads === null ? "—" : fmtNum(buyer.platformLeads)}
                icon={<Users size={15} />}
              />
              <KpiCard
                index={buyerIndex * 4 + 2}
                label={lang === "ar" ? "الفواتير" : "Invoices"}
                value={fmtNum(buyer.invoices)}
                sub={`${fmtNum(buyer.salesOrders)} ${lang === "ar" ? "أمر بيع" : "sales orders"}`}
                icon={<ReceiptText size={15} />}
              />
              <KpiCard
                index={buyerIndex * 4 + 3}
                label={lang === "ar" ? "الإيراد" : "Revenue"}
                value={fmtUSDFull(buyer.revenue)}
                hero
                icon={<ChartNoAxesCombined size={15} />}
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label="ROAS" value={buyer.roas === null ? "—" : `${buyer.roas.toFixed(2)}×`} />
              <Mini label="CPL" value={fmtUSDFull(buyer.cpl)} />
              <Mini label="CPA" value={fmtUSDFull(buyer.cpa)} />
              <Mini label="CTR (all)" value={fmtPct(buyer.ctrAll, 2)} />
              <Mini
                label={lang === "ar" ? "ليدز أودو" : "Odoo leads"}
                value={fmtNum(buyer.crmLeads)}
              />
              <Mini label={lang === "ar" ? "مغلقة" : "Won"} value={fmtNum(buyer.won)} />
              <Mini label={lang === "ar" ? "ضائعة" : "Lost"} value={fmtNum(buyer.lost)} />
              <Mini
                label={lang === "ar" ? "نسبة الإغلاق" : "Conversion"}
                value={fmtPct(buyer.conversionRate, 2)}
              />
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <SectionTitle>
          {lang === "ar" ? "فحص دقة توزيع الحملات" : "Campaign ownership coverage"}
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Mini
            label={lang === "ar" ? "حملات منسوبة" : "Assigned campaigns"}
            value={fmtNum(data.coverage.assignedCampaigns)}
          />
          <Mini
            label={lang === "ar" ? "حملات غير منسوبة" : "Unassigned campaigns"}
            value={fmtNum(data.coverage.unassignedCampaigns)}
          />
          <Mini
            label={lang === "ar" ? "صرف غير منسوب" : "Unassigned spend"}
            value={fmtUSDFull(data.coverage.unassignedSpend)}
          />
          <Mini
            label={lang === "ar" ? "أسماء ملتبسة" : "Ambiguous names"}
            value={fmtNum(data.coverage.ambiguousCampaigns)}
          />
        </div>
      </Card>

      <DataHealthSummary
        issues={[
          {
            tone: data.coverage.unassignedCampaigns > 0 ? "warning" : "info",
            message:
              lang === "ar"
                ? "نسبة الحملات للميديا بايرز تُقرأ من اسم الحملة نفسه."
                : "Campaign ownership is read from the campaign name itself.",
            impact:
              data.coverage.unassignedCampaigns > 0
                ? lang === "ar"
                  ? `${fmtNum(data.coverage.unassignedCampaigns)} حملة و${fmtUSDFull(data.coverage.unassignedSpend)} إنفاق خارج المقارنة أدناه.`
                  : `${fmtNum(data.coverage.unassignedCampaigns)} campaigns and ${fmtUSDFull(data.coverage.unassignedSpend)} of spend sit outside the comparison below.`
                : undefined,
            technical:
              lang === "ar"
                ? `SAYED = سيد، وSH ككلمة مستقلة = شاذلي. أسماء ملتبسة: ${fmtNum(data.coverage.ambiguousCampaigns)} · إنفاق ملتبس: ${fmtUSDFull(data.coverage.ambiguousSpend)}.`
                : `SAYED maps to Sayed and standalone SH maps to Shazly. Ambiguous names: ${fmtNum(data.coverage.ambiguousCampaigns)} · ambiguous spend: ${fmtUSDFull(data.coverage.ambiguousSpend)}.`,
          },
        ]}
      />

      {data.buyers.map((buyer) => (
        <Card key={`${buyer.id}-campaigns`} padded={false} className="overflow-hidden">
          <div className="p-4 sm:p-5">
            <SectionTitle>
              {lang === "ar" ? `حملات ${buyer.name}` : `${buyer.name} campaigns`}
            </SectionTitle>
          </div>
          <div className="table-wrap scroll-hint-x">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-surface-2 text-xs text-text-muted">
                <tr>
                  {[
                    lang === "ar" ? "الحملة" : "Campaign",
                    lang === "ar" ? "المنصة" : "Platform",
                    lang === "ar" ? "الإنفاق" : "Spend",
                    lang === "ar" ? "ليدز المنصة" : "Platform leads",
                    "CPL",
                    "CTR",
                    lang === "ar" ? "الفواتير" : "Invoices",
                    lang === "ar" ? "أوامر البيع" : "Sales orders",
                    lang === "ar" ? "الإيراد" : "Revenue",
                    "ROAS",
                  ].map((h) => (
                    <th key={h} className="px-3 py-3 text-start font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {buyer.rows.map((row) => (
                  <tr key={row.key} className="hover:bg-surface-2/60">
                    <td className="max-w-[280px] px-3 py-3 font-medium text-text">
                      <span className="block truncate" title={row.campaignName}>
                        {row.campaignName || row.name}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-text-muted">
                      {row.platforms.join(" + ") || "—"}
                    </td>
                    <td className="num px-3 py-3">{fmtUSDFull(row.spend)}</td>
                    <td className="num px-3 py-3">
                      {row.platformLeads === null ? "—" : fmtNum(row.platformLeads)}
                    </td>
                    <td className="num px-3 py-3">{fmtUSDFull(row.cpl)}</td>
                    <td className="num px-3 py-3">{fmtPct(row.ctrAll, 2)}</td>
                    <td className="num px-3 py-3">{fmtNum(row.invoices)}</td>
                    <td className="num px-3 py-3">{fmtNum(row.salesOrders)}</td>
                    <td className="num px-3 py-3">{fmtUSDFull(row.revenue)}</td>
                    <td className="num px-3 py-3">
                      {row.roas === null ? "—" : `${row.roas.toFixed(2)}×`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="num mt-1 text-base font-semibold text-text">{value}</div>
    </div>
  );
}
