import {
  BarChart3,
  BrainCircuit,
  CalendarClock,
  CalendarRange,
  GraduationCap,
  GitCompareArrows,
  BookMarked,
  Globe2,
  Leaf,
  Megaphone,
  MessagesSquare,
  MapPinned,
  Receipt,
  TrendingDown,
  TrendingUp,
  Users,
  UsersRound,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react";
import type { DictKey, Lang } from "@/lib/i18n";

export interface NavigationItem {
  to: string;
  key: DictKey;
  icon: LucideIcon;
  /**
   * What this report is called ON THE TAB STRIP, when the dictionary entry is
   * not what a reader needs there.
   *
   * `t(key)` names the PAGE — "الحسابات", "الدورات" — and those names are also
   * the page headings, so they cannot be rewritten without renaming the report
   * itself. A tab has a different job: sitting beside its siblings it has to
   * say which of the three reports in this section it is. Only the items whose
   * page name is ambiguous in that row carry one; the rest fall back to `t(key)`.
   */
  tabLabel?: Record<Lang, string>;
}

export interface NavigationSection {
  id: "business" | "campaigns" | "sales" | "leads" | "comparisons" | "media-buyers" | "social";
  label: Record<Lang, string>;
  shortLabel: Record<Lang, string>;
  icon: LucideIcon;
  defaultTo: string;
  items: NavigationItem[];
  aliases?: string[];
}

/**
 * The information architecture mirrors an executive BI workspace: each primary
 * section owns one business question and only reveals its detailed reports when
 * it is active. Routes remain stable so bookmarks and shared links keep working.
 */
export const NAVIGATION_SECTIONS: NavigationSection[] = [
  {
    id: "business",
    label: { ar: "تحليلات البيزنس", en: "Business analytics" },
    shortLabel: { ar: "البيزنس", en: "Business" },
    icon: BrainCircuit,
    defaultTo: "/",
    items: [{ to: "/", key: "business_analytics", icon: BrainCircuit }],
  },
  {
    id: "campaigns",
    label: { ar: "الحملات", en: "Campaigns" },
    shortLabel: { ar: "الحملات", en: "Campaigns" },
    icon: Megaphone,
    defaultTo: "/campaigns",
    items: [
      { to: "/campaigns", key: "campaigns", icon: Megaphone },
      { to: "/ads", key: "ads_tech", icon: BarChart3, tabLabel: { ar: "الإعلانات", en: "Ads" } },
      {
        to: "/acquisition",
        key: "acquisition_performance",
        icon: TrendingUp,
        tabLabel: { ar: "تحليل الاستحواذ", en: "Acquisition performance" },
      },
      {
        to: "/attribution",
        key: "attribution",
        icon: MapPinned,
        tabLabel: { ar: "إسناد المحادثات", en: "Attribution" },
      },
      {
        to: "/landing-pages",
        key: "landing_pages",
        icon: Globe2,
        tabLabel: { ar: "صفحات الهبوط", en: "Landing pages" },
      },
      {
        to: "/website",
        key: "website",
        icon: Globe2,
        tabLabel: { ar: "الموقع الإلكتروني", en: "Website" },
      },
    ],
  },
  {
    id: "sales",
    label: { ar: "المبيعات", en: "Sales" },
    shortLabel: { ar: "المبيعات", en: "Sales" },
    icon: Receipt,
    defaultTo: "/accounting",
    aliases: ["/full-invoiced", "/sales", "/products"],
    items: [
      {
        to: "/accounting",
        key: "accounting",
        icon: Receipt,
        tabLabel: { ar: "الحسابات والتحصيل", en: "Accounts & collection" },
      },
      {
        to: "/courses",
        key: "courses",
        icon: GraduationCap,
        tabLabel: { ar: "الكورسات", en: "Courses" },
      },
      {
        to: "/pricing",
        key: "price_book",
        icon: BookMarked,
        tabLabel: { ar: "الأسعار والالتزام", en: "Pricing & compliance" },
      },
    ],
  },
  {
    id: "leads",
    label: { ar: "إدارة العملاء CRM", en: "CRM management" },
    shortLabel: { ar: "CRM", en: "CRM" },
    icon: Users,
    defaultTo: "/leads",
    items: [
      { to: "/leads", key: "leads", icon: Users },
      { to: "/lost", key: "lost", icon: TrendingDown },
      { to: "/teams", key: "teams", icon: UsersRound },
    ],
  },
  {
    id: "comparisons",
    label: { ar: "المقارنات", en: "Comparisons" },
    shortLabel: { ar: "المقارنة", en: "Compare" },
    icon: GitCompareArrows,
    defaultTo: "/weekend",
    items: [
      { to: "/weekend", key: "weekend", icon: CalendarClock },
      { to: "/yoy", key: "yoy", icon: CalendarRange },
    ],
  },
  {
    id: "media-buyers",
    label: { ar: "أداء الميديا بايرز", en: "Media buyers" },
    shortLabel: { ar: "الميديا", en: "Media" },
    icon: UserRoundSearch,
    defaultTo: "/media-buyers",
    items: [
      { to: "/media-buyers", key: "media_buyers", icon: UserRoundSearch },
      { to: "/media-plan", key: "media_plan", icon: CalendarRange },
    ],
  },
  {
    id: "social",
    label: { ar: "السوشيال ميديا", en: "Social media" },
    shortLabel: { ar: "السوشيال", en: "Social" },
    icon: MessagesSquare,
    defaultTo: "/social-media",
    items: [
      { to: "/social-media", key: "social_media", icon: MessagesSquare },
      { to: "/organic", key: "organic", icon: Leaf },
    ],
  },
];

export function pathMatchesRoute(pathname: string, route: string): boolean {
  return route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`);
}

export function sectionIsActive(section: NavigationSection, pathname: string): boolean {
  return (
    section.items.some((item) => pathMatchesRoute(pathname, item.to)) ||
    section.aliases?.some((route) => pathMatchesRoute(pathname, route)) === true
  );
}

export function sectionForPathname(pathname: string): NavigationSection | undefined {
  return NAVIGATION_SECTIONS.find((section) => sectionIsActive(section, pathname));
}

/**
 * The five views of Acquisition performance. Shared by the page's own switch
 * and the phone navigation drawer so the two can never name them differently.
 */
export const ACQUISITION_SECTIONS = [
  { value: "overview", label: { ar: "نظرة عامة", en: "Overview" } },
  { value: "ads", label: { ar: "الإعلانات والمواد", en: "Ads & creatives" } },
  { value: "leads", label: { ar: "العملاء والجودة", en: "Leads & quality" } },
  { value: "sales", label: { ar: "المبيعات والإيراد", en: "Sales & revenue" } },
  { value: "coverage", label: { ar: "تغطية البيانات", en: "Data coverage" } },
] as const satisfies readonly { value: string; label: Record<Lang, string> }[];

export type AcquisitionSectionValue = (typeof ACQUISITION_SECTIONS)[number]["value"];

export interface DrawerLink {
  key: string;
  label: string;
  icon?: LucideIcon;
  to: string;
  /** Only the acquisition views carry a search; everything else is a plain route. */
  section?: AcquisitionSectionValue;
  active: boolean;
  children: DrawerLink[];
}

/**
 * What the phone drawer lists: every section at the first level, and — only for
 * the section the reader is in — its reports one level down, with the
 * acquisition views under Acquisition performance when that report is open.
 * Nesting only where it helps keeps the first level a short, scannable list.
 */
export function navigationDrawerTree(
  pathname: string,
  acquisitionSection: string | undefined,
  lang: Lang,
  itemLabel: (item: NavigationItem) => string,
): DrawerLink[] {
  return NAVIGATION_SECTIONS.map((section) => {
    const active = sectionIsActive(section, pathname);
    const reports =
      active && section.items.length > 1
        ? section.items.map((item): DrawerLink => {
            const itemActive = pathMatchesRoute(pathname, item.to);
            const views =
              item.to === "/acquisition" && itemActive
                ? ACQUISITION_SECTIONS.map((view): DrawerLink => ({
                    key: `acquisition:${view.value}`,
                    label: view.label[lang],
                    to: "/acquisition",
                    section: view.value,
                    active: (acquisitionSection || "overview") === view.value,
                    children: [],
                  }))
                : [];
            return {
              key: item.to,
              label: itemLabel(item),
              icon: item.icon,
              to: item.to,
              active: itemActive,
              children: views,
            };
          })
        : [];
    return {
      key: section.id,
      label: section.label[lang],
      icon: section.icon,
      to: section.defaultTo,
      active,
      children: reports,
    };
  });
}
