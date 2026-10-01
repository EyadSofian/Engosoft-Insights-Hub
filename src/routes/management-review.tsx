import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChartNoAxesCombined,
  CircleHelp,
  Clock3,
  Target,
  TriangleAlert,
} from "lucide-react";
import { DashboardPageHeader } from "@/components/dashboard-bits";
import { Card, ErrorState, Skeleton } from "@/components/ui-bits";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";

export const Route = createFileRoute("/management-review")({ component: ManagementReviewPage });

interface CourseRow {
  course: string;
  leads: number;
  won: number;
  lost: number;
  freshLeads: number;
  freshWon: number;
  oldLeads: number;
  oldWon: number;
  conversion: number | null;
  freshConversion: number | null;
  oldConversion: number | null;
  lostRate: number | null;
  turnaroundDays: number | null;
}

interface ReviewRow {
  month: string;
  historicalStatus: string;
  funnelAvailable: boolean;
  coverage: { crm: boolean; ads: boolean; revenue: boolean };
  funnelEnriched: boolean;
  planStatus: "approved" | "draft" | null;
  planBasisMonth: string | null;
  leadBasis: "platform" | "mixed_platform_crm" | null;
  target: Record<
    "revenue" | "spend" | "leads" | "conversion" | "freshConversion" | "oldConversion",
    number | null
  >;
  actual: Record<
    "revenue" | "spend" | "leads" | "conversion" | "freshConversion" | "oldConversion",
    number | null
  >;
  achievement: Record<"revenue" | "spend" | "leads", number | null>;
  funnel: {
    leads: number;
    won: number;
    lost: number;
    lostRate: number | null;
    noAnswer: number | null;
    noAnswerRate: number | null;
    replyKnown: number | null;
    freshLeads: number | null;
    freshWon: number | null;
    oldLeads: number | null;
    oldWon: number | null;
    freshConversion: number | null;
    oldConversion: number | null;
    segmentCoverage: number | null;
    turnaroundDays: number | null;
    turnaroundSamples: number | null;
    reasons: { key: string; label: string; count: number; share: number | null }[];
    courses: CourseRow[];
    topConversionCourse: CourseRow | null;
    topFreshCourse: CourseRow | null;
  };
}

interface ReviewResponse {
  selectedMonth: string;
  today: string;
  months: string[];
  rows: ReviewRow[];
  selected: ReviewRow;
  historical: { status: string; funnelReady: boolean; syncedAt: string };
}

const percent = (value: number | null | undefined) =>
  value == null ? "—" : fmtPct(value * 100, 1);
const number = (value: number | null | undefined) => (value == null ? "—" : fmtNum(value));
const money = (value: number | null | undefined) => (value == null ? "—" : fmtUSDFull(value));
const days = (value: number | null | undefined) =>
  value == null ? "—" : `${value.toFixed(1)} يوم`;
const monthName = (month: string, lang: string) =>
  new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));

function SummaryMetric({
  label,
  value,
  detail,
  tone = "brand",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "brand" | "red" | "amber" | "green";
}) {
  const tones = {
    brand: "border-brand/25 bg-brand/5 text-brand",
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="text-xs font-semibold opacity-80">{label}</div>
      <div className="num mt-2 text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] leading-relaxed opacity-75">{detail}</div>
    </div>
  );
}

function ManagementReviewPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [month, setMonth] = useState("");
  const { data, isLoading, error, refetch } = useApi<ReviewResponse>(
    `/api/management-review${month ? `?month=${month}` : ""}`,
  );
  useEffect(() => {
    if (data?.historical.status !== "refreshing" || data.historical.funnelReady) return;
    const timer = window.setInterval(() => {
      void refetch();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [data?.historical.status, data?.historical.funnelReady, refetch]);
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data)
    return (
      <div className="page-sections">
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  const row = data.selected;
  const f = row.funnel;
  const targetRows = [
    { key: "revenue", ar: "التحصيل / المبيعات", en: "Revenue / sales", format: money },
    { key: "spend", ar: "صرف الإعلانات", en: "Ad spend", format: money },
    { key: "leads", ar: "ليدز الدورات الإعلانية", en: "Paid course leads", format: number },
    { key: "conversion", ar: "معدل التحويل", en: "Conversion rate", format: percent },
    { key: "freshConversion", ar: "تحويل Fresh", en: "Fresh conversion", format: percent },
    { key: "oldConversion", ar: "تحويل Old Data", en: "Old Data conversion", format: percent },
  ] as const;
  return (
    <div className="page-sections">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DashboardPageHeader
          flush
          icon={<ChartNoAxesCombined size={20} />}
          title={ar ? "مراجعة الأداء والخطة" : "Performance & plan review"}
          subtitle={
            ar
              ? "من 2025 حتى الآن · مسار الليدز، أسباب الفقد، والخطة مقابل التنفيذ."
              : "2025 to date · lead funnel, loss reasons and target versus actual."
          }
          period={`${row.month}-01 → ${row.month === data.today.slice(0, 7) ? data.today : new Date(Date.UTC(Number(row.month.slice(0, 4)), Number(row.month.slice(5, 7)), 0)).toISOString().slice(0, 10)}`}
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-text-muted">
            {ar ? "شهر المراجعة" : "Review month"}
            <select
              className="mt-1 block min-w-44 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text"
              value={row.month}
              onChange={(event) => setMonth(event.target.value)}
            >
              {[...data.months].reverse().map((value) => (
                <option key={value} value={value}>
                  {monthName(value, lang)}
                </option>
              ))}
            </select>
          </label>
          <Link
            to="/media-plan"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-brand"
          >
            <ArrowLeft size={14} />
            {ar ? "العودة لخطة الميديا" : "Media plan"}
          </Link>
        </div>
      </div>

      <Card className="border-brand/20 bg-gradient-to-l from-brand/5 to-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-text">
            {ar ? "قرار الإدارة قبل خطة الشهر القادم" : "Management baseline for next month"}
          </h2>
          <span className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-semibold text-text-muted">
            {row.planStatus === "approved"
              ? ar
                ? "خطة معتمدة"
                : "Approved plan"
              : row.planStatus === "draft"
                ? ar
                  ? "خطة مسودة — ليست تارجت معتمد"
                  : "Draft — not approved"
                : ar
                  ? "لا توجد خطة محفوظة لهذا الشهر"
                  : "No saved plan for this month"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SummaryMetric
            label={ar ? "تحقيق تارجت المبيعات" : "Revenue target achievement"}
            value={percent(row.achievement.revenue)}
            detail={`${money(row.actual.revenue)} / ${money(row.target.revenue)}`}
            tone="green"
          />
          <SummaryMetric
            label={ar ? "المستخدم من ميزانية الإعلانات" : "Ad budget utilization"}
            value={percent(row.achievement.spend)}
            detail={`${money(row.actual.spend)} / ${money(row.target.spend)}`}
            tone="amber"
          />
          <SummaryMetric
            label={ar ? "تحقيق تارجت الليدز" : "Lead target achievement"}
            value={percent(row.achievement.leads)}
            detail={`${number(row.actual.leads)} / ${number(row.target.leads)}`}
          />
        </div>
        {row.planStatus === "draft" && (
          <p className="mt-3 text-xs leading-relaxed text-amber-800">
            {ar
              ? `تنبيه: تارجت ${monthName(row.month, lang)} مسودة${row.planBasisMonth ? ` منسوخة من ${monthName(row.planBasisMonth, lang)}` : ""}، فلا تعتبر نسبة التحقيق حكمًا نهائيًا حتى اعتماد الخطة.`
              : "Draft targets are provisional and must be approved before treating achievement as final."}
          </p>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <Target size={18} className="text-brand" />
            <h2 className="text-base font-bold text-text">
              {ar ? "الخطة مقابل الفعلي" : "Target vs actual"}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] table-fixed text-sm">
              <thead className="border-b border-border bg-surface-2 text-xs text-text-muted">
                <tr>
                  <th className="w-[34%] p-3 text-start">{ar ? "المؤشر" : "Metric"}</th>
                  <th className="w-[22%] p-3 text-end">Target</th>
                  <th className="w-[22%] p-3 text-end">Actual</th>
                  <th className="w-[22%] p-3 text-end">{ar ? "التحقيق" : "Achievement"}</th>
                </tr>
              </thead>
              <tbody>
                {targetRows.map((metric) => (
                  <tr key={metric.key} className="border-b border-border/70 last:border-0">
                    <td className="p-3 font-medium text-text">{ar ? metric.ar : metric.en}</td>
                    <td className="num p-3 text-end text-text-muted">
                      {metric.format(row.target[metric.key])}
                    </td>
                    <td className="num p-3 text-end font-semibold text-text">
                      {metric.format(row.actual[metric.key])}
                    </td>
                    <td className="num p-3 text-end font-semibold text-brand">
                      {metric.key === "revenue" || metric.key === "spend" || metric.key === "leads"
                        ? percent(row.achievement[metric.key])
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
            {ar
              ? `لا نختلق تارجت لمعدل التحويل أو لأشهر بلا خطة. التحصيل من Odoo بتاريخ الدفع، والصرف من كل الحسابات المتصلة. ليدز التارجت من الدورات المطابقة للخطة (${row.leadBasis === "mixed_platform_crm" ? "منصات + بديل CRM عند غياب بيانات المنصة" : "بيانات المنصات"})؛ مسار الـCRM الكامل معروض منفصلًا.`
              : "No inferred targets. Paid accounting and connected ad accounts. Paid course leads match plan courses; CRM funnel is separate."}
          </p>
        </Card>
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <CircleHelp size={18} className="text-brand" />
            <h2 className="text-base font-bold text-text">
              {ar ? "أين تضيع الليدز؟" : "Where do leads drop?"}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SummaryMetric
              label="Lost Rate"
              value={row.funnelAvailable ? percent(f.lostRate) : "—"}
              detail={`${row.funnelAvailable ? number(f.lost) : "—"} / ${row.funnelAvailable ? number(f.leads) : "—"}`}
              tone="red"
            />
            <SummaryMetric
              label="No Answer Rate"
              value={percent(f.noAnswerRate)}
              detail={`${number(f.noAnswer)} / ${row.funnelAvailable ? number(f.leads) : "—"}`}
              tone="amber"
            />
            <SummaryMetric
              label={ar ? "متوسط دوران الليد" : "Avg. turnaround"}
              value={days(f.turnaroundDays)}
              detail={`${number(f.turnaroundSamples)} ${ar ? "حالة مغلقة بتاريخ معروف" : "dated closures"}`}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SummaryMetric
              label="Fresh conversion"
              value={percent(f.freshConversion)}
              detail={`${number(f.freshWon)} / ${number(f.freshLeads)} ${ar ? "مصنّف Fresh" : "tagged Fresh"}`}
              tone="green"
            />
            <SummaryMetric
              label="Old Data conversion"
              value={percent(f.oldConversion)}
              detail={`${number(f.oldWon)} / ${number(f.oldLeads)} ${ar ? "مصنّف Old Data" : "tagged Old Data"}`}
            />
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            <TriangleAlert size={15} className="me-1 inline" />
            {ar
              ? `تغطية تصنيف Fresh/Old Data: ${percent(f.segmentCoverage)} من الليدز. الليدز بلا تصنيف ليست في مقام أي من المعدلين. حقل الرد مسجّل في ${number(f.replyKnown)} ليد فقط؛ No Answer يشمل أيضًا سبب Lost «لا يرد».`
              : `Fresh/Old Data coverage: ${percent(f.segmentCoverage)}. Untagged leads are excluded. Reply field recorded on ${number(f.replyKnown)} leads; No Answer also includes the Lost reason.`}
          </div>
          {!row.funnelEnriched && (
            <p className="mt-3 text-xs text-amber-800">
              {!row.funnelAvailable
                ? ar
                  ? "مصدر الـCRM أو الـLost لا يغطي هذا الشهر؛ لا نعرض الصفر كأنه نتيجة حقيقية."
                  : "CRM or Lost does not cover this month; zero is not shown as a real result."
                : ar
                  ? "تفاصيل 2025 قيد إعادة السحب من Odoo؛ الأعداد الأساسية ظاهرة لكن الردود والأسباب والتصنيفات لن تُعرض حتى يكتمل التحديث."
                  : "2025 detail is refreshing from Odoo; detailed rates remain blank until complete."}
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card className="p-5">
          <h2 className="mb-3 text-base font-bold text-text">
            {ar ? "أسباب الـLost" : "Lost reasons"}
          </h2>
          {f.reasons.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[350px] text-sm">
                <thead className="border-b border-border bg-surface-2 text-xs text-text-muted">
                  <tr>
                    <th className="p-3 text-start">{ar ? "السبب" : "Reason"}</th>
                    <th className="p-3 text-end">Count</th>
                    <th className="p-3 text-end">% of Lost</th>
                  </tr>
                </thead>
                <tbody>
                  {f.reasons.map((reason) => (
                    <tr key={reason.key} className="border-b border-border/70">
                      <td className="p-3 text-text">{reason.label}</td>
                      <td className="num p-3 text-end text-text">{fmtNum(reason.count)}</td>
                      <td className="num p-3 text-end font-semibold text-brand">
                        {percent(reason.share)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-text-muted">
              {ar
                ? "لا توجد أسباب متاحة للفترة أو التحديث ما زال جاريًا."
                : "No loss reasons available yet."}
            </p>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-1 text-base font-bold text-text">
            {ar ? "أي دورة تحول أفضل؟" : "Which courses convert best?"}
          </h2>
          <p className="mb-3 text-[11px] text-text-muted">
            {ar
              ? "الترتيب الأعلى يتطلب 20 ليد على الأقل حتى لا يتصدر كورس بليد واحد."
              : "Top ranking requires at least 20 leads."}
          </p>
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-lg bg-brand/10 px-3 py-2 text-brand">
              {ar ? "أفضل تحويل عام:" : "Best overall:"}{" "}
              <b>{f.topConversionCourse?.course ?? "—"}</b> ·{" "}
              {percent(f.topConversionCourse?.conversion)}
            </span>
            <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
              {ar ? "أفضل تحويل Fresh:" : "Best Fresh:"} <b>{f.topFreshCourse?.course ?? "—"}</b> ·{" "}
              {percent(f.topFreshCourse?.freshConversion)}
            </span>
          </div>
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-surface-2 text-xs text-text-muted">
                <tr>
                  <th className="p-3 text-start">{ar ? "الدورة" : "Course"}</th>
                  <th className="p-3 text-end">Leads</th>
                  <th className="p-3 text-end">Won</th>
                  <th className="p-3 text-end">Lost %</th>
                  <th className="p-3 text-end">Conversion</th>
                  <th className="p-3 text-end">Fresh</th>
                  <th className="p-3 text-end">Old</th>
                  <th className="p-3 text-end">{ar ? "الدوران" : "Turnaround"}</th>
                </tr>
              </thead>
              <tbody>
                {f.courses.map((course) => (
                  <tr key={course.course} className="border-b border-border/70">
                    <td className="p-3 font-semibold text-text">{course.course}</td>
                    <td className="num p-3 text-end">{number(course.leads)}</td>
                    <td className="num p-3 text-end">{number(course.won)}</td>
                    <td className="num p-3 text-end">{percent(course.lostRate)}</td>
                    <td className="num p-3 text-end font-semibold text-brand">
                      {percent(course.conversion)}
                    </td>
                    <td className="num p-3 text-end">{percent(course.freshConversion)}</td>
                    <td className="num p-3 text-end">{percent(course.oldConversion)}</td>
                    <td className="num whitespace-nowrap p-3 text-end">
                      {days(course.turnaroundDays)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-text">
              {ar ? "مسار الشهور · 2025 حتى الآن" : "Monthly trend · 2025 to date"}
            </h2>
            <p className="text-xs text-text-muted">
              {ar
                ? "اضغط على شهر لفتح تفسيره وأسباب الفقد فيه."
                : "Select a month for its detailed funnel."}
            </p>
          </div>
          <Clock3 size={18} className="text-brand" />
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-surface-2 text-xs text-text-muted">
              <tr>
                <th className="p-3 text-start">{ar ? "الشهر" : "Month"}</th>
                <th className="p-3 text-end">Leads</th>
                <th className="p-3 text-end">Won</th>
                <th className="p-3 text-end">Lost %</th>
                <th className="p-3 text-end">Fresh %</th>
                <th className="p-3 text-end">Old %</th>
                <th className="p-3 text-end">{ar ? "المبيعات" : "Revenue"}</th>
                <th className="p-3 text-end">{ar ? "الصرف" : "Spend"}</th>
                <th className="p-3 text-end">{ar ? "تحقيق التارجت" : "Target"}</th>
              </tr>
            </thead>
            <tbody>
              {[...data.rows].reverse().map((item) => (
                <tr
                  key={item.month}
                  onClick={() => setMonth(item.month)}
                  className={`cursor-pointer border-b border-border/70 transition-colors hover:bg-brand/5 ${item.month === row.month ? "bg-brand/10" : ""}`}
                >
                  <td className="p-3 font-semibold text-text">{monthName(item.month, lang)}</td>
                  <td className="num p-3 text-end">
                    {item.funnelAvailable ? number(item.funnel.leads) : "—"}
                  </td>
                  <td className="num p-3 text-end">
                    {item.funnelAvailable ? number(item.funnel.won) : "—"}
                  </td>
                  <td className="num p-3 text-end">
                    {item.funnelAvailable ? percent(item.funnel.lostRate) : "—"}
                  </td>
                  <td className="num p-3 text-end">{percent(item.funnel.freshConversion)}</td>
                  <td className="num p-3 text-end">{percent(item.funnel.oldConversion)}</td>
                  <td className="num p-3 text-end">{money(item.actual.revenue)}</td>
                  <td className="num p-3 text-end">{money(item.actual.spend)}</td>
                  <td className="num p-3 text-end font-semibold text-brand">
                    {percent(item.achievement.revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <details className="rounded-2xl border border-border bg-surface p-4 text-xs leading-relaxed text-text-muted">
        <summary className="cursor-pointer font-semibold text-text">
          {ar ? "تعريف الأرقام ومصادرها" : "Definitions & sources"}
        </summary>
        <div className="mt-3 space-y-2">
          <p>
            {ar
              ? "الليدز مجموعات حسب تاريخ الإنشاء في Odoo؛ بيانات 2025 التاريخية تشمل Inventory، بينما بيانات التشغيل 2026 لا تشملها. Won وLost هي الحالة الحالية وقت آخر مزامنة وليست لقطة محفوظة بنهاية كل شهر."
              : "Leads use Odoo creation date. Historical 2025 includes Inventory, while operational 2026 excludes it. Won/Lost reflect current state, not saved month-end state."}
          </p>
          <p>
            {ar
              ? "No Answer = قيمة Not answer في Calling reply أو سبب Lost «لم يتم الوصول/لا يرد»، بدون تكرار الليد. متوسط الدوران = تاريخ الإغلاق ناقص تاريخ الإنشاء للحالات ذات التاريخين."
              : "No Answer uses the reply field or Lost reason; turnaround needs both creation and closure dates."}
          </p>
          <p>
            {ar
              ? "Fresh وOld Data حسب Lead Segment المسجل فقط. تحصيل المبيعات من الفواتير المدفوعة بتاريخ الدفع بعد استبعاد المنتج 246. صرف الإعلانات من الحسابات المربوطة. لا تُنشأ تارجتات لأشهر بلا خطة."
              : "Fresh and Old Data use explicit Odoo tags only. Paid revenue excludes product 246. Spend is from connected ad accounts. Missing plans remain blank."}
          </p>
        </div>
      </details>
    </div>
  );
}
