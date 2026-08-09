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
  CampaignPeriodSummary,
  PerfRow,
} from "@/lib/types";
import { fmtNum, fmtUSD, useI18n } from "@/lib/i18n";
import { PLATFORM_LABEL, PLATFORMS } from "@/lib/constants";
import { mutedRiskCount, riskAlertPrefs, useRiskAlertPrefs } from "@/lib/campaign-risk-prefs";
import { Card, EmptyState, Notice, Pill, SectionTitle } from "./ui-bits";

export function CampaignActivityPanel({ activity }: { activity: CampaignActivity }) {
  const { lang } = useI18n();
  const prefs = useRiskAlertPrefs();
  // The only way back once the popup has been silenced for good.
  const muted = mutedRiskCount(activity.atRisk, prefs);
  // Both badges read the server's own verdict. Recomputing them here let the
  // list disagree with the count in the notice right above it.
  const zeroKeys = new Set(activity.zeroResult.map((row) => row.key));
  const atRiskKeys = new Set(activity.atRisk.map((row) => row.key));
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
        <div className="mb-4 grid grid-cols-3 gap-2">
          <StatusCount
            icon={<Radio size={15} />}
            label={lang === "ar" ? "جاهزة للتشغيل" : "Eligible now"}
            value={activeCount}
            tone="success"
          />
          <StatusCount
            icon={<CircleCheck size={15} />}
            label={lang === "ar" ? "منصات متصلة" : "Connected"}
            value={connectedCount}
            tone="success"
          />
          <StatusCount
            icon={<CircleX size={15} />}
            label={lang === "ar" ? "ربط محتاج مراجعة" : "Need reconnect"}
            value={disconnectedCount}
            tone={disconnectedCount ? "warning" : "neutral"}
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
          {activity.atRisk.length > 0 && (
            <Notice
              tone="warning"
              title={
                lang === "ar"
                  ? `${fmtNum(activity.atRisk.length)} حملة تحتاج مراجعة`
                  : `${fmtNum(activity.atRisk.length)} campaigns need review`
              }
              icon={<AlertTriangle size={16} />}
            >
              {lang === "ar"
                ? `دي قائمة المراجعة فقط، مش كل الحملات الجاهزة. الحملات دي مفعّلة وجدولها مفتوح وجواها إعلان شغّال، وصرفت في الفترة المختارة، ولسه مفيش Won أو فاتورة مدفوعة أو أمر بيع مفوتر بالكامل في تاريخها.`
                : "This is only the review list. These campaigns are enabled, currently scheduled, contain a live ad, spent in the selected period, and still have no Won, paid invoice, or fully invoiced sales order in their history."}
              {muted > 0 && (
                <button
                  type="button"
                  onClick={() => riskAlertPrefs.restore()}
                  className="mt-2 inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-current/25 px-2.5 text-[12px] font-semibold transition-colors hover:bg-current/10"
                >
                  <BellRing size={13} aria-hidden="true" />
                  {lang === "ar"
                    ? `إظهار تنبيه ${fmtNum(muted)} حملة مكتومة`
                    : `Unmute ${fmtNum(muted)} silenced ${muted === 1 ? "campaign" : "campaigns"}`}
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
              tone="success"
              title={lang === "ar" ? "أفضل أداء في الفترة" : "Best performance in period"}
            />
            <ActivitySpotlight
              row={activity.worst}
              period={activity.worst ? period[activity.worst.key] : undefined}
              tone="danger"
              title={lang === "ar" ? "أولوية المراجعة في الفترة" : "Review priority in period"}
            />
          </div>

          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {activity.rows.map((row) => {
              const life = lifetime[row.key];
              const inPeriod = period[row.key];
              const state = delivery[row.key];
              const sold = !!life && (life.won > 0 || life.invoices > 0 || life.revenue > 0);
              return (
                <details
                  key={`${row.platforms.join("-")}:${row.key}`}
                  className="group bg-surface open:bg-surface-2/55"
                >
                  <summary className="grid min-h-16 cursor-pointer list-none grid-cols-2 items-center gap-3 px-3 py-3 marker:content-none sm:grid-cols-[minmax(0,1fr)_repeat(5,auto)_24px] sm:gap-4">
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="truncate text-[13px] font-semibold text-text"
                          title={row.name}
                        >
                          {row.name || "—"}
                        </div>
                        <ChevronDown
                          size={14}
                          className="shrink-0 text-text-muted transition-transform group-open:rotate-180 sm:hidden"
                        />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.platforms.map((platform) => (
                          <Pill key={platform} tone="neutral">
                            {PLATFORM_LABEL[platform][lang]}
                          </Pill>
                        ))}
                        {state && <DeliveryPill state={state.deliveryState} />}
                        {zeroKeys.has(row.key) && (
                          <Pill tone="danger">{lang === "ar" ? "صرف بلا ليدز" : "No leads"}</Pill>
                        )}
                        {atRiskKeys.has(row.key) && (
                          <Pill tone="warning">
                            {lang === "ar" ? "لم تبِع من قبل" : "Never sold"}
                          </Pill>
                        )}
                      </div>
                    </div>
                    <Mini
                      label={lang === "ar" ? "صرف الفترة" : "Period spend"}
                      value={fmtUSD(inPeriod?.spend ?? 0)}
                    />
                    <Mini
                      label={lang === "ar" ? "ليدز CRM في الفترة" : "Period CRM leads"}
                      value={fmtNum(inPeriod?.crmLeads ?? 0)}
                    />
                    <Mini
                      label={lang === "ar" ? "Lost مؤرشف في الفترة" : "Archived Lost in period"}
                      value={fmtNum(inPeriod?.lostArchived ?? 0)}
                    />
                    <Mini
                      label={lang === "ar" ? "Won في الفترة" : "Won in period"}
                      value={fmtNum(inPeriod?.won ?? 0)}
                    />
                    <Mini
                      label={lang === "ar" ? "إيراد مدفوع في الفترة" : "Paid revenue in period"}
                      value={fmtUSD(inPeriod?.revenue ?? 0)}
                    />
                    <ChevronDown
                      size={15}
                      className="hidden text-text-muted transition-transform group-open:rotate-180 sm:block"
                    />
                  </summary>

                  <div className="border-t border-border px-3 py-3 text-xs leading-relaxed text-text-muted">
                    <p className="text-text">
                      {lang === "ar"
                        ? `${PLATFORM_LABEL[state?.platform ?? row.platforms[0]][lang]} بتقول إن الحملة مفعّلة، جدولها لسه مفتوح، وجواها إعلان شغّال. فوق: صرف، ليدز CRM، Lost، Won، والإيراد المدفوع في الفترة المختارة. تحت: إجمالي تاريخ الحملة.`
                        : `${PLATFORM_LABEL[state?.platform ?? row.platforms[0]][lang]} reports this campaign as enabled, currently scheduled, and containing a live ad. Above: selected-period results. Below: lifetime totals.`}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
                      <Mini
                        label={lang === "ar" ? "Won — كل التاريخ" : "Lifetime Won"}
                        value={life ? fmtNum(life.won) : "—"}
                      />
                      <Mini
                        label={lang === "ar" ? "فواتير مدفوعة" : "Paid invoices"}
                        value={life ? fmtNum(life.invoices) : "—"}
                      />
                      <Mini
                        label={lang === "ar" ? "أوامر بيع" : "Sales orders"}
                        value={life ? fmtNum(life.salesOrders) : "—"}
                      />
                      <Mini
                        label={lang === "ar" ? "إجمالي المصروف" : "Lifetime spend"}
                        value={life ? fmtUSD(life.spend) : "—"}
                      />
                      <Mini
                        label={lang === "ar" ? "إجمالي الإيراد" : "Lifetime revenue"}
                        value={life ? fmtUSD(life.revenue) : "—"}
                      />
                      <Mini
                        label="ROAS"
                        value={
                          life?.roas === null || life?.roas === undefined
                            ? "—"
                            : `${life.roas.toFixed(2)}×`
                        }
                      />
                      <Mini
                        label={lang === "ar" ? "آخر يوم صرف" : "Last spend date"}
                        value={life?.lastSpendDate || "—"}
                      />
                    </div>
                    {state && (
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-subtle">
                        <span>
                          {PLATFORM_LABEL[state.platform][lang]}: {state.configuredStatus}
                        </span>
                        {state.servingStatus && (
                          <span>
                            {lang === "ar" ? "التقديم" : "Serving"}: {state.servingStatus}
                          </span>
                        )}
                        {state.activeAdsets > 0 && (
                          <span>
                            {lang === "ar" ? "Ad sets نشطة" : "Active ad sets"}:{" "}
                            {fmtNum(state.activeAdsets)}
                          </span>
                        )}
                        {state.activeAds > 0 && (
                          <span>
                            {lang === "ar" ? "إعلانات نشطة" : "Active ads"}:{" "}
                            {fmtNum(state.activeAds)}
                          </span>
                        )}
                        <span>
                          {lang === "ar" ? "آخر فحص" : "Checked"}: {state.checkedAt || "—"}
                        </span>
                      </div>
                    )}
                    {sold && (
                      <div className="mt-2 font-semibold text-success">
                        {lang === "ar"
                          ? `الحملة باعت قبل كده: ${fmtUSD(life.revenue)} و${fmtNum(life.won)} Won.`
                          : `This campaign has sold before: ${fmtUSD(life.revenue)} and ${fmtNum(life.won)} Won.`}
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
function ActivitySpotlight({
  row,
  period,
  tone,
  title,
}: {
  row: PerfRow | null;
  period?: CampaignPeriodSummary;
  tone: "success" | "danger";
  title: string;
}) {
  const { lang } = useI18n();
  const Icon = tone === "success" ? TrendingUp : TrendingDown;
  if (!row)
    return (
      <div className="rounded-xl border border-border p-4 text-sm text-text-muted">
        {title}: {lang === "ar" ? "لا توجد عينة كافية" : "No qualifying sample"}
      </div>
    );
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: tone === "success" ? "var(--success)" : "var(--danger)",
        background: tone === "success" ? "var(--success-soft)" : "var(--danger-soft)",
      }}
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Icon size={15} />
        {title}
      </div>
      <div className="mt-2 truncate text-sm font-semibold text-text" title={row.name}>
        {row.name}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        <Mini
          label={lang === "ar" ? "صرف الفترة" : "Period spend"}
          value={fmtUSD(period?.spend ?? row.spend)}
        />
        <Mini
          label={lang === "ar" ? "ليدز CRM في الفترة" : "Period CRM leads"}
          value={fmtNum(period?.crmLeads ?? 0)}
        />
        <Mini
          label={lang === "ar" ? "Lost مؤرشف" : "Archived Lost"}
          value={fmtNum(period?.lostArchived ?? 0)}
        />
        <Mini
          label={lang === "ar" ? "Won في الفترة" : "Period Won"}
          value={fmtNum(period?.won ?? 0)}
        />
        <Mini
          label={lang === "ar" ? "إيراد مدفوع" : "Paid revenue"}
          value={fmtUSD(period?.revenue ?? row.revenue)}
        />
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className="num mt-0.5 whitespace-nowrap text-[12px] font-semibold text-text">
        {value}
      </div>
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
  const googleHelp = platform === "google" && !ok;
  return (
    <div
      className={`min-w-0 rounded-xl border px-3 py-3 ${
        ok ? "border-success/25 bg-success-soft/35" : "border-warning/30 bg-warning-soft/45"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-text">
          {PLATFORM_LABEL[platform][lang]}
        </span>
        {ok ? (
          <CircleCheck size={15} className="shrink-0 text-success" aria-hidden="true" />
        ) : (
          <CircleX size={15} className="shrink-0 text-warning" aria-hidden="true" />
        )}
      </div>
      <div className="num mt-1 text-lg font-bold text-text">{ok ? fmtNum(health.active) : "—"}</div>
      <div className="mt-0.5 text-[10px] leading-relaxed text-text-muted">
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
  tone: "success" | "warning" | "neutral";
}) {
  const color =
    tone === "success"
      ? "text-success bg-success-soft"
      : tone === "warning"
        ? "text-warning bg-warning-soft"
        : "text-text-muted bg-surface-2";
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${color}`}>{icon}</span>
      <div className="min-w-0">
        <div className="num text-sm font-bold text-text">{fmtNum(value)}</div>
        <div className="truncate text-[10px] text-text-muted" title={label}>
          {label}
        </div>
      </div>
    </div>
  );
}
