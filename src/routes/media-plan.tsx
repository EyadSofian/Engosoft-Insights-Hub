import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowUpRight,
  BadgeDollarSign,
  Gauge,
  Info,
  Landmark,
  Target,
  TriangleAlert,
  UserRoundCheck,
  Users,
  WalletCards,
} from "lucide-react";
import {
  Card,
  ErrorState,
  Notice,
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";

export const Route = createFileRoute("/media-plan")({ component: MediaPlanPage });

type PlanStatus = "approved" | "draft";
type PlanPhase = "upcoming" | "active" | "complete";

interface CourseRow {
  key: string;
  label: string;
  targetLeads: number;
  targetCpl: number;
  targetBudgetUsd: number;
  owners: string[];
  actual: {
    spend: number;
    platformLeads: number | null;
    crmLeads: number;
    won: number;
    lost: number;
    revenueUsd: number;
    invoices: number;
    actualLeads: number;
    leadBasis: "platform" | "crm_fallback";
    actualCpl: number | null;
    achievement: number | null;
    expectedLeads: number;
    expectedAchievement: number;
    budgetUsed: number | null;
    cplVariance: number | null;
  };
}

interface MediaPlanResponse {
  plan: {
    month: string;
    status: PlanStatus;
    basisMonth?: string;
    leadTarget: number;
    paidLeadTarget: number;
    organicWebinarLeadTarget: number;
    leadGenerationBudgetUsd: number;
    salesTargetSar: number;
    targetCpl: number | null;
    plannedCourseBudgetUsd: number;
    reserveBudgetUsd: number;
    additionalBudgetUsd: number;
    totalMarketingBudgetUsd: number;
    additionalActivities: { key: string; label: string; budgetUsd: number }[];
  };
  window: {
    from: string;
    to: string;
    days: number;
    today: string;
    elapsed: number;
    phase: PlanPhase;
  };
  actual: {
    targetedSpend: number;
    targetedLeads: number;
    targetedCrmLeads: number;
    targetedCpl: number | null;
    paidLeadAchievement: number | null;
    organicWebinarLeads: number;
    organicAchievement: number | null;
    allSpend: number;
    unattributedOrUnplannedSpend: number;
    revenueUsd: number;
    revenueSar: number;
    salesAchievement: number | null;
  };
  courses: CourseRow[];
  unplanned: {
    course: string;
    spend: number;
    platformLeads: number | null;
    crmLeads: number;
  }[];
  availableMonths: string[];
  sources: string[];
}

const ratioPct = (value: number | null): string => (value === null ? "—" : fmtPct(value * 100, 1));

const barWidth = (value: number | null): string =>
  `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%`;

function monthName(month: string, lang: "ar" | "en"): string {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, number - 1, 1)));
}

function sar(value: number, lang: "ar" | "en"): string {
  const formatted = new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", {
    maximumFractionDigits: 0,
  }).format(value);
  return lang === "ar" ? `${formatted} ر.س` : `SAR ${formatted}`;
}

function courseState(row: CourseRow, phase: PlanPhase) {
  if (phase === "upcoming") return { tone: "neutral" as const, key: "upcoming" };
  if (row.actual.spend <= 0 && row.actual.actualLeads <= 0) {
    return { tone: "danger" as const, key: "no_delivery" };
  }
  if ((row.actual.cplVariance ?? 0) > 0.1) {
    return { tone: "warning" as const, key: "high_cpl" };
  }
  if ((row.actual.achievement ?? 0) + 0.04 < row.actual.expectedAchievement) {
    return { tone: "danger" as const, key: "behind" };
  }
  return { tone: "success" as const, key: "on_track" };
}

