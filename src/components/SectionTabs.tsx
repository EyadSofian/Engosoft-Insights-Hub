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
 */
export function SectionTabs() {
  const { pathname } = useLocation();
  const { t, lang } = useI18n();
  const section = sectionForPathname(pathname);

  if (!section || section.items.length < 2) return null;

  const SectionIcon = section.icon;
  const label = section.label[lang];

  return (
    <nav
      aria-label={lang === "ar" ? `تقارير ${label}` : `${label} reports`}
      // A section with a single report has nothing to switch between, so on a
      // phone the row is 70px of pure chrome — the bottom nav already says
      // which section is open. It stays from `sm` up, where it costs nothing.
      className="border-b border-border bg-surface/95 lg:hidden"
    >
      <div className="pad-safe-x [--pad-x:0.875rem] sm:[--pad-x:1.5rem] mx-auto flex w-full max-w-[1600px] items-stretch gap-2">
        <div className="hidden shrink-0 items-center gap-2 pe-3 text-sm font-semibold text-text sm:flex">
          <SectionIcon size={17} aria-hidden="true" />
          <span>{label}</span>
          <span className="h-5 w-px bg-border" aria-hidden="true" />
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
                className={`relative flex min-h-11 shrink-0 items-center gap-2 px-2.5 text-[13px] transition-colors duration-150 focus-visible:rounded-md sm:min-h-12 sm:px-3 sm:text-sm font-medium ${
                  active ? "text-brand" : "text-text-muted hover:text-text"
                }`}
              >
                <Icon size={16} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                <span>{t(item.key)}</span>
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-opacity duration-150 ${
                    active ? "bg-brand opacity-100" : "opacity-0"
                  }`}
                />
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
