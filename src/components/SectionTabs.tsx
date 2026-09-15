import { useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { itemIsActive, itemLabel, sectionForLocation } from "@/lib/navigation";
import { MoreReportsList, useLocationSearch } from "./MoreReports";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * The one contextual navigation layer.
 *
 * A management workspace (Marketing, Sales & CRM, Revenue, Team) shows its
 * two to four reports as tabs. The specialist reports under More show a single
 * switcher naming the current report instead of a twelve-tab strip. A page
 * inside a workspace does not add a second switch of its own: anything deeper
 * is a breadcrumb, a dropdown or a drawer.
 *
 * Route-backed secondary navigation.
 *
 * Links keep browser history, deep links and keyboard behavior intact, while
 * the visual treatment gives the business-domain hierarchy a familiar tab
 * shape. A plain navigation landmark is intentionally used instead of ARIA
 * `tablist`: these controls navigate to separate pages rather than swapping
 * panels in-place.
 *
 * It sticks directly under the top bar. When the bar slides away on a downward
 * scroll the strip follows it up on the same transform (`chrome-follow`) and
 * parks at the top of the viewport, so the reader keeps one line saying where
 * they are while the rest of the chrome is gone.
 */
export function SectionTabs() {
  const { pathname } = useLocation();
  const search = useLocationSearch();
  const { t, lang } = useI18n();
  const section = sectionForLocation(pathname, search);
  const ref = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  if (!section || section.contextual === "none" || section.items.length < 2) return null;

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
      className="chrome-bar chrome-follow sticky z-(--z-sticky)"
      style={{ top: "var(--chrome-header-h, 0px)" }}
    >
      <div className="pad-safe-x [--pad-x:0.875rem] sm:[--pad-x:1.5rem] mx-auto flex w-full max-w-[1600px] items-stretch gap-2">
        {/* The section's own name, at EVERY width — phone included.
            Without it, three route links such as Leads / Lost / Team read as
            unrelated buttons: the reader cannot tell they are three reports
            inside one CRM workspace, and on a phone, where the rail is gone,
            this line is the only thing left saying which section they are in.
            It shrinks (the name truncates, the tab count drops below `sm`)
            but it never disappears. */}
        <div className="flex min-w-0 max-w-[45%] shrink items-center gap-2 pe-2 text-sm font-semibold text-text sm:max-w-none sm:shrink-0 sm:pe-3">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"
            aria-hidden="true"
          >
            <SectionIcon size={15} />
          </span>
          <span className="truncate text-[12.5px] sm:text-sm">{label}</span>
          <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
        </div>

        {section.contextual === "menu" ? (
          <div className="flex min-w-0 flex-1 items-center py-1.5">
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex min-h-10 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-semibold text-text transition-colors hover:bg-surface-2 sm:text-sm"
                  aria-label={lang === "ar" ? "اختيار تقرير آخر" : "Switch report"}
                >
                  {(() => {
                    const current = section.items.find((item) =>
                      itemIsActive(item, pathname, search),
                    );
                    const Icon = current?.icon;
                    return (
                      <>
                        {Icon && (
                          <Icon size={15} className="shrink-0 text-brand" aria-hidden="true" />
                        )}
                        <span className="truncate">
                          {current ? itemLabel(current, lang, t) : section.label[lang]}
                        </span>
                      </>
                    );
                  })()}
                  <ChevronDown size={15} className="shrink-0 text-text-muted" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[min(20rem,calc(100vw-2rem))] max-h-[70dvh] overflow-y-auto rounded-xl p-2"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <MoreReportsList onNavigate={() => setMenuOpen(false)} />
              </PopoverContent>
            </Popover>
          </div>
        ) : (
          <>
            <div className="hscroll hidden min-w-0 flex-1 items-stretch gap-1 sm:flex">
              {section.items.map((item, index) => {
                const active = itemIsActive(item, pathname, search);
                const Icon = item.icon;

                return (
                  <Link
                    key={`${item.to}:${index}`}
                    to={item.to}
                    search={item.search as never}
                    activeOptions={{ exact: true, includeSearch: true }}
                    aria-current={active ? "page" : undefined}
                    className={`relative my-1.5 flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 text-[13px] font-semibold transition-colors duration-150 sm:px-3 sm:text-sm ${
                      active
                        ? "border-brand bg-brand text-white shadow-sm"
                        : "border-border bg-surface text-text-muted hover:bg-surface-2 hover:text-text"
                    }`}
                  >
                    <Icon size={16} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                    <span>{itemLabel(item, lang, t)}</span>
                  </Link>
                );
              })}
            </div>

            <div className="flex min-w-0 flex-1 items-center py-1.5 sm:hidden">
              <Popover open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex min-h-10 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-semibold text-text"
                    aria-label={lang === "ar" ? "تغيير مساحة العمل" : "Switch workspace"}
                  >
                    {(() => {
                      const current = section.items.find((item) =>
                        itemIsActive(item, pathname, search),
                      );
                      const Icon = current?.icon;
                      return (
                        <>
                          {Icon && (
                            <Icon size={15} className="shrink-0 text-brand" aria-hidden="true" />
                          )}
                          <span className="truncate">
                            {current ? itemLabel(current, lang, t) : section.label[lang]}
                          </span>
                        </>
                      );
                    })()}
                    <ChevronDown
                      size={15}
                      className="shrink-0 text-text-muted"
                      aria-hidden="true"
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[min(20rem,calc(100vw-2rem))] rounded-xl p-2"
                  style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                >
                  <div className="grid gap-1">
                    {section.items.map((item, index) => {
                      const active = itemIsActive(item, pathname, search);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={`${item.to}:mobile:${index}`}
                          to={item.to}
                          search={item.search as never}
                          activeOptions={{ exact: true, includeSearch: true }}
                          aria-current={active ? "page" : undefined}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ${
                            active
                              ? "bg-brand text-white"
                              : "text-text-muted hover:bg-surface-2 hover:text-text"
                          }`}
                        >
                          <Icon size={16} aria-hidden="true" />
                          <span>{itemLabel(item, lang, t)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
