import { fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { METRICS, type MetricKey } from "@/lib/metric-catalog";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/constants";
import type { PerfRow } from "@/lib/types";
import { EmptyState } from "@/components/ui-bits";
import { AdSetOriginBadge, InferredCourse } from "@/components/metric-bits";
import { VerdictChip } from "./MetricCard";
import { roasVerdict } from "./verdict";
import { ratioCell } from "./cells";

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
  onRowClick,
  emptyState,
}: {
  rows: PerfRow[];
  grain: "campaign" | "adset" | "ad";
  nameOf: (r: PerfRow) => string;
  spendAvailable: boolean;
  spendNote?: string;
  onRowClick?: (r: PerfRow) => void;
  emptyState?: React.ReactNode;
}) {
  const { lang } = useI18n();
  if (!rows.length) return <>{emptyState ?? <EmptyState label="—" compact />}</>;

  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r, i) => {
        const verdict = roasVerdict(r.roas, r.spend);
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
              className="card w-full h-full text-start p-3.5 flex flex-col gap-2.5 card-hover hover:shadow-md hover:-translate-y-0.5 disabled:cursor-default cursor-pointer"
            >
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
                </span>
                {verdict && <VerdictChip verdict={verdict} label={`${r.roas!.toFixed(2)}×`} />}
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

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-auto pt-1.5 border-t border-border/70">
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
                <Fact metric="revenue" value={fmtUSD(r.revenue)} />
                <Fact
                  metric="platformLeads"
                  value={r.platformLeads === null ? <Dash /> : fmtNum(r.platformLeads)}
                />
                <Fact metric="crmLeads" value={fmtNum(r.crmLeads)} />
                <Fact
                  metric="won"
                  value={
                    <>
                      {fmtNum(r.won)}
                      {/* Bracketed: "34" next to "3.1%" scans as 343.1%. */}
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
              </dl>

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
