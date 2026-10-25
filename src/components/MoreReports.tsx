import { Link, useLocation, useRouterState } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import {
  itemIsActive,
  itemLabel,
  NAVIGATION_SECTIONS,
  type LocationSearch,
} from "@/lib/navigation";

const MORE = NAVIGATION_SECTIONS.find((section) => section.id === "more")!;

export function useLocationSearch(): LocationSearch {
  return useRouterState({ select: (state) => state.location.search as LocationSearch });
}

/**
 * The specialist reports, as one list: name, one line of what it answers, and
 * the current one marked. Shared by the rail's More menu and the switcher a
 * More page shows instead of a long tab strip.
 */
export function MoreReportsList({ onNavigate }: { onNavigate?: () => void }) {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const search = useLocationSearch();

  return (
    <ul className="grid gap-0.5" role="list">
      {MORE.items.map((item, index) => {
        const active = itemIsActive(item, pathname, search);
        const Icon = item.icon;
        return (
          <li key={`${item.to}:${index}`}>
            <Link
              to={item.to}
              search={item.search as never}
              activeOptions={{ exact: true, includeSearch: true }}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-2.5 py-1.5 transition-colors ${
                active ? "bg-brand-soft text-brand" : "text-text hover:bg-surface-2"
              }`}
            >
              <Icon size={16} className="shrink-0 opacity-80" aria-hidden="true" />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[13px] font-semibold">
                  {itemLabel(item, lang, t)}
                </span>
                {item.description && (
                  <span className="block truncate text-[11px] text-text-muted">
                    {item.description[lang]}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
