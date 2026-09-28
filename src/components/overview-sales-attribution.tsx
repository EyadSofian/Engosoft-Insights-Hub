import { useState } from "react";
import {
  ArrowDownLeft,
  Clock3,
  ExternalLink,
  Info,
  Layers3,
  LoaderCircle,
  ReceiptText,
  Users,
} from "lucide-react";
import { DashboardPanel } from "@/components/dashboard-bits";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtDelta, fmtNum, fmtPct, fmtUSD, fmtUSDFull } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
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
      campaign_not_linked: "Campaign recorded but not linked to these lead cohorts",
      source_without_campaign: "Source recorded without campaign",
      no_source: "No campaign or source recorded",
    }[reason];
  }
  return {
    current_period_campaign: "حملة مرتبطة بليدز الفترة الحالية فقط",
    previous_period_campaign: "حملة مرتبطة بليدز الشهر الماضي فقط",
    shared_campaign: "حملة مشتركة بين الفترتين",
    outside_selected_cohorts: "حملة خارج فترتي الليدز",
    campaign_not_linked: "اسم/معرف حملة موجود لكن غير مربوط بكوهورت الليدز",
    source_without_campaign: "المصدر مسجل بدون حملة",
    no_source: "لا توجد حملة أو مصدر مسجل",
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
  selected,
  onClick,
}: {
  label: string;
  value: number | null;
  share: number | null;
  leads?: number;
  tone: "mint" | "violet" | "amber";
  lang: Lang;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border bg-surface-2/65 p-3 text-start transition hover:border-mint-strong/50 hover:bg-surface-2 ${selected ? "border-mint-strong ring-1 ring-mint-strong/25" : "border-border"}`}
    >
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
      <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-mint-strong">
        {lang === "ar" ? "اضغط لعرض المصادر" : "Click to inspect sources"}
        <ArrowDownLeft size={12} />
      </span>
    </button>
  );
}

type SourceReason = RevenueLeadAttribution["sourceRows"][number]["reason"];
type SourceDetailResponse = {
  totalLines: number;
  totalRevenue: number;
  truncated: boolean;
  lines: {
    id: string;
    movement: string;
    paymentDate: string;
    invoiceDate: string;
    partner: string;
    product: string;
    course: string;
    salesperson: string;
    salesTeam: string;
    campaignName: string;
    campaignId: string;
    adset: string;
    adName: string;
    source: string;
    usdPaid: number;
    currency: string;
    isCreditNote: boolean;
    orderRef: string;
  }[];
};

function reasonGroup(reason: SourceReason): "current" | "previous" | "other" {
  if (reason === "current_period_campaign") return "current";
  if (reason === "previous_period_campaign") return "previous";
  return "other";
}

function detailDate(line: SourceDetailResponse["lines"][number]) {
  return line.paymentDate || line.invoiceDate || "—";
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
  const [selectedCohort, setSelectedCohort] = useState<"current" | "previous" | "other">("other");
  const [selectedReason, setSelectedReason] = useState<SourceReason | "all">("all");
  const [selectedSource, setSelectedSource] = useState<
    RevenueLeadAttribution["sourceRows"][number] | null
  >(null);
  const detail = useApi<SourceDetailResponse>(
    `/api/overview-revenue-source?sourceKey=${encodeURIComponent(selectedSource?.sourceKey ?? "")}`,
    { enabled: Boolean(selectedSource) },
  );
  const reasonItems = [
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
      "campaign_not_linked",
      attribution.otherBreakdown.campaignNotLinkedRevenue,
      attribution.otherBreakdown.campaignNotLinkedLines,
    ],
    [
      "source_without_campaign",
      attribution.otherBreakdown.sourceWithoutCampaignRevenue,
      attribution.otherBreakdown.sourceWithoutCampaignLines,
    ],
    [
      "no_source",
      attribution.otherBreakdown.noSourceRevenue,
      attribution.otherBreakdown.noSourceLines,
    ],
  ] as const;
  const availableReasons = reasonItems
    .filter(([, revenue]) => revenue !== 0)
    .map(([reason]) => reason);
  const visibleSources = attribution.sourceRows.filter(
    (source) =>
      reasonGroup(source.reason) === selectedCohort &&
      (selectedReason === "all" || source.reason === selectedReason),
  );
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
          selected={selectedCohort === "current"}
          onClick={() => {
            setSelectedCohort("current");
            setSelectedReason("all");
          }}
        />
        <CohortCard
          label={A ? "حملات ليدز الشهر الماضي فقط" : "Campaigns matched to last-month leads only"}
          value={comparisonAvailable ? attribution.previousLeadRevenue : null}
          share={comparisonAvailable ? attribution.previousLeadRevenueShare : null}
          leads={comparisonAvailable ? attribution.previousLeads : undefined}
          tone="violet"
          lang={lang}
          selected={selectedCohort === "previous"}
          onClick={() => {
            setSelectedCohort("previous");
            setSelectedReason("all");
          }}
        />
        <CohortCard
          label={A ? "مشترك أو خارج فترتي الليدز" : "Shared or outside lead periods"}
          value={attribution.otherLeadRevenue}
          share={attribution.otherLeadRevenueShare}
          tone="amber"
          lang={lang}
          selected={selectedCohort === "other"}
          onClick={() => {
            setSelectedCohort("other");
            setSelectedReason("all");
          }}
        />
      </div>

      <div className="mt-3 rounded-xl border border-border bg-surface-2/25 p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[12px] font-bold text-text">
              {A ? "المصادر التي كوّنت المبلغ المحدد" : "Sources behind the selected amount"}
            </div>
            <div className="mt-0.5 text-[10px] text-text-muted">
              {A
                ? "اختر مصدرًا لعرض فواتيره وبنوده بالتفصيل."
                : "Choose a source to inspect its invoices and accounting lines."}
            </div>
          </div>
          {selectedCohort === "other" && (
            <span className="rounded-full bg-amber-surface px-2 py-1 text-[10px] font-semibold text-amber-strong">
              {A ? "غير منسوب لفترة واحدة" : "Not assigned to one period"}
            </span>
          )}
        </div>
        {selectedCohort === "other" && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedReason("all")}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${selectedReason === "all" ? "border-text bg-text text-surface" : "border-border bg-surface text-text-muted"}`}
            >
              {A ? "كل الأنواع" : "All types"}
            </button>
            {availableReasons.map((reason) => {
              const item = reasonItems.find(([key]) => key === reason);
              return (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setSelectedReason(reason)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${selectedReason === reason ? "border-amber-strong bg-amber-surface text-text" : "border-border bg-surface text-text-muted"}`}
                >
                  {sourceReason(reason, lang)}
                  {item ? ` · ${fmtUSDFull(item[1])}` : ""}
                </button>
              );
            })}
          </div>
        )}
        {visibleSources.length ? (
          <div className="grid max-h-[380px] gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
            {visibleSources.map((source) => (
              <button
                key={source.sourceKey}
                type="button"
                onClick={() => setSelectedSource(source)}
                className="group rounded-lg border border-border bg-surface p-3 text-start transition hover:border-mint-strong/60 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-bold text-text" title={source.name}>
                      {source.name === "No campaign"
                        ? A
                          ? "بدون حملة"
                          : source.name
                        : source.name === "No source recorded" && A
                          ? "لا يوجد مصدر مسجل"
                          : source.name}
                    </div>
                    <div
                      className="mt-1 truncate text-[9.5px] text-text-subtle"
                      title={
                        source.source || source.campaignId || sourceReason(source.reason, lang)
                      }
                    >
                      {source.source
                        ? `${A ? "المصدر" : "Source"}: ${source.source}`
                        : source.campaignId
                          ? `ID: ${source.campaignId}`
                          : sourceReason(source.reason, lang)}
                    </div>
                  </div>
                  <ExternalLink
                    size={13}
                    className="shrink-0 text-text-subtle transition group-hover:text-mint-strong"
                  />
                </div>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <span className="num text-[14px] font-black text-text">
                    {fmtUSDFull(source.revenue)}
                  </span>
                  <span className="text-[9.5px] text-text-muted">
                    {fmtNum(source.lines)} {A ? "بند" : "lines"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] text-text-muted">
            {A
              ? "لا توجد مصادر ضمن هذا التصنيف في الفترة المحددة."
              : "No sources in this category for the selected period."}
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(selectedSource)}
        onOpenChange={(open) => {
          if (!open) setSelectedSource(null);
        }}
      >
        <DialogContent
          className="max-h-[88vh] max-w-6xl overflow-hidden p-0"
          dir={A ? "rtl" : "ltr"}
        >
          <div className="border-b border-border bg-surface-2/45 px-5 py-4 sm:px-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-start">
                <ReceiptText size={18} />
                {selectedSource?.name}
              </DialogTitle>
              <DialogDescription className="text-start">
                {selectedSource && (
                  <>
                    {sourceReason(selectedSource.reason, lang)} ·{" "}
                    {selectedSource.source || (A ? "لا يوجد مصدر مسجل" : "No source recorded")}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-text-muted">
              <span>
                {A ? "إجمالي البنود" : "Accounting lines"}:{" "}
                <b className="num text-text">
                  {fmtNum(detail.data?.totalLines ?? selectedSource?.lines ?? 0)}
                </b>
              </span>
              <span>
                {A ? "إجمالي التحصيل" : "Total collected"}:{" "}
                <b className="num text-text">
                  {fmtUSDFull(detail.data?.totalRevenue ?? selectedSource?.revenue ?? 0)}
                </b>
              </span>
              {selectedSource?.campaignId && (
                <span dir="ltr">
                  Campaign ID: <b className="text-text">{selectedSource.campaignId}</b>
                </span>
              )}
            </div>
          </div>
          <div className="max-h-[calc(88vh-145px)] overflow-auto p-4 sm:p-5">
            {detail.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-text-muted">
                <LoaderCircle size={16} className="animate-spin" />
                {A ? "جارٍ تحميل قيود المصدر…" : "Loading source records…"}
              </div>
            ) : detail.error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-[12px] text-destructive">
                {(detail.error as Error).message}
              </div>
            ) : detail.data ? (
              <>
                {detail.data.truncated && (
                  <div className="mb-3 rounded-lg border border-amber-border bg-amber-surface/40 p-3 text-[11px] text-text">
                    {A
                      ? `المعروض أول ${fmtNum(detail.data.lines.length)} بند من ${fmtNum(detail.data.totalLines)}؛ الإجمالي أعلى الجدول يشمل الكل.`
                      : `Showing the first ${fmtNum(detail.data.lines.length)} of ${fmtNum(detail.data.totalLines)} lines; the total above includes all lines.`}
                  </div>
                )}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[1020px] text-[10.5px]">
                    <thead className="sticky top-0 bg-surface-2 text-text-muted">
                      <tr className="border-b border-border">
                        {[
                          A ? "تاريخ السداد" : "Paid date",
                          A ? "رقم الفاتورة" : "Invoice",
                          A ? "العميل" : "Customer",
                          A ? "الكورس / المنتج" : "Course / product",
                          A ? "المندوب" : "Salesperson",
                          A ? "الحملة / المجموعة / الإعلان" : "Campaign / ad set / ad",
                          A ? "المصدر" : "Source",
                          A ? "المبلغ" : "Amount",
                        ].map((heading) => (
                          <th key={heading} className="px-3 py-2.5 text-start font-semibold">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.lines.map((line, index) => (
                        <tr
                          key={line.id || `${line.movement}-${index}`}
                          className="border-b border-border/60 last:border-0 hover:bg-surface-2/35"
                        >
                          <td className="num whitespace-nowrap px-3 py-2.5 text-text">
                            {detailDate(line)}
                          </td>
                          <td className="px-3 py-2.5 text-text">
                            <span dir="ltr">{line.movement || line.orderRef || "—"}</span>
                            {line.isCreditNote && (
                              <span className="ms-1 rounded bg-rose-100 px-1 py-0.5 text-[9px] text-rose-700">
                                {A ? "إشعار دائن" : "Credit note"}
                              </span>
                            )}
                          </td>
                          <td
                            className="max-w-44 truncate px-3 py-2.5 text-text"
                            title={line.partner}
                          >
                            {line.partner || "—"}
                          </td>
                          <td className="max-w-52 px-3 py-2.5 text-text">
                            <div className="truncate" title={line.course}>
                              {line.course || "—"}
                            </div>
                            <div
                              className="truncate text-[9px] text-text-subtle"
                              title={line.product}
                            >
                              {line.product}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-text">
                            <div>{line.salesperson || "—"}</div>
                            <div className="text-[9px] text-text-subtle">{line.salesTeam}</div>
                          </td>
                          <td className="max-w-56 px-3 py-2.5 text-text">
                            <div className="truncate" title={line.campaignName}>
                              {line.campaignName || "—"}
                            </div>
                            <div
                              className="truncate text-[9px] text-text-subtle"
                              title={`${line.adset} · ${line.adName}`}
                            >
                              {[line.adset, line.adName].filter(Boolean).join(" · ") || "—"}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-text">{line.source || "—"}</td>
                          <td className="num whitespace-nowrap px-3 py-2.5 text-end font-bold text-text">
                            {fmtUSDFull(line.usdPaid)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

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
