import { Link, useLocation } from "@tanstack/react-router";
import { BookOpen, PanelRightClose } from "lucide-react";
import { chromeStore, useChrome } from "@/lib/chrome-store";
import { useI18n } from "@/lib/i18n";
import { NAVIGATION_SECTIONS, sectionIsActive } from "@/lib/navigation";
import logoImg from "@/assets/engosoft-logo.png";

/**
 * The desktop navigation rail.
 *
 * Fixed to the inline edge and taken out of the flow, so a reader can collapse
 * it without a heavy reflow; the content column follows in one transition (see
 * `chrome-inset`). It never reacts to scrolling.
 *
 * `inert` while it is off screen: a rail translated out of view is still in the
 * tab order, and a keyboard user would otherwise tab into links nobody can see.
 */
export function Sidebar() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const chrome = useChrome();
  const out = chrome.navHidden;

  return (
    <aside
      data-app-chrome=""
      inert={out ? true : undefined}
      className="chrome-slide chrome-sidebar fixed top-0 z-(--z-rail) hidden h-dvh flex-col gap-1 overflow-y-auto scrollbar-none px-3 py-5 lg:flex"
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
      <div className="mb-5 flex items-center gap-2">
        <Link to="/" className="group flex min-w-0 flex-1 items-center gap-2.5 px-1">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-border bg-white shadow-xs transition-transform duration-200 group-hover:scale-105">
            <img src={logoImg} alt="" className="h-7 w-7 object-contain" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[15px] font-bold tracking-tight text-nav-text">
              ENGOSOFT
            </div>
            <div className="truncate text-[11px] text-nav-text-muted">{t("app_sub")}</div>
          </div>
        </Link>
        <NavigationToggle />
      </div>

      <nav
        className="flex flex-col gap-1"
        aria-label={lang === "ar" ? "أقسام لوحة المعلومات" : "Dashboard sections"}
      >
        {NAVIGATION_SECTIONS.map((section) => {
          const active = sectionIsActive(section, pathname);
          const Icon = section.icon;
          // A section that owns several reports lands on its default report and
          // hands the rest to the sticky tab strip, which stays on screen
          // while the header slides away. Only a single-report section can
          // therefore claim `aria-current="page"` from here.
          const hasChildren = section.items.length > 1;

          return (
            <div key={section.id}>
              {/* The active section is a filled soft-blue pill with a solid
                  icon tile inside it. A 3px edge rail was too quiet to find at
                  a glance in a list of seven, and the reader's own position is
                  the one thing a rail must never make them hunt for. */}
              <Link
                to={section.defaultTo}
                aria-current={active && !hasChildren ? "page" : undefined}
                className={`group relative flex min-h-11 items-center gap-3 rounded-2xl px-2.5 text-[13.5px] font-semibold transition-colors duration-150 ${
                  active ? "" : "hover:bg-nav-hover"
                }`}
                style={
                  active
                    ? { background: "var(--sky-surface)", color: "var(--sky-ink)" }
                    : { color: "var(--nav-text)" }
                }
              >
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-xl transition-colors"
                  style={
                    active
                      ? { background: "var(--sky-strong)", color: "#fff" }
                      : { background: "var(--surface-2)", color: "var(--nav-text-muted)" }
                  }
                  aria-hidden="true"
                >
                  <Icon size={17} strokeWidth={active ? 2.4 : 1.9} />
                </span>
                <span className="truncate">{section.label[lang]}</span>
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3 px-1 pt-6">
        <Link
          to="/guide"
          className="flex min-h-10 items-center gap-2.5 rounded-xl bg-surface-2 px-3 text-[12px] font-semibold text-nav-text-muted transition-colors hover:bg-surface-3 hover:text-nav-text"
        >
          <BookOpen size={16} />
          <span>{lang === "ar" ? "دليل استخدام الداشبورد" : "Dashboard user guide"}</span>
        </Link>
        <div className="px-3 text-[11px] text-text-subtle">
          © {new Date().getFullYear()} Engosoft
        </div>
      </div>
    </aside>
  );
}

/**
 * The rail only changes when the reader asks it to. This closes it; the matching
 * button in the fixed control bar reopens it. The choice survives refreshes.
 */
function NavigationToggle() {
  const { lang } = useI18n();
  const label =
    lang === "ar" ? "تصغير قائمة التنقل (⌘/Ctrl + B)" : "Collapse navigation (⌘/Ctrl + B)";

  return (
    <button
      type="button"
      onClick={() => chromeStore.setNavigationHidden(true)}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-nav-border text-nav-text-muted transition-colors hover:bg-nav-hover hover:text-nav-text active:scale-[0.97]"
    >
      <PanelRightClose size={16} className="rtl:-scale-x-100" />
    </button>
  );
}