function MediaPlanPage() {
  const { lang } = useI18n();
  const [month, setMonth] = useState("2026-09");
  const { data, isLoading, error, refetch } = useApi<MediaPlanResponse>(
    `/api/media-plan?month=${month}`,
  );

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={lang === "ar" ? "خطة الميديا الشهرية" : "Monthly media plan"}
          subtitle={
            lang === "ar"
              ? "لوحة واحدة تربط التارجت بالصرف والليدز الفعلية لكل دورة ومسؤول."
              : "One planning board linking every course target and owner to actual spend and leads."
          }
        />
        <Link
          to="/media-buyers"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-brand transition-colors hover:bg-surface-2"
        >
          {lang === "ar" ? "فتح تقييم الميديا بايرز" : "Open buyer evaluation"}
          <ArrowUpRight size={14} />
        </Link>
      </div>

      {isLoading || !data ? (
        <MediaPlanSkeleton />
      ) : (
        <>
          <section className="relative overflow-hidden rounded-[28px] border border-[#173b61] bg-[#071a31] p-5 text-white shadow-[0_18px_55px_rgba(4,20,38,0.18)] sm:p-7">
            <div
              className="pointer-events-none absolute inset-0 opacity-25"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)",
                backgroundSize: "34px 34px",
                maskImage: "linear-gradient(to left, black, transparent 70%)",
              }}
            />
            <div className="pointer-events-none absolute -bottom-20 -left-16 size-64 rounded-full bg-[#f5ad24]/20 blur-3xl" />

            <div className="relative z-10 flex flex-wrap items-start justify-between gap-5">
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Pill tone={data.plan.status === "draft" ? "warning" : "success"}>
                    {data.plan.status === "draft"
                      ? lang === "ar"
                        ? "مسودة تحتاج اعتماد"
                        : "Draft - approval needed"
                      : lang === "ar"
                        ? "خطة معتمدة"
                        : "Approved plan"}
                  </Pill>
                  <span className="text-xs text-white/55">
                    {data.window.from} - {data.window.to}
                  </span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-4xl">
                  {monthName(data.plan.month, lang)}
                </h2>
                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/65 sm:text-sm">
                  {data.plan.status === "draft" && data.plan.basisMonth
                    ? lang === "ar"
                      ? `الأرقام منسوخة بوضوح من خطة ${monthName(data.plan.basisMonth, lang)} كخط أساس، مع CPL Benchmarks من خطة يوليو، لحين اعتماد أرقام سبتمبر النهائية.`
                      : `Targets are visibly copied from ${monthName(data.plan.basisMonth, lang)} as a baseline, with July CPL benchmarks, until September is approved.`
                    : lang === "ar"
                      ? "الخطة المعتمدة للشهر مع مقارنة التنفيذ الفعلي."
                      : "Approved monthly targets compared with actual delivery."}
                </p>
              </div>

              <label className="block min-w-52 text-xs font-semibold text-white/60">
                {lang === "ar" ? "شهر الخطة" : "Plan month"}
                <select
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm font-semibold text-white outline-none ring-[#f5ad24] focus:ring-2"
                >
                  {data.availableMonths.map((value) => (
                    <option key={value} value={value} className="text-black">
                      {monthName(value, lang)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="relative z-10 mt-7 grid grid-cols-2 gap-2.5 lg:grid-cols-4 xl:grid-cols-6">
              <HeroMetric
                label={lang === "ar" ? "تارجت الشهر" : "Monthly lead target"}
                value={fmtNum(data.plan.leadTarget)}
                sub={lang === "ar" ? "Paid + Organic/Webinar" : "Paid + Organic/Webinar"}
                icon={<Target size={17} />}
              />
              <HeroMetric
                label={lang === "ar" ? "تارجت Paid" : "Paid lead target"}
                value={fmtNum(data.plan.paidLeadTarget)}
                sub={ratioPct(data.actual.paidLeadAchievement)}
                icon={<Users size={17} />}
              />
              <HeroMetric
                label={lang === "ar" ? "ميزانية الليدز" : "Lead-gen budget"}
                value={fmtUSDFull(data.plan.leadGenerationBudgetUsd)}
                sub={`${fmtUSDFull(data.actual.targetedSpend)} ${lang === "ar" ? "مصروف" : "spent"}`}
                icon={<WalletCards size={17} />}
              />
              <HeroMetric
                label={lang === "ar" ? "CPL المستهدف" : "Target CPL"}
                value={fmtUSDFull(data.plan.targetCpl)}
                sub={`${lang === "ar" ? "الفعلي" : "actual"} ${fmtUSDFull(data.actual.targetedCpl)}`}
                icon={<Gauge size={17} />}
              />
              <HeroMetric
                label={lang === "ar" ? "تارجت المبيعات" : "Sales target"}
                value={sar(data.plan.salesTargetSar, lang)}
                sub={ratioPct(data.actual.salesAchievement)}
                icon={<Landmark size={17} />}
              />
              <HeroMetric
                label={lang === "ar" ? "إجمالي ميزانية التسويق" : "Total marketing budget"}
                value={fmtUSDFull(data.plan.totalMarketingBudgetUsd)}
                sub={`+ ${fmtUSDFull(data.plan.additionalBudgetUsd)} ${lang === "ar" ? "أنشطة إضافية" : "extra activities"}`}
                icon={<BadgeDollarSign size={17} />}
              />
            </div>
          </section>

          {data.plan.status === "draft" && (
            <Notice tone="warning" icon={<TriangleAlert size={16} />}>
              {lang === "ar"
                ? "أرقام سبتمبر ليست اعتمادًا إداريًا جديدًا بعد؛ هي Baseline من أغسطس حتى لا تبدأ لوحة المتابعة فارغة. غيّرها عند وصول الخطة النهائية قبل اتخاذ قرار زيادة أو خفض الميزانية."
                : "September is not newly approved yet; it uses August as a visible baseline so tracking does not start empty. Replace it when management publishes the final plan."}
            </Notice>
          )}

          <Card className="overflow-hidden">
            <SectionTitle
              hint={
                lang === "ar"
                  ? "المطلوب حتى اليوم محسوب حسب نسبة الأيام المنقضية من الشهر، وليس التارجت الكامل من أول يوم."
                  : "Expected-to-date uses elapsed calendar days, not the entire monthly target from day one."
              }
              action={
                <Pill tone={data.window.phase === "active" ? "brand" : "neutral"}>
                  {data.window.phase === "upcoming"
                    ? lang === "ar"
                      ? "لم يبدأ الشهر"
                      : "Month not started"
                    : data.window.phase === "complete"
                      ? lang === "ar"
                        ? "الشهر مكتمل"
                        : "Month complete"
                      : `${ratioPct(data.window.elapsed)} ${lang === "ar" ? "من الشهر" : "elapsed"}`}
                </Pill>
              }
            >
              {lang === "ar" ? "المطلوب مقابل المتحقق" : "Plan versus actual"}
            </SectionTitle>
            <div className="grid gap-4 lg:grid-cols-3">
              <ProgressRail
                label={lang === "ar" ? "ليدز الحملات المدفوعة" : "Paid campaign leads"}
                actual={fmtNum(data.actual.targetedLeads)}
                target={fmtNum(data.plan.paidLeadTarget)}
                ratio={data.actual.paidLeadAchievement}
                expected={data.window.elapsed}
                accent="#1d6fdc"
              />
              <ProgressRail
                label={lang === "ar" ? "Organic + Webinar" : "Organic + Webinar"}
                actual={fmtNum(data.actual.organicWebinarLeads)}
                target={fmtNum(data.plan.organicWebinarLeadTarget)}
                ratio={data.actual.organicAchievement}
                expected={data.window.elapsed}
                accent="#159a78"
              />
              <ProgressRail
                label={lang === "ar" ? "المبيعات المحصلة" : "Collected sales"}
                actual={sar(data.actual.revenueSar, lang)}
                target={sar(data.plan.salesTargetSar, lang)}
                ratio={data.actual.salesAchievement}
                expected={data.window.elapsed}
                accent="#e59318"
              />
            </div>
          </Card>

          <Card padded={false} className="overflow-hidden">
            <div className="p-4 sm:p-5">
              <SectionTitle
                hint={
                  lang === "ar"
                    ? "Actual Leads من المنصة عند توفرها؛ وإذا المنصة لا ترسلها يظهر CRM fallback بوضوح."
                    : "Actual leads use platform reporting when available; CRM fallback is labelled explicitly."
                }
              >
                {lang === "ar" ? "خطة كل دورة والمسؤول عنها" : "Course targets and ownership"}
              </SectionTitle>
            </div>

            <div className="hidden table-wrap scroll-hint-x lg:block">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="bg-surface-2 text-xs text-text-muted">
                  <tr>
                    {[
                      lang === "ar" ? "الدورة" : "Course",
                      lang === "ar" ? "المسؤول" : "Owner",
                      lang === "ar" ? "تارجت الليدز" : "Lead target",
                      lang === "ar" ? "Budget" : "Budget",
                      lang === "ar" ? "Target CPL" : "Target CPL",
                      lang === "ar" ? "ليدز فعلية" : "Actual leads",
                      lang === "ar" ? "Actual CPL" : "Actual CPL",
                      lang === "ar" ? "الصرف" : "Spend",
                      lang === "ar" ? "الإنجاز" : "Progress",
                      lang === "ar" ? "الحالة" : "Status",
                    ].map((header) => (
                      <th key={header} className="px-3 py-3 text-start font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.courses.map((row) => (
                    <CourseTableRow key={row.key} row={row} phase={data.window.phase} lang={lang} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-3 pt-0 lg:hidden">
              {data.courses.map((row) => (
                <CourseMobileCard key={row.key} row={row} phase={data.window.phase} lang={lang} />
              ))}
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
            <Card>
              <SectionTitle
                hint={
                  lang === "ar"
                    ? "دي ليست ضمن $20K الخاصة بتوليد الليدز."
                    : "These activities sit outside the $20K lead-generation budget."
                }
              >
                {lang === "ar" ? "الميزانية الإضافية" : "Additional activity budget"}
              </SectionTitle>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data.plan.additionalActivities.map((activity) => (
                  <div
                    key={activity.key}
                    className="rounded-2xl border border-border bg-surface-2 p-3"
                  >
                    <div className="text-[11px] leading-snug text-text-muted">{activity.label}</div>
                    <div className="num mt-2 text-lg font-bold text-text">
                      {fmtUSDFull(activity.budgetUsd)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-text-muted">
                <span>
                  {lang === "ar" ? "المحجوز للدورات" : "Allocated to courses"}:{" "}
                  {fmtUSDFull(data.plan.plannedCourseBudgetUsd)}
                </span>
                <span>
                  {lang === "ar" ? "احتياطي من ميزانية الليدز" : "Lead budget reserve"}:{" "}
                  {fmtUSDFull(data.plan.reserveBudgetUsd)}
                </span>
              </div>
            </Card>

            <Card>
              <SectionTitle>
                {lang === "ar" ? "مصدر الخطة وطريقة القراءة" : "Plan source and reading guide"}
              </SectionTitle>
              <div className="space-y-3 text-xs leading-relaxed text-text-muted">
                <div className="flex gap-2">
                  <Info size={15} className="mt-0.5 shrink-0 text-brand" />
                  <p>
                    {lang === "ar"
                      ? "تارجت الدورات الست = 4,000 Paid Leads. الـ1,000 الباقية مستهدف Organic وWebinar، لذلك لا تُوزع مرتين على الدورات."
                      : "The six course rows total 4,000 paid leads. The remaining 1,000 belong to Organic and Webinar, so they are not double-counted by course."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <UserRoundCheck size={15} className="mt-0.5 shrink-0 text-brand" />
                  <p>
                    {lang === "ar"
                      ? "المسؤولون من خطة أغسطس: Sayed وShazly، مع المسؤوليات المشتركة ظاهرة بدل تقسيم الليدز افتراضيًا بينهم."
                      : "Owners come from the August plan. Joint ownership remains explicit instead of inventing a split between buyers."}
                  </p>
                </div>
                {data.sources.map((source) => (
                  <p
                    key={source}
                    className="border-t border-border pt-2 text-[11px] text-text-subtle"
                  >
                    {source}
                  </p>
                ))}
              </div>
            </Card>
          </div>

          {(data.actual.unattributedOrUnplannedSpend > 0 || data.unplanned.length > 0) && (
            <Notice tone="warning" icon={<TriangleAlert size={16} />}>
              {lang === "ar"
                ? `يوجد ${fmtUSDFull(data.actual.unattributedOrUnplannedSpend)} صرف خارج الدورات الست أو غير قابل للربط بها في هذا الشهر. راجع أسماء الحملات قبل اعتباره جزءًا من تحقيق الخطة.`
                : `${fmtUSDFull(data.actual.unattributedOrUnplannedSpend)} of spend is outside the six planned courses or cannot be attributed to them. Review campaign naming before counting it toward the plan.`}
            </Notice>
          )}
        </>
      )}
    </div>
  );
}

function HeroMetric({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-3 backdrop-blur-sm sm:p-4">
      <div className="flex items-start justify-between gap-2 text-[11px] text-white/55">
        <span className="leading-snug">{label}</span>
        <span className="text-[#f5ad24]">{icon}</span>
      </div>
      <div className="num mt-2 text-lg font-bold tracking-tight sm:text-xl">{value}</div>
      <div className="mt-1 text-[10px] text-white/45">{sub}</div>
    </div>
  );
}

function ProgressRail({
  label,
  actual,
  target,
  ratio,
  expected,
  accent,
}: {
  label: string;
  actual: string;
  target: string;
  ratio: number | null;
  expected: number;
  accent: string;
}) {
  const { lang } = useI18n();
  return (
    <div className="rounded-2xl border border-border bg-surface-2/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-text">{label}</span>
        <span className="num text-xs font-bold" style={{ color: accent }}>
          {ratioPct(ratio)}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="num text-xl font-bold text-text">{actual}</span>
        <span className="text-[11px] text-text-subtle">/ {target}</span>
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: barWidth(ratio), background: accent }}
        />
        <span
          className="absolute inset-y-[-2px] w-0.5 bg-text/55"
          style={{ insetInlineStart: barWidth(expected) }}
          title={lang === "ar" ? "المطلوب حتى اليوم" : "Expected to date"}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-text-subtle">
        <span>{lang === "ar" ? "المتحقق" : "Actual"}</span>
        <span>
          {lang === "ar" ? "المطلوب حتى اليوم" : "Expected today"}: {ratioPct(expected)}
        </span>
      </div>
    </div>
  );
}

function CourseTableRow({
  row,
  phase,
  lang,
}: {
  row: CourseRow;
  phase: PlanPhase;
  lang: "ar" | "en";
}) {
  const state = courseState(row, phase);
  return (
    <tr className="hover:bg-surface-2/55">
      <td className="px-3 py-3.5 font-bold text-text">{row.label}</td>
      <td className="px-3 py-3.5">
        <OwnerList owners={row.owners} />
      </td>
      <td className="num px-3 py-3.5 font-semibold text-text">{fmtNum(row.targetLeads)}</td>
      <td className="num px-3 py-3.5">{fmtUSDFull(row.targetBudgetUsd)}</td>
      <td className="num px-3 py-3.5">{fmtUSDFull(row.targetCpl)}</td>
      <td className="px-3 py-3.5">
        <div className="num font-semibold text-text">{fmtNum(row.actual.actualLeads)}</div>
        <div className="mt-0.5 text-[10px] text-text-subtle">
          {row.actual.leadBasis === "platform" ? "Platform" : "CRM fallback"} · CRM{" "}
          {fmtNum(row.actual.crmLeads)}
        </div>
      </td>
      <td className="num px-3 py-3.5">{fmtUSDFull(row.actual.actualCpl)}</td>
      <td className="num px-3 py-3.5">{fmtUSDFull(row.actual.spend)}</td>
      <td className="min-w-32 px-3 py-3.5">
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-text-muted">
          <span>{ratioPct(row.actual.achievement)}</span>
          <span>{fmtNum(Math.round(row.actual.expectedLeads))}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: barWidth(row.actual.achievement) }}
          />
        </div>
      </td>
      <td className="px-3 py-3.5">
        <Pill tone={state.tone}>{stateLabel(state.key, lang)}</Pill>
      </td>
    </tr>
  );
}

function CourseMobileCard({
  row,
  phase,
  lang,
}: {
  row: CourseRow;
  phase: PlanPhase;
  lang: "ar" | "en";
}) {
  const state = courseState(row, phase);
  return (
    <article className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-text">{row.label}</h3>
          <div className="mt-1">
            <OwnerList owners={row.owners} />
          </div>
        </div>
        <Pill tone={state.tone}>{stateLabel(state.key, lang)}</Pill>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <CompactMetric
          label={lang === "ar" ? "التارجت" : "Target"}
          value={fmtNum(row.targetLeads)}
        />
        <CompactMetric label="Target CPL" value={fmtUSDFull(row.targetCpl)} />
        <CompactMetric
          label={lang === "ar" ? "الميزانية" : "Budget"}
          value={fmtUSDFull(row.targetBudgetUsd)}
        />
        <CompactMetric
          label={lang === "ar" ? "ليدز فعلية" : "Actual leads"}
          value={fmtNum(row.actual.actualLeads)}
        />
        <CompactMetric label="Actual CPL" value={fmtUSDFull(row.actual.actualCpl)} />
        <CompactMetric
          label={lang === "ar" ? "الصرف" : "Spend"}
          value={fmtUSDFull(row.actual.spend)}
        />
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: barWidth(row.actual.achievement) }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-text-subtle">
        <span>{ratioPct(row.actual.achievement)}</span>
        <span>
          {lang === "ar" ? "المطلوب حتى اليوم" : "Expected today"}:{" "}
          {fmtNum(Math.round(row.actual.expectedLeads))}
        </span>
      </div>
    </article>
  );
}

function OwnerList({ owners }: { owners: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {owners.map((owner) => (
        <span
          key={owner}
          className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand"
        >
          {owner}
        </span>
      ))}
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-2">
      <div className="text-[9px] leading-snug text-text-subtle">{label}</div>
      <div className="num mt-1 truncate text-xs font-bold text-text">{value}</div>
    </div>
  );
}

function stateLabel(key: string, lang: "ar" | "en") {
  const labels: Record<string, { ar: string; en: string }> = {
    upcoming: { ar: "لم يبدأ", en: "Not started" },
    no_delivery: { ar: "لا يوجد تشغيل", en: "No delivery" },
    high_cpl: { ar: "CPL أعلى", en: "CPL high" },
    behind: { ar: "أقل من المطلوب", en: "Behind plan" },
    on_track: { ar: "على المسار", en: "On track" },
  };
  return labels[key]?.[lang] ?? key;
}

function MediaPlanSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-80 rounded-[28px]" />
      <Skeleton className="h-52" />
      <Skeleton className="h-[420px]" />
    </div>
  );
}
