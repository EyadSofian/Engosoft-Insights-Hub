import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Sigma,
  Sparkles,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useFilters, usePreset } from "@/lib/filter-store";
import { toneOf, toneVars, type AnyTone } from "@/lib/dashboard-tone";
import { scopeChips, type MetricBreakdownGroup, type MetricDetail } from "@/lib/metric-detail";
import { contextualQuestions, elementManifest } from "@/lib/nexus-surface-registry";
import { getNexusView, updateNexusView } from "./engo-nexus/state/nexus-view-context";
import { nexusStore } from "./engo-nexus/state/nexus-store";
import { DetailPanel } from "./DetailPanel";
import { MultiLineChart } from "./charts";
import { DeltaBadge, KpiCard } from "./ui-bits";
import { InsightCard } from "./dashboard-bits";
import { MetricCard } from "./ads/MetricCard";

/* ---------------------------------------------------------------------------
   THE METRIC DRILL-DOWN

   One system, used by every headline figure on every page. Pressing a KPI card
   opens the same eight-part answer in the same order, so a reader learns the
   shape once: what it is, over what window, under which filters, how it moved,
   what it is made of, what explains it, which rows produced it, and where to go
   next.

   IT OPENS OVER THE PAGE, IT DOES NOT NAVIGATE. A click that jumps to another
   route loses the period, the filters and the scroll position — and answers a
   question the reader had not asked yet. The full report stays one deliberate
   press away, inside the panel.

   The shell is `DetailPanel`, which is already the app's one drill-down surface:
   a side panel from the inline end on a desktop (so it never lands on the
   navigation rail, in either direction) and a full-height drawer on a phone. No
   second modal library, and no second set of focus and escape behaviour to keep
   in step.
--------------------------------------------------------------------------- */

/* --- header --------------------------------------------------------------- */

/**
 * The figure, restated in the panel's own voice.
 *
 * Same icon, same family, same value as the card that was pressed — a reader
 * who clicked the wrong card has to be able to see that in one glance, before
 * reading a word.
 */
