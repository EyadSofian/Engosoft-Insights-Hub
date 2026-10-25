import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  CalendarRange,
  CircleHelp,
  CopyCheck,
  Download,
  Filter,
  Layers3,
  PhoneCall,
  ReceiptText,
  ShieldCheck,
  TrendingDown,
  Users,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import {
  BarList,
  Card,
  ErrorState,
  KpiSkeletonGrid,
  Notice,
  Pill,
  SectionTitle,
  Segmented,
  Skeleton,
} from "@/components/ui-bits";
import {
  DashboardPageHeader,
  KpiRow,
  PageSection,
  PageSections,
  SyncStatus,
} from "@/components/dashboard-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { MetricDetailTrigger } from "@/components/metric-detail";
import { topRows, type MetricBreakdownRow, type MetricDetail } from "@/lib/metric-detail";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";
import { LeadClassificationAudit } from "@/components/leads/LeadClassificationAudit";
import {
  performanceStages,
  type PerformanceGroup,
  type PerformanceRecord,
  type PerformanceResult,
} from "@/lib/lead-performance";

type Response = PerformanceResult & {
  collectionsByMonth: { month: string; paidInvoices: number; paidUsd: number }[];
  callCoverage: { expectedDays: number; coveredDays: number; newestSync: string | null } | null;
  syncedAt: string;
  linksRefreshedAt: string | null;
  source?: Record<string, string>;
  availability: {
    crm: boolean;
    lost: boolean;
    accounting: boolean;
    callRefreshSucceeded: boolean;
    crmSyncedAt: string;
    lostSyncedAt: string;
    accountingSyncedAt: string;
  };
};
type Dimension = "course" | "source" | "platform" | "campaign" | "buyer" | "owner" | "closer";
type LostDimension = "course" | "platform" | "source" | "owner" | "buyer";

