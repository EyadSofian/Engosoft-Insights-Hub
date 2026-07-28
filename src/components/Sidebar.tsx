import { Link, useLocation } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import {
  NAVIGATION_SECTIONS,
  pathMatchesRoute,
  sectionIsActive,
  type NavigationItem,
} from "@/lib/navigation";
import logoImg from "@/assets/engosoft-logo.png";

function ChildLink({ item, pathname }: { item: NavigationItem; pathname: string }) {
  const { t } = useI18n();
  const active = pathMatchesRoute(pathname, item.to);
  const Icon = item.icon;

  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium transition-colors duration-150 ${
        active ? "text-white" : "text-white/55 hover:bg-white/[0.06] hover:text-white"
      }`}
      style={active ? { background: "var(--brand)" } : undefined}
    >
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{t(item.key)}</span>
    </Link>
  );
}

export function Sidebar() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();

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

      <nav
        className="flex flex-col gap-2"
        aria-label={lang === "ar" ? "أقسام لوحة المعلومات" : "Dashboard sections"}
      >
        {NAVIGATION_SECTIONS.map((section) => {
          const active = sectionIsActive(section, pathname);
          const Icon = section.icon;
          const hasChildren = section.id !== "overview";

          return (
            <div key={section.id}>
              <Link
                to={section.defaultTo}
                aria-current={active && !hasChildren ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors duration-150 ${
                  active
                    ? "bg-white/[0.09] text-white"
                    : "text-white/65 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <Icon
                  size={19}
                  strokeWidth={active ? 2.2 : 1.8}
                  className="shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">{section.label[lang]}</span>
                {active && (
                  <span
                    className="ms-auto h-1.5 w-1.5 shrink-0 rounded-full bg-electric"
                    aria-hidden="true"
                  />
                )}
              </Link>

              {hasChildren && (
                <div
                  className="ms-[21px] mt-1 flex flex-col gap-0.5 border-s border-white/10 ps-2"
                  aria-label={
                    lang === "ar"
                      ? `تقارير ${section.label[lang]}`
                      : `${section.label[lang]} reports`
                  }
                >
                  {section.items.map((item) => (
                    <ChildLink key={item.to} item={item} pathname={pathname} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto pt-6 px-3 text-white/35 text-[11px]">
        © {new Date().getFullYear()} Engosoft
      </div>
    </aside>
  );
}

export function MobileNav() {
  const { lang } = useI18n();
  const { pathname } = useLocation();

  return (
    <nav
      className="glass-navy fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around gap-1 px-2 pt-1.5 lg:hidden"
      style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}
    >
      {NAVIGATION_SECTIONS.map((section) => {
        const active = sectionIsActive(section, pathname);
        const Icon = section.icon;

        return (
          <Link
            key={section.id}
            to={section.defaultTo}
            aria-current={active ? "true" : undefined}
            aria-label={section.label[lang]}
            className={`flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-0.5 transition-colors duration-150 ${
              active ? "text-white" : "text-white/60"
            }`}
            style={active ? { background: "var(--brand)" } : undefined}
          >
            <Icon size={19} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
            <span className="max-w-full truncate text-[10px] font-medium leading-none">
              {section.shortLabel[lang]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
