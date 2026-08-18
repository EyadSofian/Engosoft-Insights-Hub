import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import type { Maybe } from "@/lib/types";
import { MetricInfo } from "./MetricInfo";
import { Unavailable } from "./MetricCard";

/**
 * Platform leads → CRM leads → Won / Lost.
 *
 * The middle stage can legitimately be *larger* than the one above it: TikTok,
 * UChat, WhatsApp and referrals all create CRM leads that no ad tab priced. The
 * component says that out loud instead of hiding the overflow, because a funnel
 * that silently clamps is a funnel nobody can reconcile against the CRM.
 */
export function MiniFunnel({
  platformLeads,
  crmLeads,
  won,
  lost,
  conversionRate,
  lostRate,
  spendAvailable = true,
}: {
  platformLeads: Maybe;
  crmLeads: number;
  won: number;
  lost: number;
  conversionRate: Maybe;
  lostRate: Maybe;
  spendAvailable?: boolean;
}) {
  const { lang } = useI18n();
  const peak = Math.max(platformLeads ?? 0, crmLeads, 1);
  const overflow = platformLeads !== null && crmLeads > platformLeads;

  return (
    <div className="space-y-3">
      <Stage
        metric="platformLeads"
        label={lang === "ar" ? "ليدز من المنصات" : "Platform leads"}
        value={
          platformLeads === null ? (
            <Unavailable
              reason={
                spendAvailable
                  ? lang === "ar"
                    ? "المنصة دي مبتبلّغش عن عدد ليدز"
                    : "This platform reports no lead metric"
                  : lang === "ar"
                    ? "المنصة دي ملهاش تبويب إعلانات في المصدر الحالي"
                    : "This platform has no ad tab in the current source"
              }
            />
          ) : (
            fmtNum(platformLeads)
          )
        }
        width={platformLeads === null ? 0 : (platformLeads / peak) * 100}
        color="var(--chart-1)"
      />

      <Stage
        metric="crmLeads"
        label={lang === "ar" ? "ليدز في النظام (CRM)" : "CRM leads"}
        value={fmtNum(crmLeads)}
        width={(crmLeads / peak) * 100}
        color="var(--chart-3)"
        note={
          overflow
            ? lang === "ar"
              ? "أكبر من ليدز المنصات لأن فيه ليدز من مصادر مفيهاش إنفاق مسجّل"
              : "Larger than platform leads because some sources carry no recorded spend"
            : undefined
        }
      />

      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <Outcome
          metric="won"
          label={lang === "ar" ? "رابحة" : "Won"}
          count={won}
          rate={conversionRate}
          color="var(--success)"
          soft="var(--success-soft)"
        />
        <Outcome
          metric="lost"
          label={lang === "ar" ? "ضايعة" : "Lost"}
          count={lost}
          rate={lostRate}
          color="var(--danger)"
          soft="var(--danger-soft)"
        />
      </div>
    </div>
  );
}

function Stage({
  metric,
  label,
  value,
  width,
  color,
  note,
}: {
  metric: "platformLeads" | "crmLeads";
  label: string;
  value: React.ReactNode;
  width: number;
  color: string;
  note?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="inline-flex items-center gap-1 text-xs text-text-muted min-w-0">
          <span className="truncate">{label}</span>
          <MetricInfo metric={metric} size={12} />
        </span>
        <span className="num text-[13px] font-semibold text-text shrink-0">{value}</span>
      </div>
      <div className="h-6 rounded-lg bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-lg transition-[width] duration-700"
          style={{ width: `${Math.max(width > 0 ? 3 : 0, width)}%`, background: color }}
        />
      </div>
      {note && <p className="text-[10.5px] text-text-subtle mt-1 leading-snug">{note}</p>}
    </div>
  );
}

function Outcome({
  metric,
  label,
  count,
  rate,
  color,
  soft,
}: {
  metric: "won" | "lost";
  label: string;
  count: number;
  rate: Maybe;
  color: string;
  soft: string;
}) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: soft }}>
      <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color }}>
        {label}
        <MetricInfo metric={metric} size={11} />
      </span>
      <div className="num text-[17px] font-semibold text-text mt-0.5">{fmtNum(count)}</div>
      <div className="num text-[11px] text-text-muted">{fmtPct(rate, 1)}</div>
    </div>
  );
}
