import { useLayoutEffect, useRef } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { pathMatchesRoute, sectionForPathname } from "@/lib/navigation";

/**
 * Route-backed secondary navigation.
 *
 * Links keep browser history, deep links and keyboard behavior intact, while
 * the visual treatment gives the business-domain hierarchy a familiar tab
 * shape. A plain navigation landmark is intentionally used instead of ARIA
 * `tablist`: these controls navigate to separate pages rather than swapping
 * panels in-place.
 *
 * It sticks directly under the top bar and rides up with it: once the bar hides
 * the tabs park at the top of the viewport on their own, so the reader keeps
 * one line saying where they are while the rest of the chrome is gone.
 */
export function SectionTabs() {
  const { pathname } = useLocation();
  const { t, lang } = useI18n();
  const section = sectionForPathname(pathname);
  const ref = useRef<HTMLElement>(null);

  // Anything stacking below this strip — a page's own tab bar — needs its
  // height, and that height is zero on the pages and breakpoints where the
  // strip is not rendered at all.
  useLayoutEffect(() => {
    const element = ref.current;
    const root = document.documentElement;
    if (!element) {
      root.style.setProperty("--chrome-sections-h", "0px");
      return;
    }
    const sync = () =>
      root.style.setProperty(
        "--chrome-sections-h",
        // Hidden by the `lg:hidden` breakpoint rather than by React, so the
        // element exists with no box. offsetParent is the cheapest honest test.
        element.offsetParent === null ? "0px" : `${element.offsetHeight}px`,
      );
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      root.style.setProperty("--chrome-sections-h", "0px");
    };
  });

  if (!section || section.items.length < 2) return null;

  const SectionIcon = section.icon;
  const label = section.label[lang];

  return (
    <nav
      ref={ref}
      data-app-chrome=""
      aria-label={lang === "ar" ? `تقارير ${label}` : `${label} reports`}
      // Shown at every width, not only below `lg`. The rail auto-hides on the
      // first downward scroll, and it was taking the section's sub-navigation
      // with it — on a long report a desktop reader had no way back to a
      // sibling tab without scrolling up. A section with a single report still
      // renders nothing at all (see the guard above), so this costs a row only
      // where there is genuinely something to switch between.
      className="chrome-bar sticky z-20"
      style={{
        top: "var(--chrome-header-h, 0px)",
        transition: "top var(--dur-chrome) var(--ease-chrome)",
      }}
    >
      <div className="pad-safe-x [--pad-x:0.875rem] sm:[--pad-x:1.5rem] mx-auto flex w-full max-w-[1600px] items-stretch gap-2">
        {/* This label deliberately stays visible on desktop as well as mobile.
            Without it, three route links such as Leads / Lost / Team appear as
            unrelated buttons; the reader cannot tell they are all reports
            inside one CRM workspace. */}
        <div className="flex shrink-0 items-center gap-2 pe-2 text-sm font-semibold text-text sm:pe-3">
          <span className="grid size-7 place-items-center rounded-lg bg-brand-soft text-brand" aria-hidden="true">
            <SectionIcon size={15} />
          </span>
          <span className="hidden lg:inline">{label}</span>
          <span className="hidden text-[11px] font-medium text-text-subtle xl:inline">
            {lang === "ar" ? `${section.items.length} تبويبات` : `${section.items.length} tabs`}
          </span>
          <span className="h-6 w-px bg-border" aria-hidden="true" />
        </div>

        <div className="hscroll flex min-w-0 flex-1 items-stretch gap-1">
          {section.items.map((item) => {
            const active = pathMatchesRoute(pathname, item.to);
            const Icon = item.icon;

            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={`relative my-1.5 flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[13px] font-semibold transition-colors duration-150 sm:px-3 sm:text-sm ${
                  active
                    ? "border-brand bg-brand text-white shadow-sm"
                    : "border-transparent text-text-muted hover:border-border hover:bg-surface-2 hover:text-text"
                }`}
              >
                <Icon size={16} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                <span>{t(item.key)}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
