import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";
import { BarChart3, GraduationCap, Image as ImageIcon, Megaphone, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useModalGuard } from "@/lib/ui-store";
import { filterStore } from "@/lib/filter-store";
import { searchDestinations, type SearchDestination } from "@/lib/global-search";
import { SEARCH_DESTINATIONS } from "@/lib/global-search-registry";

interface EntityResults {
  campaigns: { key: string; name: string; platform: string; course: string; spend: number }[];
  creatives: {
    id: string;
    name: string;
    campaign: string;
    platform: string;
    thumbnailUrl?: string;
  }[];
  courses: { name: string }[];
}

const EMPTY: EntityResults = { campaigns: [], creatives: [], courses: [] };
const RECENT_KEY = "engo_search_recent";
const RECENT_LIMIT = 5;

interface Row {
  key: string;
  label: string;
  meta?: string;
  icon: typeof Search;
  go: () => void;
}

/** What the reader opened last, so an empty search is still useful. */
function readRecent(): { label: string; route: string; search?: Record<string, string> }[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

/**
 * One place to look anything up.
 *
 * Simplifying the navigation moved reports one level deeper, so nothing may
 * become harder to find: this takes Arabic, English, Arabizi or a typo and
 * offers the report, the real campaign, the real creative or the course —
 * grouped, reports first, and every row opens the screen that answers it.
 */
export function GlobalSearch() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState<EntityResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useModalGuard(open);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Entity search waits for the typing to settle and drops stale answers, so a
  // fast typist never sees results for a query they have moved past.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setEntities(EMPTY);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : EMPTY))
        .then((data: EntityResults) => setEntities(data ?? EMPTY))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setEntities(EMPTY);
    }
    setActive(0);
  }, [open]);

  const remember = useCallback((label: string, route: string, search?: Record<string, string>) => {
    try {
      const next = [
        { label, route, search },
        ...readRecent().filter((entry) => entry.label !== label),
      ].slice(0, RECENT_LIMIT);
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // A reader in private mode simply gets no history.
    }
  }, []);

  const goTo = useCallback(
    (label: string, route: string, search?: Record<string, string>) => {
      remember(label, route, search);
      setOpen(false);
      void navigate({ to: route, search: (search ?? {}) as never });
    },
    [navigate, remember],
  );

  const reports = useMemo(
    () => (query.trim() ? searchDestinations(query, SEARCH_DESTINATIONS, 6) : []),
    [query],
  );

  const groups = useMemo(() => {
    const destinationRow = (item: SearchDestination): Row => ({
      key: `report:${item.id}`,
      label: A ? item.titleAr : item.title,
      meta: item.hint?.[lang],
      icon: BarChart3,
      go: () => goTo(A ? item.titleAr : item.title, item.route, item.search),
    });

    if (!query.trim()) {
      const recent = readRecent();
      const shortcuts = ["campaigns", "creatives", "sales-crm", "revenue"]
        .map((id) => SEARCH_DESTINATIONS.find((item) => item.id === id))
        .filter((item): item is SearchDestination => Boolean(item));
      return [
        recent.length
          ? {
              title: A ? "آخر ما فتحته" : "Recently opened",
              rows: recent.map((entry, index): Row => ({
                key: `recent:${index}`,
                label: entry.label,
                icon: Search,
                go: () => goTo(entry.label, entry.route, entry.search),
              })),
            }
          : null,
        { title: A ? "اختصارات" : "Shortcuts", rows: shortcuts.map(destinationRow) },
      ].filter(Boolean) as { title: string; rows: Row[] }[];
    }

    return [
      { title: A ? "التقارير" : "Reports", rows: reports.map((hit) => destinationRow(hit.item)) },
      {
        title: A ? "الحملات" : "Campaigns",
        rows: entities.campaigns.map((campaign): Row => ({
          key: `campaign:${campaign.key}`,
          label: campaign.name,
          meta: [campaign.platform, campaign.course].filter(Boolean).join(" · "),
          icon: Megaphone,
          go: () => goTo(campaign.name, "/campaigns", { campaign: campaign.key }),
        })),
      },
      {
        title: A ? "المواد الإعلانية" : "Creatives",
        rows: entities.creatives.map((creative): Row => ({
          key: `creative:${creative.id}`,
          label: creative.name,
          meta: creative.campaign,
          icon: ImageIcon,
          go: () =>
            goTo(creative.name, "/acquisition", {
              section: "ads",
              view: "creatives",
              creative: creative.id,
            }),
        })),
      },
      {
        title: A ? "الكورسات" : "Courses",
        rows: entities.courses.map((course): Row => ({
          key: `course:${course.name}`,
          label: course.name,
          icon: GraduationCap,
          go: () => goTo(course.name, "/courses", { course: course.name }),
        })),
      },
    ].filter((group) => group.rows.length > 0);
  }, [A, entities, goTo, lang, query, reports]);

  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);

  useEffect(() => {
    setActive((index) => (index >= rows.length ? 0 : index));
  }, [rows.length]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (rows.length ? (index + 1) % rows.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (rows.length ? (index - 1 + rows.length) % rows.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      rows[active]?.go();
    }
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const placeholder = A
    ? "ابحث عن تقرير أو حملة أو مادة إعلانية…"
    : "Search reports, campaigns, creatives…";
  let cursor = -1;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={A ? "بحث" : "Search"}
          title={`${A ? "بحث" : "Search"} (⌘K)`}
          className="inline-flex h-11 min-w-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-2.5 text-[13px] text-text-muted transition-colors hover:bg-surface-2 active:scale-[0.97] sm:h-9 md:min-w-[210px]"
        >
          <Search size={16} className="shrink-0" aria-hidden="true" />
          <span className="hidden truncate md:inline">{placeholder}</span>
          <kbd className="ms-auto hidden rounded border border-border px-1 text-[10px] lg:inline">
            ⌘K
          </kbd>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="nav-drawer-backdrop fixed inset-0 z-(--z-modal)" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed inset-x-0 top-0 z-(--z-modal) mx-auto flex max-h-[100dvh] w-full flex-col overflow-hidden border border-border bg-surface shadow-2xl sm:inset-x-auto sm:top-[8vh] sm:left-1/2 sm:max-h-[72dvh] sm:w-[min(40rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:rounded-2xl"
        >
          <Dialog.Title className="sr-only">{A ? "بحث" : "Search"}</Dialog.Title>
          <div
            className="flex items-center gap-2 border-b border-border px-3"
            style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
          >
            <Search size={18} className="shrink-0 text-text-subtle" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="min-h-12 min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none"
            />
            <Dialog.Close
              aria-label={A ? "إغلاق" : "Close"}
              className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg text-text-muted hover:bg-surface-2"
            >
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>

          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
          >
            {groups.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-text-muted">
                {loading
                  ? A
                    ? "جارِ البحث…"
                    : "Searching…"
                  : A
                    ? "لا نتائج. جرّب اسم حملة أو كلمة زي «تحصيل» أو «كرياتيف»."
                    : "Nothing found. Try a campaign name, or a word like “revenue” or “creative”."}
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.title} className="mb-1.5 last:mb-0">
                  <h3 className="px-2.5 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wide text-text-subtle">
                    {group.title}
                  </h3>
                  <ul>
                    {group.rows.map((row) => {
                      cursor += 1;
                      const index = cursor;
                      const Icon = row.icon;
                      return (
                        <li key={row.key}>
                          <button
                            type="button"
                            data-active={index === active}
                            onMouseEnter={() => setActive(index)}
                            onClick={row.go}
                            className={`flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-start transition-colors ${
                              index === active ? "bg-brand-soft text-brand" : "hover:bg-surface-2"
                            }`}
                          >
                            <Icon size={16} className="shrink-0 opacity-75" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13.5px] font-semibold">
                                {row.label}
                              </span>
                              {row.meta && (
                                <span className="block truncate text-[11px] text-text-muted">
                                  {row.meta}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