export function MetricDetailHeader({
  title,
  value,
  tone,
  icon,
  delta,
  deltaInvert,
  period,
}: {
  title: string;
  value: ReactNode;
  tone?: AnyTone;
  icon?: ReactNode;
  delta?: number;
  deltaInvert?: boolean;
  period?: string;
}) {
  const t = toneOf(tone);
  return (
    <div
      className="tone-surface flex items-start gap-3 rounded-2xl p-3.5"
      style={toneVars(tone)}
      data-testid="metric-detail-header"
    >
      {icon && (
        <span
          className="grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-sm"
          style={{ background: t.strong }}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold" style={{ color: t.ink, opacity: 0.78 }}>
          {title}
        </div>
        <div
          className="num mt-1 text-[26px] font-bold leading-none tracking-[-0.03em]"
          style={{ color: t.ink }}
        >
          {value}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <DeltaBadge value={delta} invert={deltaInvert} />
          {period && (
            <span className="text-[11px]" style={{ color: t.ink, opacity: 0.7 }}>
              {period}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- scope ---------------------------------------------------------------- */

/**
 * Everything currently narrowing this figure — read from the filter store, not
 * described from memory.
 *
 * The commonest way a dashboard misleads is a figure that is correct for a
 * scope the reader has forgotten is on. This is the fix, and it costs four
 * lines of small type.
 */
export function MetricFiltersSummary({
  extra,
}: {
  extra?: { key: string; label: string; value: string }[];
}) {
  const { lang } = useI18n();
  const filters = useFilters();
  const preset = usePreset();
  const chips = scopeChips(filters, preset, lang, extra ?? []);

  return (
    <dl
      className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-xl border border-border bg-surface-2/70 px-3 py-2.5"
      data-testid="metric-scope"
    >
      {chips.map((chip) => (
        <div key={chip.key} className="flex min-w-0 items-baseline gap-1.5">
          <dt className="text-[10.5px] font-semibold text-text-subtle">{chip.label}:</dt>
          <dd className="text-[11.5px] font-medium text-text">
            <bdi>{chip.value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* --- definition ----------------------------------------------------------- */

/**
 * What the number is, in one sentence a sales manager would use.
 *
 * The arithmetic sits behind a control rather than in the sentence: "collected
 * revenue ÷ ad spend" helps whoever is checking the figure and stops everyone
 * else reading the definition at all.
 */
export function MetricDefinition({
  definition,
  formula,
  caveat,
}: {
  definition: string;
  formula?: string;
  caveat?: string;
}) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <section data-testid="metric-definition">
      <SectionLabel>{lang === "ar" ? "ما هذا الرقم؟" : "What is this?"}</SectionLabel>
      <p className="text-[13px] leading-relaxed text-text">{definition}</p>
      {formula && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={id}
            className="mt-2 inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-semibold text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Sigma size={12} aria-hidden="true" />
            {lang === "ar" ? "طريقة الحساب" : "How it is calculated"}
          </button>
          {open && (
            <p
              id={id}
              className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-[11.5px] leading-relaxed text-text-muted"
            >
              <bdi>{formula}</bdi>
            </p>
          )}
        </>
      )}
      {caveat && (
        <p
          className="mt-2 rounded-xl px-3 py-2 text-[11.5px] leading-relaxed"
          style={{ background: "var(--amber-surface)", color: "var(--amber-ink)" }}
        >
          {caveat}
        </p>
      )}
    </section>
  );
}

/* --- trend ---------------------------------------------------------------- */

/**
 * The shape of the figure over the selected window.
 *
 * Drawn only from a series the response actually carried, and only from two
 * points up: one point is a value, not a trend, and a straight line drawn
 * through a single reading is a claim the data never made. When there is no
 * series the section says so instead of drawing a flat line.
 */
export function MetricTrendSection({
  trend,
  tone,
}: {
  trend: MetricDetail["trend"];
  tone?: AnyTone;
}) {
  const { lang } = useI18n();
  if (!trend) return null;
  const t = toneOf(tone);
  const points = trend.points.filter((point) => Number.isFinite(point.value));

  return (
    <section data-testid="metric-trend">
      <SectionLabel>{trend.label}</SectionLabel>
      {points.length < 2 ? (
        <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[11.5px] leading-relaxed text-text-muted">
          {trend.emptyLabel ??
            (lang === "ar"
              ? "لا توجد سلسلة زمنية كافية لهذه الفترة، ولن يُرسم خط لا تدعمه البيانات."
              : "This period carries no series long enough to plot, and no line is drawn that the data does not support.")}
        </p>
      ) : (
        <MultiLineChart
          data={points.map((point) => ({ date: point.date, value: point.value }))}
          height={190}
          format={trend.format}
          series={[{ key: "value", name: trend.label, color: trend.color ?? t.strong }]}
        />
      )}
      {trend.previous && (
        <p className="mt-1.5 text-[11px] text-text-muted">
          {trend.previous.label}:{" "}
          <span className="num font-semibold text-text">{trend.previous.value}</span>
        </p>
      )}
    </section>
  );
}

/* --- breakdown ------------------------------------------------------------ */

/**
 * What the figure is made of, five rows at a time.
 *
 * Five, then a link — a drill-down that renders the whole table is the table,
 * and the reader already had one of those. The bar is proportional to the
 * largest row shown so the shape of the distribution is readable without
 * anybody doing division in their head.
 */
export function MetricBreakdown({ group }: { group: MetricBreakdownGroup }) {
  const { lang } = useI18n();
  const rows = group.rows;
  const peak = group.max ?? Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <section data-testid={`metric-breakdown-${group.id}`}>
      <SectionLabel hint={group.hint}>{group.title}</SectionLabel>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[11.5px] text-text-muted">
          {group.emptyLabel ??
            (lang === "ar" ? "لا توجد بيانات في هذه الفترة" : "Nothing in this period")}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const t = toneOf(row.tone ?? "sky");
            return (
              <li key={row.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[12.5px] text-text" title={row.label}>
                    {row.label}
                  </span>
                  <span className="num shrink-0 text-[12.5px] font-semibold text-text">
                    {row.display}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, (Math.abs(row.value) / peak) * 100)}%`,
                        background: t.strong,
                      }}
                    />
                  </div>
                  {row.meta && (
                    <span className="num shrink-0 text-[10.5px] text-text-muted">{row.meta}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {group.moreTo && (
        <Link
          to={group.moreTo}
          search={group.moreSearch as never}
          className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-bold text-brand hover:underline"
        >
          {group.moreLabel ?? (lang === "ar" ? "عرض الكل" : "View all")}
          {lang === "ar" ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
        </Link>
      )}
    </section>
  );
}

/* --- records -------------------------------------------------------------- */

/**
 * The rows that actually produced the figure.
 *
 * At most five, never a table: a scrolling grid inside a 560px panel is a worse
 * version of the report it is standing in front of. A row links out only when
 * the page handed over a real record id.
 */
export function MetricRecords({ records }: { records: NonNullable<MetricDetail["records"]> }) {
  const { lang } = useI18n();
  return (
    <section data-testid="metric-records">
      <SectionLabel hint={records.hint}>{records.title}</SectionLabel>
      {records.rows.length === 0 ? (
        <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[11.5px] text-text-muted">
          {records.emptyLabel ??
            (lang === "ar" ? "لا توجد سجلات في هذه الفترة" : "No records in this period")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {records.rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-medium text-text" title={row.title}>
                    {row.title}
                  </span>
                  {row.href && (
                    <a
                      href={row.href}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-text-subtle transition-colors hover:text-brand"
                      aria-label={lang === "ar" ? `فتح ${row.title}` : `Open ${row.title}`}
                    >
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  )}
                </div>
                {row.subtitle && (
                  <div className="mt-0.5 truncate text-[10.5px] text-text-muted">
                    {row.subtitle}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-end">
                {row.value && (
                  <div className="num text-[12.5px] font-semibold text-text">{row.value}</div>
                )}
                {row.meta && <div className="text-[10px] text-text-muted">{row.meta}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --- supporting numbers --------------------------------------------------- */

function MetricSupporting({ facts }: { facts: NonNullable<MetricDetail["supporting"]> }) {
  const { lang } = useI18n();
  return (
    <section data-testid="metric-supporting">
      <SectionLabel>{lang === "ar" ? "أرقام تفسّر الرقم" : "Numbers behind it"}</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        {facts.map((fact) => (
          <div key={fact.key} className="rounded-xl border border-border bg-surface-2/60 px-3 py-2">
            <div className="text-[10px] font-semibold text-text-subtle">{fact.label}</div>
            <div className="num mt-0.5 text-[14px] font-bold text-text">{fact.value}</div>
            {fact.hint && <div className="mt-0.5 text-[10px] text-text-muted">{fact.hint}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

/* --- Nexus ---------------------------------------------------------------- */

/**
 * "Ask Nexus about this number."
 *
 * Hands the assistant the identity of what the reader is looking at — element
 * id, entity, and whatever period and filters are live — and opens the existing
 * panel through the existing store. No second assistant instance, no figures in
 * the message: Nexus fetches the value itself, against the same contract every
 * other surface uses.
 */
export function MetricNexusAction({
  elementId,
  entity,
  onOpened,
}: {
  elementId: string;
  entity?: MetricDetail["entity"];
  onOpened?: () => void;
}) {
  const { lang } = useI18n();
  const manifest = elementManifest(elementId);
  // The surface the reader is on, as the page itself declared it — not a
  // hard-coded id, so a metric that lives on three pages offers each page's
  // own fallback questions when the registry has none of its own.
  const questions = contextualQuestions(
    getNexusView().surface ?? "",
    manifest ? elementId : null,
    lang,
  );

  const ask = useCallback(
    (prompt?: string) => {
      updateNexusView({
        focusedElementId: elementId,
        ...(entity ? { selectedEntity: entity } : {}),
      });
      nexusStore.open(prompt);
      onOpened?.();
    },
    [elementId, entity, onOpened],
  );

  return (
    <section data-testid="metric-nexus">
      <button
        type="button"
        onClick={() => ask()}
        data-testid={`metric-ask-nexus-${elementId}`}
        className="inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90"
        style={{ background: "var(--brand)" }}
      >
        <Sparkles size={14} aria-hidden="true" />
        {lang === "ar" ? "اسأل Nexus عن هذا الرقم" : "Ask Nexus about this number"}
      </button>
      {questions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {questions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => ask(question)}
              className="cursor-pointer rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-muted transition-colors hover:border-brand hover:text-brand"
            >
              {question}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* --- the sheet ------------------------------------------------------------ */

function SectionLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-subtle">
        {children}
      </h3>
      {hint && <p className="mt-0.5 text-[10.5px] leading-snug text-text-muted">{hint}</p>}
    </div>
  );
}

/**
 * The eight parts, always in this order.
 *
 * Order is the contract: a reader who has opened one of these knows where the
 * definition is on every other page. Sections with nothing behind them are
 * omitted rather than rendered empty — an empty "Breakdown by campaign" says
 * the app is broken, when what is true is that nothing ran.
 */
export function MetricDetailSheet({
  detail,
  open,
  onClose,
  scopeExtra,
}: {
  detail: MetricDetail;
  open: boolean;
  onClose: () => void;
  scopeExtra?: { key: string; label: string; value: string }[];
}) {
  const { lang } = useI18n();
  const filters = useFilters();
  const preset = usePreset();
  const period = scopeChips(filters, preset, lang)[0]?.value;
  const breakdowns = (detail.breakdowns ?? []).filter(
    (group) => group.rows.length > 0 || group.moreTo,
  );

  return (
    <DetailPanel
      open={open}
      onClose={onClose}
      title={detail.title}
      subtitle={
        lang === "ar" ? "تفاصيل المؤشر ومصدره" : "What the figure is, and where it comes from"
      }
      width="min(620px, 100vw)"
      footer={
        detail.report ? (
          <Link
            to={detail.report.to}
            search={detail.report.search as never}
            onClick={onClose}
            data-testid="metric-open-report"
            className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-[12.5px] font-bold text-text transition-colors hover:bg-surface-2"
          >
            {detail.report.label}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <MetricDetailHeader
          title={detail.title}
          value={detail.value}
          tone={detail.tone}
          icon={detail.icon}
          delta={detail.delta}
          deltaInvert={detail.deltaInvert}
          period={period}
        />

        <MetricFiltersSummary extra={scopeExtra} />

        <MetricDefinition
          definition={detail.definition}
          formula={detail.formula}
          caveat={detail.caveat}
        />

        {detail.trend && <MetricTrendSection trend={detail.trend} tone={detail.tone} />}

        {detail.supporting && detail.supporting.length > 0 && (
          <MetricSupporting facts={detail.supporting} />
        )}

        {breakdowns.map((group) => (
          <MetricBreakdown key={group.id} group={group} />
        ))}

        {detail.records && <MetricRecords records={detail.records} />}

        <MetricNexusAction elementId={detail.id} entity={detail.entity} onOpened={onClose} />
      </div>
    </DetailPanel>
  );
}

/* --- trigger -------------------------------------------------------------- */

/**
 * The wiring every drill-down trigger shares.
 *
 * One place owns: recording the element for Nexus on hover and focus, the open
 * state, the "ask Nexus" chip, the panel, and putting the keyboard back on the
 * card afterwards. Two card shapes use it — the tonal `KpiCard` most reports
 * carry, and the advertising `MetricCard` with its glossary and verdict — and
 * neither has to re-implement any of that.
 */
export function MetricTriggerShell({
  detail,
  scopeExtra,
  className = "",
  children,
}: {
  detail: MetricDetail;
  scopeExtra?: { key: string; label: string; value: string }[];
  className?: string;
  children: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const manifest = elementManifest(detail.id);

  const focus = useCallback(() => {
    updateNexusView({
      focusedElementId: detail.id,
      ...(detail.entity ? { selectedEntity: detail.entity } : {}),
    });
  }, [detail.id, detail.entity]);

  /**
   * Put the keyboard back on the card that was opened.
   *
   * Radix restores focus to whatever held it before the panel opened, which is
   * the card — but only in a browser that focuses a button when it is clicked,
   * and Safari on macOS does not. Returning focus explicitly makes the promise
   * hold everywhere, and is queued so it lands after Radix has had its turn.
   */
  const close = useCallback(() => {
    setOpen(false);
    const card =
      host.current?.querySelector<HTMLElement>("[data-metric-trigger]") ??
      // A page that wraps a card shape of its own still gets the keyboard back:
      // whatever control opened the panel is the first focusable thing inside.
      host.current?.querySelector<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])");
    if (card) requestAnimationFrame(() => card.focus());
  }, []);

  return (
    <div
      ref={host}
      className={`group/nexus relative h-full ${className}`}
      onMouseEnter={focus}
      onFocusCapture={focus}
      data-nexus-element={detail.id}
    >
      {children(() => setOpen(true))}
      {manifest && (
        <button
          type="button"
          onClick={() => {
            focus();
            nexusStore.open();
          }}
          aria-label={`اسأل Nexus عن ${manifest.title.ar}`}
          title="اسأل Nexus"
          className="absolute end-1 top-1 hidden rounded-md border border-border bg-surface p-1 text-text-muted opacity-0 transition-opacity group-hover/nexus:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none sm:block"
          data-testid={`nexus-ask-${detail.id}`}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      <MetricDetailSheet detail={detail} open={open} onClose={close} scopeExtra={scopeExtra} />
    </div>
  );
}

/**
 * Any card shape, wired to the metric drill-down.
 *
 * The named triggers below cover the app's two standard KPI cards and the
 * shared insight card. This is for everything else: a page that already has a
 * card of its own — the sales attribution highlight, an organic winner, one
 * media buyer's four figures — hands over the description and calls `open` from
 * its own control, and gets the panel, the escape key, the focus return and the
 * Nexus hand-off unchanged.
 */
export const MetricDrilldown = MetricTriggerShell;

/**
 * A KPI card wired to its own drill-down.
 *
 * This is the only thing most pages write: hand it the card's props and a
 * description of the number, and the affordance, the panel, the escape key, the
 * focus return and the Nexus hand-off all come with it.
 */
export function MetricDetailTrigger({
  detail,
  card,
  scopeExtra,
  className = "",
}: {
  detail: MetricDetail;
  /** Everything `KpiCard` takes except the parts the description already owns. */
  card?: Omit<
    Parameters<typeof KpiCard>[0],
    "onClick" | "tone" | "icon" | "label" | "value" | "delta" | "deltaInvert"
  >;
  scopeExtra?: { key: string; label: string; value: string }[];
  className?: string;
}) {
  const { lang } = useI18n();
  return (
    <MetricTriggerShell detail={detail} scopeExtra={scopeExtra} className={className}>
      {(open) => (
        <KpiCard
          {...card}
          label={detail.title}
          value={detail.value}
          tone={detail.tone}
          icon={detail.icon}
          delta={detail.delta}
          deltaInvert={detail.deltaInvert}
          onClick={open}
          ariaLabel={
            lang === "ar"
              ? `${detail.title} — عرض تفاصيل الرقم`
              : `${detail.title} — open the detail for this figure`
          }
          testId={`kpi-${detail.id}`}
        />
      )}
    </MetricTriggerShell>
  );
}

/**
 * A reading of the period, wired to the same drill-down as the figures above it.
 *
 * An insight makes a claim — "CFM produced the most revenue", "one source has
 * not refreshed" — and a claim a reader cannot open is an assertion they have
 * to take on trust. Pressing it opens the same panel a KPI does, carrying the
 * figures that produced the verdict, the breakdown behind it and the report it
 * came from, so the judgement is checkable rather than announced.
 *
 * It shares `MetricTriggerShell` with the KPI triggers, which is what makes the
 * escape key, the focus return and the Nexus hand-off identical on both.
 */
export function InsightDetailTrigger({
  detail,
  card,
  scopeExtra,
  className = "",
}: {
  detail: MetricDetail;
  card: Omit<Parameters<typeof InsightCard>[0], "onClick" | "to" | "search" | "ariaLabel">;
  scopeExtra?: { key: string; label: string; value: string }[];
  className?: string;
}) {
  const { lang } = useI18n();
  const title = typeof card.title === "string" ? card.title : detail.title;
  return (
    <MetricTriggerShell detail={detail} scopeExtra={scopeExtra} className={className}>
      {(open) => (
        <InsightCard
          {...card}
          onClick={open}
          actionLabel={card.actionLabel ?? (lang === "ar" ? "على أي أساس؟" : "On what basis?")}
          ariaLabel={
            lang === "ar"
              ? `${title} — عرض الأرقام التي أدت لهذه القراءة`
              : `${title} — open the figures behind this reading`
          }
          testId={card.testId ?? `insight-${detail.id}`}
        />
      )}
    </MetricTriggerShell>
  );
}

/**
 * The advertising card, wired to the same drill-down.
 *
 * Campaigns and Ads use `MetricCard` rather than `KpiCard` because those two
 * pages carry a glossary entry, a verdict word and an "unavailable, and here is
 * why" state that the rest of the dashboard does not. They keep all of it and
 * gain the panel.
 */
export function MetricCardDetailTrigger({
  detail,
  card,
  scopeExtra,
  className = "",
}: {
  detail: MetricDetail;
  card: Omit<Parameters<typeof MetricCard>[0], "onClick" | "value" | "testId"> & {
    value?: Parameters<typeof MetricCard>[0]["value"];
  };
  scopeExtra?: { key: string; label: string; value: string }[];
  className?: string;
}) {
  return (
    <MetricTriggerShell detail={detail} scopeExtra={scopeExtra} className={className}>
      {(open) => (
        <MetricCard
          {...card}
          value={card.value ?? detail.value}
          onClick={open}
          testId={`kpi-${detail.id}`}
        />
      )}
    </MetricTriggerShell>
  );
}
