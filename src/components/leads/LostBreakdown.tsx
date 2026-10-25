import { useMemo, useState } from "react";
import { Download, Search, SlidersHorizontal, TrendingDown } from "lucide-react";
import { PageSection } from "@/components/dashboard-bits";
import { exportCsv } from "@/lib/csv";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import type { PerformanceGroup } from "@/lib/lead-performance";

export type LostDimension = "course" | "platform" | "source" | "owner" | "buyer";
type SortKey = "lost" | "rate" | "leads" | "name";

const copy = {
  ar: {
    title: "تفصيل المفقود حسب الفلتر",
    hint: "مجموعة شهر الدخول المختارة وحالتها الحالية في أودو؛ النسبة من سجلات كل مجموعة.",
    eyebrow: "قراءة سريعة للمجموعة المختارة",
    entryMonth: "شهر الدخول",
    headline: "سجلات أصبحت مفقودة",
    ofEntries: "من إجمالي سجلات CRM الجديدة",
    lostLeads: "ليدز مفقودة",
    lostOpportunities: "فرص بيعية مفقودة",
    formula: "ليدز مفقودة + فرص مفقودة = إجمالي المفقود. لا تجمع الأسباب مرة ثانية.",
    search: "ابحث داخل التقسيم الحالي…",
    export: "تصدير CSV",
    groups: "مجموعة",
    sortedBy: "ترتيب حسب",
    sortLost: "الأكثر فقدانًا",
    sortRate: "أعلى نسبة فقدان",
    sortLeads: "أكثر سجلات دخلت",
    sortName: "الاسم",
    newRecords: "سجل CRM جديد",
    lostNow: "مفقود الآن",
    reasons: "أسباب مسجلة ضمن المفقود",
    noAnswer: "لا يرد",
    unreachable: "تعذر الوصول",
    noInterest: "غير مهتم",
    rateBasis: "نسبة الفقدان من سجلات هذا الصف",
    more: "عرض بقية المجموعات",
    less: "عرض مجموعات أقل",
    empty: "لا توجد مجموعات تطابق البحث في هذا التقسيم.",
    unattributed: "غير منسوب",
  },
  en: {
    title: "Lost breakdown by filter",
    hint: "Selected entry-month cohort and its current Odoo status; each rate uses that group's records.",
    eyebrow: "Selected cohort at a glance",
    entryMonth: "Entry month",
    headline: "Records currently lost",
    ofEntries: "of all new CRM records",
    lostLeads: "Lost leads",
    lostOpportunities: "Lost opportunities",
    formula: "Lost leads + lost opportunities = total lost. Do not add reasons again.",
    search: "Search this breakdown…",
    export: "Export CSV",
    groups: "groups",
    sortedBy: "Sort by",
    sortLost: "Most lost",
    sortRate: "Highest lost rate",
    sortLeads: "Most new records",
    sortName: "Name",
    newRecords: "new CRM records",
    lostNow: "lost now",
    reasons: "Recorded reasons within Lost",
    noAnswer: "No answer",
    unreachable: "Unreachable",
    noInterest: "Not interested",
    rateBasis: "Lost rate of this group's records",
    more: "Show remaining groups",
    less: "Show fewer groups",
    empty: "No groups match this search.",
    unattributed: "Unattributed",
  },
} as const;

