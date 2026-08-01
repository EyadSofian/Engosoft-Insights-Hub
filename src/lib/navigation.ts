import {
  BarChart3,
  CalendarRange,
  Globe2,
  LayoutDashboard,
  Megaphone,
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
  id: "overview" | "marketing" | "crm" | "accounting" | "website";
  label: Record<Lang, string>;
  shortLabel: Record<Lang, string>;
  icon: LucideIcon;
  defaultTo: string;
  items: NavigationItem[];
  aliases?: string[];
}

/**
 * The information architecture has two deliberate levels:
 * business domain first, then the report inside that domain.
 *
 * Year-over-year lives under Marketing because it compares the same spend,
 * lead and attributed-revenue facts as the other marketing reports. This keeps
 * the mobile navigation to five stable destinations instead of hiding a sixth
 * primary destination behind a "More" drawer.
 */
export const NAVIGATION_SECTIONS: NavigationSection[] = [
  {
    id: "overview",
    label: { ar: "نظرة عامة", en: "Overview" },
    shortLabel: { ar: "الرئيسية", en: "Home" },
    icon: LayoutDashboard,
    defaultTo: "/",
    items: [{ to: "/", key: "overview", icon: LayoutDashboard }],
  },
  {
    id: "marketing",
    label: { ar: "التسويق", en: "Marketing" },
    shortLabel: { ar: "التسويق", en: "Marketing" },
    icon: Megaphone,
    defaultTo: "/campaigns",
    items: [
      { to: "/campaigns", key: "campaigns", icon: Megaphone },
      { to: "/media-buyers", key: "media_buyers", icon: UserRoundSearch },
      { to: "/ads", key: "ads_tech", icon: BarChart3 },
      { to: "/yoy", key: "yoy", icon: CalendarRange },
    ],
  },
  {
    id: "crm",
    label: { ar: "إدارة العملاء", en: "CRM" },
    shortLabel: { ar: "العملاء", en: "CRM" },
    icon: Users,
    defaultTo: "/leads",
    items: [
      { to: "/leads", key: "leads", icon: Users },
      { to: "/lost", key: "lost", icon: TrendingDown },
      { to: "/teams", key: "teams", icon: UsersRound },
    ],
  },
  {
    id: "accounting",
    label: { ar: "الحسابات", en: "Accounting" },
    shortLabel: { ar: "الحسابات", en: "Accounts" },
    icon: Receipt,
    defaultTo: "/accounting",
    aliases: ["/sales", "/full-invoiced"],
    items: [{ to: "/accounting", key: "accounting", icon: Receipt }],
  },
  {
    id: "website",
    label: { ar: "الموقع الإلكتروني", en: "Website" },
    shortLabel: { ar: "الموقع", en: "Website" },
    icon: Globe2,
    defaultTo: "/website",
    items: [{ to: "/website", key: "website", icon: Globe2 }],
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
