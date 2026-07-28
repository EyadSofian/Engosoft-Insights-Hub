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

  if (!section || section.id === "overview") return null;

  const SectionIcon = section.icon;
  const label = section.label[lang];

  return (
    <nav
      aria-label={lang === "ar" ? `تقارير ${label}` : `${label} reports`}
      className="border-b border-border bg-surface/95"
    >
      <div className="mx-auto flex w-full max-w-[1600px] items-stretch gap-2 px-4 sm:px-6">
        <div className="hidden shrink-0 items-center gap-2 pe-3 text-sm font-semibold text-text sm:flex">
          <SectionIcon size={17} aria-hidden="true" />
          <span>{label}</span>
          <span className="h-5 w-px bg-border" aria-hidden="true" />
        </div>

        <div className="scrollbar-none flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto">
          {section.items.map((item) => {
            const active = pathMatchesRoute(pathname, item.to);
            const Icon = item.icon;

            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-12 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors duration-150 focus-visible:rounded-md ${
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
