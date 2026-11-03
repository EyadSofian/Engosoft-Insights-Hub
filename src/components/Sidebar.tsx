import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { BookOpen, ChevronLeft, ChevronRight, PanelRightClose } from "lucide-react";
import { chromeStore, useChrome } from "@/lib/chrome-store";
import { useI18n } from "@/lib/i18n";
import { NAVIGATION_SECTIONS, sectionIsActive, type NavigationSection } from "@/lib/navigation";
import { MoreReportsList, useLocationSearch } from "./MoreReports";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { EngosoftMark } from "./EngosoftMark";
import { NexusLauncher } from "./engo-nexus/NexusLauncher";

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
  const search = useLocationSearch();
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
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
          <EngosoftMark className="h-6 w-6 shrink-0 text-nav-text" />
          <div className="min-w-0 leading-tight">
            <div className="engosoft-wordmark truncate text-[17px] text-nav-text">engosoft</div>
            <div className="truncate text-[12px] text-nav-text-muted">{t("app_sub")}</div>
          </div>
        </Link>
        <NavigationToggle />
      </div>

      <nav
        className="flex flex-col gap-1"
        aria-label={lang === "ar" ? "أقسام لوحة المعلومات" : "Dashboard sections"}
      >
        {NAVIGATION_SECTIONS.map((section) => {
          const active = sectionIsActive(section, pathname, search);
          if (section.contextual === "menu")
            return <MoreMenuRow key={section.id} section={section} active={active} />;
          // A workspace lands on its default report and hands the rest to the
          // contextual strip, so only a single-report section can claim
          // `aria-current="page"` from here.
          const hasChildren = section.items.length > 1;
          return (
            <Link
              key={section.id}
              to={section.defaultTo}
              search={section.defaultSearch as never}
              aria-current={active && !hasChildren ? "page" : undefined}
              activeOptions={{ exact: true, includeSearch: true }}
              className={railRowClass(active)}
              style={railRowStyle(active)}
            >
              <RailIcon section={section} active={active} />
              <span className="truncate">{section.label[lang]}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-1 px-1 pt-6">
        <NexusLauncher />
        <Link
          to="/guide"
          className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-normal text-nav-text-muted transition-colors hover:bg-nav-hover hover:text-nav-text"
        >
          <BookOpen size={16} />
          <span>{lang === "ar" ? "دليل استخدام الداشبورد" : "Dashboard user guide"}</span>
        </Link>
        <div className="px-2.5 pt-2 text-[12px] text-nav-text-muted">
          © {new Date().getFullYear()} Engosoft
        </div>
      </div>
    </aside>
  );
}

const railRowClass = (active: boolean) =>
  `group relative flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-[14px] font-normal transition-colors duration-150 ${
    active ? "" : "hover:bg-nav-hover"
  }`;

/**
 * The row you are on is a surface step with a cobalt tick, not a white pill
 * with a violet shadow under it. The rail carries no data, so nothing on it
 * should be the brightest thing on the screen.
 */
const railRowStyle = (active: boolean) =>
  active
    ? {
        background: "var(--nav-active-bg)",
        color: "var(--nav-active-text)",
        boxShadow: "inset 2px 0 0 0 var(--brand)",
      }
    : { color: "var(--nav-text-muted)" };

function RailIcon({ section, active }: { section: NavigationSection; active: boolean }) {
  const Icon = section.icon;
  // One icon box width in every row, so the labels start on one line. One size
  // and one stroke, whether the row is active or not.
  return (
    <span className="grid size-5 shrink-0 place-items-center" aria-hidden="true">
      <Icon size={18} strokeWidth={1.5} color={active ? "var(--brand)" : "currentColor"} />
    </span>
  );
}

/**
 * More is a menu, not a destination: the specialist reports open from it in a
 * panel beside the rail, so the rail itself stays six rows long.
 */
function MoreMenuRow({ section, active }: { section: NavigationSection; active: boolean }) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${railRowClass(active || open)} cursor-pointer`}
          style={railRowStyle(active || open)}
          aria-label={lang === "ar" ? "المزيد من التقارير المتخصصة" : "More specialist reports"}
        >
          <RailIcon section={section} active={active || open} />
          <span className="min-w-0 flex-1 truncate">{section.label[lang]}</span>
          {lang === "ar" ? (
            <ChevronLeft size={15} className="shrink-0 opacity-60" aria-hidden="true" />
          ) : (
            <ChevronRight size={15} className="shrink-0 opacity-60" aria-hidden="true" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={lang === "ar" ? "left" : "right"}
        align="start"
        sideOffset={10}
        className="w-80 max-h-[80dvh] overflow-y-auto rounded-xl p-2"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="px-2.5 pb-1.5 pt-1 text-[12px] font-medium text-text-subtle">
          {lang === "ar" ? "تقارير متخصصة" : "Specialist reports"}
        </div>
        <MoreReportsList onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
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
      className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border border-nav-border text-nav-text-muted transition-colors hover:bg-nav-hover hover:text-nav-text active:scale-[0.98]"
    >
      <PanelRightClose size={16} className="rtl:-scale-x-100" />
    </button>
  );
}
