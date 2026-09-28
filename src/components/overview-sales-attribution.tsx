import { Clock3, Info, Layers3, Users } from "lucide-react";
import { DashboardPanel } from "@/components/dashboard-bits";
import { fmtDelta, fmtNum, fmtPct, fmtUSD, fmtUSDFull } from "@/lib/i18n";
import type { CourseSaleContribution, RevenueLeadAttribution } from "@/components/overview-metrics";

type Lang = "ar" | "en";

function pct(value: number | null, lang: Lang) {
  return value === null ? "—" : fmtPct(value, 1);
}

function sourceReason(reason: RevenueLeadAttribution["sourceRows"][number]["reason"], lang: Lang) {
  if (lang === "en") {
    return {
      current_period_campaign: "Campaign matched to current-period leads only",
      previous_period_campaign: "Campaign matched to previous-period leads only",
      shared_campaign: "Campaign shared by both periods",
      outside_selected_cohorts: "Campaign outside both lead periods",
      no_campaign: "No campaign on accounting row",
    }[reason];
  }
  return {
    current_period_campaign: "حملة مرتبطة بليدز الفترة الحالية فقط",
    previous_period_campaign: "حملة مرتبطة بليدز الشهر الماضي فقط",
    shared_campaign: "حملة مشتركة بين الفترتين",
    outside_selected_cohorts: "حملة خارج فترتي الليدز",
    no_campaign: "لا توجد حملة في سجل التحصيل",
  }[reason];
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
        {value === null ? "—" : fmtUSDFull(value)}
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
          ? "إجمالي التحصيل حسب تاريخ السداد، ثم يوضح التقرير كيف تم إسناده إلى فترات الليدز."
          : "Collections by payment date, with a transparent breakdown of how each amount maps to lead periods."
      }
      footer={
        <span className="inline-flex items-center gap-1.5">
          <Info size={13} />
          {A
            ? "الإسناد هنا على مستوى الحملة، وليس ربطًا مؤكدًا بين فاتورة وليد بعينه. إجمالي البنود يساوي التحصيل خلال الفترة."
            : "Attribution is campaign-level, not a proven invoice-to-lead link. The breakdown reconciles to all collections in the selected period."}
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 rounded-xl border border-border bg-surface-2/45 px-4 py-3">
        <div className="text-[11px] font-semibold text-text-muted">
          {A
            ? "إجمالي التحصيل خلال الفترة · حسب تاريخ السداد"
            : "Total collected in selected period · by payment date"}
        </div>
        <div className="num text-xl font-black tracking-tight text-text">
          {fmtUSDFull(attribution.currentPeriodRevenue)}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <CohortCard
          label={
            A ? "حملات ليدز الفترة الحالية فقط" : "Campaigns matched to current-period leads only"
          }
          value={attribution.currentLeadRevenue}
          share={attribution.currentLeadRevenueShare}
          leads={attribution.currentLeads}
          tone="mint"
          lang={lang}
        />
        <CohortCard
          label={A ? "حملات ليدز الشهر الماضي فقط" : "Campaigns matched to last-month leads only"}
          value={comparisonAvailable ? attribution.previousLeadRevenue : null}
          share={comparisonAvailable ? attribution.previousLeadRevenueShare : null}
          leads={comparisonAvailable ? attribution.previousLeads : undefined}
          tone="violet"
          lang={lang}
        />
        <CohortCard
          label={A ? "مشترك أو خارج فترتي الليدز" : "Shared or outside lead periods"}
          value={attribution.otherLeadRevenue}
          share={attribution.otherLeadRevenueShare}
          tone="amber"
          lang={lang}
        />
      </div>

      {attribution.otherLeadRevenue > 0 && (
        <div className="mt-3 rounded-xl border border-amber-border/70 bg-amber-surface/25 p-3">
          <div className="mb-2 text-[11px] font-bold text-text">
            {A
              ? "تفصيل المبلغ الذي لم يُنسب لفترة واحدة"
              : "Why this amount is not assigned to one period"}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                [
                  "shared_campaign",
                  attribution.otherBreakdown.sharedCampaignRevenue,
                  attribution.otherBreakdown.sharedCampaignLines,
                ],
                [
                  "outside_selected_cohorts",
                  attribution.otherBreakdown.outsideSelectedCohortsRevenue,
                  attribution.otherBreakdown.outsideSelectedCohortsLines,
                ],
                [
                  "no_campaign",
                  attribution.otherBreakdown.noCampaignRevenue,
                  attribution.otherBreakdown.noCampaignLines,
                ],
              ] as const
            ).map(([reason, revenue, lines]) => (
              <div key={reason} className="rounded-lg border border-border bg-surface px-3 py-2">
                <div className="text-[10px] leading-4 text-text-muted">
                  {sourceReason(reason, lang)}
                </div>
                <div className="num mt-1 text-[14px] font-bold text-text">
                  {fmtUSDFull(revenue)}
                </div>
                <div className="mt-0.5 text-[10px] text-text-subtle">
                  {fmtNum(lines)} {A ? "بند محاسبي" : "accounting lines"} ·{" "}
                  {pct(
                    attribution.currentPeriodRevenue > 0
                      ? (revenue / attribution.currentPeriodRevenue) * 100
                      : null,
                    lang,
                  )}{" "}
                  {A ? "من الإجمالي" : "of total"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {attribution.sourceRows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface">
          <div className="border-b border-border bg-surface-2/45 px-3 py-2 text-[11px] font-bold text-text">
            {A ? "كل مصادر التحصيل في الفترة" : "All collection sources in this period"}
          </div>
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full min-w-[720px] text-[10.5px]">
              <thead className="sticky top-0 bg-surface-2/90 text-text-muted backdrop-blur">
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2 text-start font-semibold">
                    {A ? "الحملة وبيانات المصدر المسجلة" : "Campaign and recorded source details"}
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">
                    {A ? "الإسناد" : "Attribution"}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-semibold">
                    {A ? "بنود محاسبية" : "Accounting lines"}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-semibold">
                    {A ? "التحصيل" : "Collected"}
                  </th>
                  <th scope="col" className="px-3 py-2 text-end font-semibold">
                    {A ? "% من الإجمالي" : "% of total"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {attribution.sourceRows.map((source) => (
                  <tr
                    key={`${source.reason}:${source.name}`}
                    className="border-b border-border/60 last:border-0 hover:bg-surface-2/40"
                  >
                    <td
                      className="max-w-[260px] truncate px-3 py-2 font-semibold text-text"
                      title={source.name}
                    >
                      <div>{source.name === "No campaign" && A ? "بدون حملة" : source.name}</div>
                      {(source.campaignId || source.source) && (
                        <div className="mt-0.5 truncate text-[9.5px] font-normal text-text-subtle">
                          {source.campaignId && <span dir="ltr">ID: {source.campaignId}</span>}
                          {source.campaignId && source.source ? " · " : ""}
                          {source.source && (
                            <span>
                              {A ? "المصدر:" : "Source:"} {source.source}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {sourceReason(source.reason, lang)}
                    </td>
                    <td className="num px-3 py-2 text-end text-text">{fmtNum(source.lines)}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-end font-bold text-text">
                      {fmtUSDFull(source.revenue)}
                    </td>
                    <td className="num px-3 py-2 text-end text-text-muted">
                      {pct(
                        attribution.currentPeriodRevenue > 0
                          ? (source.revenue / attribution.currentPeriodRevenue) * 100
                          : null,
                        lang,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

      <div className="mt-5 grid gap-2 md:hidden">
        {courses.map((course) => (
          <article
            key={course.course}
            className="rounded-xl border border-border bg-surface-2/45 p-3"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-text-muted">{A ? "الدورة" : "Course"}</p>
                <bdi
                  dir="auto"
                  className="bidi-name block truncate text-[13px] font-bold text-text"
                  title={course.course}
                >
                  {course.course}
                </bdi>
              </div>
              <div className="shrink-0 text-end">
                <p className="text-[10px] font-medium text-text-muted">
                  {A ? "التحصيل" : "Collected"}
                </p>
                <bdi dir="ltr" className="num block text-[14px] font-bold text-text">
                  {fmtUSD(course.revenue)}
                </bdi>
                <bdi dir="ltr" className="num block text-[10px] text-text-subtle">
                  {fmtPct(course.contribution, 1)} {A ? "من مبيعات الدورات" : "of course sales"}
                </bdi>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border/70 pt-3">
              <div>
                <dt className="text-[10px] text-text-muted">
                  {A ? "ليدز / مكسوب" : "Leads / won"}
                </dt>
                <dd className="num mt-0.5 text-[12px] font-semibold text-text">
                  {fmtNum(course.leads ?? 0)} / {fmtNum(course.won ?? 0)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] text-text-muted">
                  {A ? "معدل الإغلاق" : "Closure rate"}
                </dt>
                <dd className="num mt-0.5 text-[12px] font-semibold text-text">
                  {pct(course.closureRate ?? null, lang)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] text-text-muted">{A ? "دوران الليد" : "Lead cycle"}</dt>
                <dd className="num mt-0.5 text-[12px] font-semibold text-text">
                  {course.avgCloseDays == null
                    ? "—"
                    : `${course.avgCloseDays.toFixed(1)} ${A ? "يوم" : "days"}`}
                </dd>
              </div>
            </dl>

            <div className="mt-3 border-t border-border/70 pt-3">
              <p className="text-[10px] font-medium text-text-muted">
                {A ? "مصدر التحصيل" : "Revenue source"}
              </p>
              <dl className="mt-1.5 grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-[10px] text-text-muted">{A ? "حالي" : "Current"}</dt>
                  <dd className="num text-[12px] font-semibold text-text" dir="ltr">
                    {fmtUSDFull(course.currentLeadRevenue ?? 0)} ·{" "}
                    {pct(course.currentLeadRevenueShare ?? null, lang)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-text-muted">{A ? "ماضٍ" : "Previous"}</dt>
                  <dd className="num text-[12px] font-semibold text-text" dir="ltr">
                    {fmtUSDFull(course.previousLeadRevenue ?? 0)} ·{" "}
                    {pct(
                      comparisonAvailable ? (course.previousLeadRevenueShare ?? null) : null,
                      lang,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] text-text-muted">{A ? "مشترك" : "Other"}</dt>
                  <dd className="num text-[12px] font-semibold text-text" dir="ltr">
                    {fmtUSDFull(course.otherLeadRevenue ?? 0)} ·{" "}
                    {pct(course.otherLeadRevenueShare ?? null, lang)}
                  </dd>
                </div>
              </dl>
            </div>
          </article>
        ))}
      </div>

      <div className="table-wrap scroll-hint-x mt-5 hidden rounded-xl border border-border md:block">
        <table className="mx-auto w-full min-w-[880px] max-w-[1400px] table-fixed text-[12px]">
          <caption className="sr-only">
            {A ? "التحصيل ومصدره ومعدل إغلاق كل دورة" : "Collection source and closure by course"}
          </caption>
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[18%]" />
            <col className="w-[15%]" />
            <col className="w-[13%]" />
            <col className="w-[14%]" />
            <col className="w-[24%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-surface-2/70 text-text-muted">
              <th scope="col" className="px-3 py-3 text-start font-semibold">
                {A ? "الدورة" : "Course"}
              </th>
              <th scope="col" className="px-3 py-3 text-end font-semibold">
                {A ? "التحصيل" : "Collected"}
              </th>
              <th scope="col" className="px-3 py-3 text-end font-semibold">
                {A ? "ليدز / مكسوب" : "Leads / won"}
              </th>
              <th scope="col" className="px-3 py-3 text-end font-semibold">
                {A ? "معدل الإغلاق" : "Closure rate"}
              </th>
              <th scope="col" className="px-3 py-3 text-end font-semibold">
                {A ? "دوران الليد" : "Lead cycle"}
              </th>
              <th scope="col" className="px-3 py-3 text-end font-semibold">
                {A ? "مصدر التحصيل" : "Revenue source"}
              </th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => (
              <tr
                key={course.course}
                className="border-b border-border/70 align-middle transition-colors last:border-0 hover:bg-surface-2/45"
              >
                <td className="px-3 py-3 text-start font-semibold text-text">
                  <bdi dir="auto" className="bidi-name block truncate" title={course.course}>
                    {course.course}
                  </bdi>
                </td>
                <td className="num px-3 py-3 text-end font-semibold text-text">
                  <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap" dir="ltr">
                    <span>{fmtUSD(course.revenue)}</span>
                    <span className="text-[10px] font-normal text-text-subtle">
                      ({fmtPct(course.contribution, 1)})
                    </span>
                  </span>
                </td>
                <td className="num px-3 py-3 text-end text-text">
                  {fmtNum(course.leads ?? 0)} / {fmtNum(course.won ?? 0)}
                </td>
                <td className="num px-3 py-3 text-end font-semibold text-text">
                  {pct(course.closureRate ?? null, lang)}
                </td>
                <td className="num px-3 py-3 text-end text-text">
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <Clock3 size={12} className="text-text-subtle" />
                    {course.avgCloseDays == null
                      ? "—"
                      : `${course.avgCloseDays.toFixed(1)} ${A ? "يوم" : "days"}`}
                  </span>
                </td>
                <td className="px-3 py-3 text-end text-text-muted">
                  <div className="inline-grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-start leading-5">
                    <span>{A ? "حالي" : "Current"}</span>
                    <bdi dir="ltr" className="num font-medium text-text">
                      {fmtUSDFull(course.currentLeadRevenue ?? 0)} ·{" "}
                      {pct(course.currentLeadRevenueShare ?? null, lang)}
                    </bdi>
                    <span>{A ? "ماضٍ" : "Previous"}</span>
                    <bdi dir="ltr" className="num font-medium text-text">
                      {fmtUSDFull(course.previousLeadRevenue ?? 0)} ·{" "}
                      {pct(
                        comparisonAvailable ? (course.previousLeadRevenueShare ?? null) : null,
                        lang,
                      )}
                    </bdi>
                    <span>{A ? "مشترك" : "Other"}</span>
                    <bdi dir="ltr" className="num font-medium text-text">
                      {fmtUSDFull(course.otherLeadRevenue ?? 0)} ·{" "}
                      {pct(course.otherLeadRevenueShare ?? null, lang)}
                    </bdi>
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
