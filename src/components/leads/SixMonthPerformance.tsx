import { useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  CircleHelp,
  Layers3,
  ReceiptText,
  ShieldCheck,
  TrendingDown,
  Users,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useI18n } from "@/lib/i18n";
import { ErrorState, Skeleton } from "@/components/ui-bits";
import type { PerformanceGroup, PerformanceResult } from "@/lib/lead-performance";

type Response = PerformanceResult & {
  syncedAt: string;
  linksRefreshedAt: string | null;
  availability: {
    crm: boolean;
    lost: boolean;
    accounting: boolean;
    crmSyncedAt: string;
    lostSyncedAt: string;
    accountingSyncedAt: string;
  };
};
type Dimension = "course" | "source" | "campaign" | "buyer" | "owner" | "closer";

const copy = {
  ar: {
    title: "رحلة الليد إلى تسجيل مدفوع",
    sub: "آخر ٦ أشهر حسب شهر دخول الليد؛ البيع اللاحق يرجع لمجموعة دخوله الأصلية.",
    fixed:
      "الفترة ثابتة: آخر ٦ أشهر تقويمية، والشهر الحالي حتى اليوم. فلاتر الكورس العامة فقط تنطبق هنا.",
    leads: "سجلات CRM جديدة",
    lost: "فُقدت حتى الآن",
    paid: "تسجيلات مدفوعة مثبتة",
    rate: "تحويل مدفوع مثبت",
    later: "دُفعت في شهر لاحق",
    revenue: "صافي تحصيل المجموعة",
    trend: "مقارنة مجموعات الدخول الشهرية",
    trendSub: "حالة كل مجموعة حتى اليوم، وليست مبيعات الشهر نفسه.",
    month: "شهر الدخول",
    duplicates: "تكرار محتمل",
    same: "داخل الشهر",
    previous: "من شهر سابق",
    confirmed: "مؤكد كسبب فقدان في أودو",
    unqualified: "غير مؤهل",
    noAnswer: "لا يرد",
    unreachable: "تعذر الوصول",
    noInterest: "غير مهتم",
    contact: "محاولات اتصال PBX",
    zero: "لا يوجد سجل PBX",
    one: "محاولة واحدة",
    two: "محاولتان",
    many: "٣ محاولات فأكثر",
    avgAttempts: "متوسط المحاولات",
    avgDays: "أيام لأول محاولة (تقريب يومي)",
    coverage: "تغطية الاتصال",
    reasons: "أسباب الفقدان",
    reasonsSub: "تصنيفات السبب ضمن سجلات Lost الحالية لمجموعة الدخول المختارة.",
    quality: "لماذا لم يتأهل الليد؟",
    data: "بيانات العميل",
    fit: "ملاءمة الكورس",
    unspecified: "سبب غير محدد",
    breakdown: "من أين جاءت النتيجة؟",
    course: "الكورس",
    source: "المصدر",
    campaign: "الحملة",
    buyer: "الميديا باير",
    owner: "مسؤول الليد الحالي",
    closer: "السيلز الذي أغلق فاتورة مدفوعة",
    paidOrders: "أوامر مدفوعة",
    money: "الصافي بالدولار",
    funnel: "مسار التحويل المثبت",
    funnelLead: "دخلت CRM",
    funnelOpp: "مصنّفة فرصة الآن",
    funnelPaid: "ارتبطت بأمر بيع مدفوع",
    definitions: "تعريفات ومراجعة الأرقام",
    definitionText:
      "الجديد = سجل أودو أُنشئ في الشهر، سواء أصبح لاحقًا Opportunity أو Lost. التكرار المحتمل = هوية هاتف/بريد تكررت ولا يعني إلغاء التسجيل تلقائيًا؛ المؤكد هو سبب Duplicate في أودو. غير المؤهل = سبب أودو Not Qualified أو حكم QA يدوي غير صالح. لا يرد/تعذر الوصول/غير مهتم هي أسباب داخل Lost وليست أرقامًا تُضاف فوقه. التحويل = أمر بيع مرتبط بالفرصة ارتباطًا مباشرًا وله صافي فواتير مدفوعة موجب بعد الخصم، وليس مجرد Won في CRM.",
    limits: "حدود الدقة",
    limitsText:
      "*تصنيف الفرصة وLost هو الوضع الحالي، وليس سجل انتقال تاريخي أو لقطة لنهاية شهر الدخول؛ لذلك مستوى الفرصة مؤشر لا مسارًا تاريخيًا مثبتًا. الكورس والمصدر والحملة ومسؤول الليد هي حقول أودو الحالية، وقد تكون تغيّرت منذ دخوله. إسناد الميديا باير من اسم الحملة وقواعد ملكية الكورسات المعتمدة. بيانات المكالمات PBX فقط؛ عدم ظهور مكالمة لا يثبت عدم التواصل عبر واتساب. التكرار بالهوية مؤشر للمراجعة وليس حكمًا نهائيًا. زمن أول اتصال بالأيام لأن نسخة CRM المجمعة بلا ساعة إنشاء دقيقة. الفواتير غير المربوطة لا تُنسب تخمينًا، والإنفاق الإعلاني لا يظهر هنا لعدم وجود ربط محقق بين كل فاتورة وحملة.",
    missingLinks: "ربط أوامر البيع غير متاح؛ مؤشرات الدفع غير مكتملة.",
    limitedLinks:
      "تغطية ربط بنود الحسابات بأوامر البيع منخفضة؛ التحويل المعروض حد أدنى مُثبت وليس معدل التحويل الحقيقي لكل الليدز، فلا تستخدمه وحده لتقييم الفريق.",
    missingAccounting: "بيانات الفواتير المدفوعة قديمة؛ مؤشرات التسجيلات والتحصيل مخفية حتى تتحدث.",
    staleCrm:
      "بيانات CRM قديمة؛ أوقفت التقرير حتى لا يظهر الصفر أو نسبة تحويل مضللة. راجع مزامنة أودو.",
    staleLost:
      "بيانات Lost غير متاحة أو قديمة؛ أوقفت التقرير لأن إجمالي الليدز ونسبة الفقدان سيصبحان ناقصين.",
    missingCalls: "مصدر المكالمات غير متاح؛ لا يمكن الحكم على المحاولات.",
    missingQa: "التحقق اليدوي من جودة الليد غير متاح؛ غير المؤهل هنا من سبب أودو فقط.",
    excluded: "مستبعد من مؤشرات الاستحواذ",
    unknown: "بيانات غير منسوبة",
    rows: "سجل",
    all: "كل الكورسات",
    noRows: "لا توجد سجلات لهذه المجموعة.",
    wonCaveat: "Won في CRM ظاهر للمراجعة فقط، ولا يدخل في معدل التسجيل المدفوع.",
  },
  en: {
    title: "From lead to paid enrollment",
    sub: "Six entry-month cohorts; later payments remain with the original lead month.",
    fixed:
      "Fixed window: six calendar months, current month through today. Only the global course filter applies here.",
    leads: "New CRM records",
    lost: "Lost to date",
    paid: "Verified paid enrollments",
    rate: "Verified paid conversion",
    later: "Paid in a later month",
    revenue: "Net cohort collections",
    trend: "Entry-cohort comparison",
    trendSub: "Current outcome of each cohort, not sales booked in that month.",
    month: "Entry month",
    duplicates: "Potential duplicates",
    same: "Same month",
    previous: "Prior month",
    confirmed: "Confirmed Odoo duplicate reason",
    unqualified: "Unqualified",
    noAnswer: "No answer",
    unreachable: "Unreachable",
    noInterest: "Not interested",
    contact: "PBX call attempts",
    zero: "No PBX record",
    one: "One attempt",
    two: "Two attempts",
    many: "Three or more",
    avgAttempts: "Average attempts",
    avgDays: "Days to first attempt (day-level)",
    coverage: "Call coverage",
    reasons: "Loss reasons",
    reasonsSub: "Reasons within the current Lost records of the selected entry cohort.",
    quality: "Why was the lead unqualified?",
    data: "Customer data",
    fit: "Course fit",
    unspecified: "Unspecified reason",
    breakdown: "Where did the result come from?",
    course: "Course",
    source: "Source",
    campaign: "Campaign",
    buyer: "Media buyer",
    owner: "Current lead owner",
    closer: "Paid-invoice closer",
    paidOrders: "Paid orders",
    money: "Net USD",
    funnel: "Evidence-backed funnel",
    funnelLead: "Entered CRM",
    funnelOpp: "Currently opportunity",
    funnelPaid: "Exact-linked paid order",
    definitions: "Definitions and audit trail",
    definitionText:
      "New means an Odoo CRM record created in the month, including records later converted to Opportunity or Lost. Potential duplicate means matching phone/email identity, not an automatic removal; confirmed duplicate uses the Odoo loss reason. Unqualified means Odoo Not Qualified reason or an invalid manual QA verdict. No answer, unreachable and not interested are reasons within Lost, not extra additive categories. Conversion requires an exact opportunity-linked sale order with positive net paid invoices after credit notes; CRM Won alone never counts.",
    limits: "Accuracy limits",
    limitsText:
      "*Opportunity/Lost is the current status, not a verified transition history or historical month-end snapshot; the opportunity step is a proxy. Course, source, campaign and lead owner are current Odoo fields and may have changed since entry. Media buyer follows campaign naming and approved course ownership. Calls Hub covers PBX only; missing PBX calls do not prove no WhatsApp contact. Identity duplicates require review. First-contact lag is day-level because consolidated CRM creation lacks a reliable time. Unlinked invoices are not guessed onto leads or buyers; ad spend is omitted here without verified invoice-to-campaign attribution.",
    missingLinks: "Sale-order linkage is unavailable; paid metrics are incomplete.",
    limitedLinks:
      "Accounting-line to sale-order coverage is low. Shown conversion is a verified lower bound, not the true conversion of all leads; do not use it alone to judge staff.",
    missingAccounting:
      "Paid-invoice data is stale; enrollment and revenue metrics are hidden until it refreshes.",
    staleCrm:
      "CRM data is stale. This report is paused rather than displaying a misleading zero or conversion rate. Check Odoo sync.",
    staleLost:
      "Lost data is unavailable or stale. This report is paused because entry counts and loss rates would be incomplete.",
    missingCalls: "Calls Hub is unavailable; attempt metrics cannot be assessed.",
    missingQa: "Manual lead QA is unavailable; unqualified uses Odoo reason only.",
    excluded: "Excluded from acquisition KPIs",
    unknown: "Unattributed data",
    rows: "records",
    all: "All courses",
    noRows: "No records for this cohort.",
    wonCaveat: "CRM Won is shown for audit only; it does not enter paid conversion.",
  },
} as const;

