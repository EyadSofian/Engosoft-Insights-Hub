import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BadgeDollarSign,
  BookOpen,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Filter,
  GraduationCap,
  Megaphone,
  ReceiptText,
  Search,
  Sparkles,
  Target,
  TrendingDown,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader, Pill } from "@/components/ui-bits";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/guide")({ component: GuidePage });

function GuidePage() {
  const { lang } = useI18n();
  const ar = lang === "ar";

  return (
    <div className="space-y-6">
      <PageHeader
        title={ar ? "دليل استخدام الداشبورد" : "Dashboard user guide"}
        subtitle={
          ar
            ? "من أول اختيار الفترة لحد معرفة الحملة باعت كام — وكل رقم جاي منين."
            : "From choosing a period to tracing campaign sales—and the source behind every number."
        }
      />

      <section className="relative overflow-hidden rounded-3xl border border-brand/20 bg-[linear-gradient(135deg,var(--navy),color-mix(in_oklab,var(--brand)_76%,var(--navy)))] p-5 text-white shadow-sm sm:p-8">
        <div className="absolute -end-20 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="relative max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold">
            <BookOpen size={14} />
            {ar ? "اقرأها في 5 دقايق" : "A five-minute walkthrough"}
          </span>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            {ar
              ? "المختصر: اختار الفترة، افتح التقرير، واضغط الصف للتفاصيل"
              : "The short version: choose a period, open a report, and expand a row"}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">
            {ar
              ? "الفلاتر فوق بتتطبق على كل الصفحات. أرقام «الفترة» تتغير معها، أما إجمالي تاريخ الحملة فيظهر بعد فتح السهم ومكتوب عليه بوضوح إنه إجمالي."
              : "Top filters apply across the app. Period figures follow them; lifetime campaign totals appear only after expanding a row and are clearly labelled."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <GuideLink to="/campaigns" label={ar ? "ابدأ بالحملات" : "Start with campaigns"} />
            <GuideLink to="/courses" label={ar ? "افتح الدورات" : "Open courses"} />
            <GuideLink to="/accounting" label={ar ? "راجع الفواتير" : "Review invoices"} />
          </div>
        </div>
      </section>

      <section className="card p-4 sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Target size={19} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-text">
              {ar
                ? "خريطة الأرقام: كل رقم جاي منين؟"
                : "Data map: where does every number come from?"}
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              {ar
                ? "مفيش رقم بيتخمن أو بيتجمع من مصدرين مختلفين من غير ما يكون مكتوب."
                : "No metric is guessed or silently combined across authorities."}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <SourceNode
            icon={<Megaphone size={18} />}
            title={ar ? "منصات الإعلانات" : "Ad platforms"}
            source="Meta · Snap · TikTok · Google"
            metric={ar ? "الإنفاق · ليدز المنصة · Active" : "Spend · platform leads · Active"}
          />
          <SourceNode
            icon={<Users size={18} />}
            title="Odoo CRM"
            source={ar ? "الفرص الحالية" : "Current opportunities"}
            metric={ar ? "ليدز CRM · Won" : "CRM leads · Won"}
          />
          <SourceNode
            icon={<TrendingDown size={18} />}
            title={ar ? "أرشيف Odoo المباشر" : "Direct Odoo archive"}
            source={ar ? "الفرص المؤرشفة" : "Archived opportunities"}
            metric="Lost"
            tone="danger"
          />
          <SourceNode
            icon={<ReceiptText size={18} />}
            title="Full Invoiced Orders"
            source={ar ? "أوامر البيع المفوترة" : "Fully invoiced orders"}
            metric={ar ? "عدد Sales Orders" : "Sales order count"}
          />
          <SourceNode
            icon={<CircleDollarSign size={18} />}
            title={ar ? "الفواتير المدفوعة" : "Paid invoices"}
            source="Accounting · USD Paid"
            metric={ar ? "الإيراد حسب Payment Date" : "Revenue by Payment Date"}
            tone="success"
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <GuideSection
          number="01"
          icon={<Filter size={19} />}
          title={ar ? "اضبط الفترة والفلاتر" : "Set the period and filters"}
          path={ar ? "الشريط العلوي" : "Top bar"}
          description={
            ar
              ? "اختار الشهر أو فترة مخصصة، وبعدها المنصة. زر «الفلاتر» فيه الحساب والحملة والدورة والمندوب والشركة. أي اختيار يظهر كشريحة علشان تعرف إنت بتقرأ إيه."
              : "Choose a month or custom range, then the platform. Filters include account, campaign, course, salesperson, and company; active choices stay visible as chips."
          }
        >
          <MockToolbar ar={ar} />
        </GuideSection>

        <GuideSection
          number="02"
          icon={<Megaphone size={19} />}
          title={ar ? "اعرف الحملة شغالة وحققت إيه" : "Check campaign status and results"}
          path={ar ? "التسويق ← الحملات" : "Marketing → Campaigns"}
          description={
            ar
              ? "Active جاي من حالة المنصة ومش بيتغير مع فلتر التاريخ. نفس الصف يعرض صرف وليدز وLost وWon وإيراد الفترة؛ السهم يفتح إجمالي تاريخ الحملة وROAS وآخر يوم صرف."
              : "Active comes from platform status and ignores the date filter. The row shows period spend, leads, Lost, Won, and revenue; expand it for lifetime totals and ROAS."
          }
          to="/campaigns"
        >
          <MockCampaign ar={ar} />
        </GuideSection>

        <GuideSection
          number="03"
          icon={<Users size={19} />}
          title={ar ? "تابع الليدز والـLost" : "Track leads and Lost"}
          path={
            ar ? "إدارة العملاء ← العملاء المحتملون / تحليل الخسائر" : "CRM → Leads / Lost Analysis"
          }
          description={
            ar
              ? "العملاء المحتملون يعرض CRM الحالي. تحليل الـLost التسويقي يمشي بتاريخ إنشاء الليد عشان يقيس جودة ليدز نفس الفترة، وتحت منه حركة مستقلة للي اتقفل Lost بتاريخ الإغلاق. Won المؤرشف لا يتحسب Lost."
              : "Leads shows current CRM. Marketing Lost follows lead creation date to measure the same acquisition cohort; a separate movement card shows what closed Lost by close date. Archived Won is never counted as Lost."
          }
          to="/lost"
        >
          <MockFunnel ar={ar} />
        </GuideSection>

        <GuideSection
          number="04"
          icon={<GraduationCap size={19} />}
          title={ar ? "قارن الدورات والحملات المرتبطة" : "Compare courses and linked campaigns"}
          path={ar ? "التسويق ← الدورات" : "Marketing → Courses"}
          description={
            ar
              ? "كل صف دورة يعرض إنفاق وليدز وLost وWon وأوامر بيع وفواتير وإيراد الفترة. اضغط الدورة لتشوف كل حملاتها، مصدر ربط الاسم، ومقارنة شهرين لنفس الدورة."
              : "Every course row shows period spend, leads, Lost, Won, sales orders, invoices, and revenue. Select it for all linked campaigns, match source, and month comparison."
          }
          to="/courses"
        >
          <MockCourse ar={ar} />
        </GuideSection>

        <GuideSection
          number="05"
          icon={<BadgeDollarSign size={19} />}
          title={ar ? "راجع الفاتورة وتاريخ التحصيل" : "Audit invoice recognition dates"}
          path={ar ? "الحسابات ← الحسابات" : "Accounting → Accounting"}
          description={
            ar
              ? "ابحث برقم أمر البيع أو الفاتورة. الوضع الافتراضي يستخدم Payment Date داخل حركة السداد، مش Due Date. الدفع المقدم ممكن يظهر قبل تاريخ إصدار الفاتورة، وده طبيعي لو Odoo رابط الحركة."
              : "Search by sales order or invoice. The default uses Payment Date from the payment movement—not Due Date. A prepayment may legitimately predate the invoice."
          }
          to="/accounting"
        >
          <MockInvoice ar={ar} />
        </GuideSection>

        <GuideSection
          number="06"
          icon={<Sparkles size={19} />}
          title={ar ? "اسأل المساعد بصيغة مباشرة" : "Ask the assistant directly"}
          path={ar ? "زر المساعد أسفل الشاشة" : "Assistant button at the bottom"}
          description={
            ar
              ? "اكتب: «أفضل حملة الشهر ده»، «فين الحملات؟»، «دورة PMP صرفت وباعت كام؟» أو «الإيراد ده جاي من أنهي حملة؟». المساعد يقرأ نفس الفلاتر الظاهرة ومش المفروض يخمن رقم ناقص."
              : "Ask: “best campaign this month”, “where are campaigns?”, or “how much did PMP spend and sell?”. The assistant follows visible filters and must not invent missing data."
          }
        >
          <MockAssistant ar={ar} />
        </GuideSection>
      </div>

      <section className="card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-success-soft text-success">
            <CheckCircle2 size={20} />
          </span>
          <div>
            <h2 className="font-semibold text-text">
              {ar ? "قبل ما تبعت رقم في تقرير" : "Before sharing a number"}
            </h2>
            <ol className="mt-3 grid gap-2 text-sm leading-6 text-text-muted md:grid-cols-3">
              <li>{ar ? "1. راجع الفترة والمنصة فوق." : "1. Check period and platform."}</li>
              <li>
                {ar ? "2. فرّق بين «الفترة» و«كل التاريخ»." : "2. Separate period from lifetime."}
              </li>
              <li>
                {ar
                  ? "3. افتح الصف وشوف المصدر والتاريخ."
                  : "3. Expand the row and verify source/date."}
              </li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}

function GuideLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white transition-colors hover:bg-white/15"
    >
      {label}
      <ArrowLeft size={14} className="rtl:rotate-0 ltr:rotate-180" />
    </Link>
  );
}