const copy = {
  ar: {
    title: "رحلة الليد إلى تسجيل مدفوع",
    sub: "آخر ٦ أشهر حسب شهر دخول الليد؛ البيع اللاحق يرجع لمجموعة دخوله الأصلية.",
    fixed:
      "الفترة ثابتة: آخر ٦ أشهر تقويمية، والشهر الحالي حتى اليوم. فلاتر الكورس العامة فقط تنطبق هنا.",
    leads: "سجلات CRM جديدة",
    lost: "فُقدت حتى الآن",
    paid: "ليدز ثبت دفعها وربطها",
    rate: "تحويل مدفوع مثبت (حد أدنى)",
    later: "دُفعت في شهر لاحق",
    revenue: "تحصيل مرتبط بمجموعات الدخول",
    trend: "مقارنة مجموعات الدخول الشهرية",
    trendSub: "حالة كل مجموعة حتى اليوم، وليست مبيعات الشهر نفسه.",
    month: "شهر الدخول",
    duplicates: "تطابق هوية محتمل",
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
    avgHours: "ساعات لأول محاولة موثّقة",
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
      "*تصنيف الفرصة وLost هو الوضع الحالي، وليس سجل انتقال تاريخي أو لقطة لنهاية شهر الدخول؛ لذلك مستوى الفرصة مؤشر لا مسارًا تاريخيًا مثبتًا. الكورس والمصدر والحملة ومسؤول الليد هي حقول أودو الحالية، وقد تكون تغيّرت منذ دخوله. إسناد الميديا باير من اسم الحملة وقواعد ملكية الكورسات المعتمدة. عدد المحاولات من سجل Yeastar المباشر فقط بعد تغطية كل أيام الفترة؛ سجلات أطراف المكالمة المتعددة تُحسب محاولة واحدة، واليوم الحالي جزئي حتى آخر تحديث. Chatter أودو متاح لفحص السجل منفردًا لكنه ليس مجمّعًا بعد، وغياب مكالمة لا يثبت عدم التواصل عبر واتساب. التكرار بالهوية مؤشر للمراجعة وليس حكمًا نهائيًا. زمن أول اتصال بالساعات حيث توجد ساعة إنشاء أودو الدقيقة، وإلا يظهر تقريب بالأيام. الفواتير غير المربوطة لا تُنسب تخمينًا، والإنفاق الإعلاني لا يظهر هنا لعدم وجود ربط محقق بين كل فاتورة وحملة.",
    missingLinks: "ربط أوامر البيع غير متاح؛ مؤشرات الدفع غير مكتملة.",
    limitedLinks:
      "تغطية ربط بنود الحسابات بأوامر البيع منخفضة؛ التحويل المعروض حد أدنى مُثبت وليس معدل التحويل الحقيقي لكل الليدز، فلا تستخدمه وحده لتقييم الفريق.",
    missingAccounting: "بيانات الفواتير المدفوعة قديمة؛ مؤشرات التسجيلات والتحصيل مخفية حتى تتحدث.",
    staleCrm:
      "بيانات CRM قديمة؛ أوقفت التقرير حتى لا يظهر الصفر أو نسبة تحويل مضللة. راجع مزامنة أودو.",
    staleLost:
      "بيانات Lost غير متاحة أو قديمة؛ أوقفت التقرير لأن إجمالي الليدز ونسبة الفقدان سيصبحان ناقصين.",
    missingCalls:
      "لم تكتمل تغطية سجلات المكالمات المباشرة من Yeastar؛ أوقفت أرقام المحاولات حتى لا تظهر ناقصة.",
    staleCalls:
      "تعذّر تحديث Yeastar الآن؛ أرقام المكالمات المعروضة من آخر نسخة محفوظة، وقد لا تشمل أحدث المكالمات.",
    missingQa: "التحقق اليدوي من جودة الليد غير متاح؛ غير المؤهل هنا من سبب أودو فقط.",
    noQaReviews:
      "لم تُسجَّل مراجعات جودة يدوية لهذه المجموعة؛ أسباب عدم التأهل الظاهرة لا تمثل تدقيقًا كاملًا لجودة الليدز.",
    excluded: "مستبعد من مؤشرات الاستحواذ",
    unknown: "بيانات غير منسوبة",
    rows: "سجل",
    all: "كل الكورسات",
    noRows: "لا توجد سجلات لهذه المجموعة.",
    wonCaveat: "Won في CRM ظاهر للمراجعة فقط، ولا يدخل في معدل التسجيل المدفوع.",
    paymentMonth: "فواتير مدفوعة خلال الشهر",
    cohortVsPayment:
      "مش نفس المؤشر: الفواتير حسب تاريخ الدفع تشمل ليدز من شهور سابقة وقد تشمل فواتير بلا ربط مؤكد. التسجيلات المثبتة أعلاه تُنسب لشهر دخول الليد، ولا تضم إلا الربط المباشر بأمر البيع. لا يصح اعتبار الفرق ليدز مفقودة أو نسبة تحويل.",
    paymentRevenue: "تحصيل فواتير الشهر",
    freshNow: "حقل Lead Segment = Fresh حاليًا",
    freshMeaning:
      "Fresh هنا تصنيف حالي في أودو، وليس معناه أن الليد لم يُتصل به، ولا يثبت تصنيفه يوم دخوله.",
    freshCalled: "لهم مكالمة PBX موثقة",
    freshNoPbx: "بلا مكالمة PBX ظاهرة",
    freshUnmatched: "تعذرت مطابقة الهاتف",
    freshCallCaveat:
      "غياب مكالمة PBX لا يثبت أن السيلز لم يتعامل مع الليد؛ قد توجد متابعة في Chatter أو واتساب.",
    leadRecordsNow: "سجلات Lead الآن (نشط أو Lost)",
    opportunityNow: "سجلات Opportunity الآن",
    preCrmUnavailable: "قبل CRM: غير متاح",
    classificationPrompt:
      "راجع تابات حالة CRM والتصنيف والاتصال أدناه؛ Fresh ليس مرادفًا لليد الذي لم يُتصل به.",
    segmentUnknown: "حقل Lead Segment فارغ",
    segmentExplanation:
      "ده حقل تصنيف منفصل عن مراحل أودو. السجلات دي لها نوع وحالة في CRM، والفرص لها مراحل بيع.",
    blankTypes: "منهم",
    blankOpportunity: "فرصة بيعية",
    blankLead: "ليد",
    blankStatuses: "حالتهم العامة الآن",
    blankOpen: "مفتوح",
    blankLost: "مفقود",
    blankWon: "مغلق بنجاح",
    blankActiveLead: "ليد نشط",
    quickRead: "ملخص واضح قبل التفاصيل",
    quickReadHint: "الأساس، ما ثبت، وما يحتاج استكمالًا — بدون خلط بينهم.",
    enteredBasis: "دخلت في شهر الاختيار",
    verifiedOutcome: "تسجيلات مدفوعة مؤكدة",
    evidenceGap: "حدود البيانات المهمة",
    freshGap:
      "Fresh التاريخي غير مثبت: Lead Segment يعرض قيمته الحالية فقط، وحقلُه فارغ في سجلات كثيرة. ده لا يعني غياب Stage البيع؛ لذلك عدد الدخول ليس عدد Fresh المؤكد.",
    paidGap:
      "الفواتير التي لا نعرف ليدها ليست صفر مبيعات؛ التحويل المعروض حد أدنى من الربط المباشر فقط.",
    funnelGap:
      "انتقالات مراحل الفرصة السابقة غير مسجلة هنا؛ لا يمكن حساب معدل كل انتقال تاريخي بدقة.",
    qaGap: "لا توجد مراجعات جودة يدوية لهذه المجموعة؛ صفر Unqualified لا يعني أن كل الليدز مؤهلة.",
    recordList: "راجع الليدز واحدًا واحدًا",
    recordListHint:
      "سجلات شهر الدخول المختار؛ ابحث بالرقم أو الكورس أو المصدر أو الحملة أو السيلز. افتح الرقم للمراجعة في أودو.",
    recordId: "رقم أودو",
    entryDate: "تاريخ الدخول",
    currentState: "الحالة الآن",
    segment: "تصنيف أودو الآن",
    attempts: "محاولات PBX",
    firstAttempt: "أول محاولة بعد (ساعة)",
    duplicateFlag: "التكرار",
    none: "غير مثبت",
    paidFlag: "تسجيل مدفوع",
    recordType: "نوع السجل",
    reason: "سبب الفقدان",
    recordCountHint: "هذا الجدول يعرض المجموعة المختارة فقط ولا يضيف ليدز إلى الإجمالي.",
  },
  en: {
    title: "From lead to paid enrollment",
    sub: "Six entry-month cohorts; later payments remain with the original lead month.",
    fixed:
      "Fixed window: six calendar months, current month through today. Only the global course filter applies here.",
    leads: "New CRM records",
    lost: "Lost to date",
    paid: "Exactly linked paid leads",
    rate: "Verified paid conversion (lower bound)",
    later: "Paid in a later month",
    revenue: "Collections linked to entry cohorts",
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
    avgHours: "Hours to first documented attempt",
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
      "*Opportunity/Lost is the current status, not a verified transition history or historical month-end snapshot; the opportunity step is a proxy. Course, source, campaign and lead owner are current Odoo fields and may have changed since entry. Media buyer follows campaign naming and approved course ownership. Attempts come from direct Yeastar CDRs only after every day in the period is covered; multiple call legs count as one attempt, and the current day is partial until the latest refresh. Odoo Chatter can be inspected per record but is not yet bulk-aggregated, and no PBX call does not prove no WhatsApp contact. Identity duplicates require review. First-contact lag uses exact Odoo creation time when present and day-level approximation otherwise. Unlinked invoices are not guessed onto leads or buyers; ad spend is omitted here without verified invoice-to-campaign attribution.",
    missingLinks: "Sale-order linkage is unavailable; paid metrics are incomplete.",
    limitedLinks:
      "Accounting-line to sale-order coverage is low. Shown conversion is a verified lower bound, not the true conversion of all leads; do not use it alone to judge staff.",
    missingAccounting:
      "Paid-invoice data is stale; enrollment and revenue metrics are hidden until it refreshes.",
    staleCrm:
      "CRM data is stale. This report is paused rather than displaying a misleading zero or conversion rate. Check Odoo sync.",
    staleLost:
      "Lost data is unavailable or stale. This report is paused because entry counts and loss rates would be incomplete.",
    missingCalls:
      "Direct Yeastar CDR coverage is incomplete; attempt metrics are withheld rather than shown too low.",
    staleCalls:
      "Yeastar could not refresh now; call figures use the last stored copy and may miss the latest calls.",
    missingQa: "Manual lead QA is unavailable; unqualified uses Odoo reason only.",
    noQaReviews:
      "No manual quality reviews exist for this cohort; the displayed unqualified reasons are not a complete lead-quality audit.",
    excluded: "Excluded from acquisition KPIs",
    unknown: "Unattributed data",
    rows: "records",
    all: "All courses",
    noRows: "No records for this cohort.",
    wonCaveat: "CRM Won is shown for audit only; it does not enter paid conversion.",
    paymentMonth: "Paid invoices in payment month",
    cohortVsPayment:
      "These are different measures: payment-month invoices can belong to older leads or lack an exact link. Verified enrollments above are credited to the lead entry month only after a direct sale-order link. The difference is not missing leads or a conversion rate.",
    paymentRevenue: "Payment-month collections",
    freshNow: "Lead Segment = Fresh now",
    freshMeaning:
      "Fresh is the current Odoo classification, not proof the lead has never been contacted or that it was Fresh at entry.",
    freshCalled: "Documented PBX call",
    freshNoPbx: "No PBX call visible",
    freshUnmatched: "Phone not safely matchable",
    freshCallCaveat:
      "No PBX call does not prove Sales did not work the lead; Chatter or WhatsApp follow-up may exist.",
    leadRecordsNow: "Lead records now (active or Lost)",
    opportunityNow: "Opportunity records now",
    preCrmUnavailable: "Before CRM: unavailable",
    classificationPrompt:
      "Use the CRM state, classification and contact tabs below. Fresh does not mean untouched.",
    segmentUnknown: "Lead Segment field is blank",
    segmentExplanation:
      "This is a separate classification field, not an Odoo sales stage. These records have CRM types and statuses; opportunities have sales stages.",
    blankTypes: "Includes",
    blankOpportunity: "opportunities",
    blankLead: "leads",
    blankStatuses: "Current broad CRM status",
    blankOpen: "open",
    blankLost: "lost",
    blankWon: "won",
    blankActiveLead: "active lead",
    quickRead: "Read this report at a glance",
    quickReadHint: "The denominator, verified outcome and evidence gaps are kept separate.",
    enteredBasis: "Entered in selected month",
    verifiedOutcome: "Verified paid enrollments",
    evidenceGap: "Important evidence gaps",
    freshGap:
      "Historical Fresh status is unverified: Lead Segment shows its current value and is blank on many records. That does not mean their sales Stage is missing; entry count is not a confirmed Fresh count.",
    paidGap:
      "Invoices without an exact lead link are not zero sales. Conversion shown is a lower bound from direct links only.",
    funnelGap:
      "Past opportunity-stage transitions are not logged here, so true stage-to-stage historical conversion cannot be calculated.",
    qaGap:
      "This cohort has no manual QA reviews. Zero Unqualified does not mean all leads were qualified.",
    recordList: "Audit individual leads",
    recordListHint:
      "Records created in the selected month. Search by ID, course, source, campaign or owner, then open an ID in Odoo.",
    recordId: "Odoo ID",
    entryDate: "Entry date",
    currentState: "Current state",
    segment: "Current Odoo segment",
    attempts: "PBX attempts",
    firstAttempt: "First attempt after (hours)",
    duplicateFlag: "Duplicate",
    none: "Not evidenced",
    paidFlag: "Paid enrollment",
    recordType: "Record type",
    reason: "Loss reason",
    recordCountHint:
      "This list belongs to the selected cohort only; it adds no records to the totals.",
  },
} as const;

/**
 * Extra wording this report needs beyond the shared `copy` block above.
 *
 * Kept separate so the definitions and caveats already reviewed with the
 * business are not re-edited every time a column is added.
 */
