import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { BookOpen, MoreHorizontal, Sparkles, X } from "lucide-react";
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
          const hasChildren = section.items.length > 1;

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

              {active && hasChildren && (
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

      <div className="mt-auto space-y-3 px-1 pt-6">
        <Link
          to="/guide"
          className="flex min-h-10 items-center gap-2.5 rounded-lg border border-white/10 px-3 text-[12px] font-semibold text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <BookOpen size={16} />
          <span>{lang === "ar" ? "دليل استخدام الداشبورد" : "Dashboard user guide"}</span>
        </Link>
        <div className="px-3 text-[11px] text-white/35">© {new Date().getFullYear()} Engosoft</div>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const { lang } = useI18n();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const primarySections = NAVIGATION_SECTIONS.slice(0, 4);
  const hiddenSections = NAVIGATION_SECTIONS.slice(4);
  const hiddenSectionActive = hiddenSections.some((section) => sectionIsActive(section, pathname));

  return (
    <>
      {moreOpen && (
        <>
          <button
            type="button"
            aria-label={lang === "ar" ? "إغلاق قائمة الأقسام" : "Close section menu"}
            className="fixed inset-0 z-40 bg-navy/55 backdrop-blur-sm lg:hidden"
            onClick={() => setMoreOpen(false)}
          />
          <section
            className="fixed inset-x-3 bottom-[calc(var(--mobile-nav-h)+0.75rem)] z-50 rounded-2xl border border-border bg-surface p-4 shadow-2xl lg:hidden"
            aria-label={lang === "ar" ? "كل أقسام الداشبورد" : "All dashboard sections"}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-text">
                  {lang === "ar" ? "أقسام الداشبورد" : "Dashboard sections"}
                </p>
                <p className="text-[11px] text-text-muted">
                  {lang === "ar" ? "اختار مساحة العمل المطلوبة" : "Choose the workspace you need"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-xl border border-border text-text-muted hover:bg-surface-2 hover:text-text"
                aria-label={lang === "ar" ? "إغلاق" : "Close"}
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {NAVIGATION_SECTIONS.map((section) => {
                const active = sectionIsActive(section, pathname);
                const Icon = section.icon;
                return (
                  <Link
                    key={section.id}
                    to={section.defaultTo}
                    onClick={() => setMoreOpen(false)}
                    className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 text-sm font-semibold transition-colors ${
                      active
                        ? "border-brand bg-brand-soft text-brand"
                        : "border-border bg-surface text-text hover:bg-surface-2"
                    }`}
                  >
                    <Icon size={18} />
                    <span className="truncate">{section.label[lang]}</span>
                  </Link>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                window.dispatchEvent(new Event("engosoft:open-chat"));
              }}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-navy px-4 text-sm font-semibold text-white"
            >
              <Sparkles size={17} />
              {lang === "ar" ? "اسأل المساعد عن الأرقام" : "Ask the assistant about the numbers"}
            </button>
          </section>
        </>
      )}

      <nav
        className="app-mobile-nav glass-navy fixed inset-x-0 bottom-0 z-50 flex min-h-[64px] items-stretch justify-around gap-1 border-t border-white/10 pt-1.5 shadow-[0_-10px_28px_rgba(0,18,40,0.18)] lg:hidden"
        style={{
          paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))",
          paddingInlineStart: "max(0.375rem, env(safe-area-inset-left))",
          paddingInlineEnd: "max(0.375rem, env(safe-area-inset-right))",
        }}
        aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}
      >
        {primarySections.map((section) => {
          const active = sectionIsActive(section, pathname);
          const Icon = section.icon;

          return (
            <Link
              key={section.id}
              to={section.defaultTo}
              aria-current={active ? "page" : undefined}
              aria-label={section.label[lang]}
              className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-0.5 transition-colors duration-150 active:scale-[0.97] ${
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
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-label={lang === "ar" ? "عرض باقي الأقسام" : "Show more sections"}
          className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-0.5 transition-colors active:scale-[0.97] ${
            hiddenSectionActive || moreOpen ? "text-white" : "text-white/60"
          }`}
          style={hiddenSectionActive || moreOpen ? { background: "var(--brand)" } : undefined}
        >
          <MoreHorizontal size={20} aria-hidden="true" />
          <span className="max-w-full truncate text-[10px] font-medium leading-none">
            {lang === "ar" ? "المزيد" : "More"}
          </span>
        </button>
      </nav>
    </>
  );
}
