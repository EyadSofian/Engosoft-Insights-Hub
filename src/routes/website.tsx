import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Banknote,
  BookOpen,
  CircleCheckBig,
  CircleDot,
  CircleX,
  Clock3,
  GitMerge,
  Globe2,
  Gauge,
  LayoutDashboard,
  ListChecks,
  MousePointerClick,
  ShoppingCart,
  Target,
  UsersRound,
} from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import {
  BarList,
  Card,
  ErrorState,
  KpiCard,
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { fmtDate, fmtNum, fmtPct, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import { PLATFORM_COLOR, PLATFORM_LABEL } from "@/lib/constants";
import type { CampaignObjective, Platform } from "@/lib/types";

export const Route = createFileRoute("/website")({ component: Website });

interface SpecialtyRow {
  specialty: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  notContacted: number;
  conversionRate: number | null;
  lostRate: number | null;
  sales: number;
  quantity: number;
  salesOrders: number;
}

interface ContactRow {
  createdAt: string;
  contact: string;
  course: string;
  stage: string;
  salesperson: string;
  callingReply: string;
  lastStageUpdate: string;
  waitingSince: string;
  daysWaiting: number;
}

interface SalesOrderRow {
  orderRef: string;
  saleDate: string;
  customer: string;
  courses: string;
  salesperson: string;
  currency: string;
  localTotal: number;
  usdSales: number;
  source: string;
  externalPrice: number;
  externalCurrency: string;
  externalSalesSource: string;
  externalPhone: string;
  reconciliationStatus: string;
  priceDifference: number | null;
}

interface WebsiteCampaignRow {
  key: string;
  campaign: string;
  objective: CampaignObjective;
  platforms: Platform[];
  spend: number;
  spendDays: number;
  averageDailySpend: number | null;
  conversions: number | null;
  costPerConversion: number | null;
  websiteOrders: number;
  websiteUnits: number;
  websiteRevenue: number;
  websiteRoas: number | null;
  odooCampaign: string;
  salesLinked: boolean;
  spendFrom: string;
  spendTo: string;
}

interface Resp {
  totals: {
    leads: number;
    won: number;
    lost: number;
    open: number;
    notContacted: number;
    sales: number;
    salesOrders: number;
    soldCourses: number;
    unsoldCourses: number;
    averageOrder: number | null;
    websiteCampaignSpend: number;
    websiteCampaignConversions: number;
  };
  websiteCampaigns: WebsiteCampaignRow[];
  websiteCampaignAttribution: {
    websiteOrders?: number;
    attributedOrders?: number;
    unattributedOrders?: number;
    websiteRevenue?: number;
    attributedRevenue?: number;
    unattributedRevenue?: number;
    sourceAvailable: boolean;
    error: string;
  };
  specialties: SpecialtyRow[];
  waitingBuckets: { label: string; count: number }[];
  soldCourses: { label: string; value: number; orders: number; quantity: number }[];
  unsoldCourses: {
    label: string;
    leads: number;
    open: number;
    lost: number;
    notContacted: number;
  }[];
  insights: {
    bestSellingCourse: { label: string; value: number; orders: number } | null;
    highestDemandUnsoldCourse: { label: string; leads: number; open: number } | null;
    conversionRate: number | null;
    averageOrder: number | null;
  };
  reconciliation: {
    totalOrders: number;
    odooOnlyOrders: number;
    matchedOrders: number;
    externalOnlyOrders: number;
    discrepancyOrders: number;
    odooOnlySales: number;
    matchedSales: number;
    externalOnlySales: number;
  };
  sheetSalesAnalysis: {
    totalOrders: number;
    totalRevenue: number;
    averageOrder: number | null;
    channels: {
      channel: "direct" | "sales" | "other";
      orders: number;
      revenue: number;
      orderShare: number;
    }[];
    owners: {
      owner: string;
      channel: "direct" | "sales" | "other";
      orders: number;
      revenue: number;
      orderShare: number;
    }[];
    courses: {
      label: string;
      orders: number;
      directOrders: number;
      salesOrders: number;
      attributedRevenue: number;
    }[];
  };
  leadSources: {
    activeCrm: number;
    activeWon: number;
    activeOpen: number;
    archivedLost: number;
    notContactedOpen: number;
  };
  salesDetail: { rows: SalesOrderRow[]; total: number; truncated: boolean };
  detail: { rows: ContactRow[]; total: number; truncated: boolean };
  asOf: string;
}

const fmtAmount = (value: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function Website() {
  const { t, lang } = useI18n();
  const [websiteTab, setWebsiteTab] = useState<"owner" | "campaigns" | "operations">("owner");
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/website");
  const copy =
    lang === "ar"
      ? {
          subtitle: "تحليل ليدز الموقع ومبيعاته الموحّدة من Odoo وشيت المبيعات الإضافي",
          sourceNote:
            "المصدر: ليدز ومبيعات الموقع من Odoo، ومعاهم أي حملة اسمها فيه web أو con من منصات الإعلانات. البيع يُنسب للحملة فقط لما حقل Campaign في Odoo يطابق اسم الحملة؛ من غير تطابق هنظهره كربط ناقص مش كصفر مبيعات.",
          websiteCampaigns: "حملات الموقع (web / con)",
          websiteCampaignsHint:
            "جمعنا هنا أي حملة اسمها فيه web أو con. حملة con تُعامل كتحويل موقع؛ أما web فقط فتحتفظ بهدفها الأصلي عشان ما نخلطش الليد بالشراء.",
          campaignSpend: "صرف حملات الموقع",
          campaignConversions: "نتائج المنصة",
          campaignFieldCoverage: "أوردرات عليها Campaign",
          campaignDateBasis:
            "صرف وتحويلات الحملة حسب الفترة المختارة، والأوردرات المربوطة حسب تاريخ تأكيد أمر البيع في Odoo.",
          averageDailySpend: "متوسط الصرف / يوم",
          costPerConversion: "تكلفة النتيجة",
          linkedOrders: "أوردرات مربوطة",
          linkedRevenue: "إيراد مربوط",
          exactCampaignMatch: "اسم Campaign متطابق في Odoo",
          missingCampaignMatch:
            "في تحويلات على المنصة، لكن مفيش أوردر موقع بنفس اسم Campaign في Odoo؛ راجع تعبئة الحقل قبل الحكم على البيع.",
          orders: "أوامر بيع",
          quickAnalysis: "ملخص تنفيذي",
          bestSelling: "الأكثر مبيعًا",
          unsoldDemand: "أعلى طلب بدون بيع",
          averageOrder: "متوسط أمر البيع",
          noData: "لا توجد بيانات كافية في الفترة المحددة",
          soldCourses: "الكورسات المباعة من الموقع",
          soldHint: "حسب تاريخ الدفع عند توفره، وإلا تاريخ المصدر/الأوردر، بعد منع تكرار Order ID",
          unsoldCourses: "كورسات عليها طلب ولم تُبع",
          unsoldHint: "وصلت لها Website Leads في الفترة، لكن لا يوجد لها Sales Order مؤكد",
          leads: "ليد",
          open: "مفتوح",
          lost: "مفقود",
          specialtyNote: "يجمع ليدز CRM ومبيعات الموقع الموحّدة حسب الكورس",
          reconciliation: "مطابقة مصادر المبيعات",
          reconciliationHint: "Odoo + شيت Website Sales الخارجي حسب Order ID",
          odooOnlyOrders: "من Odoo فقط",
          matchedOrders: "متطابق بين المصدرين",
          externalOnlyOrders: "من الشيت فقط",
          discrepancyOrders: "يحتاج مراجعة",
          sheetSalesTitle: "مبيعات شيت الموقع",
          sheetSalesHint:
            "أوردرات الشيت بعد منع تكرار Order ID ومطابقتها مع Odoo. الأرقام تتغير مع الفترة والفلاتر المختارة.",
          sheetOrders: "أوردر من الشيت",
          reconciledSheetRevenue: "إيراد الأوردرات بعد المطابقة",
          directSales: "شراء مباشر",
          salesTeamSales: "عن طريق فريق المبيعات",
          otherSales: "مصدر غير محدد",
          salesOwners: "مين قفل البيع؟",
          sourceShare: "من أوردرات الشيت",
          sheetCourses: "الدورات المباعة من الشيت",
          sheetCoursesHint:
            "عدد الأوردرات التي ظهر فيها كل كورس. لو الأوردر فيه أكثر من كورس بيتحسب مرة لكل كورس.",
          directShort: "مباشر",
          salesShort: "سيلز",
          averageSheetOrder: "متوسط الأوردر",
          activeCrm: "ليد نشط من Odoo CRM",
          archivedLost: "Lost مؤكد من الأرشيف",
          wonDefinition: "من Odoo CRM وحالته Won",
          lostDefinition: "من Lost Analysis المؤرشف فقط",
          openDefinition: "نشط في CRM وغير Won",
          notContactedDefinition: "جزء من المفتوح: لا يوجد رد ناجح",
          dataThrough: "البيانات المعروضة حتى",
          salesDetails: "تفاصيل أوردرات مبيعات الموقع",
          salesDetailsHint: "صف واحد لكل أوردر بعد الدمج ومنع التكرار",
          source: "مصدر السجل",
          externalReference: "مرجع الشيت الخارجي",
          reconciliationStatus: "حالة المطابقة",
          localAmount: "المبلغ بالعملة",
          orderId: "رقم الأوردر",
          ownerTab: "ملخص المالك",
          ownerTabHint: "الأرقام والقرار في نظرة واحدة",
          campaignsTab: "حملات الموقع",
          campaignsTabHint: "صرف ونتائج وربط البيع",
          operationsTab: "الليدز والمبيعات",
          operationsTabHint: "التفاصيل والمتابعة اليومية",
          conversionObjective: "تحويل موقع",
          leadObjective: "ويب / ليدز",
        }
      : {
          subtitle:
            "Engosoft website leads and reconciled sales from Odoo and the external sales sheet",
          sourceNote:
            "Source: Odoo website leads and sales, plus every ad campaign tagged web or con. Sales are assigned only when Odoo Campaign exactly matches the ad campaign; an unmatched name is shown as an attribution gap, not zero sales.",
          websiteCampaigns: "Website campaigns (web / con)",
          websiteCampaignsHint:
            "Every campaign tagged web or con appears here. con is treated as website conversion; web-only keeps its original objective so leads are not relabelled as purchases.",
          campaignSpend: "Website campaign spend",
          campaignConversions: "Platform results",
          campaignFieldCoverage: "Orders with Campaign",
          campaignDateBasis:
            "Campaign spend and conversions use the selected period; linked orders use the Odoo sales-order confirmation date.",
          averageDailySpend: "Average spend / day",
          costPerConversion: "Cost / result",
          linkedOrders: "Linked orders",
          linkedRevenue: "Linked revenue",
          exactCampaignMatch: "Exact Odoo Campaign match",
          missingCampaignMatch:
            "The platform has conversions, but no website order carries the same Odoo Campaign name. Fix attribution before judging sales.",
          orders: "sales orders",
          quickAnalysis: "Executive summary",
          bestSelling: "Best-selling course",
          unsoldDemand: "Highest demand without a sale",
          averageOrder: "Average sales order",
          noData: "Not enough data in the selected period",
          soldCourses: "Courses sold on the website",
          soldHint:
            "Payment date when available, otherwise source/order date, after Order-ID deduplication",
          unsoldCourses: "Courses with demand but no sale",
          unsoldHint: "Website leads exist in the period, but no confirmed sales order exists",
          leads: "leads",
          open: "open",
          lost: "lost",
          specialtyNote: "Combines Odoo CRM website leads and reconciled website sales by course",
          reconciliation: "Sales-source reconciliation",
          reconciliationHint: "Odoo + external Website Sales sheet matched by Order ID",
          odooOnlyOrders: "Odoo only",
          matchedOrders: "Matched across both sources",
          externalOnlyOrders: "External sheet only",
          discrepancyOrders: "Needs review",
          sheetSalesTitle: "Website-sheet sales",
          sheetSalesHint:
            "Sheet orders after Order-ID deduplication and Odoo reconciliation. Selected dates and filters apply.",
          sheetOrders: "sheet orders",
          reconciledSheetRevenue: "Reconciled order revenue",
          directSales: "Direct purchase",
          salesTeamSales: "Closed by sales",
          otherSales: "Unspecified source",
          salesOwners: "Who closed the sale?",
          sourceShare: "of sheet orders",
          sheetCourses: "Courses sold from the sheet",
          sheetCoursesHint:
            "Orders containing each course. A multi-course order appears once under every included course.",
          directShort: "Direct",
          salesShort: "Sales",
          averageSheetOrder: "Average order",
          activeCrm: "active leads from Odoo CRM",
          archivedLost: "confirmed archived lost",
          wonDefinition: "Odoo CRM leads whose status is Won",
          lostDefinition: "Archived Lost Analysis only",
          openDefinition: "Active CRM leads excluding Won",
          notContactedDefinition: "Subset of open leads with no successful reply",
          dataThrough: "Data shown through",
          salesDetails: "Website sales-order details",
          salesDetailsHint: "One row per order after source reconciliation and deduplication",
          source: "Record source",
          externalReference: "External-sheet reference",
          reconciliationStatus: "Reconciliation status",
          localAmount: "Amount in currency",
          orderId: "Order ID",
          ownerTab: "Owner summary",
          ownerTabHint: "Numbers and decisions at a glance",
          campaignsTab: "Website campaigns",
          campaignsTabHint: "Spend, results, and sales attribution",
          operationsTab: "Leads and sales",
          operationsTabHint: "Details for daily follow-up",
          conversionObjective: "Website conversion",
          leadObjective: "Web / leads",
        };

  const displayCourseLabel = (value?: string) => {
    const normalized = (value || "").trim().toLowerCase();
    if (
      !normalized ||
      ["other", "others", "unknown", "unspecified", "not specified", "-", "—"].includes(normalized)
    ) {
      return lang === "ar"
        ? "غير محدد في أودو (حقل الكورس فارغ)"
        : "Unspecified in Odoo (course field is blank)";
    }
    return value as string;
  };

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const specialtyCols: Col<SpecialtyRow>[] = [
    {
      key: "specialty",
      header: t("course"),
      sticky: true,
      sortValue: (r) => r.specialty,
      render: (r) => displayCourseLabel(r.specialty),
    },
    {
      key: "total",
      header: t("leads_count"),
      align: "right",
      sortValue: (r) => r.total,
      render: (r) => fmtNum(r.total),
    },
    {
      key: "won",
      header: t("won"),
      align: "right",
      sortValue: (r) => r.won,
      render: (r) => fmtNum(r.won),
    },
    {
      key: "lost",
      header: t("lost_count"),
      align: "right",
      sortValue: (r) => r.lost,
      render: (r) => fmtNum(r.lost),
    },
    {
      key: "open",
      header: t("open_leads"),
      align: "right",
      sortValue: (r) => r.open,
      render: (r) => fmtNum(r.open),
    },
    {
      key: "notContacted",
      header: t("not_contacted"),
      align: "right",
      sortValue: (r) => r.notContacted,
      render: (r) => fmtNum(r.notContacted),
    },
    {
      key: "conversionRate",
      header: t("conversion_rate"),
      align: "right",
      sortValue: (r) => r.conversionRate ?? -1,
      render: (r) => fmtPct(r.conversionRate, 1),
    },
    {
      key: "sales",
      header: t("website_sales"),
      align: "right",
      sortValue: (r) => r.sales,
      render: (r) => fmtUSD(r.sales),
    },
  ];

  const contactCols: Col<ContactRow>[] = [
    {
      key: "waitingSince",
      header: t("waiting_since"),
      sticky: true,
      width: "120px",
      sortValue: (r) => r.waitingSince,
      render: (r) => fmtDate(r.waitingSince, lang),
    },
    {
      key: "daysWaiting",
      header: t("waiting_days"),
      align: "right",
      sortValue: (r) => r.daysWaiting,
      render: (r) => `${fmtNum(r.daysWaiting)} ${t("days")}`,
    },
    {
      key: "contact",
      header: t("contact"),
      sortValue: (r) => r.contact,
      render: (r) => r.contact || "—",
    },
    {
      key: "course",
      header: t("course"),
      sortValue: (r) => r.course,
      render: (r) => displayCourseLabel(r.course),
    },
    {
      key: "stage",
      header: t("stage"),
      sortValue: (r) => r.stage,
      render: (r) => <Pill tone="warning">{r.stage || "—"}</Pill>,
    },
    {
      key: "salesperson",
      header: t("salesperson"),
      sortValue: (r) => r.salesperson,
      render: (r) => r.salesperson || "—",
    },
    {
      key: "callingReply",
      header: t("calling_reply"),
      sortValue: (r) => r.callingReply,
      render: (r) => r.callingReply || "—",
    },
  ];

  const salesCols: Col<SalesOrderRow>[] = [
    {
      key: "saleDate",
      header: t("date"),
      width: "120px",
      sortValue: (r) => r.saleDate,
      render: (r) => fmtDate(r.saleDate, lang),
    },
    {
      key: "orderRef",
      header: copy.orderId,
      sticky: true,
      sortValue: (r) => r.orderRef,
      render: (r) => r.orderRef || "—",
    },
    {
      key: "customer",
      header: t("partner"),
      sortValue: (r) => r.customer,
      render: (r) => r.customer || "—",
    },
    {
      key: "courses",
      header: t("course"),
      sortValue: (r) => r.courses,
      render: (r) => displayCourseLabel(r.courses),
    },
    {
      key: "salesperson",
      header: t("salesperson"),
      sortValue: (r) => r.salesperson,
      render: (r) => r.salesperson || "—",
    },
    {
      key: "localTotal",
      header: copy.localAmount,
      align: "right",
      sortValue: (r) => r.localTotal,
      render: (r) => `${fmtAmount(r.localTotal)} ${r.currency}`,
    },
    {
      key: "usdSales",
      header: t("website_sales"),
      align: "right",
      sortValue: (r) => r.usdSales,
      render: (r) => fmtUSD(r.usdSales),
    },
    {
      key: "source",
      header: copy.source,
      sortValue: (r) => r.source,
      render: (r) => (
        <Pill
          tone={
            r.source === "External Google Sheet"
              ? "brand"
              : r.source === "Odoo + External Google Sheet"
                ? "success"
                : "neutral"
          }
        >
          {r.source || "Odoo"}
        </Pill>
      ),
    },
    {
      key: "externalPrice",
      header: copy.externalReference,
      align: "right",
      sortValue: (r) => r.externalPrice,
      render: (r) =>
        r.externalPrice ? `${fmtAmount(r.externalPrice)} ${r.externalCurrency}` : "—",
    },
    {
      key: "reconciliationStatus",
      header: copy.reconciliationStatus,
      sortValue: (r) => r.reconciliationStatus,
      render: (r) => (
        <Pill tone={/mismatch/i.test(r.reconciliationStatus) ? "danger" : "neutral"}>
          {r.reconciliationStatus || "—"}
        </Pill>
      ),
    },
  ];

  const websiteTabs = [
    {
      value: "owner" as const,
      label: copy.ownerTab,
      hint: copy.ownerTabHint,
      icon: <LayoutDashboard size={17} />,
    },
    {
      value: "campaigns" as const,
      label: copy.campaignsTab,
      hint: copy.campaignsTabHint,
      icon: <Target size={17} />,
    },
    {
      value: "operations" as const,
      label: copy.operationsTab,
      hint: copy.operationsTabHint,
      icon: <ListChecks size={17} />,
    },
  ];
  const sheetChannelLabels = {
    direct: copy.directSales,
    sales: copy.salesTeamSales,
    other: copy.otherSales,
  } as const;

  return (
    <div className="space-y-5">
      <PageHeader title={t("website")} subtitle={copy.subtitle} />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-80" />
        </>
      ) : (
        <>
          <div className="rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-xs text-text-muted leading-relaxed">
            <div>{copy.sourceNote}</div>
            <div className="mt-1 font-semibold text-brand">
              {copy.dataThrough} {fmtDate(data.asOf, lang)}
            </div>
          </div>

          <div
            role="tablist"
            aria-label={lang === "ar" ? "أقسام الموقع" : "Website sections"}
            /* Three Arabic labels cannot share 375px without each being cut to
               an ellipsis, so on a phone the row scrolls with every label
               intact and only becomes an equal 3-up grid once it fits. */
            className="hscroll flex gap-1 rounded-2xl border border-border bg-surface-2/70 p-1.5 sm:grid sm:grid-cols-3"
          >
            {websiteTabs.map((tab) => {
              const active = websiteTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setWebsiteTab(tab.value)}
                  className={`shrink-0 rounded-xl px-3 py-2.5 text-start transition-all sm:min-w-0 sm:shrink sm:px-4 ${
                    active
                      ? "bg-surface text-brand shadow-sm ring-1 ring-brand/15"
                      : "text-text-muted hover:bg-surface/70 hover:text-text"
                  }`}
                >
                  <span className="flex items-center justify-center gap-2 text-xs font-semibold sm:justify-start sm:text-sm">
                    {tab.icon}
                    <span className="whitespace-nowrap sm:truncate">{tab.label}</span>
                  </span>
                  <span className="mt-1 hidden truncate text-[10.5px] text-text-muted sm:block">
                    {tab.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <div className={websiteTab === "campaigns" ? "block" : "hidden"}>
            <Card className="overflow-hidden border-brand/15">
              <SectionTitle
                hint={copy.websiteCampaignsHint}
                action={
                  <Pill tone="brand">
                    {fmtNum(data.websiteCampaigns.length)} {t("campaigns")}
                  </Pill>
                }
              >
                <span className="inline-flex items-center gap-2">
                  <Target size={17} className="text-brand" />
                  {copy.websiteCampaigns}
                </span>
              </SectionTitle>

              <div className="mb-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-border bg-surface-2/50 p-3">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <Gauge size={14} className="text-brand" />
                    {copy.campaignSpend}
                  </div>
                  <div className="num mt-1 text-lg font-semibold text-text">
                    {fmtUSDFull(data.totals.websiteCampaignSpend)}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-surface-2/50 p-3">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <MousePointerClick size={14} className="text-brand" />
                    {copy.campaignConversions}
                  </div>
                  <div className="num mt-1 text-lg font-semibold text-text">
                    {fmtNum(data.totals.websiteCampaignConversions)}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-surface-2/50 p-3">
                  <div className="flex items-center gap-2 text-[11px] text-text-muted">
                    <ShoppingCart size={14} className="text-brand" />
                    {copy.campaignFieldCoverage}
                  </div>
                  <div className="num mt-1 text-lg font-semibold text-text">
                    {data.websiteCampaignAttribution.sourceAvailable
                      ? `${fmtNum(data.websiteCampaignAttribution.attributedOrders ?? 0)} / ${fmtNum(data.websiteCampaignAttribution.websiteOrders ?? 0)}`
                      : "—"}
                  </div>
                </div>
              </div>
              <p className="mb-4 rounded-lg bg-surface-2/60 px-3 py-2 text-[10.5px] leading-5 text-text-muted">
                {copy.campaignDateBasis}
              </p>

              {data.websiteCampaigns.length ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {data.websiteCampaigns.map((campaign) => (
                    <article
                      key={campaign.key}
                      className="rounded-2xl border border-border bg-surface p-3.5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3
                            className="truncate text-[13px] font-semibold text-text"
                            dir="auto"
                            title={campaign.campaign}
                          >
                            {campaign.campaign}
                          </h3>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {campaign.platforms.map((platform) => (
                              <span
                                key={platform}
                                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{
                                  background: `color-mix(in oklab, ${PLATFORM_COLOR[platform]} 14%, transparent)`,
                                  color: PLATFORM_COLOR[platform],
                                }}
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ background: PLATFORM_COLOR[platform] }}
                                />
                                {PLATFORM_LABEL[platform][lang]}
                              </span>
                            ))}
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                campaign.objective === "website_conversion"
                                  ? "bg-success-soft text-success"
                                  : "bg-brand-soft text-brand"
                              }`}
                            >
                              {campaign.objective === "website_conversion"
                                ? copy.conversionObjective
                                : copy.leadObjective}
                            </span>
                          </div>
                        </div>
                        <Pill tone={campaign.salesLinked ? "success" : "warning"}>
                          {campaign.salesLinked
                            ? copy.exactCampaignMatch
                            : lang === "ar"
                              ? "البيع مش مربوط"
                              : "Sales not linked"}
                        </Pill>
                      </div>

                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border/70 pt-3">
                        <WebsiteCampaignFact label={t("spend")} value={fmtUSD(campaign.spend)} />
                        <WebsiteCampaignFact
                          label={copy.campaignConversions}
                          value={campaign.conversions === null ? "—" : fmtNum(campaign.conversions)}
                        />
                        <WebsiteCampaignFact
                          label={copy.averageDailySpend}
                          value={fmtUSDFull(campaign.averageDailySpend)}
                        />
                        <WebsiteCampaignFact
                          label={copy.costPerConversion}
                          value={fmtUSDFull(campaign.costPerConversion)}
                        />
                        <WebsiteCampaignFact
                          label={copy.linkedOrders}
                          value={campaign.salesLinked ? fmtNum(campaign.websiteOrders) : "—"}
                        />
                        <WebsiteCampaignFact
                          label={copy.linkedRevenue}
                          value={campaign.salesLinked ? fmtUSD(campaign.websiteRevenue) : "—"}
                        />
                      </dl>

                      <p
                        className={`mt-3 text-[10.5px] leading-5 ${campaign.salesLinked ? "text-success" : "text-warning"}`}
                      >
                        {campaign.salesLinked
                          ? `${copy.exactCampaignMatch} · ROAS ${campaign.websiteRoas === null ? "—" : `${campaign.websiteRoas.toFixed(2)}×`}`
                          : copy.missingCampaignMatch}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">
                  {copy.noData}
                </p>
              )}
            </Card>
          </div>

          <div className={websiteTab === "owner" ? "space-y-5" : "hidden"}>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <KpiCard
                index={0}
                label={t("website_leads")}
                value={fmtNum(data.totals.leads)}
                sub={`${fmtNum(data.leadSources.activeCrm)} ${copy.activeCrm} + ${fmtNum(data.leadSources.archivedLost)} ${copy.archivedLost}`}
                subWrap
                icon={<Globe2 size={18} />}
              />
              <KpiCard
                index={1}
                label={t("won")}
                value={fmtNum(data.totals.won)}
                sub={`${fmtPct(data.totals.leads ? (data.totals.won / data.totals.leads) * 100 : null, 1)} · ${copy.wonDefinition}`}
                subWrap
                icon={<CircleCheckBig size={18} />}
              />
              <KpiCard
                index={2}
                label={t("lost_count")}
                value={fmtNum(data.totals.lost)}
                sub={`${fmtPct(data.totals.leads ? (data.totals.lost / data.totals.leads) * 100 : null, 1)} · ${copy.lostDefinition}`}
                subWrap
                icon={<CircleX size={18} />}
              />
              <KpiCard
                index={3}
                label={t("open_leads")}
                value={fmtNum(data.totals.open)}
                sub={copy.openDefinition}
                subWrap
                icon={<CircleDot size={18} />}
              />
              <KpiCard
                index={4}
                label={t("not_contacted")}
                value={fmtNum(data.totals.notContacted)}
                sub={copy.notContactedDefinition}
                subWrap
                icon={<Clock3 size={18} />}
              />
              <KpiCard
                index={5}
                hero
                label={t("website_sales")}
                value={fmtUSDFull(data.totals.sales)}
                sub={`${fmtNum(data.totals.salesOrders)} ${copy.orders} · ${fmtNum(data.reconciliation.odooOnlyOrders)} ${copy.odooOnlyOrders} · ${fmtNum(data.reconciliation.matchedOrders)} ${copy.matchedOrders} · ${fmtNum(data.reconciliation.externalOnlyOrders)} ${copy.externalOnlyOrders}`}
                subWrap
                icon={<Banknote size={18} />}
              />
            </div>

            <Card className="overflow-hidden border-brand/15">
              <SectionTitle
                hint={copy.sheetSalesHint}
                action={
                  <Pill tone="brand">
                    {fmtNum(data.sheetSalesAnalysis.totalOrders)} {copy.sheetOrders}
                  </Pill>
                }
              >
                <span className="inline-flex items-center gap-2">
                  <ShoppingCart size={17} className="text-brand" />
                  {copy.sheetSalesTitle}
                </span>
              </SectionTitle>

              <div className="mb-4 grid gap-2 sm:grid-cols-3">
                {data.sheetSalesAnalysis.channels.map((channel) => (
                  <div
                    key={channel.channel}
                    className={`rounded-xl border p-3 ${
                      channel.channel === "direct"
                        ? "border-brand/20 bg-brand-soft/45"
                        : channel.channel === "sales"
                          ? "border-success/20 bg-success-soft/45"
                          : "border-warning/20 bg-warning-soft/45"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-text-muted">
                      <span className="truncate">{sheetChannelLabels[channel.channel]}</span>
                      <span className="num shrink-0">{fmtPct(channel.orderShare, 0)}</span>
                    </div>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <div className="num text-2xl font-bold text-text">
                        {fmtNum(channel.orders)}
                      </div>
                      <div className="num text-xs font-semibold text-text-muted">
                        {fmtUSDFull(channel.revenue)}
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-text-subtle">{copy.sourceShare}</div>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <section className="rounded-2xl border border-border bg-surface-2/35 p-3.5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-text">
                        <UsersRound size={16} className="text-brand" />
                        {copy.salesOwners}
                      </div>
                      <div className="mt-1 text-[10.5px] text-text-muted">
                        {copy.reconciledSheetRevenue}:{" "}
                        {fmtUSDFull(data.sheetSalesAnalysis.totalRevenue)}
                      </div>
                    </div>
                    <div className="rounded-lg bg-surface px-2.5 py-1.5 text-end shadow-sm ring-1 ring-border">
                      <div className="text-[9.5px] text-text-muted">{copy.averageSheetOrder}</div>
                      <div className="num text-xs font-semibold text-text">
                        {fmtUSDFull(data.sheetSalesAnalysis.averageOrder)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {data.sheetSalesAnalysis.owners.slice(0, 7).map((owner) => (
                      <div key={`${owner.channel}:${owner.owner}`}>
                        <div className="mb-1 flex items-center justify-between gap-3 text-[11px]">
                          <span className="min-w-0 truncate font-medium text-text" dir="auto">
                            {owner.owner}
                          </span>
                          <span className="num shrink-0 text-text-muted">
                            {fmtNum(owner.orders)} · {fmtUSDFull(owner.revenue)}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                          <div
                            className={`h-full rounded-full ${
                              owner.channel === "direct"
                                ? "bg-brand"
                                : owner.channel === "sales"
                                  ? "bg-success"
                                  : "bg-warning"
                            }`}
                            style={{ width: `${Math.max(owner.orderShare, 1.5)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-surface-2/35 p-3.5">
                  <div className="mb-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text">
                      <BookOpen size={16} className="text-brand" />
                      {copy.sheetCourses}
                    </div>
                    <p className="mt-1 text-[10.5px] leading-5 text-text-muted">
                      {copy.sheetCoursesHint}
                    </p>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {data.sheetSalesAnalysis.courses.slice(0, 8).map((course) => (
                      <div
                        key={course.label}
                        className="min-w-0 rounded-xl border border-border/80 bg-surface px-3 py-2.5"
                      >
                        <div
                          className="truncate text-[11.5px] font-semibold text-text"
                          dir="auto"
                          title={displayCourseLabel(course.label)}
                        >
                          {displayCourseLabel(course.label)}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-text-muted">
                          <span className="num font-semibold text-text">
                            {fmtNum(course.orders)} {copy.orders}
                          </span>
                          <span>
                            {copy.directShort} {fmtNum(course.directOrders)} · {copy.salesShort}{" "}
                            {fmtNum(course.salesOrders)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </Card>

            <Card>
              <SectionTitle>{copy.quickAnalysis}</SectionTitle>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                  <div className="text-xs text-text-muted">{copy.bestSelling}</div>
                  <div className="mt-1 font-semibold text-text">
                    {data.insights.bestSellingCourse
                      ? displayCourseLabel(data.insights.bestSellingCourse.label)
                      : copy.noData}
                  </div>
                  {data.insights.bestSellingCourse && (
                    <div className="mt-1 text-xs text-success">
                      {fmtUSD(data.insights.bestSellingCourse.value)} ·{" "}
                      {fmtNum(data.insights.bestSellingCourse.orders)} {copy.orders}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                  <div className="text-xs text-text-muted">{copy.unsoldDemand}</div>
                  <div className="mt-1 font-semibold text-text">
                    {data.insights.highestDemandUnsoldCourse
                      ? displayCourseLabel(data.insights.highestDemandUnsoldCourse.label)
                      : copy.noData}
                  </div>
                  {data.insights.highestDemandUnsoldCourse && (
                    <div className="mt-1 text-xs text-warning">
                      {fmtNum(data.insights.highestDemandUnsoldCourse.leads)} {copy.leads} ·{" "}
                      {fmtNum(data.insights.highestDemandUnsoldCourse.open)} {copy.open}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-border bg-surface-2/40 p-3">
                  <div className="text-xs text-text-muted">{copy.averageOrder}</div>
                  <div className="mt-1 font-semibold text-text">
                    {data.insights.averageOrder === null
                      ? copy.noData
                      : fmtUSD(data.insights.averageOrder)}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    {fmtNum(data.totals.salesOrders)} {copy.orders}
                  </div>
                </div>
                <div className="rounded-lg border border-brand/20 bg-brand-soft/50 p-3">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <GitMerge size={15} className="text-brand" />
                    {copy.reconciliation}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Pill tone="neutral">
                      {fmtNum(data.reconciliation.odooOnlyOrders)} {copy.odooOnlyOrders}
                    </Pill>
                    <Pill tone="success">
                      {fmtNum(data.reconciliation.matchedOrders)} {copy.matchedOrders}
                    </Pill>
                    <Pill tone="brand">
                      {fmtNum(data.reconciliation.externalOnlyOrders)} {copy.externalOnlyOrders}
                    </Pill>
                    <Pill tone={data.reconciliation.discrepancyOrders ? "danger" : "neutral"}>
                      {fmtNum(data.reconciliation.discrepancyOrders)} {copy.discrepancyOrders}
                    </Pill>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 text-[11px] text-text-muted">
                    <div>
                      <div>{copy.odooOnlyOrders}</div>
                      <div className="num mt-0.5 font-semibold text-text">
                        {fmtUSDFull(data.reconciliation.odooOnlySales)}
                      </div>
                    </div>
                    <div>
                      <div>{copy.matchedOrders}</div>
                      <div className="num mt-0.5 font-semibold text-text">
                        {fmtUSDFull(data.reconciliation.matchedSales)}
                      </div>
                    </div>
                    <div>
                      <div>{copy.externalOnlyOrders}</div>
                      <div className="num mt-0.5 font-semibold text-text">
                        {fmtUSDFull(data.reconciliation.externalOnlySales)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] text-text-subtle">{copy.reconciliationHint}</div>
                </div>
              </div>
            </Card>
          </div>

          <div className={websiteTab === "operations" ? "space-y-5" : "hidden"}>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <SectionTitle>{t("website_pipeline")}</SectionTitle>
                <BarList
                  max={data.totals.leads}
                  items={[
                    { label: t("won"), value: data.totals.won },
                    { label: t("lost_count"), value: data.totals.lost },
                    { label: t("open_leads"), value: data.totals.open },
                    { label: t("not_contacted"), value: data.totals.notContacted },
                  ]}
                  format={fmtNum}
                />
              </Card>
              <Card>
                <SectionTitle hint={`${t("as_of")} ${fmtDate(data.asOf, lang)}`}>
                  {t("waiting_age")}
                </SectionTitle>
                <BarList
                  items={data.waitingBuckets.map((row) => ({
                    label: row.label === "0" ? t("today") : `${row.label} ${t("days")}`,
                    value: row.count,
                  }))}
                  format={fmtNum}
                  color="var(--warning)"
                />
              </Card>
            </div>

            <div>
              <SectionTitle hint={copy.salesDetailsHint}>{copy.salesDetails}</SectionTitle>
              <DataTable
                rows={data.salesDetail.rows}
                cols={salesCols}
                searchable={(r) =>
                  `${r.orderRef} ${r.customer} ${r.courses} ${r.salesperson} ${r.source} ${r.externalSalesSource} ${r.externalPhone} ${r.reconciliationStatus}`
                }
                initialSort={{ key: "saleDate", dir: -1 }}
                csvFilename="engosoft-website-sales-reconciled"
                maxHeight={640}
                truncatedNote={
                  data.salesDetail.truncated
                    ? `${t("showing")} ${fmtNum(data.salesDetail.rows.length)} ${t("of")} ${fmtNum(data.salesDetail.total)}`
                    : undefined
                }
                csvRow={(r) => ({
                  sale_date: r.saleDate,
                  order_id: r.orderRef,
                  customer: r.customer,
                  courses: r.courses,
                  salesperson: r.salesperson,
                  local_total: r.localTotal,
                  currency: r.currency,
                  sales_usd: r.usdSales,
                  record_source: r.source,
                  external_price: r.externalPrice,
                  external_currency: r.externalCurrency,
                  external_sales_source: r.externalSalesSource,
                  external_phone: r.externalPhone,
                  reconciliation_status: r.reconciliationStatus,
                  price_difference: r.priceDifference ?? "",
                })}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <SectionTitle hint={copy.soldHint}>{copy.soldCourses}</SectionTitle>
                {data.soldCourses.length ? (
                  <BarList
                    items={data.soldCourses.slice(0, 12).map((row) => ({
                      label: displayCourseLabel(row.label),
                      value: row.value,
                      meta: (
                        <span>
                          {fmtUSD(row.value)} · {fmtNum(row.orders)} {copy.orders}
                        </span>
                      ),
                    }))}
                    format={fmtUSD}
                    color="var(--success)"
                  />
                ) : (
                  <p className="text-sm text-text-muted">{copy.noData}</p>
                )}
              </Card>
              <Card>
                <SectionTitle hint={copy.unsoldHint}>{copy.unsoldCourses}</SectionTitle>
                {data.unsoldCourses.length ? (
                  <BarList
                    items={data.unsoldCourses.slice(0, 12).map((row) => ({
                      label: displayCourseLabel(row.label),
                      value: row.leads,
                      meta: (
                        <span>
                          {fmtNum(row.open)} {copy.open} · {fmtNum(row.lost)} {copy.lost}
                        </span>
                      ),
                    }))}
                    format={fmtNum}
                    color="var(--warning)"
                  />
                ) : (
                  <p className="text-sm text-text-muted">{copy.noData}</p>
                )}
              </Card>
            </div>

            <div>
              <SectionTitle hint={copy.specialtyNote}>{t("website_by_specialty")}</SectionTitle>
              <DataTable
                rows={data.specialties}
                cols={specialtyCols}
                searchable={(r) => r.specialty}
                initialSort={{ key: "total", dir: -1 }}
                csvFilename="engosoft-website-specialties"
                csvRow={(r) => ({
                  specialty: r.specialty,
                  leads: r.total,
                  won: r.won,
                  lost: r.lost,
                  open: r.open,
                  not_contacted: r.notContacted,
                  conversion_rate: r.conversionRate ?? "",
                  sales_usd: r.sales,
                  sales_orders: r.salesOrders,
                })}
              />
            </div>

            <div>
              <SectionTitle hint={t("contact_age_note")}>{t("not_contacted_detail")}</SectionTitle>
              <DataTable
                rows={data.detail.rows}
                cols={contactCols}
                searchable={(r) =>
                  `${r.contact} ${r.course} ${r.stage} ${r.salesperson} ${r.callingReply}`
                }
                initialSort={{ key: "daysWaiting", dir: -1 }}
                csvFilename="engosoft-website-not-contacted"
                maxHeight={620}
                truncatedNote={
                  data.detail.truncated
                    ? `${t("showing")} ${fmtNum(data.detail.rows.length)} ${t("of")} ${fmtNum(data.detail.total)}`
                    : undefined
                }
                csvRow={(r) => ({
                  created_at: r.createdAt,
                  contact: r.contact,
                  course: r.course,
                  stage: r.stage,
                  salesperson: r.salesperson,
                  calling_reply: r.callingReply,
                  last_stage_update: r.lastStageUpdate,
                  waiting_since: r.waitingSince,
                  waiting_days: r.daysWaiting,
                })}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function WebsiteCampaignFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] text-text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[13px] font-semibold text-text">{value}</dd>
    </div>
  );
}