const extra = {
  ar: {
    headerSubtitle:
      "من دخول الليد إلى تسجيل مدفوع مثبت: الحجم، الجودة، سرعة المتابعة، عدد المحاولات، والتحويل الفعلي لكل مجموعة شهرية.",
    exportLabel: "تنزيل التقرير",
    exportHint: "ملف Excel بنفس أرقام الشاشة وتعريفاتها",
    monthlyTable: "مقارنة شهرية كاملة",
    monthlyTableHint:
      "الدخول والتحويل محسوبان على مجموعة الليدز التي دخلت الشهر. Lost بتاريخ الإغلاق يشمل ما أُغلق خلاله وما زال Lost الآن، حتى لو دخل قبله؛ السجلات التي أُعيد فتحها غير متاحة هنا. لا نقسمه على عدد الداخلين هذا الشهر.",
    calendarLost: "أُغلقت Lost في الشهر",
    calendarLostOlderEntry: "من شهور دخول سابقة",
    calendarPaid: "أول دفع مثبت في الشهر",
    sameMonthLost: "دخل وفُقد في الشهر نفسه",
    sameMonthPaid: "دخل ودفع في الشهر نفسه",
    lossUnverified: "Lost بلا تاريخ فقدان مؤكّد",
    duplicateBasis:
      "مطابقة هاتف/إيميل محتملة ÷ كل سجلات CRM الجديدة المؤهلة. لا تُحذف آليًا؛ سبب Duplicate في أودو رقم مختلف.",
    declaredDuplicateBasis: "سبب Duplicate من Lost الحالية",
    duplicateAll: "كل السجلات",
    duplicateOnly: "تطابق محتمل",
    nonDuplicate: "بلا تطابق ظاهر",
    lostBreakdown: "تفصيل الـLost حسب الفلاتر",
    lostBreakdownHint:
      "نفس مجموعة شهر الدخول المختارة، حسب الحالة الحالية في أودو. النسبة من سجلات كل صف، لا من إجمالي Lost.",
    platform: "المنصة / القناة",
    lostLead: "Lost Leads",
    lostOpp: "Lost Opportunities",
    stageShare: "من إجمالي الدخول",
    stageStep: "من الليدز القابلة لمطابقة الهاتف",
    stageProxy: "مؤشر حالة حالية، وليس انتقالًا مسجلًا",
    stageEvidence: "مثبت بدليل",
    stageWithheld: "البيانات غير كافية لعرض هذه المرحلة",
    contactedStage: "تم التواصل معها (PBX)",
    within24: "أول اتصال خلال ٢٤ ساعة (بتوقيت إنشاء دقيق)",
    groupColumns: {
      fresh: "Fresh الآن",
      segmentMissing: "Lead Segment فارغ",
      duplicates: "تكرار",
      dupSame: "تكرار داخل الشهر",
      dupPrev: "تكرار من شهر سابق",
      dupRate: "نسبة التكرار",
      attempts: "متوسط المحاولات",
      hours: "ساعات لأول محاولة",
      contacted: "تم التواصل",
      orders: "أوامر مدفوعة",
      laterPaid: "دُفعت لاحقًا",
      invoices: "فواتير بتاريخ الدفع",
      collected: "تحصيل بتاريخ الدفع",
    },
    bandVolume: "الحجم",
    bandQuality: "الجودة",
    bandFollowUp: "المتابعة",
    bandOutcome: "النتيجة",
    bandPaymentMonth: "بتاريخ الدفع",
    noDimensionRows: "لا توجد صفوف لهذا التقسيم في المجموعة المختارة.",
    whyThisNumber: "من أين جاء هذا الرقم؟",
    cohortBasis: "الأساس: شهر إنشاء السجل في أودو، وليس تاريخ البيع.",
    perMonth: "لكل شهر",
    reasonShare: "من المفقود",
  },
  en: {
    headerSubtitle:
      "From lead entry to a verified paid enrollment: volume, quality, follow-up speed, attempt counts and the real conversion of each monthly cohort.",
    exportLabel: "Download the report",
    exportHint: "An Excel file with the same figures and definitions as the screen",
    monthlyTable: "Full monthly comparison",
    monthlyTableHint:
      "Entries and conversion use that month's entry cohort. Lost by close date counts records closed in the month and still Lost now, even if created earlier; reopened records are unavailable. It is not divided by that month's entries.",
    calendarLost: "Closed Lost in month",
    calendarLostOlderEntry: "Entered in earlier months",
    calendarPaid: "First verified payment in month",
    sameMonthLost: "Entered and Lost in same month",
    sameMonthPaid: "Entered and paid in same month",
    lossUnverified: "Lost without a verified date",
    duplicateBasis:
      "Potential phone/email matches ÷ all eligible new CRM records. These are not auto-removed; Odoo's Duplicate loss reason is a separate count.",
    declaredDuplicateBasis: "Odoo Duplicate reason among current Lost",
    duplicateAll: "All records",
    duplicateOnly: "Potential matches",
    nonDuplicate: "No visible match",
    lostBreakdown: "Lost by filter",
    lostBreakdownHint:
      "Selected entry-month cohort, using current Odoo Lost status. Each rate uses that row's records as denominator.",
    platform: "Platform / channel",
    lostLead: "Lost Leads",
    lostOpp: "Lost Opportunities",
    stageShare: "of all entries",
    stageStep: "of phone-matchable leads",
    stageProxy: "A current-status proxy, not a logged transition",
    stageEvidence: "Evidence-backed",
    stageWithheld: "There is not enough evidence to show this stage",
    contactedStage: "Contacted (PBX)",
    within24: "First call within 24 hours (exact creation time)",
    groupColumns: {
      fresh: "Fresh now",
      segmentMissing: "Blank Lead Segment",
      duplicates: "Duplicates",
      dupSame: "Duplicate, same month",
      dupPrev: "Duplicate, prior month",
      dupRate: "Duplicate rate",
      attempts: "Average attempts",
      hours: "Hours to first attempt",
      contacted: "Contacted",
      orders: "Paid orders",
      laterPaid: "Paid later",
      invoices: "Invoices by payment date",
      collected: "Collected by payment date",
    },
    bandVolume: "Volume",
    bandQuality: "Quality",
    bandFollowUp: "Follow-up",
    bandOutcome: "Outcome",
    bandPaymentMonth: "By payment date",
    noDimensionRows: "No rows for this breakdown in the selected cohort.",
    whyThisNumber: "Where did this figure come from?",
    cohortBasis: "Basis: the month the Odoo record was created, not the sale date.",
    perMonth: "per month",
    reasonShare: "of lost",
  },
} as const;

const n = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : fmtNum(value);
const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : fmtPct(value, 1);
const money = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : fmtUSD(value);

function currentState(row: PerformanceRecord, lang: "ar" | "en") {
  if (lang === "en") return row.status;
  return { lead: "ليد نشط", open: "فرصة مفتوحة", won: "مغلق بنجاح", lost: "مفقود" }[row.status];
}

function recordType(row: PerformanceRecord, lang: "ar" | "en") {
  if (lang === "en") return row.recordType;
  return row.recordType === "lead" ? "ليد" : "فرصة بيعية";
}

/** `2026-07` the way a reader says it, so a month strip is not six ISO stamps. */
function monthLabel(month: string, lang: "ar" | "en"): string {
  const [year, index] = month.split("-");
  const names =
    lang === "ar"
      ? [
          "يناير",
          "فبراير",
          "مارس",
          "أبريل",
          "مايو",
          "يونيو",
          "يوليو",
          "أغسطس",
          "سبتمبر",
          "أكتوبر",
          "نوفمبر",
          "ديسمبر",
        ]
      : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const name = names[Number(index) - 1];
  return name ? `${name} ${year}` : month;
}

/** A dimension row carrying the payment-month figures its month row also needs. */
type MonthRow = PerformanceGroup & { paidInvoices: number | null; paidUsd: number | null };

