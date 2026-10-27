import {
  BarChart3,
  BookMarked,
  CalendarClock,
  CalendarRange,
  ClipboardCheck,
  GraduationCap,
  Globe2,
  Image,
  LayoutDashboard,
  Layers,
  Leaf,
  MapPinned,
  Megaphone,
  MessagesSquare,
  MoreHorizontal,
  Receipt,
  Table2,
  Target,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UserRoundSearch,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { DictKey, Lang } from "@/lib/i18n";

/** The parsed query string of the current location. */
export type LocationSearch = Record<string, unknown>;

export interface NavigationItem {
  to: string;
  key: DictKey;
  icon: LucideIcon;
  /**
   * What this report is called in navigation, when the dictionary entry — which
   * names the PAGE and is also its heading — is not what a reader needs beside
   * its siblings.
   */
  tabLabel?: Record<Lang, string>;
  /** Query parameters the link carries, for a view that shares a route. */
  search?: Record<string, string>;
  /**
   * Whether the current location is this item, beyond sharing its pathname.
   * Omitted: any location on the route matches.
   */
  matches?: (search: LocationSearch) => boolean;
  /** One line under the name in the More menu. */
  description?: Record<Lang, string>;
}

export interface NavigationSection {
  id: "overview" | "marketing" | "leads" | "crm" | "revenue" | "more";
  label: Record<Lang, string>;
  shortLabel: Record<Lang, string>;
  icon: LucideIcon;
  defaultTo: string;
  defaultSearch?: Record<string, string>;
  items: NavigationItem[];
  aliases?: string[];
  /**
   * How the section's reports are offered once a reader is inside it: a short
   * strip of tabs for a management workspace (four at most), or a single
   * switcher for the long tail of specialist reports under More.
   */
  contextual: "none" | "tabs" | "menu";
}

const acquisitionSection = (search: LocationSearch) =>
  typeof search.section === "string" ? search.section : undefined;
const accountingView = (search: LocationSearch) =>
  typeof search.view === "string" ? search.view : undefined;
const courseView = (search: LocationSearch) =>
  typeof search.view === "string" ? search.view : undefined;
const leadsView = (search: LocationSearch) =>
  typeof search.view === "string" ? search.view : undefined;

/**
 * Six primary destinations, each answering one management question. Every
 * existing URL still renders exactly the page it always did — the structure
 * only decides where a report is listed, so bookmarks and shared links keep
 * working. Specialist and technical reports live under More.
 */
export const NAVIGATION_SECTIONS: NavigationSection[] = [
  /**
   * Management: the owners' view. The headline page, the monthly review
   * against plan, and the year-on-year comparison — results, not mechanics.
   */
  {
    id: "overview",
    label: { ar: "الإدارة", en: "Management" },
    shortLabel: { ar: "الإدارة", en: "Management" },
    icon: LayoutDashboard,
    defaultTo: "/",
    contextual: "tabs",
    items: [
      {
        to: "/",
        key: "business_analytics",
        icon: LayoutDashboard,
        tabLabel: { ar: "نظرة عامة", en: "Overview" },
      },
      {
        to: "/management-review",
        key: "business_analytics",
        icon: ClipboardCheck,
        tabLabel: { ar: "مراجعة الأداء والخطة", en: "Performance and plan review" },
      },
      {
        to: "/yoy",
        key: "yoy",
        icon: CalendarRange,
        tabLabel: { ar: "سنة بسنة", en: "Year on year" },
      },
    ],
  },
  /**
   * Marketing: the marketing manager and the media buyers. Where the money
   * went, what it bought, against the plan and per owner.
   */
  {
    id: "marketing",
    label: { ar: "التسويق", en: "Marketing" },
    shortLabel: { ar: "التسويق", en: "Marketing" },
    icon: Megaphone,
    defaultTo: "/acquisition",
    contextual: "tabs",
    items: [
      {
        to: "/acquisition",
        key: "acquisition_performance",
        icon: TrendingUp,
        tabLabel: { ar: "نظرة عامة", en: "Overview" },
        matches: (search) => acquisitionSection(search) === undefined,
      },
      {
        to: "/campaigns",
        key: "campaigns",
        icon: Megaphone,
        tabLabel: { ar: "الحملات", en: "Campaigns" },
      },
      {
        to: "/acquisition",
        key: "acquisition_performance",
        icon: Image,
        tabLabel: { ar: "المواد الإعلانية", en: "Creatives" },
        search: { section: "ads", view: "creatives" },
        matches: (search) =>
          acquisitionSection(search) === "ads" && search.view !== "adset-compare",
      },
      {
        to: "/media-plan",
        key: "media_plan",
        icon: CalendarRange,
        tabLabel: { ar: "خطة الميديا", en: "Media plan" },
      },
      {
        to: "/media-buyers",
        key: "media_buyers",
        icon: UserRoundSearch,
        tabLabel: { ar: "الميديا بايرز", en: "Media buyers" },
      },
      {
        to: "/website",
        key: "website",
        icon: Globe2,
        tabLabel: { ar: "الموقع الإلكتروني", en: "Website" },
      },
    ],
    aliases: ["/creatives"],
  },
  /**
   * Leads: whoever receives and distributes leads. How many came, from
   * where, for which course and specialty, and who is still waiting.
   */
  {
    id: "leads",
    label: { ar: "العملاء المحتملون", en: "Leads" },
    shortLabel: { ar: "العملاء المحتملون", en: "Leads" },
    icon: Users,
    defaultTo: "/acquisition",
    defaultSearch: { section: "leads" },
    contextual: "tabs",
    items: [
      {
        to: "/acquisition",
        key: "acquisition_performance",
        icon: Users,
        tabLabel: { ar: "مصادر العملاء", en: "Lead sources" },
        search: { section: "leads" },
        matches: (search) => acquisitionSection(search) === "leads",
      },
      {
        to: "/lead-sources",
        key: "lead_source_matrix",
        icon: Table2,
        tabLabel: { ar: "المصادر حسب الدورة", en: "Sources by course" },
      },
      {
        to: "/lead-distribution",
        key: "crm_leads",
        icon: Layers,
        tabLabel: { ar: "حسب التخصص والدورة", en: "Specialty and course" },
      },
      {
        to: "/leads",
        key: "leads",
        icon: CalendarClock,
        tabLabel: { ar: "متابعة ليدز الأسبوع", en: "Weekly lead follow-up" },
        search: { view: "weekly" },
        matches: (search) => leadsView(search) === "weekly",
      },
      {
        to: "/leads",
        key: "leads",
        icon: GraduationCap,
        tabLabel: { ar: "تحليل الليدز حسب الكورس", en: "Course lead intelligence" },
        search: { view: "intelligence" },
        matches: (search) => leadsView(search) === "intelligence",
      },
    ],
  },
  /**
   * CRM and sales: the sales managers. The pipeline record by record, lead to
   * paid, how deals close, the team against target, and what was lost.
   */
  {
    id: "crm",
    label: { ar: "CRM والمبيعات", en: "CRM and sales" },
    shortLabel: { ar: "CRM", en: "CRM" },
    icon: Target,
    defaultTo: "/leads",
    contextual: "tabs",
    items: [
      {
        to: "/leads",
        key: "leads",
        icon: Users,
        tabLabel: { ar: "سجلات CRM", en: "CRM records" },
        matches: (search) => leadsView(search) === undefined,
      },
      {
        to: "/leads",
        key: "leads",
        icon: Target,
        tabLabel: { ar: "من الليد للدفع · ٦ شهور", en: "Lead to paid · 6 months" },
        search: { view: "performance" },
        matches: (search) => leadsView(search) === "performance",
      },
      {
        to: "/leads",
        key: "leads",
        icon: Receipt,
        tabLabel: { ar: "قنوات إغلاق البيع", en: "Sales closing channels" },
        search: { view: "channels" },
        matches: (search) => leadsView(search) === "channels",
      },
      {
        to: "/teams",
        key: "teams",
        icon: UsersRound,
        tabLabel: { ar: "فريق المبيعات", en: "Sales team" },
      },
      { to: "/lost", key: "lost", icon: TrendingDown, tabLabel: { ar: "المفقودة", en: "Lost" } },
      {
        to: "/leads",
        key: "leads",
        icon: CalendarRange,
        tabLabel: { ar: "اللوست حسب الشهر", en: "Lost by month" },
        search: { view: "lost" },
        matches: (search) => leadsView(search) === "lost",
      },
      {
        to: "/leads",
        key: "leads",
        icon: ShieldCheck,
        tabLabel: { ar: "جودة مراجعة اللوست", en: "Lost review quality" },
        search: { view: "quality" },
        matches: (search) => leadsView(search) === "quality",
      },
    ],
  },
  /**
   * Revenue: finance and management. What was collected, what marketing
   * brought in, what each course sold, and whether prices were respected.
   */
  {
    id: "revenue",
    label: { ar: "الإيرادات", en: "Revenue" },
    shortLabel: { ar: "الإيرادات", en: "Revenue" },
    icon: Wallet,
    defaultTo: "/accounting",
    contextual: "tabs",
    aliases: ["/full-invoiced", "/sales", "/products"],
    items: [
      {
        to: "/accounting",
        key: "accounting",
        icon: Receipt,
        tabLabel: { ar: "التحصيل", en: "Collection" },
        matches: (search) => accountingView(search) !== "marketing",
      },
      {
        to: "/accounting",
        key: "accounting",
        icon: TrendingUp,
        tabLabel: { ar: "من التسويق للإيراد", en: "Marketing → revenue" },
        search: { view: "marketing" },
        matches: (search) => accountingView(search) === "marketing",
      },
      {
        to: "/courses",
        key: "courses",
        icon: GraduationCap,
        tabLabel: { ar: "مبيعات الكورسات", en: "Course sales" },
        search: { view: "sales" },
        matches: (search) => courseView(search) !== "ads",
      },
      {
        to: "/pricing",
        key: "price_book",
        icon: BookMarked,
        tabLabel: { ar: "الأسعار والالتزام", en: "Pricing and compliance" },
      },
    ],
  },
  /**
   * Specialist and technical tools: deeper slices and data-quality views for
   * the people who run the pipes. Every one stays one click from anywhere.
   */
  {
    id: "more",
    label: { ar: "أدوات متقدمة", en: "Advanced tools" },
    shortLabel: { ar: "أدوات", en: "Tools" },
    icon: MoreHorizontal,
    defaultTo: "/ads",
    contextual: "menu",
    items: [
      {
        to: "/ads",
        key: "ads_tech",
        icon: BarChart3,
        tabLabel: { ar: "تحليل الإعلانات المتقدم", en: "Ads explorer" },
        description: {
          ar: "كل المنصات بكل الأعمدة والفلاتر",
          en: "Every platform, every column and filter",
        },
      },
      {
        to: "/acquisition",
        key: "acquisition_performance",
        icon: Layers,
        tabLabel: { ar: "مقارنة الـAd Sets", en: "Ad Set comparison" },
        search: { section: "ads", view: "adset-compare" },
        matches: (search) =>
          acquisitionSection(search) === "ads" && search.view === "adset-compare",
        description: { ar: "المجموعات الإعلانية جنب بعض", en: "Ad sets side by side" },
      },
      {
        to: "/courses",
        key: "courses",
        icon: GraduationCap,
        tabLabel: { ar: "إعلانات الكورسات", en: "Course ads" },
        search: { view: "ads" },
        matches: (search) => courseView(search) === "ads",
        description: { ar: "إنفاق ونتائج كل كورس", en: "Spend and results per course" },
      },
      {
        to: "/attribution",
        key: "attribution",
        icon: MapPinned,
        tabLabel: { ar: "إسناد المحادثات", en: "Conversation attribution" },
        description: { ar: "مصدر كل محادثة واتساب", en: "Where each WhatsApp chat came from" },
      },
      {
        to: "/landing-pages",
        key: "landing_pages",
        icon: Globe2,
        tabLabel: { ar: "صفحات الهبوط", en: "Landing pages" },
        description: { ar: "أداء كل صفحة هبوط", en: "Performance of each landing page" },
      },
      {
        to: "/acquisition",
        key: "acquisition_performance",
        icon: Receipt,
        tabLabel: { ar: "سجلات المبيعات المرتبطة", en: "Linked sales records" },
        search: { section: "sales" },
        matches: (search) => acquisitionSection(search) === "sales",
        description: {
          ar: "كل عميل من إعلان حتى الفاتورة",
          en: "Every lead from ad to invoice",
        },
      },
      {
        to: "/acquisition",
        key: "acquisition_performance",
        icon: ShieldCheck,
        tabLabel: { ar: "تغطية البيانات", en: "Data coverage" },
        search: { section: "coverage" },
        matches: (search) => acquisitionSection(search) === "coverage",
        description: {
          ar: "دقة الربط وحالة المصادر التقنية",
          en: "Attribution accuracy and source health",
        },
      },
      {
        // The one place that says whether a number was checked against the
        // system it came from. It belongs near the top of the tools list, not
        // buried under them: it is what somebody reaches for when a figure
        // looks wrong.
        to: "/number-review",
        key: "number_review",
        icon: ShieldCheck,
        tabLabel: { ar: "مراجعة الأرقام", en: "Number review" },
        description: {
          ar: "كل رقم مهم: جاي منين، ومطابق للمصدر ولا لأ",
          en: "Every key number: where it came from, and whether the source agrees",
        },
      },
      {
        to: "/social-media",
        key: "social_media",
        icon: MessagesSquare,
        tabLabel: { ar: "السوشيال ميديا", en: "Social media" },
        description: { ar: "أداء الصفحات والمحتوى", en: "Page and content performance" },
      },
      {
        to: "/organic",
        key: "organic",
        icon: Leaf,
        tabLabel: { ar: "الأورجانيك", en: "Organic" },
        description: { ar: "عملاء ومبيعات بدون إعلان", en: "Leads and sales without ads" },
      },
      {
        to: "/weekend",
        key: "weekend",
        icon: CalendarClock,
        tabLabel: { ar: "مقارنة الويك إند", en: "Weekend comparison" },
        description: { ar: "الويك إند مقابل أيام الأسبوع", en: "Weekend against weekdays" },
      },
    ],
  },
];

export function pathMatchesRoute(pathname: string, route: string): boolean {
  return route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`);
}

export function itemIsActive(
  item: NavigationItem,
  pathname: string,
  search: LocationSearch = {},
): boolean {
  if (!pathMatchesRoute(pathname, item.to)) return false;
  return item.matches ? item.matches(search) : true;
}

export function sectionIsActive(
  section: NavigationSection,
  pathname: string,
  search: LocationSearch = {},
): boolean {
  return (
    section.items.some((item) => itemIsActive(item, pathname, search)) ||
    section.aliases?.some((route) => pathMatchesRoute(pathname, route)) === true
  );
}

export function sectionForLocation(
  pathname: string,
  search: LocationSearch = {},
): NavigationSection | undefined {
  return NAVIGATION_SECTIONS.find((section) => sectionIsActive(section, pathname, search));
}

export function sectionForPathname(pathname: string): NavigationSection | undefined {
  return sectionForLocation(pathname);
}

export function itemLabel(item: NavigationItem, lang: Lang, t: (key: DictKey) => string): string {
  return item.tabLabel?.[lang] ?? t(item.key);
}

/**
 * The five views of Acquisition performance. Shared by the page and by
 * navigation so the two can never name them differently.
 */
export const ACQUISITION_SECTIONS = [
  { value: "overview", label: { ar: "نظرة عامة", en: "Overview" } },
  { value: "ads", label: { ar: "الإعلانات والمواد", en: "Ads & creatives" } },
  { value: "leads", label: { ar: "مصادر العملاء", en: "Lead sources" } },
  { value: "sales", label: { ar: "سجلات المبيعات المرتبطة", en: "Linked sales records" } },
  { value: "coverage", label: { ar: "تغطية البيانات", en: "Data coverage" } },
] as const satisfies readonly { value: string; label: Record<Lang, string> }[];

export type AcquisitionSectionValue = (typeof ACQUISITION_SECTIONS)[number]["value"];

export interface DrawerLink {
  key: string;
  label: string;
  icon?: LucideIcon;
  to: string;
  search?: Record<string, string>;
  active: boolean;
  /** A menu section: its reports are listed behind a disclosure, not a link. */
  menu?: boolean;
  children: DrawerLink[];
}

/**
 * What the phone drawer lists: the six primary destinations, and — only for the
 * one the reader is in — its reports one level down. Nesting only where it
 * helps keeps the first level a short, scannable list.
 */
export function navigationDrawerTree(
  pathname: string,
  search: LocationSearch,
  lang: Lang,
  labelOf: (item: NavigationItem) => string,
): DrawerLink[] {
  return NAVIGATION_SECTIONS.map((section) => {
    const active = sectionIsActive(section, pathname, search);
    const menu = section.contextual === "menu";
    const children =
      (active || menu) && section.items.length > 1
        ? section.items.map((item, index): DrawerLink => ({
            key: `${section.id}:${index}`,
            label: labelOf(item),
            icon: item.icon,
            to: item.to,
            search: item.search,
            active: itemIsActive(item, pathname, search),
            children: [],
          }))
        : [];
    return {
      key: section.id,
      label: section.label[lang],
      icon: section.icon,
      to: section.defaultTo,
      search: section.defaultSearch,
      active,
      menu,
      children,
    };
  });
}
