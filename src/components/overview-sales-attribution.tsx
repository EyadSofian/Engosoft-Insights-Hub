import { Clock3, Info, Layers3, Users } from "lucide-react";
import { DashboardPanel } from "@/components/dashboard-bits";
import { fmtDelta, fmtNum, fmtPct, fmtUSD } from "@/lib/i18n";
import type { CourseSaleContribution, RevenueLeadAttribution } from "@/components/overview-metrics";

type Lang = "ar" | "en";

function pct(value: number | null, lang: Lang) {
  return value === null ? "—" : fmtPct(value, 1);
}

function ShareBar({ value, tone }: { value: number | null; tone: "mint" | "violet" | "amber" }) {
  const colors = {
    mint: "var(--mint-strong)",
    violet: "var(--violet-strong)",
    amber: "var(--amber-strong)",
  };
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: colors[tone] }}
      />
    </div>
  );
}

function CohortCard({
  label,
  value,
  share,
  leads,
  tone,
  lang,
}: {
  label: string;
  value: number | null;
  share: number | null;
  leads?: number;
  tone: "mint" | "violet" | "amber";
  lang: Lang;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/65 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-text-muted">{label}</span>
        <span className="num text-[15px] font-bold text-text">{pct(share, lang)}</span>
      </div>
      <div className="num mt-2 text-[18px] font-bold tracking-tight text-text">
        {value === null ? "—" : fmtUSD(value)}
      </div>
      {leads !== undefined && (
        <div className="mt-1 text-[10.5px] text-text-subtle">
          {fmtNum(leads)} {lang === "ar" ? "ليد" : "leads"}
        </div>
      )}
      <ShareBar value={share} tone={tone} />
    </div>
  );
}

export function OverviewSalesAttribution({
  attribution,
  courses,
  lang,
  comparisonAvailable = true,
}: {
  attribution: RevenueLeadAttribution;
  courses: CourseSaleContribution[];
  lang: Lang;
  comparisonAvailable?: boolean;
}) {
  const A = lang === "ar";
  return (
    <DashboardPanel
      icon={<Layers3 size={16} />}
      tone="mint"
      title={A ? "مصدر التحصيل حسب كوهورت الليد" : "Collected revenue by lead cohort"}
      hint={
        A
          ? "تقسيم واحد للتحصيل الفعلي، ثم قراءة إغلاق ودوران كل دورة تحته."
          : "One source of truth for paid revenue, then closure and lead-cycle detail per course."
      }
      footer={
        <span className="inline-flex items-center gap-1.5">
          <Info size={13} />
          {A
            ? "الحملة الموجودة في الفترتين معًا لا تُنسب قسرًا لشهر؛ تظهر ضمن غير محسوب/مشترك."
            : "Campaigns present in both windows are kept in other/shared instead of being forced into one month."}
        </span>
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <CohortCard
          label={A ? "ليدز الفترة الحالية" : "Current-period leads"}
          value={attribution.currentLeadRevenue}
          share={attribution.currentLeadRevenueShare}
          leads={attribution.currentLeads}
          tone="mint"
          lang={lang}
        />
        <CohortCard
          label={A ? "ليدز الشهر الماضي" : "Same period last month leads"}
          value={comparisonAvailable ? attribution.previousLeadRevenue : null}
          share={comparisonAvailable ? attribution.previousLeadRevenueShare : null}
          leads={comparisonAvailable ? attribution.previousLeads : undefined}
          tone="violet"
          lang={lang}
        />
        <CohortCard
          label={A ? "مشترك / بدون إسناد" : "Shared / unattributed"}
          value={attribution.otherLeadRevenue}
          share={attribution.otherLeadRevenueShare}
          tone="amber"
          lang={lang}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface-2/45 px-3 py-2.5 text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Users size={13} />
          {A ? "ليدز الفترة" : "Current leads"}:{" "}
          <b className="num text-text">{fmtNum(attribution.currentLeads)}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users size={13} />
          {A ? "ليدز المقارنة" : "Comparison leads"}:{" "}
          <b className="num text-text">
            {comparisonAvailable ? fmtNum(attribution.previousLeads) : "—"}
          </b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          {A ? "تغير التحصيل" : "Revenue change"}:{" "}
          <b className="num text-text">
            {comparisonAvailable ? fmtDelta(attribution.revenueDelta) : "—"}
          </b>
        </span>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[760px] text-[11.5px]">
          <thead>
            <tr className="border-b border-border text-start text-text-subtle">
              <th className="pb-2 pe-3 font-semibold">{A ? "الدورة" : "Course"}</th>
              <th className="pb-2 pe-3 text-end font-semibold">{A ? "التحصيل" : "Collected"}</th>
              <th className="pb-2 pe-3 text-end font-semibold">
                {A ? "ليدز / مكسوب" : "Leads / won"}
              </th>
              <th className="pb-2 pe-3 text-end font-semibold">
                {A ? "معدل الإغلاق" : "Closure rate"}
              </th>
              <th className="pb-2 pe-3 text-end font-semibold">
                {A ? "دوران الليد" : "Lead cycle"}
              </th>
              <th className="pb-2 text-end font-semibold">
                {A ? "مصدر التحصيل" : "Revenue source"}
              </th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => (
              <tr key={course.course} className="border-b border-border/70 last:border-0">
                <td className="py-2.5 pe-3 font-semibold text-text">{course.course}</td>
                <td className="num py-2.5 pe-3 text-end font-semibold text-text">
                  {fmtUSD(course.revenue)}
                  <span className="ms-1 text-[10px] font-normal text-text-subtle">
                    ({fmtPct(course.contribution, 1)})
                  </span>
                </td>
                <td className="num py-2.5 pe-3 text-end text-text">
                  {fmtNum(course.leads ?? 0)} / {fmtNum(course.won ?? 0)}
                </td>
                <td className="num py-2.5 pe-3 text-end font-semibold text-text">
                  {pct(course.closureRate ?? null, lang)}
                </td>
                <td className="num py-2.5 pe-3 text-end text-text">
                  <span className="inline-flex items-center justify-end gap-1">
                    <Clock3 size={12} className="text-text-subtle" />
                    {course.avgCloseDays == null
                      ? "—"
                      : `${course.avgCloseDays.toFixed(1)} ${A ? "يوم" : "days"}`}
                  </span>
                </td>
                <td className="num py-2.5 text-end text-text-muted">
                  <div>
                    {A ? "حالي" : "Current"} {pct(course.currentLeadRevenueShare ?? null, lang)}
                  </div>
                  <div>
                    {A ? "ماضٍ" : "Previous"}{" "}
                    {pct(
                      comparisonAvailable ? (course.previousLeadRevenueShare ?? null) : null,
                      lang,
                    )}
                  </div>
                  <div>
                    {A ? "مشترك" : "Other"} {pct(course.otherLeadRevenueShare ?? null, lang)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardPanel>
  );
}
