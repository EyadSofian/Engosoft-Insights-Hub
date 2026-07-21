import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Megaphone,
  BarChart3,
  Receipt,
  Users,
  UsersRound,
  FileText,
  TrendingDown,
  GraduationCap,
  CalendarRange,
  Globe2,
  MoreHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useI18n, type DictKey } from "@/lib/i18n";
import logoImg from "@/assets/engosoft-logo.png";

interface NavItem {
  to: string;
  key: DictKey;
  icon: LucideIcon;
  exact?: boolean;
  /** Shorter label used in the mobile bar, where space is tight. */
  shortKey?: DictKey;
}

/** Grouped so ten destinations still scan as three ideas. */
const GROUPS: { label: { ar: string; en: string }; items: NavItem[] }[] = [
  {
    label: { ar: "الأداء", en: "Performance" },
    items: [
      { to: "/", key: "overview", icon: LayoutDashboard, exact: true },
      { to: "/campaigns", key: "campaigns", icon: Megaphone },
      { to: "/ads", key: "ads_tech", icon: BarChart3 },
      { to: "/yoy", key: "yoy", icon: CalendarRange },
    ],
  },
  {
    label: { ar: "الإيرادات", en: "Revenue" },
    items: [
      { to: "/sales", key: "sales", icon: Receipt },
      { to: "/full-invoiced", key: "full_invoiced", icon: FileText },
      { to: "/courses", key: "courses", icon: GraduationCap },
    ],
  },
  {
    // "Pipeline" has no natural Arabic equivalent — "العملاء" reads correctly
    // for the leads-and-losses pair without sounding translated.
    label: { ar: "العملاء", en: "Pipeline" },
    items: [
      { to: "/website", key: "website", icon: Globe2 },
      { to: "/leads", key: "leads", icon: Users },
      { to: "/teams", key: "teams", icon: UsersRound },
      { to: "/lost", key: "lost", icon: TrendingDown },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

/** Five primary destinations for the mobile bar; the rest live behind "More". */
const MOBILE_PRIMARY: NavItem[] = [
  { to: "/", key: "overview", icon: LayoutDashboard, exact: true, shortKey: "overview_short" },
  { to: "/campaigns", key: "campaigns", icon: Megaphone, shortKey: "campaigns_short" },
  { to: "/courses", key: "courses", icon: GraduationCap },
  { to: "/leads", key: "leads", icon: Users, shortKey: "leads_short" },
];

function useIsActive() {
  const loc = useLocation();
  return (it: NavItem) => (it.exact ? loc.pathname === it.to : loc.pathname.startsWith(it.to));
}

export function Sidebar() {
  const { t, lang } = useI18n();
  const isActive = useIsActive();

  return (
    <aside
      className="hidden lg:flex flex-col shrink-0 sticky top-0 h-screen px-3 py-5 gap-1 overflow-y-auto scrollbar-none"
      style={{ width: "var(--sidebar-w)", background: "var(--navy)" }}
    >
      <Link to="/" className="flex items-center gap-3 px-2 mb-7 group">
        <div className="w-10 h-10 rounded-xl grid place-items-center bg-white shadow-sm transition-transform duration-200 group-hover:scale-105">
          <img src={logoImg} alt="" className="w-7 h-7 object-contain" />
        </div>
        <div className="leading-tight min-w-0">
          <div className="text-white font-semibold text-[15px] tracking-tight truncate">
            ENGOSOFT
          </div>
          <div className="text-white/55 text-[11px] truncate">{t("app_sub")}</div>
        </div>
      </Link>

      <nav className="flex flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.label.en}>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
              {group.label[lang]}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((it) => {
                const active = isActive(it);
                const Icon = it.icon;
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                      active ? "text-white" : "text-white/65 hover:text-white hover:bg-white/[0.06]"
                    }`}
                    style={active ? { background: "var(--brand)" } : undefined}
                  >
                    <Icon size={18} strokeWidth={active ? 2.2 : 1.8} className="shrink-0" />
                    <span className="truncate">{t(it.key)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto pt-6 px-3 text-white/35 text-[11px]">
        © {new Date().getFullYear()} Engosoft
      </div>
    </aside>
  );
}

export function MobileNav() {
  const { t, lang } = useI18n();
  const isActive = useIsActive();
  const [moreOpen, setMoreOpen] = useState(false);

  const secondary = ALL_ITEMS.filter((i) => !MOBILE_PRIMARY.some((p) => p.to === i.to));
  const secondaryActive = secondary.some(isActive);

  return (
    <>
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch justify-around gap-1 px-2 pt-1.5 glass-navy"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
        aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}
      >
        {MOBILE_PRIMARY.map((it) => {
          const active = isActive(it);
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-1 flex-1 min-h-[48px] rounded-xl transition-colors duration-150 ${
                active ? "text-white" : "text-white/60"
              }`}
              style={active ? { background: "var(--brand)" } : undefined}
            >
              <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium leading-none truncate max-w-full px-1">
                {t(it.shortKey ?? it.key)}
              </span>
            </Link>
          );
        })}

        <button
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          className={`flex flex-col items-center justify-center gap-1 flex-1 min-h-[48px] rounded-xl transition-colors duration-150 ${
            secondaryActive ? "text-white" : "text-white/60"
          }`}
          style={secondaryActive ? { background: "var(--brand)" } : undefined}
        >
          <MoreHorizontal size={19} />
          <span className="text-[10px] font-medium leading-none">{t("more")}</span>
        </button>
      </nav>

      {moreOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex items-end animate-fade-in"
          style={{ background: "rgba(4, 12, 24, 0.5)" }}
          onClick={() => setMoreOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full glass rounded-t-3xl p-5 animate-slide-up"
            style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-text">{t("more")}</h2>
              <button
                onClick={() => setMoreOpen(false)}
                aria-label={t("close")}
                className="w-10 h-10 grid place-items-center rounded-full hover:bg-surface-2 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {secondary.map((it) => {
                const active = isActive(it);
                const Icon = it.icon;
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    onClick={() => setMoreOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border text-sm font-medium transition-colors min-h-[52px] ${
                      active
                        ? "text-white border-transparent"
                        : "border-border text-text hover:bg-surface-2"
                    }`}
                    style={active ? { background: "var(--brand)" } : undefined}
                  >
                    <Icon size={18} className="shrink-0" />
                    <span className="truncate">{t(it.key)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