/** Only presentation changes here; these are the same cohort aggregates as the CSV and old table. */
export function LostBreakdown({
  cohort,
  rows,
  dimensions,
  dimension,
  onDimensionChange,
  month,
}: {
  cohort: PerformanceGroup;
  rows: PerformanceGroup[];
  dimensions: { id: LostDimension; label: string }[];
  dimension: LostDimension;
  onDimensionChange: (value: LostDimension) => void;
  month: string;
}) {
  const { lang } = useI18n();
  const t = copy[lang];
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("lost");
  const [expanded, setExpanded] = useState(false);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const out = rows.filter((row) =>
      needle
        ? (row.name === "—" ? t.unattributed : row.name).toLocaleLowerCase().includes(needle)
        : true,
    );
    return [...out].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, lang);
      const aValue = sort === "rate" ? (a.lostRate ?? -1) : sort === "leads" ? a.leads : a.lost;
      const bValue = sort === "rate" ? (b.lostRate ?? -1) : sort === "leads" ? b.leads : b.lost;
      return bValue - aValue || a.name.localeCompare(b.name, lang);
    });
  }, [rows, query, sort, lang, t.unattributed]);
  const visible = expanded || query ? filtered : filtered.slice(0, 12);
  const rate = cohort.leads ? (cohort.lost / cohort.leads) * 100 : null;

  return (
    <PageSection
      title={t.title}
      hint={t.hint}
      icon={<TrendingDown size={16} />}
      tone="rose"
      id="performance-lost-breakdown"
    >
      <div className="overflow-hidden rounded-[26px] border border-border bg-surface shadow-[0_12px_40px_-28px_rgba(8,31,58,.45)]">
        <div className="relative overflow-hidden bg-[#10243d] px-5 py-6 text-white sm:px-7 sm:py-7">
          <div
            className="pointer-events-none absolute -end-20 -top-28 size-72 rounded-full bg-[#e76369]/15 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)] lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-[11px] font-bold tracking-[0.12em] text-[#ffadb4]">
                  {t.eyebrow}
                </p>
                <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-medium text-white/70">
                  {t.entryMonth} <bdi className="num text-white">{month}</bdi>
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong className="num text-5xl font-black tracking-[-0.06em] sm:text-6xl">
                  {fmtNum(cohort.lost)}
                </strong>
                <span className="text-base font-semibold text-white/85">{t.headline}</span>
              </div>
              <p className="mt-2 text-sm text-white/65">
                <bdi className="num font-bold text-white">
                  {rate === null ? "—" : fmtPct(rate, 1)}
                </bdi>{" "}
                {t.ofEntries} · <bdi className="num">{fmtNum(cohort.leads)}</bdi>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-3.5 sm:p-4">
                <span className="block text-xs text-white/70">{t.lostLeads}</span>
                <strong className="num mt-1 block text-[29px] font-bold leading-none text-[#ffb8bd]">
                  {fmtNum(cohort.lostLeads)}
                </strong>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-3.5 sm:p-4">
                <span className="block text-xs text-white/70">{t.lostOpportunities}</span>
                <strong className="num mt-1 block text-[29px] font-bold leading-none text-[#c6b5ff]">
                  {fmtNum(cohort.lostOpportunities)}
                </strong>
              </div>
            </div>
          </div>
          <p className="relative mt-5 border-t border-white/10 pt-3 text-[11.5px] text-white/65">
            {t.formula}
          </p>
        </div>

        <div className="border-b border-border bg-surface-2/60 px-4 pb-4 pt-4 sm:px-6">
          <div
            className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface p-1.5"
            role="group"
            aria-label={t.title}
          >
            {dimensions.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={dimension === item.id}
                onClick={() => {
                  onDimensionChange(item.id);
                  setQuery("");
                  setExpanded(false);
                }}
                className={`min-h-10 shrink-0 rounded-xl px-3.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-1 ${dimension === item.id ? "bg-[#10243d] text-white shadow-sm" : "text-text-muted hover:bg-surface-2 hover:text-text"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <label className="flex min-h-11 min-w-[190px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15 sm:max-w-sm">
              <Search size={17} className="shrink-0 text-text-subtle" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.search}
                aria-label={t.search}
                className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-subtle"
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-text-muted">
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span className="sr-only">{t.sortedBy}</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                aria-label={t.sortedBy}
                className="max-w-[145px] bg-transparent text-[12.5px] font-semibold text-text outline-none"
              >
                <option value="lost">{t.sortLost}</option>
                <option value="rate">{t.sortRate}</option>
                <option value="leads">{t.sortLeads}</option>
                <option value="name">{t.sortName}</option>
              </select>
            </label>
            <span className="num text-xs font-medium text-text-muted">
              {fmtNum(filtered.length)} {t.groups}
            </span>
            <button
              type="button"
              onClick={() =>
                exportCsv(
                  filtered,
                  (row) => ({
                    name: row.name,
                    leads: row.leads,
                    lostLeads: row.lostLeads,
                    lostOpportunities: row.lostOpportunities,
                    lost: row.lost,
                    lostRate: row.lostRate ?? "",
                    noAnswer: row.noAnswer,
                    unreachable: row.unreachable,
                    noInterest: row.noInterest,
                  }),
                  `engosoft-lost-${dimension}-${month}`,
                )
              }
              disabled={!filtered.length}
              className="ms-auto inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-[12.5px] font-semibold text-text transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Download size={16} aria-hidden="true" />
              {t.export}
            </button>
          </div>
        </div>

        {visible.length ? (
          <div className="grid gap-3 bg-surface-2/35 p-3 sm:p-5 xl:grid-cols-2">
            {visible.map((row, index) => {
              const leadWidth = row.leads ? Math.min(100, (row.lostLeads / row.leads) * 100) : 0;
              const oppWidth = row.leads
                ? Math.min(100 - leadWidth, (row.lostOpportunities / row.leads) * 100)
                : 0;
              return (
                <article
                  key={row.name}
                  className="min-w-0 rounded-[20px] border border-border bg-surface p-4 shadow-[0_5px_18px_-14px_rgba(10,30,55,.45)] transition-shadow hover:shadow-[0_12px_26px_-17px_rgba(10,30,55,.45)] sm:p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="num grid size-8 shrink-0 place-items-center rounded-xl bg-rose-surface text-[11px] font-bold text-rose-ink">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3 className="min-w-0 break-words text-[16px] font-bold leading-tight text-text">
                        {row.name === "—" ? t.unattributed : row.name}
                      </h3>
                    </div>
                    <div className="shrink-0 text-end">
                      <strong className="num block text-[25px] font-black leading-none tracking-[-0.04em] text-rose-ink">
                        {row.lostRate === null ? "—" : fmtPct(row.lostRate, 1)}
                      </strong>
                      <span className="mt-1 block text-[10px] text-text-muted">{t.rateBasis}</span>
                    </div>
                  </div>
                  <div className="mt-4 flex items-baseline gap-1.5 text-[12px] text-text-muted">
                    <bdi className="num text-lg font-bold text-text">{fmtNum(row.lost)}</bdi>{" "}
                    {t.lostNow}
                    <span className="mx-1 text-border-strong">/</span>
                    <bdi className="num font-semibold text-text">{fmtNum(row.leads)}</bdi>{" "}
                    {t.newRecords}
                  </div>
                  <div
                    className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-surface-3"
                    role="img"
                    aria-label={`${t.lostNow}: ${fmtNum(row.lost)} / ${fmtNum(row.leads)}`}
                  >
                    <span className="h-full bg-rose-strong" style={{ width: `${leadWidth}%` }} />
                    <span className="h-full bg-violet-strong" style={{ width: `${oppWidth}%` }} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-rose-surface px-3 py-2 text-rose-ink">
                      <span className="text-[11.5px] font-semibold">{t.lostLeads}</span>
                      <bdi className="num text-base font-bold">{fmtNum(row.lostLeads)}</bdi>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-violet-surface px-3 py-2 text-violet-ink">
                      <span className="text-[11.5px] font-semibold">{t.lostOpportunities}</span>
                      <bdi className="num text-base font-bold">{fmtNum(row.lostOpportunities)}</bdi>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-border pt-2.5">
                    <p className="text-[10.5px] font-semibold text-text-muted">{t.reasons}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
                      <span>
                        {t.noAnswer}{" "}
                        <bdi className="num font-bold text-text">{fmtNum(row.noAnswer)}</bdi>
                      </span>
                      <span>
                        {t.unreachable}{" "}
                        <bdi className="num font-bold text-text">{fmtNum(row.unreachable)}</bdi>
                      </span>
                      <span>
                        {t.noInterest}{" "}
                        <bdi className="num font-bold text-text">{fmtNum(row.noInterest)}</bdi>
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-text-muted">{t.empty}</p>
        )}
        {!query && filtered.length > 12 && (
          <div className="border-t border-border bg-surface px-4 py-3 text-center">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="min-h-10 rounded-xl px-4 text-sm font-bold text-brand hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"
            >
              {expanded ? t.less : `${t.more} (${fmtNum(filtered.length - 12)})`}
            </button>
          </div>
        )}
      </div>
    </PageSection>
  );
}