const n = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : new Intl.NumberFormat("en-US").format(value);
const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

function MetricCard({
  label,
  value,
  note,
  tone = "blue",
  icon,
  onClick,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "blue" | "rose" | "emerald" | "amber";
  icon: React.ReactNode;
  onClick: () => void;
}) {
  const tones = {
    blue: "border-blue-200 bg-blue-50/70 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30",
    rose: "border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30",
    emerald:
      "border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30",
    amber:
      "border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-5 text-start transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${tones[tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold opacity-80">{label}</span>
        {icon}
      </div>
      <div className="mt-4 text-3xl font-black tabular-nums tracking-tight">{value}</div>
      {note && <div className="mt-1 text-xs opacity-75">{note}</div>}
    </button>
  );
}

export function SixMonthPerformance() {
  const { lang } = useI18n();
  const t = copy[lang];
  const [month, setMonth] = useState("");
  const [dimension, setDimension] = useState<Dimension>("course");
  const { data, isLoading, error } = useApi<Response>(
    `/api/lead-performance${month ? `?month=${month}` : ""}`,
  );
  if (isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  if (error)
    return (
      <ErrorState
        message={
          error.message === "CRM_STALE"
            ? t.staleCrm
            : error.message === "LOST_STALE"
              ? t.staleLost
              : error.message
        }
      />
    );
  if (!data) return null;
  const selected = data.selected;
  const paidReady = data.coverage.linksAvailable && data.availability.accounting;
  const linkedLines = data.coverage.linkedAccountingLines;
  const totalLines = linkedLines + data.coverage.unlinkedAccountingLines;
  const linkCoverage = totalLines ? (linkedLines / totalLines) * 100 : null;
  const showSection = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const dimensions: { id: Dimension; label: string; rows: PerformanceGroup[] }[] = [
    { id: "course", label: t.course, rows: data.byCourse },
    { id: "source", label: t.source, rows: data.bySource },
    { id: "campaign", label: t.campaign, rows: data.byCampaign },
    { id: "buyer", label: t.buyer, rows: data.byMediaBuyer },
    { id: "owner", label: t.owner, rows: data.bySalesOwner },
    { id: "closer", label: t.closer, rows: paidReady ? data.bySalesCloser : [] },
  ];
  const activeDimension = dimensions.find((item) => item.id === dimension)!;
  const maximum = Math.max(1, ...data.rows.map((row) => row.leads));
  const signal = (value: number, total: number, color: string) => (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <div
        className={`h-full rounded-full ${color}`}
        style={{ width: `${Math.min(100, total ? (value / total) * 100 : 0)}%` }}
      />
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950 p-6 text-white shadow-lg md:p-8 dark:border-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] text-sky-300">
              <Layers3 size={15} /> ENGOSOFT · CRM × SALES
            </div>
            <h1 className="text-2xl font-black md:text-3xl">{t.title}</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">{t.sub}</p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs text-slate-200">
            {data.months[0]} → {data.asOf}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label={t.month}>
          {data.months.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMonth(item)}
              aria-pressed={data.selectedMonth === item}
              className={`rounded-full px-4 py-2 text-xs font-bold transition ${data.selectedMonth === item ? "bg-sky-400 text-slate-950 shadow-lg shadow-sky-500/20" : "bg-white/10 text-slate-200 hover:bg-white/20"}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        {t.fixed}
      </p>
      {(!data.coverage.linksAvailable ||
        (linkCoverage !== null && linkCoverage < 90) ||
        !data.availability.accounting ||
        !data.coverage.callsAvailable ||
        !data.coverage.qaAvailable) && (
        <div className="space-y-2">
          {!data.coverage.linksAvailable && <Notice text={t.missingLinks} />}
          {linkCoverage !== null && linkCoverage < 90 && (
            <Notice text={`${t.limitedLinks} (${pct(linkCoverage)})`} />
          )}
          {!data.availability.accounting && <Notice text={t.missingAccounting} />}
          {!data.coverage.callsAvailable && <Notice text={t.missingCalls} />}
          {!data.coverage.qaAvailable && <Notice text={t.missingQa} />}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={t.leads}
          value={n(selected.leads)}
          icon={<Users size={18} />}
          onClick={() => showSection("performance-trend")}
        />
        <MetricCard
          label={t.lost}
          value={n(selected.lost)}
          note={pct(selected.lostRate)}
          tone="rose"
          icon={<TrendingDown size={18} />}
          onClick={() => showSection("performance-reasons")}
        />
        <MetricCard
          label={t.paid}
          value={paidReady ? n(selected.paidLeads) : "—"}
          note={t.wonCaveat}
          tone="emerald"
          icon={<BadgeCheck size={18} />}
          onClick={() => {
            setDimension("closer");
            showSection("performance-breakdown");
          }}
        />
        <MetricCard
          label={t.rate}
          value={paidReady ? pct(selected.conversionRate) : "—"}
          note={paidReady ? `${n(selected.paidLater)} ${t.later}` : undefined}
          tone="blue"
          icon={<ArrowUpRight size={18} />}
          onClick={() => showSection("performance-funnel")}
        />
        <MetricCard
          label={t.revenue}
          value={paidReady ? money(selected.paidRevenue) : "—"}
          tone="amber"
          icon={<ReceiptText size={18} />}
          onClick={() => {
            setDimension("campaign");
            showSection("performance-breakdown");
          }}
        />
      </div>

      <section
        id="performance-trend"
        className="scroll-mt-28 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6"
      >
        <SectionTitle title={t.trend} subtitle={t.trendSub} />
        <div className="mt-5 grid gap-3 md:grid-cols-6">
          {data.rows.map((row) => (
            <button
              key={row.name}
              type="button"
              onClick={() => setMonth(row.name)}
              className={`rounded-2xl border p-3 text-start transition hover:-translate-y-0.5 hover:shadow-md ${data.selectedMonth === row.name ? "border-sky-400 bg-sky-50 dark:bg-sky-950/30" : "border-slate-200 dark:border-slate-700"}`}
            >
              <div className="text-xs font-bold text-slate-500">{row.name}</div>
              <div className="mt-2 text-2xl font-black tabular-nums text-slate-900 dark:text-white">
                {n(row.leads)}
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-sky-500"
                  style={{ width: `${(row.leads / maximum) * 100}%` }}
                />
              </div>
              <div className="mt-3 flex justify-between text-[11px] text-slate-500">
                <span>
                  {t.lost} {n(row.lost)}
                </span>
                <span>
                  {t.paid} {paidReady ? n(row.paidLeads) : "—"}
                </span>
              </div>
            </button>
          ))}
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-700">
              <tr>
                <th className="py-2 text-start">{t.month}</th>
                <th className="py-2 text-end">{t.leads}</th>
                <th className="py-2 text-end">{t.duplicates}</th>
                <th className="py-2 text-end">{t.unqualified}</th>
                <th className="py-2 text-end">{t.lost}</th>
                <th className="py-2 text-end">{t.paid}</th>
                <th className="py-2 text-end">{t.rate}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.name} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 font-bold">{row.name}</td>
                  <td className="py-2 text-end tabular-nums">{n(row.leads)}</td>
                  <td className="py-2 text-end tabular-nums">
                    {n(row.duplicateSameMonth + row.duplicateEarlierMonth)} ·{" "}
                    {pct(
                      row.leads
                        ? ((row.duplicateSameMonth + row.duplicateEarlierMonth) / row.leads) * 100
                        : null,
                    )}
                  </td>
                  <td className="py-2 text-end tabular-nums">{n(row.unqualified)}</td>
                  <td className="py-2 text-end tabular-nums text-rose-600">
                    {n(row.lost)} · {pct(row.lostRate)}
                  </td>
                  <td className="py-2 text-end tabular-nums text-emerald-600">
                    {paidReady ? n(row.paidLeads) : "—"}
                  </td>
                  <td className="py-2 text-end tabular-nums">
                    {paidReady ? pct(row.conversionRate) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          id="performance-funnel"
          className="scroll-mt-28 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6"
        >
          <SectionTitle title={t.funnel} subtitle={t.wonCaveat} />
          <div className="mt-5 space-y-4">
            <FunnelRow
              label={t.funnelLead}
              value={selected.leads}
              max={selected.leads}
              color="bg-sky-500"
            />
            <FunnelRow
              label={t.funnelOpp}
              value={selected.opportunities}
              max={selected.leads}
              color="bg-indigo-500"
              caveat
            />
            <FunnelRow
              label={t.funnelPaid}
              value={paidReady ? selected.paidLeads : null}
              max={selected.leads}
              color="bg-emerald-500"
            />
          </div>
        </section>
        <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
          <SectionTitle
            title={t.duplicates}
            subtitle={`${pct(selected.leads ? ((selected.duplicateSameMonth + selected.duplicateEarlierMonth) / selected.leads) * 100 : null)} · ${t.confirmed}: ${n(selected.confirmedDuplicate)}`}
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <SmallStat label={t.same} value={n(selected.duplicateSameMonth)} />
            <SmallStat label={t.previous} value={n(selected.duplicateEarlierMonth)} />
            <SmallStat label={t.unqualified} value={n(selected.unqualified)} />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span>
              {t.noAnswer}{" "}
              <b className="block text-lg text-slate-900 dark:text-white">{n(selected.noAnswer)}</b>
            </span>
            <span>
              {t.unreachable}{" "}
              <b className="block text-lg text-slate-900 dark:text-white">
                {n(selected.unreachable)}
              </b>
            </span>
            <span>
              {t.noInterest}{" "}
              <b className="block text-lg text-slate-900 dark:text-white">
                {n(selected.noInterest)}
              </b>
            </span>
          </div>
        </section>
      </div>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
        <SectionTitle
          title={t.contact}
          subtitle={
            data.coverage.callsAvailable
              ? `${t.coverage}: ${n(selected.callMatchable)} / ${n(selected.leads)}`
              : t.missingCalls
          }
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <SmallStat label={t.zero} value={n(selected.contact0)} />
          <SmallStat label={t.one} value={n(selected.contact1)} />
          <SmallStat label={t.two} value={n(selected.contact2)} />
          <SmallStat label={t.many} value={n(selected.contact3Plus)} />
          <SmallStat label={t.avgAttempts} value={n(selected.averageAttempts)} />
          <SmallStat label={t.avgDays} value={n(selected.averageDaysToFirstCall)} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          id="performance-reasons"
          className="scroll-mt-28 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6"
        >
          <SectionTitle title={t.reasons} subtitle={t.reasonsSub} />
          <div className="mt-5 space-y-3">
            {data.lossReasons.slice(0, 8).map((reason) => (
              <div key={reason.key}>
                <div className="mb-1 flex justify-between gap-3 text-xs font-semibold">
                  <span>{lang === "ar" ? reason.ar : reason.en}</span>
                  <span className="tabular-nums">{n(reason.count)}</span>
                </div>
                {signal(reason.count, selected.lost, "bg-rose-500")}
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
          <SectionTitle
            title={t.quality}
            subtitle={`${t.unqualified}: ${n(selected.unqualified)}`}
          />
          <div className="mt-5 space-y-4">
            {data.unqualifiedReasons.map((row) => (
              <div key={row.category}>
                <div className="mb-1 flex justify-between gap-3 text-sm font-semibold">
                  <span>
                    {row.category === "customer_data"
                      ? t.data
                      : row.category === "course_fit"
                        ? t.fit
                        : t.unspecified}
                  </span>
                  <span className="tabular-nums">{n(row.count)}</span>
                </div>
                {signal(row.count, selected.unqualified, "bg-amber-500")}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section
        id="performance-breakdown"
        className="scroll-mt-28 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6"
      >
        <SectionTitle title={t.breakdown} subtitle={t.trendSub} />
        <div className="mt-5 flex flex-wrap gap-2" role="tablist">
          {dimensions.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={dimension === item.id}
              type="button"
              onClick={() => setDimension(item.id)}
              className={`rounded-full px-4 py-2 text-xs font-bold transition ${dimension === item.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead className="border-b border-slate-200 text-start text-xs text-slate-500 dark:border-slate-700">
              <tr>
                <th className="py-3 text-start">{activeDimension.label}</th>
                <th className="py-3 text-end">{dimension === "closer" ? t.paid : t.leads}</th>
                <th className="py-3 text-end">{t.duplicates}</th>
                <th className="py-3 text-end">{t.unqualified}</th>
                <th className="py-3 text-end">{t.noAnswer}</th>
                <th className="py-3 text-end">{t.unreachable}</th>
                <th className="py-3 text-end">{t.noInterest}</th>
                <th className="py-3 text-end">{t.lost}</th>
                <th className="py-3 text-end">{t.paid}</th>
                <th className="py-3 text-end">{t.rate}</th>
                <th className="py-3 text-end">{t.paidOrders}</th>
                <th className="py-3 text-end">{t.money}</th>
              </tr>
            </thead>
            <tbody>
              {activeDimension.rows.map((row) => (
                <tr key={row.name} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="max-w-64 truncate py-3 font-semibold" title={row.name}>
                    {row.name}
                  </td>
                  <td className="py-3 text-end tabular-nums">{n(row.leads)}</td>
                  <td className="py-3 text-end tabular-nums">
                    {n(row.duplicateSameMonth + row.duplicateEarlierMonth)}
                  </td>
                  <td className="py-3 text-end tabular-nums">{n(row.unqualified)}</td>
                  <td className="py-3 text-end tabular-nums">
                    {dimension === "closer" ? "—" : n(row.noAnswer)}
                  </td>
                  <td className="py-3 text-end tabular-nums">
                    {dimension === "closer" ? "—" : n(row.unreachable)}
                  </td>
                  <td className="py-3 text-end tabular-nums">
                    {dimension === "closer" ? "—" : n(row.noInterest)}
                  </td>
                  <td className="py-3 text-end tabular-nums text-rose-600">
                    {dimension === "closer" ? "—" : `${n(row.lost)} · ${pct(row.lostRate)}`}
                  </td>
                  <td className="py-3 text-end tabular-nums text-emerald-600">
                    {paidReady ? n(row.paidLeads) : "—"}
                  </td>
                  <td className="py-3 text-end tabular-nums">
                    {paidReady && dimension !== "closer" ? pct(row.conversionRate) : "—"}
                  </td>
                  <td className="py-3 text-end tabular-nums">
                    {paidReady ? n(row.paidOrders) : "—"}
                  </td>
                  <td className="py-3 text-end tabular-nums">
                    {paidReady ? money(row.paidRevenue) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!activeDimension.rows.length && (
            <p className="py-10 text-center text-sm text-slate-500">{t.noRows}</p>
          )}
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 text-sm dark:border-slate-800 dark:bg-slate-900 md:p-6">
        <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <ShieldCheck size={18} className="text-emerald-600" />
          {t.definitions}
        </div>
        <p className="mt-3 leading-7 text-slate-600 dark:text-slate-300">{t.definitionText}</p>
        <div className="mt-5 flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <CircleHelp size={18} className="text-amber-600" />
          {t.limits}
        </div>
        <p className="mt-3 leading-7 text-slate-600 dark:text-slate-300">{t.limitsText}</p>
        <div className="mt-5 grid gap-2 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
          <span>
            {t.excluded}: Recommendation {n(data.coverage.excludedRecommendation)} · WhatsApp
            Broadcast {n(data.coverage.excludedBroadcast)}
          </span>
          <span>
            {t.unknown}: {t.campaign} {n(data.coverage.unknownCampaign)} · {t.buyer}{" "}
            {n(data.coverage.unknownMediaBuyer)}
          </span>
          <span>
            {lang === "ar" ? "بنود مالية غير مربوطة" : "Unlinked accounting lines"}:{" "}
            {n(data.coverage.unlinkedAccountingLines)}
          </span>
          <span>
            {lang === "ar" ? "مراجعات الجودة اليدوية لهذه المجموعة" : "Manual QA reviews in cohort"}
            : {n(data.coverage.qaReviewed)} / {n(selected.leads)}
          </span>
          <span>
            {lang === "ar" ? "آخر مزامنة" : "Last sync"}: {data.syncedAt || "—"}
          </span>
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-black text-slate-900 dark:text-white">{title}</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 text-xl font-black tabular-nums text-slate-900 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function FunnelRow({
  label,
  value,
  max,
  color,
  caveat = false,
}: {
  label: string;
  value: number | null;
  max: number;
  color: string;
  caveat?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm font-semibold">
        <span>
          {label}
          {caveat ? " *" : ""}
        </span>
        <span className="tabular-nums">{n(value)}</span>
      </div>
      <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${value === null ? 0 : Math.min(100, max ? (value / max) * 100 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      <AlertTriangle size={16} />
      {text}
    </div>
  );
}
