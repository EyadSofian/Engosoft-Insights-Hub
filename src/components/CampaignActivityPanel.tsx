import {
  Activity,
  AlertTriangle,
  BellRing,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  CircleX,
  Radio,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  CampaignActivity,
  CampaignDeliveryState,
  CampaignOperationalState,
  CampaignPeriodSummary,
  PerfRow,
} from "@/lib/types";
import { fmtDateTime, fmtNum, fmtUSD, useI18n } from "@/lib/i18n";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/constants";
import {
  pendingRiskRows,
  riskAlertPrefs,
  suppressedRiskCount,
  useRiskAlertPrefs,
} from "@/lib/campaign-risk-prefs";
import { toneOf, type AnyTone } from "@/lib/dashboard-tone";
import { Card, EmptyState, Notice, Pill, SectionTitle } from "./ui-bits";

export function CampaignActivityPanel({ activity }: { activity: CampaignActivity }) {
  const { lang } = useI18n();
  const prefs = useRiskAlertPrefs();
  const pendingAtRisk = pendingRiskRows(activity.atRisk, prefs);
  // The only way back once a review or mute has been recorded.
  const suppressed = suppressedRiskCount(activity.atRisk, prefs);
  // Both badges read the server's own verdict. Recomputing them here let the
  // list disagree with the count in the notice right above it.
  const zeroKeys = new Set(activity.zeroResult.map((row) => row.key));
  const atRiskKeys = new Set(pendingAtRisk.map((row) => row.key));
  const lifetime = activity.lifetime ?? {};
  const period = activity.period ?? {};
  const delivery = activity.delivery ?? {};
  const states = Object.values(delivery);
  const activeCount = states.filter((state) => state.deliveryState === "active").length;
  const platformHealth = activity.platformHealth ?? [];
  const connectedCount = platformHealth.filter((item) => item.ok).length;
  const disconnectedCount = platformHealth.filter((item) => !item.ok).length;
  const range = lang === "ar" ? "الحالة الآن" : "Current status";
  const sourceLabel =
    activity.source === "platform_direct"
      ? lang === "ar"
        ? "الحالة مباشرة من المنصات"
        : "Status direct from platforms"
      : activity.source === "n8n_live"
        ? lang === "ar"
          ? "حالة المنصات المباشرة"
          : "Live platform status"
        : activity.source === "google_snapshot"
          ? lang === "ar"
            ? "آخر نسخة محفوظة في Google"
            : "Latest Google backup"
          : lang === "ar"
            ? "حالة محفوظة"
            : "Saved status";

  return (
    <Card>
      <SectionTitle
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone="neutral">
              <span className="inline-flex items-center gap-1">
                <CalendarClock size={13} />
                {range}
              </span>
            </Pill>
            <Pill
              tone={
                activity.source === "n8n_live" || activity.source === "platform_direct"
                  ? "success"
                  : "warning"
              }
            >
              {sourceLabel}
            </Pill>
          </div>
        }
        hint={
          lang === "ar"
            ? "القائمة لا تتأثر بفلتر التاريخ: الحملة لازم تكون مفعّلة، داخل جدولها الحالي، وجواها إعلان شغّال. أرقام كل حملة محسوبة على الفترة اللي اخترتها، والسهم يفتح إجمالي تاريخها."
            : "This list ignores the date filter: a campaign must be enabled, currently scheduled, and contain a live ad. Each row shows the selected period; expand it for lifetime results."
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Activity size={16} className="text-brand" />
          {lang === "ar" ? "الحملات الجاهزة للتشغيل الآن" : "Campaigns eligible to run now"}
        </span>
      </SectionTitle>

      {platformHealth.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {PLATFORMS.map((platform) => {
            const health = platformHealth.find((item) => item.platform === platform);
            return <PlatformHealthCard key={platform} platform={platform} health={health} />;
          })}
        </div>
      )}

      {states.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
          <StatusCount
            icon={<Radio size={15} />}
            label={lang === "ar" ? "جاهزة للتشغيل" : "Eligible now"}
            value={activeCount}
            tone="mint"
          />
          <StatusCount
            icon={<CircleCheck size={15} />}
            label={lang === "ar" ? "منصات متصلة" : "Connected"}
            value={connectedCount}
            tone="sky"
          />
          <StatusCount
            icon={<CircleX size={15} />}
            label={lang === "ar" ? "ربط محتاج مراجعة" : "Need reconnect"}
            value={disconnectedCount}
            tone={disconnectedCount ? "amber" : "slate"}
          />
        </div>
      )}

      {!activity.rows.length ? (
        <EmptyState
          compact
          label={
            lang === "ar"
              ? "الحالة الرسمية للحملات مش متاحة دلوقتي."
              : "Official campaign status is not available right now."
          }
        />
      ) : (
        <div className="space-y-4">
          {(pendingAtRisk.length > 0 || suppressed > 0) && (
            <Notice
              tone={pendingAtRisk.length > 0 ? "warning" : "info"}
              title={
                lang === "ar"
                  ? pendingAtRisk.length > 0
                    ? `${fmtNum(pendingAtRisk.length)} حملة تحتاج مراجعة`
                    : "تم التعامل مع كل حملات المراجعة الحالية"
                  : pendingAtRisk.length > 0
                    ? `${fmtNum(pendingAtRisk.length)} campaigns need review`
                    : "All current review campaigns have been handled"
              }
              icon={
                pendingAtRisk.length > 0 ? <AlertTriangle size={16} /> : <CircleCheck size={16} />
              }
            >
              {pendingAtRisk.length > 0
                ? lang === "ar"
                  ? "دي قائمة المراجعة المتبقية فقط. الحملات دي مفعّلة وصرفت في الفترة المختارة ولسه مفيش بيع مسجل في تاريخها."
                  : "This is the remaining review list. These campaigns are active, spent in the selected period, and still have no recorded sale in their history."
                : lang === "ar"
                  ? "الإجراءات المسجلة مخفية من التنبيه. الحملة ترجع تلقائيًا بعد 7 أيام لو ظلت Active بلا بيع."
                  : "Recorded actions are hidden from the alert. A campaign returns after 7 days if it remains active with no sale."}
              {suppressed > 0 && (
                <button
                  type="button"
                  onClick={() => riskAlertPrefs.restore()}
                  className="mt-2 inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-current/25 px-2.5 text-[12px] font-semibold transition-colors hover:bg-current/10"
                >
                  <BellRing size={13} aria-hidden="true" />
                  {lang === "ar"
                    ? `إعادة ${fmtNum(suppressed)} حملة لقائمة المراجعة`
                    : `Restore ${fmtNum(suppressed)} handled ${suppressed === 1 ? "campaign" : "campaigns"}`}
                </button>
              )}
            </Notice>
          )}
          {activity.zeroResult.length > 0 && (
            <Notice
              tone="danger"
              title={
                lang === "ar"
                  ? `${fmtNum(activity.zeroResult.length)} حملة Active صرفت في الفترة بدون ليدز من المنصة`
                  : `${fmtNum(activity.zeroResult.length)} active campaigns spent in the period with zero platform leads`
              }
              icon={<AlertTriangle size={16} />}
            >
              {lang === "ar"
                ? "ده مؤشر مراجعة، مش حكم على حالة الحملة: شيّك على الاستهداف والفورم والصفحة."
                : "This is a review signal, not a campaign-status verdict: check targeting, form and landing page."}
              <div className="mt-1.5">
                {activity.zeroResult
                  .slice(0, 3)
                  .map((row) => `${row.name}: ${fmtUSD(row.spend)}`)
                  .join(" · ")}
              </div>
            </Notice>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <ActivitySpotlight
              row={activity.best}
              period={activity.best ? period[activity.best.key] : undefined}
              tone="mint"
              title={lang === "ar" ? "أفضل أداء في الفترة" : "Best performance in period"}
            />
            <ActivitySpotlight
              row={activity.worst}
              period={activity.worst ? period[activity.worst.key] : undefined}
              tone="rose"
              title={lang === "ar" ? "أولوية المراجعة في الفترة" : "Review priority in period"}
            />
          </div>

          {/* One header, not one per row.
              Every row used to carry its own five column labels — "صرف الفترة",
              "ليدز CRM في الفترة" and three more — so twenty campaigns printed
              a hundred captions the reader had already read. The captions move
              to a sticky header and the rows keep only figures, which is what
              makes a column scannable down its length. */}
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="hscroll scroll-hint-x">
              <div className="min-w-[860px]">
                <div
                  className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_repeat(5,104px)_28px] items-center gap-3 border-b border-border bg-surface-2 px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide text-text-subtle"
                  role="row"
                >
                  <span>{lang === "ar" ? "الحملة" : "Campaign"}</span>
                  <span className="text-end">{lang === "ar" ? "الصرف" : "Spend"}</span>
                  <span className="text-end">{lang === "ar" ? "ليدز CRM" : "CRM leads"}</span>
                  <span className="text-end">Lost</span>
                  <span className="text-end">Won</span>
                  <span className="text-end">{lang === "ar" ? "الإيراد" : "Revenue"}</span>
                  <span aria-hidden="true" />
                </div>

                {activity.rows.map((row) => {
                  const life = lifetime[row.key];
                  const inPeriod = period[row.key];
                  const state = delivery[row.key];
                  const sold = !!life && (life.won > 0 || life.invoices > 0 || life.revenue > 0);
                  return (
                    <details
                      key={`${row.platforms.join("-")}:${row.key}`}
                      className="group border-b border-border last:border-b-0 bg-surface open:bg-surface-2/45"
                    >
                      <summary className="grid min-h-14 cursor-pointer list-none grid-cols-[minmax(0,1fr)_repeat(5,104px)_28px] items-center gap-3 px-3 py-2.5 transition-colors marker:content-none hover:bg-surface-2/70">
                        <div className="min-w-0">
                          <div
                            className="truncate text-[13px] font-semibold text-text"
                            title={row.name}
                          >
                            {row.name || "—"}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {row.platforms.map((platform) => (
                              <Pill key={platform} tone="neutral">
                                {PLATFORM_LABEL[platform][lang]}
                              </Pill>
                            ))}
                            {state && <DeliveryPill state={state.deliveryState} />}
                            {zeroKeys.has(row.key) && (
                              <Pill tone="danger">
                                {lang === "ar" ? "صرف بلا ليدز" : "No leads"}
                              </Pill>
                            )}
                            {atRiskKeys.has(row.key) && (
                              <Pill tone="warning">
                                {lang === "ar" ? "لم تبِع من قبل" : "Never sold"}
                              </Pill>
                            )}
                          </div>
                        </div>
                        <Figure tone="rose" value={fmtUSD(inPeriod?.spend ?? 0)} />
                        <Figure tone="sky" value={fmtNum(inPeriod?.crmLeads ?? 0)} />
                        <Figure tone="rose" muted value={fmtNum(inPeriod?.lostArchived ?? 0)} />
                        <Figure tone="violet" value={fmtNum(inPeriod?.won ?? 0)} />
                        <Figure tone="mint" value={fmtUSD(inPeriod?.revenue ?? 0)} />
                        <ChevronDown
                          size={15}
                          className="justify-self-center text-text-muted transition-transform group-open:rotate-180"
                        />
                      </summary>

                      {/* What the row cannot say: the campaign's whole history.
                          The sentence explaining what "eligible" means used to
                          be repeated inside every one of these — it is stated
                          once, above the list, where a definition belongs. */}
                      <div className="border-t border-border bg-surface px-3 py-3">
                        <div className="mb-2.5 flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                            {lang === "ar" ? "إجمالي تاريخ الحملة" : "Lifetime"}
                          </span>
                          {sold ? (
                            <Pill tone="success">
                              {lang === "ar"
                                ? `باعت ${fmtUSD(life.revenue)} · ${fmtNum(life.won)} Won`
                                : `Sold ${fmtUSD(life.revenue)} · ${fmtNum(life.won)} Won`}
                            </Pill>
                          ) : (
                            <Pill tone="warning">
                              {lang === "ar" ? "لم تسجّل بيعاً بعد" : "No recorded sale yet"}
                            </Pill>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                          <LifetimeStat
                            tone="rose"
                            label={lang === "ar" ? "المصروف" : "Spend"}
                            value={life ? fmtUSD(life.spend) : "—"}
                          />
                          <LifetimeStat
                            tone="mint"
                            label={lang === "ar" ? "الإيراد" : "Revenue"}
                            value={life ? fmtUSD(life.revenue) : "—"}
                          />
                          <LifetimeStat
                            tone="amber"
                            label="ROAS"
                            value={
                              life?.roas === null || life?.roas === undefined
                                ? "—"
                                : `${life.roas.toFixed(2)}×`
                            }
                          />
                          <LifetimeStat
                            tone="violet"
                            label="Won"
                            value={life ? fmtNum(life.won) : "—"}
                          />
                          <LifetimeStat
                            tone="violet"
                            label={lang === "ar" ? "فواتير" : "Invoices"}
                            value={life ? fmtNum(life.invoices) : "—"}
                          />
                          <LifetimeStat
                            tone="cyan"
                            label={lang === "ar" ? "أوامر بيع" : "Sales orders"}
                            value={life ? fmtNum(life.salesOrders) : "—"}
                          />
                          <LifetimeStat
                            tone="slate"
                            label={lang === "ar" ? "آخر يوم صرف" : "Last spend"}
                            value={life?.lastSpendDate || "—"}
                          />
                        </div>

                        {state && <DeliveryDetail state={state} />}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
/**
 * The best and the worst campaign of the period, as one card each.
 *
 * They carry the same five figures the table does, so the tones match the
 * columns below and a reader can see immediately which row in the list this
 * card is pointing at.
 */
function ActivitySpotlight({
  row,
  period,
  tone,
  title,
}: {
  row: PerfRow | null;
  period?: CampaignPeriodSummary;
  tone: "mint" | "rose";
  title: string;
}) {
  const { lang } = useI18n();
  const t = toneOf(tone);
  const Icon = tone === "mint" ? TrendingUp : TrendingDown;

  if (!row)
    return (
      <div className="rounded-2xl border border-border bg-surface px-4 py-3.5 text-[13px] text-text-muted">
        <div className="font-semibold text-text">{title}</div>
        <div className="mt-1">{lang === "ar" ? "لا توجد عينة كافية" : "No qualifying sample"}</div>
      </div>
    );

  const stats: { label: string; value: string; tone: AnyTone }[] = [
    {
      label: lang === "ar" ? "الصرف" : "Spend",
      value: fmtUSD(period?.spend ?? row.spend),
      tone: "rose",
    },
    {
      label: lang === "ar" ? "ليدز CRM" : "CRM leads",
      value: fmtNum(period?.crmLeads ?? 0),
      tone: "sky",
    },
    { label: "Lost", value: fmtNum(period?.lostArchived ?? 0), tone: "rose" },
    { label: "Won", value: fmtNum(period?.won ?? 0), tone: "violet" },
    {
      label: lang === "ar" ? "الإيراد" : "Revenue",
      value: fmtUSD(period?.revenue ?? row.revenue),
      tone: "mint",
    },
  ];

  return (
    <div
      className="rounded-2xl border px-4 py-3.5"
      style={{ background: t.surface, borderColor: t.border }}
    >
      <div
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide"
        style={{ color: t.strong }}
      >
        <span
          className="grid size-5 shrink-0 place-items-center rounded-md text-white"
          style={{ background: t.strong }}
        >
          <Icon size={12} strokeWidth={2.6} aria-hidden="true" />
        </span>
        {title}
      </div>
      <div
        className="mt-2 truncate text-[15px] font-bold"
        style={{ color: t.ink }}
        title={row.name}
      >
        {row.name}
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-5">
        {stats.map((stat) => {
          const st = toneOf(stat.tone);
          return (
            <div key={stat.label} className="min-w-0">
              <div
                className="truncate text-[10px] font-semibold"
                style={{ color: t.ink, opacity: 0.6 }}
              >
                {stat.label}
              </div>
              <div className="num mt-0.5 truncate text-[13px] font-bold" style={{ color: st.ink }}>
                {stat.value}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One figure in a labelled column.
 *
 * Colour is the column's, not the row's: spend is rose all the way down,
 * revenue is mint all the way down. That is what lets a reader run an eye down
 * one column looking for the big number instead of reading every cell. `muted`
 * is for a column that shares a family with a louder one beside it — archived
 * Lost is rose like spend, and would otherwise shout as loudly.
 */
function Figure({ value, tone, muted = false }: { value: string; tone: AnyTone; muted?: boolean }) {
  const t = toneOf(tone);
  const zero = value === "0" || value === "$0" || value === "—";
  return (
    <span
      className="num truncate text-end text-[13.5px] font-bold"
      style={{
        color: zero ? "var(--text-subtle)" : t.ink,
        opacity: zero ? 1 : muted ? 0.72 : 1,
      }}
      title={value}
    >
      {value}
    </span>
  );
}

/** A lifetime total, on its family's pastel chip. */
function LifetimeStat({ label, value, tone }: { label: string; value: string; tone: AnyTone }) {
  const t = toneOf(tone);
  return (
    <div
      className="min-w-0 rounded-xl px-2.5 py-2"
      style={{ background: t.surface, border: `1px solid ${t.border}` }}
    >
      <div className="truncate text-[10px] font-semibold" style={{ color: t.ink, opacity: 0.72 }}>
        {label}
      </div>
      <div
        className="num mt-0.5 truncate text-[13px] font-bold"
        style={{ color: t.ink }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Why the platform considers this campaign eligible, in words.
 *
 * This row used to print the platform's own enum values and a raw ISO
 * timestamp — "ميتا: ACTIVE، التقديم: ELIGIBLE ... آخر فحص:
 * 2026-09-07T23:10:00.369Z". None of that is actionable, and the timestamp was
 * not even readable. The counts a reader can act on stay; the platform's
 * literal strings move into the tooltip, for whoever is debugging a feed.
 */
function DeliveryDetail({ state }: { state: CampaignOperationalState }) {
  const { lang } = useI18n();
  const raw = [
    `${PLATFORM_LABEL[state.platform][lang]}: ${state.configuredStatus}`,
    state.servingStatus ? `serving: ${state.servingStatus}` : "",
    state.statusReason ? `reason: ${state.statusReason}` : "",
    state.checkedAt ? `checkedAt: ${state.checkedAt}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const parts = [
    state.activeAdsets > 0
      ? `${fmtNum(state.activeAdsets)} ${lang === "ar" ? "مجموعة إعلانية نشطة" : state.activeAdsets === 1 ? "active ad set" : "active ad sets"}`
      : "",
    state.activeAds > 0
      ? `${fmtNum(state.activeAds)} ${lang === "ar" ? "إعلان نشط" : state.activeAds === 1 ? "active ad" : "active ads"}`
      : "",
  ].filter(Boolean);

  return (
    <div
      className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 text-[11px] text-text-muted"
      title={raw}
    >
      <span className="inline-flex items-center gap-1.5 font-semibold text-text">
        <Radio size={12} style={{ color: "var(--mint-strong)" }} aria-hidden="true" />
        {lang === "ar"
          ? `${PLATFORM_LABEL[state.platform][lang]} تؤكد أنها تعمل الآن`
          : `${PLATFORM_LABEL[state.platform][lang]} confirms it is running`}
      </span>
      {parts.length > 0 && <span>{parts.join(" · ")}</span>}
      {state.checkedAt && (
        <span className="num">
          {lang === "ar" ? "آخر فحص" : "Checked"} {fmtDateTime(state.checkedAt, lang)}
        </span>
      )}
    </div>
  );
}

function DeliveryPill({ state }: { state: CampaignDeliveryState }) {
  const { lang } = useI18n();
  if (state === "active")
    return <Pill tone="success">{lang === "ar" ? "جاهزة للتشغيل" : "Eligible now"}</Pill>;
  return <Pill tone="neutral">{lang === "ar" ? "الحالة غير واضحة" : "Status unclear"}</Pill>;
}

function PlatformHealthCard({
  platform,
  health,
}: {
  platform: (typeof PLATFORMS)[number];
  health?: CampaignActivity["platformHealth"][number];
}) {
  const { lang } = useI18n();
  const ok = health?.ok === true;
  const t = toneOf(ok ? "mint" : "amber");
  const googleHelp = platform === "google" && !ok;
  return (
    <div
      className="min-w-0 rounded-2xl border px-3.5 py-3"
      style={{ background: t.surface, borderColor: t.border }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-bold" style={{ color: t.ink }}>
          {PLATFORM_LABEL[platform][lang]}
        </span>
        <span
          className="grid size-6 shrink-0 place-items-center rounded-lg text-white"
          style={{ background: t.strong }}
          aria-hidden="true"
        >
          {ok ? <CircleCheck size={13} /> : <CircleX size={13} />}
        </span>
      </div>
      <div className="num mt-1.5 text-[22px] font-bold leading-none" style={{ color: t.ink }}>
        {ok ? fmtNum(health.active) : "—"}
      </div>
      <div className="mt-1 text-[10.5px] leading-snug" style={{ color: t.ink, opacity: 0.68 }}>
        {ok
          ? lang === "ar"
            ? health.enabled !== undefined && health.enabled !== health.active
              ? `جاهزة الآن · ${fmtNum(health.enabled)} مفعّلة`
              : "جاهزة للتشغيل الآن"
            : health.enabled !== undefined && health.enabled !== health.active
              ? `eligible now · ${fmtNum(health.enabled)} enabled`
              : "eligible to run now"
          : googleHelp
            ? lang === "ar"
              ? "محتاج تسجيل دخول بحساب Engosoft الصحيح"
              : "Sign in with the correct Engosoft account"
            : lang === "ar"
              ? "الربط محتاج مراجعة"
              : "Connection needs review"}
      </div>
    </div>
  );
}

function StatusCount({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: AnyTone;
}) {
  const t = toneOf(tone);
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-border bg-surface px-3.5 py-2.5">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-xl text-white"
        style={{ background: t.strong }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="num text-[17px] font-bold leading-none text-text">{fmtNum(value)}</div>
        <div className="mt-0.5 truncate text-[10.5px] text-text-muted" title={label}>
          {label}
        </div>
      </div>
    </div>
  );
}