function SourceNode({
  icon,
  title,
  source,
  metric,
  tone = "brand",
}: {
  icon: ReactNode;
  title: string;
  source: string;
  metric: string;
  tone?: "brand" | "danger" | "success";
}) {
  const colors = {
    brand: "bg-brand-soft text-brand",
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
  };
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${colors[tone]}`}>{icon}</span>
      <h3 className="mt-3 text-sm font-semibold text-text">{title}</h3>
      <p className="mt-1 text-[11px] text-text-muted">{source}</p>
      <p className="mt-3 border-t border-border pt-3 text-xs font-semibold text-text">{metric}</p>
    </div>
  );
}

function GuideSection({
  number,
  icon,
  title,
  path,
  description,
  to,
  children,
}: {
  number: string;
  icon: ReactNode;
  title: string;
  path: string;
  description: string;
  to?: string;
  children: ReactNode;
}) {
  const { lang } = useI18n();
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-border p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="num text-xs font-bold text-brand">{number}</span>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-text">{title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Pill tone="neutral">{path}</Pill>
              {to && (
                <Link to={to} className="text-xs font-semibold text-brand hover:underline">
                  {lang === "ar" ? "فتح التقرير" : "Open report"}
                </Link>
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm leading-7 text-text-muted">{description}</p>
      </div>
      <div className="bg-surface-2/35 p-4 sm:p-5">{children}</div>
    </section>
  );
}

function MockToolbar({ ar }: { ar: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-border px-3 text-xs font-semibold">
          <CalendarRange size={14} /> {ar ? "هذا الشهر" : "This month"}
        </span>
        <span className="rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white">
          {ar ? "كل المنصات" : "All platforms"}
        </span>
        <span className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-border px-3 text-xs">
          <Filter size={14} /> {ar ? "الفلاتر" : "Filters"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill tone="brand">{ar ? "الدورة: PMP" : "Course: PMP"}</Pill>
        <Pill tone="neutral">Meta</Pill>
      </div>
    </div>
  );
}

function MockCampaign({ ar }: { ar: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_repeat(5,auto)_20px]">
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <div className="truncate text-sm font-semibold text-text">PMP-1/7/26-sayed</div>
          <div className="mt-1 flex gap-1">
            <Pill tone="neutral">Meta</Pill>
            <Pill tone="success">Active</Pill>
          </div>
        </div>
        <MiniStat label={ar ? "صرف الفترة" : "Spend"} value="$140" />
        <MiniStat label={ar ? "ليدز" : "Leads"} value="28" />
        <MiniStat label="Lost" value="1" />
        <MiniStat label="Won" value="4" />
        <MiniStat label={ar ? "المحصل" : "Revenue"} value="$687" />
        <ChevronDown size={15} className="hidden self-center text-text-muted sm:block" />
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-dashed border-border bg-surface-2/50 p-3 text-center">
        <MiniStat label={ar ? "إجمالي الإيراد" : "Lifetime revenue"} value="$7,322" />
        <MiniStat label="ROAS" value="3.07×" />
        <MiniStat label={ar ? "آخر صرف" : "Last spend"} value="05/08" />
      </div>
    </div>
  );
}

function MockFunnel({ ar }: { ar: boolean }) {
  const steps = [
    [ar ? "دخل CRM" : "Entered CRM", "503"],
    [ar ? "مهتم" : "Interested", "91"],
    [ar ? "عرض سعر" : "Quotation", "38"],
    ["Won", "25"],
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {steps.map(([label, value], index) => (
        <div
          key={label}
          className="relative rounded-xl border border-border bg-surface p-3 text-center"
        >
          <div className="num text-lg font-bold text-text">{value}</div>
          <div className="mt-1 text-[11px] text-text-muted">{label}</div>
          {index < steps.length - 1 && (
            <span className="absolute -end-2 top-1/2 z-10 h-px w-2 bg-border" />
          )}
        </div>
      ))}
    </div>
  );
}

function MockCourse({ ar }: { ar: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="font-semibold text-text">PMP</div>
          <div className="text-[11px] text-text-muted">Professional Certificate</div>
        </div>
        <Pill tone="brand">$295</Pill>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
        <MiniStat label={ar ? "ليدز" : "Leads"} value="66" />
        <MiniStat label="Lost" value="11" />
        <MiniStat label="Won" value="4" />
        <MiniStat label={ar ? "أوامر" : "Orders"} value="13" />
        <MiniStat label={ar ? "فواتير" : "Invoices"} value="13" />
        <MiniStat label={ar ? "محصل" : "Revenue"} value="$2,721" />
      </div>
    </div>
  );
}

function MockInvoice({ ar }: { ar: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Search size={14} className="text-brand" />
        <span className="num text-sm font-semibold">S18104</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label={ar ? "الفاتورة" : "Invoice"} value="001791" />
        <MiniStat label="Payment Date" value="25/07/2026" />
        <MiniStat label="Invoice Date" value="26/07/2026" />
        <MiniStat label={ar ? "المحصل" : "Collected"} value="$534" />
      </div>
      <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
        {ar
          ? "دفع مقدّم مثبت في حركة Odoo — مش Due Date."
          : "Prepayment verified in the Odoo payment movement—not Due Date."}
      </p>
    </div>
  );
}

function MockAssistant({ ar }: { ar: boolean }) {
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-surface p-3 shadow-sm">
      <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-sm bg-brand px-3 py-2 text-xs leading-5 text-white">
        {ar
          ? "فين الحملات وجايبة مبيعات كام الشهر ده؟"
          : "Where are campaigns and how much did they sell this month?"}
      </div>
      <div className="max-w-[92%] rounded-2xl rounded-es-sm bg-surface-2 px-3 py-2 text-xs leading-5 text-text">
        {ar
          ? "افتح التسويق ← الحملات. الصف يعرض أرقام الفترة؛ والسهم يفتح إجمالي تاريخ الحملة."
          : "Open Marketing → Campaigns. Rows show period figures; expand for lifetime totals."}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] text-text-muted">{label}</div>
      <div className="num mt-1 whitespace-nowrap text-sm font-semibold text-text">{value}</div>
    </div>
  );
}
