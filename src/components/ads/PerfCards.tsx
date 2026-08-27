import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { METRICS, type MetricKey } from "@/lib/metric-catalog";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/constants";
import type { PerfRow } from "@/lib/types";
import { CAMPAIGN_RETURN_COLOR, campaignReturnBand } from "@/lib/campaign-return-band";
import { EmptyState } from "@/components/ui-bits";
import { AdSetOriginBadge, InferredCourse } from "@/components/metric-bits";
import { VerdictChip } from "./MetricCard";
import { roasVerdict } from "./verdict";
import { ratioCell } from "./cells";
import { ownerStatusLabel, type OwnerCampaignVerdict } from "./owner-campaign-verdict";

/**
 * The same rows as the table, as tiles.
 *
 * A table is the right tool for scanning twenty campaigns against each other on
 * a desktop; it is the wrong tool on a phone, where it becomes a sideways scroll
 * and the numbers lose their labels. Each tile repeats the label next to every
 * figure, so a card read on a phone is self-contained.
 *
 * Identical data, identical formatting rules — a dash here means exactly what it
 * means in the table.
 */
export function PerfCards({
  rows,
  grain,
  nameOf,
  spendAvailable,
  spendNote,
  activeCampaignKeys,
  showLivePerformance = false,
  ownerMode = false,
  ownerVerdicts,
  onRowClick,
  emptyState,
}: {
  rows: PerfRow[];
  grain: "campaign" | "adset" | "ad";
  nameOf: (r: PerfRow) => string;
  spendAvailable: boolean;
  spendNote?: string;
  activeCampaignKeys?: ReadonlySet<string>;
  showLivePerformance?: boolean;
  ownerMode?: boolean;
  ownerVerdicts?: ReadonlyMap<string, OwnerCampaignVerdict>;
  onRowClick?: (r: PerfRow) => void;
  emptyState?: React.ReactNode;
}) {
  const { lang } = useI18n();
  if (!rows.length) return <>{emptyState ?? <EmptyState label="—" compact />}</>;

  return (
    <ul
      className={`grid gap-3 sm:grid-cols-2 ${ownerMode ? "lg:grid-cols-3 2xl:grid-cols-4" : "xl:grid-cols-3"}`}
    >
      {rows.map((r, i) => {
        const verdict = roasVerdict(r.roas, r.spend);
        const ownerVerdict = ownerVerdicts?.get(r.key);
        const running =
          activeCampaignKeys?.has(r.campaignKey) === true ||
          activeCampaignKeys?.has(r.key) === true;
        const websiteConversion = r.objective === "website_conversion";
        const returnBand =
          grain === "campaign" && spendAvailable
            ? campaignReturnBand(r.spend, r.revenue)
            : "unrated";
        // At campaign grain the "parent" is the campaign itself, which would
        // print the title twice.
        const parent =
          grain === "campaign"
            ? ""
            : [r.campaignName, grain === "ad" ? r.adsetName : ""].filter(Boolean).join(" › ");

        return (
          <li
            key={r.key}
            className="stagger"
            style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={() => onRowClick?.(r)}
              disabled={!onRowClick}
              className={`card relative w-full h-full overflow-hidden text-start flex flex-col card-hover hover:shadow-md hover:-translate-y-0.5 disabled:cursor-default cursor-pointer ${ownerMode ? "p-3 gap-2" : "p-3.5 gap-2.5"}`}
            >
              {returnBand !== "unrated" && (
                <span
                  className="absolute inset-y-0 start-0 w-1"
                  style={{ background: CAMPAIGN_RETURN_COLOR[returnBand] }}
                  aria-hidden="true"
                />
              )}
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  {r.platforms.length ? (
                    r.platforms.map((p) => (
                      <span
                        key={p}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                        style={{
                          background: `color-mix(in oklab, ${PLATFORM_COLOR[p]} 14%, transparent)`,
                          color: PLATFORM_COLOR[p],
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: PLATFORM_COLOR[p] }}
                        />
                        {PLATFORM_LABEL[p][lang]}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-text-subtle">
                      {lang === "ar" ? "بدون منصة مسجّلة" : "No platform recorded"}
                    </span>
                  )}
                  {grain === "adset" && <AdSetOriginBadge origin={r.adsetOrigin} />}
                  {websiteConversion && (
                    <span className="inline-flex items-center rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand whitespace-nowrap">
                      {lang === "ar" ? "تحويلات موقع" : "Website conversions"}
                    </span>
                  )}
                  {showLivePerformance && running && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap"
                      style={{ background: "var(--success-soft)", color: "var(--success)" }}
                    >
                      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                      </span>
                      {lang === "ar" ? "شغالة فعليًا" : "Running now"}
                    </span>
                  )}
                </span>
                {ownerMode && ownerVerdict ? (
                  <OwnerVerdictChip verdict={ownerVerdict} />
                ) : verdict ? (
                  <VerdictChip
                    verdict={verdict}
                    label={`${
                      verdict === "good"
                        ? lang === "ar"
                          ? "أداء كويس"
                          : "Good"
                        : verdict === "watch"
                          ? lang === "ar"
                            ? "محتاج متابعة"
                            : "Watch"
                          : lang === "ar"
                            ? "أداء ضعيف"
                            : "Weak"
                    } · ${r.roas!.toFixed(2)}×`}
                  />
                ) : null}
              </div>

              <div className="min-w-0">
                <h3
                  className="text-[13.5px] font-semibold text-text leading-snug line-clamp-2"
                  dir="auto"
                  title={nameOf(r)}
                >
                  {nameOf(r)}
                </h3>
                {parent && (
                  <p
                    className="text-[10.5px] text-text-subtle truncate mt-0.5"
                    dir="auto"
                    title={parent}
                  >
                    {parent}
                  </p>
                )}
                {r.course && (
                  <p className="text-[10.5px] text-text-muted mt-0.5">
                    <InferredCourse course={r.course} inferred={r.courseInferred} />
                  </p>
                )}
              </div>

              {ownerMode && ownerVerdict && (
                <p className="min-h-9 text-[10.5px] leading-[1.15rem] text-text-muted line-clamp-2">
                  {ownerVerdict.reason[lang]}
                </p>
              )}

              <dl
                className={`grid grid-cols-2 gap-x-3 mt-auto pt-1.5 border-t border-border/70 ${ownerMode ? "gap-y-1" : "gap-y-1.5"}`}
              >
                <Fact
                  metric="spend"
                  value={
                    spendAvailable ? (
                      fmtUSD(r.spend)
                    ) : (
                      <span className="text-text-subtle" title={spendNote}>
                        —
                      </span>
                    )
                  }
                />
                {ownerMode && websiteConversion ? (
                  <>
                    <SimpleFact
                      label={lang === "ar" ? "تحويلات الموقع" : "Website conversions"}
                      value={r.platformLeads === null ? <Dash /> : fmtNum(r.platformLeads)}
                    />
                    <SimpleFact
                      label={lang === "ar" ? "تكلفة التحويل" : "Cost / conversion"}
                      value={ratioCell(r.cpl, r.spend, fmtUSDFull, spendNote)}
                    />
                    <SimpleFact
                      label={lang === "ar" ? "إيراد مربوط" : "Linked revenue"}
                      value={fmtUSD(r.revenue)}
                    />
                    <SimpleFact
                      label={lang === "ar" ? "أوامر بيع مربوطة" : "Linked sales orders"}
                      value={fmtNum(r.salesOrders)}
                    />
                    <SimpleFact
                      label="ROAS"
                      value={r.roas === null ? <Dash /> : `${r.roas.toFixed(2)}×`}
                    />
                  </>
                ) : ownerMode ? (
                  <>
                    <Fact metric="revenue" value={fmtUSD(r.revenue)} />
                    <Fact metric="crmLeads" value={fmtNum(r.crmLeads)} />
                    <SimpleFact
                      label={lang === "ar" ? "نسبة الإغلاق" : "Conversion"}
                      value={fmtPct(r.conversionRate, 1)}
                    />
                    <SimpleFact
                      label={lang === "ar" ? "Lost" : "Lost rate"}
                      value={fmtPct(r.lostRate, 1)}
                    />
                    <SimpleFact
                      label={lang === "ar" ? "دورة البيع" : "Sales cycle"}
                      value={
                        r.avgCloseDays === null ? (
                          <Dash />
                        ) : (
                          <>
                            {r.avgCloseDays.toFixed(1)} {lang === "ar" ? "يوم" : "days"}
                          </>
                        )
                      }
                    />
                  </>
                ) : (
                  <>
                    <Fact metric="revenue" value={fmtUSD(r.revenue)} />
                    <Fact metric="crmLeads" value={fmtNum(r.crmLeads)} />
                    <Fact
                      metric="platformLeads"
                      value={
                        r.platformLeads === null ? (
                          <Dash />
                        ) : (
                          <span
                            title={
                              websiteConversion
                                ? lang === "ar"
                                  ? "تحويلات الموقع"
                                  : "Website conversions"
                                : undefined
                            }
                          >
                            {fmtNum(r.platformLeads)}
                          </span>
                        )
                      }
                    />
                    <Fact
                      metric="won"
                      value={
                        <>
                          {fmtNum(r.won)}
                          <span className="text-text-subtle text-[10px] ms-1">
                            ({fmtPct(r.conversionRate, 1)})
                          </span>
                        </>
                      }
                    />
                    <SimpleFact
                      label={lang === "ar" ? "الفواتير المدفوعة" : "Paid invoices"}
                      value={fmtNum(r.invoices)}
                    />
                    <SimpleFact
                      label={lang === "ar" ? "أوامر البيع" : "Sales orders"}
                      value={fmtNum(r.salesOrders)}
                    />
                    <Fact metric="cpl" value={ratioCell(r.cpl, r.spend, fmtUSDFull, spendNote)} />
                  </>
                )}
              </dl>

              {ownerMode && ownerVerdict && (
                <p className="text-[9.5px] text-text-subtle">
                  {ownerVerdict.benchmark.relatedCampaigns > 0
                    ? lang === "ar"
                      ? `${fmtNum(ownerVerdict.benchmark.relatedCampaigns)} حملات مرتبطة بنفس الدورة — اضغط للتفاصيل`
                      : `${fmtNum(ownerVerdict.benchmark.relatedCampaigns)} related course campaigns — open for details`
                    : lang === "ar"
                      ? "اضغط لفهم الحساب والتفاصيل"
                      : "Open to inspect the calculation"}
                </p>
              )}

              {r.partialSpend && (
                <p className="text-[10px] leading-snug" style={{ color: "var(--warning)" }}>
                  {lang === "ar"
                    ? "بيانات الإنفاق بتغطي جزء من الفترة بس — العائد هنا مش قابل للمقارنة."
                    : "Spend data covers only part of the period — this return is not comparable."}
                </p>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Dash() {
  return <span className="text-text-subtle">—</span>;
}

function OwnerVerdictChip({ verdict }: { verdict: OwnerCampaignVerdict }) {
  const { lang } = useI18n();
  const label = ownerStatusLabel(verdict.status, lang);
  if (verdict.status === "early") {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-1 text-[10px] font-semibold text-text-muted whitespace-nowrap">
        {label}
      </span>
    );
  }

  return (
    <VerdictChip
      verdict={
        verdict.status === "successful" ? "good" : verdict.status === "watch" ? "watch" : "weak"
      }
      label={label}
    />
  );
}

function Fact({ metric, value }: { metric: MetricKey; value: React.ReactNode }) {
  const { lang } = useI18n();
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-text-muted truncate">{METRICS[metric][lang].short}</dt>
      <dd className="num text-[13px] font-semibold text-text">{value}</dd>
    </div>
  );
}

function SimpleFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] text-text-muted">{label}</dt>
      <dd className="num text-[13px] font-semibold text-text">{value}</dd>
    </div>
  );
}
