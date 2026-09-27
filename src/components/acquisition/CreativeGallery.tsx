import { useMemo, useState } from "react";
import { Image as ImageIcon, LayoutGrid, PlayCircle, Table2 } from "lucide-react";
import { PageSection } from "@/components/dashboard-bits";
import { Card, Segmented } from "@/components/ui-bits";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import type { ClosedLoopResponse } from "./ClosedLoop";

/**
 * Materials by Ad ID: the ad's name and media first, then the same figures as
 * the table. A reused creative asset never merges two different ads here.
 */

type SortKey = "revenue" | "roas" | "won" | "qualificationRate" | "leads" | "cpl";

const SORTS: { value: SortKey; en: string; ar: string }[] = [
  { value: "revenue", en: "Most revenue", ar: "الأعلى إيرادًا" },
  { value: "roas", en: "Highest ROAS", ar: "الأعلى عائدًا" },
  { value: "won", en: "Most won", ar: "الأكثر فوزًا" },
  { value: "qualificationRate", en: "Highest qualification rate", ar: "الأعلى تأهيلًا" },
  { value: "leads", en: "Most leads", ar: "الأكثر عملاء" },
  { value: "cpl", en: "Lowest cost per lead", ar: "الأقل تكلفة للعميل" },
];

/** Rates and ROAS need a sample; a 2-lead creative with one win is not a winner. */
const MIN_LEADS_FOR_RATES = 20;

export function CreativeGallery({
  data,
  loading,
  onOpenCreative,
  onShowTable,
}: {
  data?: ClosedLoopResponse;
  loading: boolean;
  onOpenCreative: (id: string) => void;
  onShowTable: () => void;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [sort, setSort] = useState<SortKey>("revenue");
  const [limit, setLimit] = useState(24);
  const spendAvailable = data?.kpis?.metaSpend ? data.kpis.metaSpend.status === "ok" : true;
  const rows = useMemo(() => {
    const list = (data?.grains?.ad ?? []).filter((row) => row.leads > 0 || row.spend > 0);
    const score = (row: (typeof list)[number]): number => {
      switch (sort) {
        case "revenue":
          return row.revenue;
        case "won":
          return row.won;
        case "leads":
          return row.leads;
        case "roas":
          return row.leads >= MIN_LEADS_FOR_RATES && row.spend > 0 ? (row.roas ?? -1) : -1;
        case "qualificationRate":
          return row.crmMatched >= MIN_LEADS_FOR_RATES ? (row.qualificationRate ?? -1) : -1;
        case "cpl":
          return row.cpl == null || row.leads < MIN_LEADS_FOR_RATES ? -Infinity : -row.cpl;
      }
    };
    return [...list].sort((a, b) => score(b) - score(a) || b.spend - a.spend);
  }, [data, sort]);

  return (
    <PageSection
      title={A ? "المواد الإعلانية حسب اسم الإعلان" : "Creatives by ad name"}
      icon={<ImageIcon size={16} />}
      tone="violet"
      hint={
        A
          ? `كل بطاقة إعلان واحد بمعرّفه الدقيق. الترتيب بالنسب يحتاج ${MIN_LEADS_FOR_RATES} ليد على الأقل.`
          : `One exact Ad ID per card. Rate and ROAS sorting need at least ${MIN_LEADS_FOR_RATES} leads.`
      }
      action={
        <button
          type="button"
          onClick={onShowTable}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
        >
          <Table2 size={13} aria-hidden />
          {A ? "عرض كجدول" : "Show as table"}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="-mx-1 overflow-x-auto px-1">
          <Segmented
            value={sort}
            onChange={(value) => {
              setSort(value);
              setLimit(24);
            }}
            options={SORTS.map((option) => ({
              value: option.value,
              label: A ? option.ar : option.en,
            }))}
          />
        </div>
        {loading && !rows.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="h-72 animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Card padded className="text-sm text-text-muted">
            {A
              ? "لا توجد إعلانات لها صرف أو ليدز في هذه الفترة."
              : "No ad has spend or leads in this period."}
          </Card>
        ) : (
          <>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {rows.slice(0, limit).map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => row.creativeId && onOpenCreative(row.creativeId)}
                    className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface text-start transition-colors hover:border-brand"
                  >
                    <div className="relative aspect-square w-full bg-surface-2">
                      {row.thumbnailUrl ? (
                        <img
                          src={row.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-text-muted">
                          <ImageIcon size={28} />
                        </div>
                      )}
                      {row.mediaType === "video" ? (
                        <PlayCircle
                          size={28}
                          aria-hidden
                          className="absolute end-2 top-2 text-white drop-shadow"
                        />
                      ) : row.mediaType === "carousel" ? (
                        <LayoutGrid
                          size={24}
                          aria-hidden
                          className="absolute end-2 top-2 text-white drop-shadow"
                        />
                      ) : null}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <div
                        className="line-clamp-2 text-sm font-semibold text-text"
                        title={row.adName}
                      >
                        {row.adName || (A ? `إعلان ${row.adId}` : `Ad ${row.adId}`)}
                      </div>
                      <div className="min-w-0 text-[10px] text-text-muted">
                        <p className="truncate" title={row.campaignName}>
                          {A ? "الحملة" : "Campaign"}: {row.campaignName || "—"}
                        </p>
                        <p className="truncate" title={row.adsetName}>
                          {A ? "المجموعة" : "Ad set"}: {row.adsetName || "—"}
                        </p>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs">
                        <Metric
                          label={A ? "الصرف" : "Spend"}
                          value={
                            spendAvailable
                              ? fmtUSD(row.spend)
                              : A
                                ? "بانتظار المزامنة"
                                : "Pending sync"
                          }
                        />
                        <Metric label={A ? "عدد الليدز" : "Leads"} value={fmtNum(row.leads)} />
                        <Metric
                          label={A ? "سعر الليد" : "Cost per lead"}
                          value={
                            spendAvailable
                              ? row.cpl == null
                                ? "—"
                                : fmtUSD(row.cpl)
                              : A
                                ? "بانتظار المزامنة"
                                : "Pending sync"
                          }
                        />
                        <Metric label={A ? "عدد البيع" : "Won sales"} value={fmtNum(row.won)} />
                        <Metric label={A ? "عدد اللوست" : "Lost"} value={fmtNum(row.lost)} />
                        <Metric
                          label={A ? "نسبة التحويل" : "Conversion rate"}
                          value={row.leads > 0 ? fmtPct((row.won / row.leads) * 100, 1) : "—"}
                        />
                        <Metric
                          label={A ? "المبيعات" : "Revenue"}
                          value={fmtUSD(row.revenue)}
                          strong
                        />
                        <Metric
                          label="ROAS"
                          value={
                            spendAvailable
                              ? row.roas == null
                                ? "—"
                                : `${row.roas.toFixed(2)}×`
                              : A
                                ? "بانتظار المزامنة"
                                : "Pending sync"
                          }
                          strong
                        />
                      </dl>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {rows.length > limit ? (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setLimit((value) => value + 24)}
                  className="rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:border-brand"
                >
                  {A
                    ? `عرض المزيد (${fmtNum(rows.length - limit)})`
                    : `Show more (${fmtNum(rows.length - limit)})`}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </PageSection>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-text-muted">{label}</dt>
      <dd className={`num truncate ${strong ? "font-bold text-text" : "font-semibold text-text"}`}>
        {value}
      </dd>
    </div>
  );
}
