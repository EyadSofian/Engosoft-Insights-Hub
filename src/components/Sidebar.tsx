import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { BookOpen, MoreHorizontal, Pin, PinOff, Sparkles } from "lucide-react";
import { chromeStore, useChrome } from "@/lib/chrome-store";
import { useI18n } from "@/lib/i18n";
import { useModalGuard } from "@/lib/ui-store";
import {
  NAVIGATION_SECTIONS,
  pathMatchesRoute,
  sectionIsActive,
  type NavigationItem,
} from "@/lib/navigation";
import { Drawer, DrawerContent, DrawerTitle } from "./ui/drawer";
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

/**
 * The desktop navigation rail.
 *
 * Fixed to the inline edge and taken out of the flow, so it can slide away on a
 * `transform` without the content column relaying out frame by frame; the
 * column's own padding follows in one transition (see `chrome-inset`).
 *
 * `inert` while it is off screen: a rail translated out of view is still in the
 * tab order, and a keyboard user would otherwise tab into links nobody can see.
 */
export function Sidebar() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const chrome = useChrome();
  const out = chrome.navHidden && !chrome.peeking && !chrome.pinned;

  return (
    <aside
      data-app-chrome=""
      inert={out ? true : undefined}
      className="chrome-slide chrome-sidebar fixed top-0 z-35 hidden h-dvh flex-col gap-1 overflow-y-auto scrollbar-none px-3 py-5 lg:flex"
      style={{
        width: "var(--sidebar-w)",
        insetInlineStart: 0,
        // It leaves towards the edge it lives on, which is the right-hand edge
        // under RTL — hence a signed offset rather than a fixed direction.
        transform: out
          ? `translateX(calc(var(--sidebar-w) * ${lang === "ar" ? 1 : -1}))`
          : "translateX(0)",
        opacity: out ? 0 : 1,
      }}
    >
      <div className="mb-6 flex items-center gap-2">
        <Link to="/" className="group flex min-w-0 flex-1 items-center gap-3 px-1">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm transition-transform duration-200 group-hover:scale-105">
            <img src={logoImg} alt="" className="h-7 w-7 object-contain" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[15px] font-semibold tracking-tight text-white">
              ENGOSOFT
            </div>
            <div className="truncate text-[11px] text-white/55">{t("app_sub")}</div>
          </div>
        </Link>
        <PinToggle />
      </div>

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

/**
 * Turns the auto-hide off and back on, and remembers the answer.
 *
 * The preference is the reader's, so it is stated in words in the tooltip
 * rather than left to a pin glyph, and the keyboard shortcut is named where
 * somebody can actually find it.
 */
function PinToggle() {
  const { lang } = useI18n();
  const chrome = useChrome();
  const label = chrome.pinned
    ? lang === "ar"
      ? "إلغاء التثبيت والسماح بالإخفاء عند التمرير (⌘/Ctrl + B)"
      : "Unpin and allow hiding on scroll (⌘/Ctrl + B)"
    : lang === "ar"
      ? "تثبيت التنقل ومنع إخفائه عند التمرير (⌘/Ctrl + B)"
      : "Pin navigation open (⌘/Ctrl + B)";

  return (
    <button
      type="button"
      onClick={() => chromeStore.togglePinned()}
      aria-pressed={chrome.pinned}
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border transition-colors ${
        chrome.pinned
          ? "border-white/25 bg-white/[0.12] text-white"
          : "border-white/10 text-white/50 hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      {chrome.pinned ? <Pin size={15} /> : <PinOff size={15} />}
    </button>
  );
}

/**
 * The phone navigation.
 *
 * The four sections a reader opens most stay on the bar; the rest live in a
 * bottom sheet rather than being squeezed into the same row. The bar itself
 * does not auto-hide — it is the only navigation a phone has, and 64px is a
 * fair price for always knowing where you are.
 */
export function MobileNav() {
  const { lang } = useI18n();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  useModalGuard(moreOpen);

  const primarySections = NAVIGATION_SECTIONS.slice(0, 4);
  const hiddenSections = NAVIGATION_SECTIONS.slice(4);
  const hiddenSectionActive = hiddenSections.some((section) => sectionIsActive(section, pathname));

  return (
    <>
      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerContent className="border-border bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] lg:hidden">
          <div className="px-4 pt-3">
            <DrawerTitle className="text-[15px] font-bold text-text">
              {lang === "ar" ? "أقسام الداشبورد" : "Dashboard sections"}
            </DrawerTitle>
            <p className="mt-0.5 text-[12px] text-text-muted">
              {lang === "ar" ? "اختر مساحة العمل المطلوبة" : "Choose the workspace you need"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 p-4">
            {NAVIGATION_SECTIONS.map((section) => {
              const active = sectionIsActive(section, pathname);
              const Icon = section.icon;
              return (
                <Link
                  key={section.id}
                  to={section.defaultTo}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 text-[13px] font-semibold transition-colors ${
                    active
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border bg-surface text-text hover:bg-surface-2"
                  }`}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span className="truncate">{section.label[lang]}</span>
                </Link>
              );
            })}
          </div>

          <div className="px-4 pb-2">
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                window.dispatchEvent(new Event("engosoft:open-chat"));
              }}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold text-white"
              style={{ background: "var(--ink)" }}
            >
              <Sparkles size={17} aria-hidden="true" />
              {lang === "ar" ? "اسأل المساعد عن الأرقام" : "Ask the assistant about the numbers"}
            </button>
          </div>
        </DrawerContent>
      </Drawer>

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
          onClick={() => setMoreOpen(true)}
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
