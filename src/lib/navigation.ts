import {
  BarChart3,
  BrainCircuit,
  CalendarClock,
  CalendarRange,
  GraduationCap,
  GitCompareArrows,
  Globe2,
  Leaf,
  Megaphone,
  MessagesSquare,
  Receipt,
  TrendingDown,
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
}

export interface NavigationSection {
  id:
    | "business"
    | "campaigns"
    | "sales"
    | "leads"
    | "comparisons"
    | "website"
    | "media-buyers"
    | "social";
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
      { to: "/ads", key: "ads_tech", icon: BarChart3 },
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
      { to: "/accounting", key: "accounting", icon: Receipt },
      { to: "/courses", key: "courses", icon: GraduationCap },
    ],
  },
  {
    id: "leads",
    label: { ar: "جودة وأعداد الليدز", en: "Lead quality" },
    shortLabel: { ar: "الليدز", en: "Leads" },
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
    id: "website",
    label: { ar: "الموقع الإلكتروني", en: "Website" },
    shortLabel: { ar: "الموقع", en: "Website" },
    icon: Globe2,
    defaultTo: "/website",
    items: [{ to: "/website", key: "website", icon: Globe2 }],
  },
  {
    id: "media-buyers",
    label: { ar: "أداء الميديا بايرز", en: "Media buyers" },
    shortLabel: { ar: "الميديا", en: "Media" },
    icon: UserRoundSearch,
    defaultTo: "/media-buyers",
    items: [{ to: "/media-buyers", key: "media_buyers", icon: UserRoundSearch }],
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