export function SixMonthPerformance() {
  const { lang } = useI18n();
  const t = copy[lang];
  const x = extra[lang];
  const [month, setMonth] = useState("");
  const [dimension, setDimension] = useState<Dimension>("course");
  const [lostDimension, setLostDimension] = useState<LostDimension>("course");
  const [recordScope, setRecordScope] = useState<"all" | "duplicate" | "nonduplicate">("all");
  const { data, isLoading, error } = useApi<Response>(
    `/api/lead-performance${month ? `?month=${month}` : ""}`,
  );

  // The page declares which cohort is on screen, so a question asked here is
  // answered about the month the reader is actually looking at.
  useRegisterNexusView("leads", {
    tab: "performance",
    parameters: data?.selectedMonth ? { month: data.selectedMonth } : undefined,
  });

  const paidReady = Boolean(data && data.coverage.linksAvailable && data.availability.accounting);

  /**
   * The five headline figures, each able to explain itself.
   *
   * Every breakdown comes out of the same response the card was rendered from,
   * so opening a figure costs no request and cannot disagree with the number
   * above it. The provenance block is not decoration here: a conversion rate
   * that a team is judged on has to be able to say which systems it joined and
   * what it refused to guess.
   */
  const figures = useMemo((): Record<string, MetricDetail> => {
    if (!data) return {};
    const selected = data.selected;
    const dimensionRows = (
      rows: PerformanceGroup[],
      metric: (row: PerformanceGroup) => number | null,
      display: (row: PerformanceGroup) => string,
    ): MetricBreakdownRow[] =>
      rows.map((row) => ({
        key: row.name,
        label: row.name === "—" ? (lang === "ar" ? "غير منسوب" : "Unattributed") : row.name,
        value: metric(row) ?? 0,
        display: display(row),
        meta: `${n(row.leads)} ${lang === "ar" ? "ليد" : "leads"}`,
      }));
    const trend = (
      metric: (row: PerformanceGroup) => number | null,
      label: string,
      format: (value: number) => string,
    ) => ({
      points: data.rows.map((row) => ({
        date: `${row.name}-01`,
        value: metric(row) ?? 0,
      })),
      label,
      format,
      grain: "week" as const,
    });
    const provenance = {
      system: "Odoo CRM + Accounting + Yeastar PBX",
      dateBasis: x.cohortBasis,
      note: t.definitionText,
    };
    const duplicates = selected.duplicateSameMonth + selected.duplicateEarlierMonth;
    return {
      leads: {
        id: "leads.leads",
        title: t.leads,
        value: n(selected.leads),
        tone: "sky",
        icon: <Users size={17} />,
        definition: t.definitionText.split(".")[0] ?? t.leads,
        trend: trend(
          (row) => row.leads,
          t.leads,
          (value) => fmtNum(value),
        ),
        supporting: [
          { key: "opps", label: t.funnelOpp, value: n(selected.opportunities) },
          { key: "lost", label: t.lost, value: n(selected.lost) },
          { key: "dup", label: t.duplicates, value: n(duplicates) },
        ],
        breakdowns: [
          {
            id: "course",
            title: t.course,
            rows: topRows(
              dimensionRows(
                data.byCourse,
                (row) => row.leads,
                (row) => n(row.leads),
              ),
            ),
          },
          {
            id: "source",
            title: t.source,
            rows: topRows(
              dimensionRows(
                data.bySource,
                (row) => row.leads,
                (row) => n(row.leads),
              ),
            ),
          },
          {
            id: "buyer",
            title: t.buyer,
            rows: topRows(
              dimensionRows(
                data.byMediaBuyer,
                (row) => row.leads,
                (row) => n(row.leads),
              ),
            ),
          },
        ],
        provenance,
      },
      lost: {
        id: "leads.leads",
        title: t.lost,
        value: n(selected.lost),
        tone: "rose",
        icon: <TrendingDown size={17} />,
        definition: t.reasonsSub,
        formula: `${n(selected.lost)} ÷ ${n(selected.leads)} = ${pct(selected.lostRate)}`,
        trend: trend(
          (row) => row.lost,
          t.lost,
          (value) => fmtNum(value),
        ),
        supporting: [
          { key: "noAnswer", label: t.noAnswer, value: n(selected.noAnswer) },
          { key: "unreachable", label: t.unreachable, value: n(selected.unreachable) },
          { key: "noInterest", label: t.noInterest, value: n(selected.noInterest) },
          { key: "unqualified", label: t.unqualified, value: n(selected.unqualified) },
        ],
        breakdowns: [
          {
            id: "reasons",
            title: t.reasons,
            hint: t.reasonsSub,
            rows: data.lossReasons.slice(0, 5).map((reason) => ({
              key: reason.key,
              label: lang === "ar" ? reason.ar : reason.en,
              value: reason.count,
              display: n(reason.count),
              meta: `${pct(selected.lost ? (reason.count / selected.lost) * 100 : null)} ${x.reasonShare}`,
            })),
            max: selected.lost,
          },
        ],
        provenance,
      },
      paid: {
        id: "leads.cohortConversion",
        title: t.paid,
        value: paidReady ? n(selected.paidLeads) : "—",
        tone: "mint",
        icon: <BadgeCheck size={17} />,
        definition: t.wonCaveat,
        caveat: paidReady ? undefined : t.missingLinks,
        trend: paidReady
          ? trend(
              (row) => row.paidLeads,
              t.paid,
              (value) => fmtNum(value),
            )
          : undefined,
        supporting: [
          { key: "later", label: t.later, value: paidReady ? n(selected.paidLater) : "—" },
          { key: "orders", label: t.paidOrders, value: paidReady ? n(selected.paidOrders) : "—" },
          { key: "crmWon", label: "CRM Won", value: n(selected.crmWon), hint: t.wonCaveat },
        ],
        breakdowns: paidReady
          ? [
              {
                id: "closer",
                title: t.closer,
                rows: topRows(
                  dimensionRows(
                    data.bySalesCloser,
                    (row) => row.paidLeads,
                    (row) => n(row.paidLeads),
                  ),
                ),
              },
            ]
          : undefined,
        provenance,
      },
      rate: {
        id: "leads.cohortConversion",
        title: t.rate,
        value: paidReady ? pct(selected.conversionRate) : "—",
        tone: "violet",
        icon: <ArrowUpRight size={17} />,
        definition: t.definitionText,
        formula: `${n(selected.paidLeads)} ÷ ${n(selected.leads)} = ${pct(selected.conversionRate)}`,
        caveat: data.coverage.linksAvailable ? undefined : t.missingLinks,
        trend: paidReady
          ? trend(
              (row) => row.conversionRate,
              t.rate,
              (value) => fmtPct(value, 1),
            )
          : undefined,
        breakdowns: paidReady
          ? [
              {
                id: "courseRate",
                title: t.course,
                hint: t.limitedLinks,
                rows: topRows(
                  dimensionRows(
                    data.byCourse.filter((row) => row.leads > 0),
                    (row) => row.conversionRate,
                    (row) => pct(row.conversionRate),
                  ),
                ),
              },
              {
                id: "sourceRate",
                title: t.source,
                rows: topRows(
                  dimensionRows(
                    data.bySource.filter((row) => row.leads > 0),
                    (row) => row.conversionRate,
                    (row) => pct(row.conversionRate),
                  ),
                ),
              },
            ]
          : undefined,
        provenance,
      },
    };
  }, [data, lang, paidReady, t, x]);

  /** The monthly rows, with the payment-month figures joined onto each. */
  const monthRows = useMemo((): MonthRow[] => {
    if (!data) return [];
    return data.rows.map((row) => {
      const collections = data.collectionsByMonth.find((item) => item.month === row.name);
      return {
        ...row,
        paidInvoices: data.availability.accounting ? (collections?.paidInvoices ?? null) : null,
        paidUsd: data.availability.accounting ? (collections?.paidUsd ?? null) : null,
      };
    });
  }, [data]);

  /**
   * One column set, used by the monthly table and by every breakdown.
   *
   * Sharing it is the point: when the attempt columns existed only on the month
   * total, "which salesperson is slow to call?" had no answer on a page whose
   * whole purpose is to answer it fairly.
   */
  const groupCols = (
    label: string,
    isCloser: boolean,
    monthly = false,
  ): Col<PerformanceGroup>[] => [
    {
      key: "name",
      header: label,
      always: true,
      sticky: true,
      minWidth: "180px",
      render: (row) => (
        <span className="font-semibold text-text" title={row.name}>
          {row.name === "—" ? (lang === "ar" ? "غير منسوب" : "Unattributed") : row.name}
        </span>
      ),
      sortValue: (row) => row.name,
    },
    {
      key: "leads",
      header: isCloser ? t.paid : t.leads,
      group: "volume",
      align: "right",
      render: (row) => n(row.leads),
      sortValue: (row) => row.leads,
    },
    {
      key: "freshTagged",
      header: x.groupColumns.fresh,
      group: "volume",
      align: "right",
      headerTitle: t.freshGap,
      render: (row) => n(row.freshTagged),
      sortValue: (row) => row.freshTagged,
    },
    {
      key: "segmentMissing",
      header: x.groupColumns.segmentMissing,
      group: "volume",
      align: "right",
      headerTitle: t.freshGap,
      render: (row) => n(row.segmentMissing),
      sortValue: (row) => row.segmentMissing,
    },
    {
      key: "duplicates",
      header: x.groupColumns.duplicates,
      label: x.groupColumns.duplicates,
      group: "quality",
      align: "right",
      headerTitle: t.definitionText,
      render: (row) => n(row.duplicateSameMonth + row.duplicateEarlierMonth),
      sortValue: (row) => row.duplicateSameMonth + row.duplicateEarlierMonth,
    },
    {
      key: "dupSame",
      header: x.groupColumns.dupSame,
      group: "quality",
      align: "right",
      hideByDefault: true,
      render: (row) => n(row.duplicateSameMonth),
      sortValue: (row) => row.duplicateSameMonth,
    },
    {
      key: "dupPrev",
      header: x.groupColumns.dupPrev,
      group: "quality",
      align: "right",
      hideByDefault: true,
      render: (row) => n(row.duplicateEarlierMonth),
      sortValue: (row) => row.duplicateEarlierMonth,
    },
    {
      key: "dupRate",
      header: x.groupColumns.dupRate,
      group: "quality",
      align: "right",
      hideByDefault: true,
      render: (row) =>
        pct(
          row.leads
            ? ((row.duplicateSameMonth + row.duplicateEarlierMonth) / row.leads) * 100
            : null,
        ),
      sortValue: (row) =>
        row.leads ? (row.duplicateSameMonth + row.duplicateEarlierMonth) / row.leads : 0,
    },
    {
      key: "unqualified",
      header: t.unqualified,
      group: "quality",
      align: "right",
      render: (row) => n(row.unqualified),
      sortValue: (row) => row.unqualified,
    },
    {
      key: "noAnswer",
      header: t.noAnswer,
      group: "quality",
      align: "right",
      render: (row) => (isCloser ? "—" : n(row.noAnswer)),
      sortValue: (row) => row.noAnswer,
    },
    {
      key: "unreachable",
      header: t.unreachable,
      group: "quality",
      align: "right",
      hideByDefault: true,
      render: (row) => (isCloser ? "—" : n(row.unreachable)),
      sortValue: (row) => row.unreachable,
    },
    {
      key: "noInterest",
      header: t.noInterest,
      group: "quality",
      align: "right",
      hideByDefault: true,
      render: (row) => (isCloser ? "—" : n(row.noInterest)),
      sortValue: (row) => row.noInterest,
    },
    {
      key: "contacted",
      header: x.groupColumns.contacted,
      group: "followUp",
      align: "right",
      headerTitle: t.missingCalls,
      render: (row) => n(row.contacted),
      sortValue: (row) => row.contacted ?? -1,
    },
    {
      key: "attempts",
      header: x.groupColumns.attempts,
      group: "followUp",
      align: "right",
      render: (row) => n(row.averageAttempts),
      sortValue: (row) => row.averageAttempts ?? -1,
    },
    {
      key: "hours",
      header: x.groupColumns.hours,
      group: "followUp",
      align: "right",
      headerTitle: t.avgHours,
      render: (row) =>
        row.averageHoursToFirstCall !== null
          ? n(row.averageHoursToFirstCall)
          : row.averageDaysToFirstCall !== null
            ? `${n(row.averageDaysToFirstCall * 24)}*`
            : "—",
      sortValue: (row) => row.averageHoursToFirstCall ?? (row.averageDaysToFirstCall ?? -1) * 24,
    },
    {
      key: "lost",
      header: t.lost,
      group: "outcome",
      align: "right",
      hideByDefault: monthly,
      headerTitle: monthly ? t.trendSub : undefined,
      render: (row) =>
        isCloser ? (
          "—"
        ) : (
          <span style={{ color: "var(--rose-ink)" }}>
            {n(row.lost)} · {pct(row.lostRate)}
          </span>
        ),
      sortValue: (row) => row.lost,
    },
    {
      key: "paid",
      header: t.paid,
      group: "outcome",
      align: "right",
      hideByDefault: monthly,
      render: (row) =>
        paidReady ? <span style={{ color: "var(--mint-ink)" }}>{n(row.paidLeads)}</span> : "—",
      sortValue: (row) => row.paidLeads,
    },
    {
      key: "rate",
      header: t.rate,
      group: "outcome",
      align: "right",
      hideByDefault: monthly,
      render: (row) => (paidReady && !isCloser ? pct(row.conversionRate) : "—"),
      sortValue: (row) => row.conversionRate ?? -1,
    },
    {
      key: "laterPaid",
      header: x.groupColumns.laterPaid,
      group: "outcome",
      align: "right",
      hideByDefault: true,
      headerTitle: t.cohortVsPayment,
      render: (row) => (paidReady ? n(row.paidLater) : "—"),
      sortValue: (row) => row.paidLater,
    },
    {
      key: "orders",
      header: x.groupColumns.orders,
      group: "outcome",
      align: "right",
      hideByDefault: true,
      render: (row) => (paidReady ? n(row.paidOrders) : "—"),
      sortValue: (row) => row.paidOrders,
    },
    {
      key: "money",
      header: t.money,
      group: "outcome",
      align: "right",
      render: (row) => (paidReady ? money(row.paidRevenue) : "—"),
      sortValue: (row) => row.paidRevenue,
    },
  ];

  const bandLabels = {
    volume: x.bandVolume,
    quality: x.bandQuality,
    followUp: x.bandFollowUp,
    outcome: x.bandOutcome,
    payment: x.bandPaymentMonth,
  };

  const csvRow = (row: PerformanceGroup): Record<string, string | number> => ({
    name: row.name,
    leads: row.leads,
    freshTagged: row.freshTagged,
    segmentMissing: row.segmentMissing,
    duplicateSameMonth: row.duplicateSameMonth,
    duplicateEarlierMonth: row.duplicateEarlierMonth,
    confirmedDuplicate: row.confirmedDuplicate,
    unqualified: row.unqualified,
    noAnswer: row.noAnswer,
    unreachable: row.unreachable,
    noInterest: row.noInterest,
    lost: row.lost,
    lostRate: row.lostRate ?? "",
    contacted: row.contacted ?? "",
    averageAttempts: row.averageAttempts ?? "",
    hoursToFirstAttempt: row.averageHoursToFirstCall ?? "",
    paidLeads: paidReady ? row.paidLeads : "",
    paidLater: paidReady ? row.paidLater : "",
    conversionRate: paidReady ? (row.conversionRate ?? "") : "",
    paidOrders: paidReady ? row.paidOrders : "",
    netUsd: paidReady ? row.paidRevenue : "",
  });

  if (isLoading)
    return (
      <div className="page-sections">
        <Skeleton className="h-28" />
        <KpiSkeletonGrid count={4} />
        <Skeleton className="h-72" />
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
  const leadRecordsNow = data.records.filter((row) => row.recordType === "lead").length;
  const selectedCollections = data.collectionsByMonth.find(
    (row) => row.month === data.selectedMonth,
  );
  const linkedLines = data.coverage.linkedAccountingLines;
  const totalLines = linkedLines + data.coverage.unlinkedAccountingLines;
  const linkCoverage = totalLines ? (linkedLines / totalLines) * 100 : null;
  const stages = performanceStages(selected, paidReady);
  const stageLabel: Record<string, string> = {
    entered: t.funnelLead,
    contacted: x.contactedStage,
    opportunity: t.funnelOpp,
    paid: t.funnelPaid,
  };
  const stageTone: Record<string, string> = {
    entered: "var(--sky-strong)",
    contacted: "var(--violet-strong)",
    opportunity: "var(--amber-strong)",
    paid: "var(--mint-strong)",
  };
  const dimensions: { id: Dimension; label: string; rows: PerformanceGroup[] }[] = [
    { id: "course", label: t.course, rows: data.byCourse },
    { id: "source", label: t.source, rows: data.bySource },
    { id: "platform", label: x.platform, rows: data.byPlatform },
    { id: "campaign", label: t.campaign, rows: data.byCampaign },
    { id: "buyer", label: t.buyer, rows: data.byMediaBuyer },
    { id: "owner", label: t.owner, rows: data.bySalesOwner },
    { id: "closer", label: t.closer, rows: paidReady ? data.bySalesCloser : [] },
  ];
  const activeDimension = dimensions.find((item) => item.id === dimension)!;
  const lostDimensions = dimensions.filter(
    (item): item is (typeof dimensions)[number] & { id: LostDimension } =>
      ["course", "platform", "source", "owner", "buyer"].includes(item.id),
  );
  const activeLostDimension = lostDimensions.find((item) => item.id === lostDimension)!;
  const displayedRecords = data.records.filter((row) =>
    recordScope === "all"
      ? true
      : recordScope === "duplicate"
        ? row.duplicate !== null
        : row.duplicate === null,
  );
  const notices = [
    !data.coverage.linksAvailable && t.missingLinks,
    linkCoverage !== null && linkCoverage < 90 && `${t.limitedLinks} (${pct(linkCoverage)})`,
    !data.availability.accounting && t.missingAccounting,
    !data.coverage.callsAvailable &&
      `${t.missingCalls} ${
        data.callCoverage
          ? `(${data.callCoverage.coveredDays}/${data.callCoverage.expectedDays} ${lang === "ar" ? "يوم" : "days"})`
          : ""
      }`,
    data.coverage.callsAvailable && !data.availability.callRefreshSucceeded && t.staleCalls,
    !data.coverage.qaAvailable && t.missingQa,
    data.coverage.qaAvailable && data.coverage.qaReviewed === 0 && t.noQaReviews,
  ].filter((value): value is string => Boolean(value));
  const exportParams = new URLSearchParams({ month: data.selectedMonth, lang });
  const hasFreshGap = selected.segmentMissing > 0;
  const hasPaidGap = data.coverage.unlinkedAccountingInvoices > 0;
  const hasQaGap = data.coverage.qaReviewed === 0;

  const recordColumns: Col<PerformanceRecord>[] = [
    {
      key: "id",
      header: t.recordId,
      always: true,
      sticky: true,
      render: (row) => (
        <a
          className="font-semibold text-sky-strong underline underline-offset-2"
          href={`https://engosoft.com/web#id=${encodeURIComponent(row.id)}&model=crm.lead&view_type=form`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {row.id}
        </a>
      ),
      sortValue: (row) => Number(row.id) || row.id,
    },
    {
      key: "createdAt",
      header: t.entryDate,
      render: (row) => row.createdAt,
      sortValue: (row) => row.createdAt,
    },
    {
      key: "course",
      header: t.course,
      render: (row) => row.course || "—",
      sortValue: (row) => row.course,
    },
    {
      key: "source",
      header: t.source,
      render: (row) => row.source || "—",
      sortValue: (row) => row.source,
    },
    {
      key: "campaign",
      header: t.campaign,
      render: (row) => row.campaign || "—",
      sortValue: (row) => row.campaign,
    },
    {
      key: "buyer",
      header: t.buyer,
      render: (row) => row.mediaBuyer || "—",
      sortValue: (row) => row.mediaBuyer,
    },
    {
      key: "owner",
      header: t.owner,
      render: (row) => row.salesperson || "—",
      sortValue: (row) => row.salesperson,
    },
    {
      key: "status",
      header: t.currentState,
      render: (row) => currentState(row, lang),
      sortValue: (row) => row.status,
    },
    {
      key: "attempts",
      header: t.attempts,
      align: "right",
      render: (row) => n(row.attempts),
      sortValue: (row) => row.attempts ?? -1,
    },
    {
      key: "firstAttempt",
      header: t.firstAttempt,
      align: "right",
      render: (row) =>
        row.firstCallLagHours !== null
          ? n(row.firstCallLagHours)
          : row.firstCallLagDays !== null
            ? `${n(row.firstCallLagDays * 24)}*`
            : "—",
      sortValue: (row) => row.firstCallLagHours ?? (row.firstCallLagDays ?? -1) * 24,
    },
    {
      key: "paid",
      header: t.paidFlag,
      align: "right",
      render: (row) =>
        paidReady
          ? row.paidOrders
            ? `${n(row.paidOrders)} · ${money(row.paidRevenue)}`
            : "0"
          : "—",
      sortValue: (row) => row.paidOrders,
    },
    {
      key: "segment",
      header: t.segment,
      hideByDefault: true,
      render: (row) => row.leadSegment || "—",
      sortValue: (row) => row.leadSegment,
    },
    {
      key: "type",
      header: t.recordType,
      hideByDefault: true,
      render: (row) => recordType(row, lang),
      sortValue: (row) => row.recordType,
    },
    {
      key: "duplicate",
      header: t.duplicateFlag,
      hideByDefault: true,
      render: (row) =>
        row.duplicate === "same" ? t.same : row.duplicate === "earlier" ? t.previous : "—",
      sortValue: (row) => row.duplicate ?? "",
    },
    {
      key: "reason",
      header: t.reason,
      hideByDefault: true,
      render: (row) => (lang === "ar" ? row.lossReasonAr : row.lossReasonEn) || "—",
      sortValue: (row) => row.lossReasonEn,
    },
    {
      key: "closer",
      header: t.closer,
      hideByDefault: true,
      render: (row) => (paidReady ? row.closer || "—" : "—"),
      sortValue: (row) => row.closer,
    },
  ];

  return (
    <PageSections>
      <DashboardPageHeader
        flush
        tone="violet"
        icon={<Layers3 size={21} />}
        title={t.title}
        subtitle={x.headerSubtitle}
        period={`${monthLabel(data.months[0]!, lang)} → ${fmtDate(data.asOf, lang)}`}
        sync={data.syncedAt ? <SyncStatus label={fmtDate(data.syncedAt, lang)} /> : undefined}
        actions={
          <a
            href={`/api/lead-performance-export?${exportParams.toString()}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-xs font-semibold text-text transition-colors hover:bg-surface-2"
            title={x.exportHint}
          >
            <Download size={15} />
            {x.exportLabel}
          </a>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={data.selectedMonth}
            onChange={setMonth}
            options={data.months.map((item) => ({
              value: item,
              label: monthLabel(item, lang),
            }))}
          />
          <Pill tone="neutral" wrap>
            {t.fixed}
          </Pill>
        </div>
      </DashboardPageHeader>

      <PageSection
        title={t.quickRead}
        hint={`${monthLabel(data.selectedMonth, lang)} · ${t.quickReadHint}`}
        icon={<BadgeCheck size={16} />}
        tone="sky"
        id="performance-summary"
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="border-sky-strong/20 bg-sky-surface/50">
            <div className="text-xs font-semibold text-text-muted">{t.enteredBasis}</div>
            <div className="num mt-2 text-3xl font-bold text-text">{n(selected.leads)}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-text-muted">{t.leadRecordsNow}</span>
                <b className="num mt-1 block text-base text-text">{n(leadRecordsNow)}</b>
              </div>
              <div>
                <span className="text-text-muted">{t.opportunityNow}</span>
                <b className="num mt-1 block text-base text-text">{n(selected.opportunities)}</b>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-sky-strong/15 bg-surface/70 px-3 py-2.5 text-[11.5px] leading-5 text-text-muted">
              <p>
                <b className="text-text">
                  {t.freshNow}: {n(selected.freshTagged)}
                </b>{" "}
                · {t.freshMeaning}
              </p>
              <p className="mt-2">
                {t.preCrmUnavailable}. {t.classificationPrompt}
              </p>
            </div>
          </Card>
          <Card className="border-mint-strong/20 bg-mint-surface/50">
            <div className="text-xs font-semibold text-text-muted">{t.verifiedOutcome}</div>
            <div className="num mt-2 text-3xl font-bold text-text">
              {paidReady ? n(selected.paidLeads) : "—"}
            </div>
            <div className="mt-3 text-xs leading-6 text-text-muted">
              {t.rate}:{" "}
              <b className="text-text">{paidReady ? pct(selected.conversionRate) : "—"}</b> ·{" "}
              {t.later}: <b className="text-text">{paidReady ? n(selected.paidLater) : "—"}</b>
            </div>
          </Card>
          <Card className="border-amber-strong/20 bg-amber-surface/50">
            <div className="text-xs font-semibold text-text-muted">{t.evidenceGap}</div>
            <div className="mt-3 space-y-2 text-[12px] leading-5 text-text-muted">
              {hasFreshGap && <p>{t.freshGap}</p>}
              {hasPaidGap && <p>{t.paidGap}</p>}
              {hasQaGap && <p>{t.qaGap}</p>}
              <p>{t.funnelGap}</p>
            </div>
          </Card>
        </div>
      </PageSection>

      <LeadClassificationAudit
        records={data.records}
        lang={lang}
        callsAvailable={data.coverage.callsAvailable}
      />

      {notices.length > 0 && (
        <div className="space-y-2">
          {notices.map((text) => (
            <Notice key={text} tone="warning" icon={<AlertTriangle size={15} />}>
              {text}
            </Notice>
          ))}
        </div>
      )}

      <PageSection level="headline" aria-label={t.title}>
        <KpiRow>
          <MetricDetailTrigger detail={figures.leads!} card={{ index: 0 }} />
          <MetricDetailTrigger
            detail={figures.lost!}
            card={{ index: 1, sub: pct(selected.lostRate) }}
          />
          <MetricDetailTrigger
            detail={figures.paid!}
            card={{ index: 2, sub: t.wonCaveat, subWrap: true }}
          />
          <MetricDetailTrigger
            detail={figures.rate!}
            card={{
              index: 3,
              sub: paidReady ? `${n(selected.paidLater)} ${t.later}` : undefined,
            }}
          />
        </KpiRow>
      </PageSection>

      <PageSection
        title={t.funnel}
        hint={t.trendSub}
        icon={<Filter size={16} />}
        tone="violet"
        id="performance-funnel"
      >
        <Card>
          <div className="space-y-4">
            {stages.map((stage) => (
              <div key={stage.key}>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-[13px] font-semibold text-text">
                    {stageLabel[stage.key]}
                    {!stage.evidenced && (
                      <span
                        className="ms-1.5 align-middle text-[11px] font-medium text-text-muted"
                        title={stage.count === null ? x.stageWithheld : x.stageProxy}
                      >
                        *
                      </span>
                    )}
                  </span>
                  <span className="num flex items-baseline gap-2 text-[13px]">
                    <b className="text-text">{n(stage.count)}</b>
                    {stage.stepRate !== null && (
                      <span className="text-text-muted">
                        {pct(stage.stepRate)} {x.stageStep}
                      </span>
                    )}
                    {stage.key !== "entered" && stage.shareOfEntries !== null && (
                      <span className="text-text-subtle">
                        {pct(stage.shareOfEntries)} {x.stageShare}
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${stage.shareOfEntries === null ? 0 : Math.min(100, stage.shareOfEntries)}%`,
                      background: stageTone[stage.key],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11.5px] leading-relaxed text-text-muted">
            {x.stageProxy} · {t.wonCaveat}
          </p>
        </Card>
      </PageSection>

      <PageSection
        title={x.monthlyTable}
        hint={x.monthlyTableHint}
        icon={<CalendarRange size={16} />}
        tone="sky"
        id="performance-trend"
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {data.rows.map((row) => (
            <button
              key={row.name}
              type="button"
              aria-pressed={row.name === data.selectedMonth}
              onClick={() => setMonth(row.name)}
              className={`rounded-2xl border p-3 text-start transition-colors hover:border-sky-strong ${
                row.name === data.selectedMonth
                  ? "border-sky-strong bg-sky-surface shadow-sm"
                  : "border-border bg-surface"
              }`}
            >
              <span className="text-xs font-semibold text-text">{monthLabel(row.name, lang)}</span>
              <span className="num mt-2 block text-2xl font-bold text-text">{n(row.leads)}</span>
              <span className="text-[11px] text-text-muted">{t.leads}</span>
              <span className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <span className="text-rose-strong">
                  {x.calendarLost}
                  <b className="num mt-0.5 block text-sm">{n(row.calendarLost)}</b>
                  <span className="block text-text-muted">
                    {x.calendarLostOlderEntry}: {n(row.calendarLostOlderEntry)}
                  </span>
                </span>
                <span className="text-mint-strong">
                  {x.sameMonthPaid}
                  <b className="num mt-0.5 block text-sm">
                    {paidReady ? n(row.paidSameEntryMonth) : "—"} ·{" "}
                    {paidReady ? pct(row.paidSameEntryMonthRate) : "—"}
                  </b>
                </span>
              </span>
              <span className="mt-2 block text-[11px] text-text-muted">
                {x.sameMonthLost}: {n(row.lostSameEntryMonth)} · {x.calendarPaid}:{" "}
                {paidReady ? n(row.calendarPaid) : "—"}
              </span>
            </button>
          ))}
        </div>
        <Card padded={false} className="overflow-hidden">
          <DataTable<MonthRow>
            rows={monthRows}
            cols={[
              ...(groupCols(t.month, false, true) as Col<MonthRow>[]),
              {
                key: "calendarLost",
                header: x.calendarLost,
                group: "outcome",
                align: "right",
                always: true,
                render: (row) => n(row.calendarLost),
                sortValue: (row) => row.calendarLost,
              },
              {
                key: "calendarLostOlderEntry",
                header: x.calendarLostOlderEntry,
                group: "outcome",
                align: "right",
                render: (row) => n(row.calendarLostOlderEntry),
                sortValue: (row) => row.calendarLostOlderEntry,
              },
              {
                key: "lostSameEntryMonth",
                header: x.sameMonthLost,
                group: "outcome",
                align: "right",
                always: true,
                render: (row) =>
                  `${n(row.lostSameEntryMonth)} · ${pct(row.leads ? (row.lostSameEntryMonth / row.leads) * 100 : null)}`,
                sortValue: (row) => row.lostSameEntryMonth,
              },
              {
                key: "paidSameEntryMonth",
                header: x.sameMonthPaid,
                group: "outcome",
                align: "right",
                always: true,
                render: (row) =>
                  paidReady
                    ? `${n(row.paidSameEntryMonth)} · ${pct(row.paidSameEntryMonthRate)}`
                    : "—",
                sortValue: (row) => row.paidSameEntryMonth,
              },
              {
                key: "calendarPaid",
                header: x.calendarPaid,
                group: "payment",
                align: "right",
                render: (row) => (paidReady ? n(row.calendarPaid) : "—"),
                sortValue: (row) => row.calendarPaid,
              },
              {
                key: "lostTimingUnverified",
                header: x.lossUnverified,
                group: "outcome",
                align: "right",
                hideByDefault: true,
                render: (row) => n(row.lostTimingUnverified),
                sortValue: (row) => row.lostTimingUnverified,
              },
              {
                key: "paidInvoices",
                header: x.groupColumns.invoices,
                group: "payment",
                align: "right",
                headerTitle: t.cohortVsPayment,
                render: (row) => n(row.paidInvoices),
                sortValue: (row) => row.paidInvoices ?? -1,
              },
              {
                key: "paidUsd",
                header: x.groupColumns.collected,
                group: "payment",
                align: "right",
                hideByDefault: true,
                headerTitle: t.cohortVsPayment,
                render: (row) => money(row.paidUsd),
                sortValue: (row) => row.paidUsd ?? -1,
              },
            ]}
            groupLabels={bandLabels}
            columnChooser
            defaultVisibleLimit={15}
            pageSize={6}
            initialSort={{ key: "name", dir: 1 }}
            onRowClick={(row) => setMonth(row.name)}
            rowKey={(row) => row.name}
            csvFilename={`engosoft-lead-cohorts-${data.asOf}`}
            csvRow={csvRow}
          />
        </Card>
      </PageSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <PageSection title={t.contact} hint={t.coverage} icon={<PhoneCall size={16} />} tone="cyan">
          <Card>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <SmallStat label={t.zero} value={n(selected.contact0)} />
              <SmallStat label={t.one} value={n(selected.contact1)} />
              <SmallStat label={t.two} value={n(selected.contact2)} />
              <SmallStat label={t.many} value={n(selected.contact3Plus)} />
              <SmallStat label={t.avgAttempts} value={n(selected.averageAttempts)} />
              <SmallStat
                label={selected.averageHoursToFirstCall !== null ? t.avgHours : t.avgDays}
                value={n(selected.averageHoursToFirstCall ?? selected.averageDaysToFirstCall)}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill tone={selected.contactedWithin24h === null ? "neutral" : "success"}>
                {x.within24}: {n(selected.contactedWithin24h)}
              </Pill>
              <Pill tone="neutral">
                {t.coverage}: {n(selected.callMatchable)} / {n(selected.leads)}
              </Pill>
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-text-muted">
              {data.coverage.callsAvailable
                ? selected.exactLagSample
                  ? `${n(selected.exactLagSample)} ${lang === "ar" ? "سجل بتوقيت إنشاء دقيق" : "records with an exact creation time"}`
                  : lang === "ar"
                    ? "تقدير يومي فقط"
                    : "Day-level estimate only"
                : t.missingCalls}
            </p>
          </Card>
        </PageSection>

        <PageSection
          title={t.duplicates}
          hint={`${t.confirmed}: ${n(selected.confirmedDuplicate)}`}
          icon={<CopyCheck size={16} />}
          tone="amber"
        >
          <Card>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <SmallStat label={t.same} value={n(selected.duplicateSameMonth)} />
              <SmallStat label={t.previous} value={n(selected.duplicateEarlierMonth)} />
              <SmallStat
                label={t.duplicates}
                value={pct(
                  selected.leads
                    ? ((selected.duplicateSameMonth + selected.duplicateEarlierMonth) /
                        selected.leads) *
                        100
                    : null,
                )}
              />
            </div>
            <p className="mt-3 text-[11.5px] leading-5 text-text-muted">
              {x.duplicateBasis} {n(selected.duplicateSameMonth + selected.duplicateEarlierMonth)} ÷{" "}
              {n(selected.leads)} ={" "}
              {pct(
                selected.leads
                  ? ((selected.duplicateSameMonth + selected.duplicateEarlierMonth) /
                      selected.leads) *
                      100
                  : null,
              )}
              .
            </p>
            <p className="mt-1 text-[11.5px] leading-5 text-text-muted">
              {x.declaredDuplicateBasis}: {n(selected.confirmedDuplicate)} ÷ {n(selected.lost)} ={" "}
              {pct(selected.lost ? (selected.confirmedDuplicate / selected.lost) * 100 : null)}.
            </p>
            <div className="mt-4">
              <SectionTitle hint={`${t.unqualified}: ${n(selected.unqualified)}`}>
                {t.quality}
              </SectionTitle>
              <BarList
                items={data.unqualifiedReasons.map((row) => ({
                  label:
                    row.category === "customer_data"
                      ? t.data
                      : row.category === "course_fit"
                        ? t.fit
                        : t.unspecified,
                  value: row.count,
                }))}
                format={(value) => fmtNum(value)}
                // Bars are drawn against the cohort's unqualified total, so
                // three small categories do not each read as a full bar.
                max={selected.unqualified || 1}
                color="var(--amber-strong)"
              />
            </div>
          </Card>
        </PageSection>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PageSection
          title={t.reasons}
          hint={t.reasonsSub}
          icon={<TrendingDown size={16} />}
          tone="rose"
          id="performance-reasons"
        >
          <Card>
            <BarList
              items={data.lossReasons.slice(0, 8).map((reason) => ({
                label: lang === "ar" ? reason.ar : reason.en,
                value: reason.count,
                meta: `${n(reason.count)} · ${pct(selected.lost ? (reason.count / selected.lost) * 100 : null)} ${x.reasonShare}`,
              }))}
              format={(value) => fmtNum(value)}
              max={selected.lost || 1}
              color="var(--rose-strong)"
            />
          </Card>
        </PageSection>

        <PageSection
          title={t.paymentMonth}
          hint={monthLabel(data.selectedMonth, lang)}
          icon={<ReceiptText size={16} />}
          tone="mint"
        >
          <Card>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
              <div>
                <div className="text-[11.5px] text-text-muted">{t.paymentMonth}</div>
                <div className="num mt-1 text-3xl font-bold text-text">
                  {data.availability.accounting ? n(selectedCollections?.paidInvoices) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[11.5px] text-text-muted">{t.paymentRevenue}</div>
                <div className="num mt-1 text-xl font-bold text-text">
                  {data.availability.accounting ? money(selectedCollections?.paidUsd ?? 0) : "—"}
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-text-muted">
              {t.cohortVsPayment}
            </p>
          </Card>
        </PageSection>
      </div>

      <PageSection
        title={x.lostBreakdown}
        hint={x.lostBreakdownHint}
        icon={<TrendingDown size={16} />}
        tone="rose"
        id="performance-lost-breakdown"
        action={
          <Segmented
            value={lostDimension}
            onChange={setLostDimension}
            options={lostDimensions.map((item) => ({ value: item.id, label: item.label }))}
          />
        }
      >
        <Card padded={false} className="overflow-hidden">
          <DataTable<PerformanceGroup>
            rows={activeLostDimension.rows}
            cols={[
              {
                key: "name",
                header: activeLostDimension.label,
                always: true,
                sticky: true,
                render: (row) =>
                  row.name === "—" ? (lang === "ar" ? "غير منسوب" : "Unattributed") : row.name,
                sortValue: (row) => row.name,
              },
              {
                key: "leads",
                header: t.leads,
                align: "right",
                render: (row) => n(row.leads),
                sortValue: (row) => row.leads,
              },
              {
                key: "lostLeads",
                header: x.lostLead,
                align: "right",
                render: (row) => n(row.lostLeads),
                sortValue: (row) => row.lostLeads,
              },
              {
                key: "lostOpportunities",
                header: x.lostOpp,
                align: "right",
                render: (row) => n(row.lostOpportunities),
                sortValue: (row) => row.lostOpportunities,
              },
              {
                key: "lostRate",
                header: t.lost,
                align: "right",
                render: (row) => `${n(row.lost)} · ${pct(row.lostRate)}`,
                sortValue: (row) => row.lost,
              },
              {
                key: "noAnswer",
                header: t.noAnswer,
                align: "right",
                render: (row) => n(row.noAnswer),
                sortValue: (row) => row.noAnswer,
              },
              {
                key: "unreachable",
                header: t.unreachable,
                align: "right",
                render: (row) => n(row.unreachable),
                sortValue: (row) => row.unreachable,
              },
              {
                key: "noInterest",
                header: t.noInterest,
                align: "right",
                render: (row) => n(row.noInterest),
                sortValue: (row) => row.noInterest,
              },
            ]}
            searchable={(row) => row.name}
            initialSort={{ key: "lostRate", dir: -1 }}
            rowKey={(row) => row.name}
            csvFilename={`engosoft-lost-${lostDimension}-${data.selectedMonth}`}
            csvRow={(row) => ({
              name: row.name,
              leads: row.leads,
              lostLeads: row.lostLeads,
              lostOpportunities: row.lostOpportunities,
              lost: row.lost,
              lostRate: row.lostRate ?? "",
              noAnswer: row.noAnswer,
              unreachable: row.unreachable,
              noInterest: row.noInterest,
            })}
          />
        </Card>
      </PageSection>

      <PageSection
        title={t.breakdown}
        hint={t.trendSub}
        icon={<Layers3 size={16} />}
        tone="violet"
        id="performance-breakdown"
        action={
          <Segmented
            value={dimension}
            onChange={setDimension}
            options={dimensions.map((item) => ({ value: item.id, label: item.label }))}
          />
        }
      >
        <Card padded={false} className="overflow-hidden">
          <DataTable<PerformanceGroup>
            rows={activeDimension.rows}
            cols={groupCols(activeDimension.label, dimension === "closer")}
            groupLabels={bandLabels}
            columnChooser
            defaultVisibleLimit={15}
            searchable={(row) => row.name}
            initialSort={{ key: "leads", dir: -1 }}
            rowKey={(row) => row.name}
            csvFilename={`engosoft-lead-cohort-${dimension}-${data.selectedMonth}`}
            csvRow={csvRow}
            emptyState={
              <p className="p-8 text-center text-sm text-text-muted">{x.noDimensionRows}</p>
            }
          />
        </Card>
      </PageSection>

      <PageSection
        title={t.recordList}
        hint={`${monthLabel(data.selectedMonth, lang)} · ${n(displayedRecords.length)} / ${n(data.records.length)} ${t.rows}`}
        icon={<Users size={16} />}
        tone="sky"
        id="performance-records"
        action={
          <Segmented
            value={recordScope}
            onChange={setRecordScope}
            options={[
              { value: "all", label: x.duplicateAll },
              { value: "duplicate", label: x.duplicateOnly },
              { value: "nonduplicate", label: x.nonDuplicate },
            ]}
          />
        }
      >
        <Card padded={false} className="overflow-hidden">
          <p className="px-4 pt-4 text-xs leading-6 text-text-muted">
            {t.recordListHint} {t.recordCountHint} {x.duplicateBasis}
          </p>
          <DataTable<PerformanceRecord>
            rows={displayedRecords}
            cols={recordColumns}
            searchable={(row) =>
              [row.id, row.course, row.source, row.campaign, row.mediaBuyer, row.salesperson].join(
                " ",
              )
            }
            columnChooser
            defaultVisibleLimit={11}
            pageSize={20}
            maxHeight={640}
            initialSort={{ key: "createdAt", dir: -1 }}
            rowKey={(row) => row.id}
            csvFilename={`engosoft-lead-records-${data.selectedMonth}`}
            csvRow={(row) => ({
              id: row.id,
              createdAt: row.createdAt,
              course: row.course,
              source: row.source,
              campaign: row.campaign,
              mediaBuyer: row.mediaBuyer,
              salesperson: row.salesperson,
              status: row.status,
              leadSegment: row.leadSegment,
              duplicate: row.duplicate ?? "",
              attempts: row.attempts ?? "",
              firstCallLagHours: row.firstCallLagHours ?? "",
              lossReason: lang === "ar" ? row.lossReasonAr : row.lossReasonEn,
              paidOrders: paidReady ? row.paidOrders : "",
              paidUsd: paidReady ? row.paidRevenue : "",
            })}
          />
        </Card>
      </PageSection>

      <PageSection
        title={t.definitions}
        icon={<ShieldCheck size={16} />}
        tone="slate"
        level="insight"
      >
        <Card>
          <p className="text-[13px] leading-7 text-text-muted">{t.definitionText}</p>
          <div className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-text">
            <CircleHelp size={15} style={{ color: "var(--amber-strong)" }} />
            {t.limits}
          </div>
          <p className="mt-2 text-[13px] leading-7 text-text-muted">{t.limitsText}</p>
          <dl className="mt-5 grid gap-3 text-[11.5px] sm:grid-cols-2 lg:grid-cols-3">
            <Fact
              label={t.excluded}
              value={`Recommendation ${n(data.coverage.excludedRecommendation)} · WhatsApp Broadcast ${n(data.coverage.excludedBroadcast)} · AutoDialer Broadcast ${n(data.coverage.excludedAutodialerBroadcast)}`}
            />
            <Fact
              label={t.unknown}
              value={`${t.campaign} ${n(data.coverage.unknownCampaign)} · ${t.buyer} ${n(data.coverage.unknownMediaBuyer)}`}
            />
            <Fact
              label={
                lang === "ar" ? "بنود غير مربوطة في آخر ٦ أشهر" : "Unlinked lines in six months"
              }
              value={`${n(data.coverage.unlinkedAccountingLines)}${linkCoverage !== null ? ` · ${pct(linkCoverage)} ${lang === "ar" ? "مربوط" : "linked"}` : ""}`}
            />
            <Fact
              label={
                lang === "ar" ? "مراجعات الجودة اليدوية" : "Manual quality reviews in this cohort"
              }
              value={`${n(data.coverage.qaReviewed)} / ${n(selected.leads)}`}
            />
            <Fact
              label={lang === "ar" ? "هوية ناقصة" : "Records with no identity"}
              value={n(data.coverage.missingIdentity)}
            />
            <Fact
              label={lang === "ar" ? "آخر مزامنة" : "Last sync"}
              value={data.syncedAt ? fmtDate(data.syncedAt, lang) : "—"}
            />
          </dl>
          <dl className="mt-4 grid gap-3 border-t border-border pt-4 text-[11.5px] sm:grid-cols-2">
            {Object.entries(data.source ?? {}).map(([key, value]) => (
              <Fact key={key} label={key} value={String(value)} />
            ))}
          </dl>
        </Card>
      </PageSection>
    </PageSections>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="text-[11.5px] leading-snug text-text-muted">{label}</div>
      <div className="num mt-1.5 text-lg font-bold text-text">{value}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-subtle">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-text-muted">{value}</dd>
    </div>
  );
}
