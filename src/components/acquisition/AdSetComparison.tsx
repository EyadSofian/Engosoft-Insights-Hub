import { Layers } from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import { PageSection } from "@/components/dashboard-bits";
import type { GrainRow } from "@/lib/closed-loop";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import type { ClosedLoopResponse } from "./ClosedLoop";

/** Compare audiences through their Ad Set results, never by a reused label alone. */
export function AdSetComparison({
  data,
  loading,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const rows = data?.grains?.adset ?? [];
  const spendAvailable = data?.kpis?.metaSpend ? data.kpis.metaSpend.status === "ok" : true;
  const pending = A ? "بانتظار المزامنة" : "Pending sync";
  const cols: Col<GrainRow>[] = [
    {
      key: "adset",
      header: "Ad Set",
      minWidth: "260px",
      sticky: true,
      always: true,
      render: (row) => (
        <div className="min-w-0">
          <bdi
            dir="auto"
            className="block max-w-[300px] truncate font-semibold text-text"
            title={row.adsetName || row.adsetId}
          >
            {row.adsetName || `ID ${row.adsetId}`}
          </bdi>
          <span className="font-mono text-[10px] text-text-muted">{row.adsetId}</span>
        </div>
      ),
      sortValue: (row) => row.adsetName || row.adsetId,
    },
    {
      key: "campaign",
      header: A ? "الحملة" : "Campaign",
      minWidth: "210px",
      render: (row) => (
        <bdi dir="auto" className="block max-w-[250px] truncate" title={row.campaignName}>
          {row.campaignName || "—"}
        </bdi>
      ),
      sortValue: (row) => row.campaignName,
    },
    {
      key: "spend",
      header: A ? "الصرف" : "Spend",
      align: "right",
      render: (row) => (spendAvailable ? fmtUSD(row.spend) : pending),
      sortValue: (row) => row.spend,
    },
    {
      key: "leads",
      header: A ? "الليدز" : "Leads",
      align: "right",
      render: (row) => fmtNum(row.leads),
      sortValue: (row) => row.leads,
    },
    {
      key: "cpl",
      header: A ? "سعر الليد" : "CPL",
      align: "right",
      render: (row) => (spendAvailable ? (row.cpl === null ? "—" : fmtUSD(row.cpl)) : pending),
      sortValue: (row) => row.cpl ?? -1,
    },
    {
      key: "qualified",
      header: A ? "مؤهل" : "Qualified",
      align: "right",
      render: (row) => fmtNum(row.qualified),
      sortValue: (row) => row.qualified,
    },
    {
      key: "won",
      header: A ? "البيع" : "Won",
      align: "right",
      render: (row) => fmtNum(row.won),
      sortValue: (row) => row.won,
    },
    {
      key: "lost",
      header: A ? "اللوست" : "Lost",
      align: "right",
      render: (row) => fmtNum(row.lost),
      sortValue: (row) => row.lost,
    },
    {
      key: "conversion",
      header: A ? "التحويل" : "Conversion",
      align: "right",
      render: (row) => (row.leads ? fmtPct((row.won / row.leads) * 100, 1) : "—"),
      sortValue: (row) => (row.leads ? row.won / row.leads : -1),
    },
    {
      key: "revenue",
      header: A ? "المبيعات" : "Revenue",
      align: "right",
      render: (row) => fmtUSD(row.revenue),
      sortValue: (row) => row.revenue,
    },
    {
      key: "roas",
      header: "ROAS",
      align: "right",
      render: (row) =>
        spendAvailable ? (row.roas === null ? "—" : `${row.roas.toFixed(2)}×`) : pending,
      sortValue: (row) => row.roas ?? -1,
    },
  ];
  return (
    <PageSection
      title={A ? "مقارنة Ad Sets" : "Ad Set comparison"}
      icon={<Layers size={16} />}
      tone="violet"
      hint={
        A
          ? "قارن الـaudiences من نتائج كل Ad Set بمعرّفه، حتى لو الأسماء متشابهة. الليدز دقيقة فقط؛ نسبة التحويل = البيع ÷ الليدز. إعدادات استهداف الجمهور نفسها غير معروضة في المصدر الحالي."
          : "Compare audiences by each Ad Set's exact ID, even when names match. Leads are exact acquisitions; conversion = wins / leads. Targeting settings are not available in this source."
      }
    >
      <DataTable
        rows={rows}
        cols={cols}
        loading={loading}
        defaultVisibleLimit={11}
        initialSort={{ key: "spend", dir: -1 }}
        searchable={(row) => `${row.adsetName} ${row.adsetId} ${row.campaignName}`}
        rowKey={(row) => row.key}
        csvFilename="engosoft-adset-comparison"
      />
    </PageSection>
  );
}
