import {
  Activity,
  AlertTriangle,
  BellRing,
  CalendarClock,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { CampaignActivity, PerfRow } from "@/lib/types";
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
  const platformWindows = activity.platformWindows ?? {};
  const representedPlatforms = PLATFORMS.filter((platform) => platformWindows[platform]);
  const range = representedPlatforms.length
    ? lang === "ar"
      ? "أحدث 3 أيام لكل منصة"
      : "Latest 3 days per platform"
    : lang === "ar"
      ? "لا توجد أيام إنفاق"
      : "No spend dates";

  return (
    <Card>
      <SectionTitle
        action={
          <Pill tone="neutral">
            <span className="inline-flex items-center gap-1">
              <CalendarClock size={13} />
              {range}
            </span>
          </Pill>
        }
        hint={
          lang === "ar"
            ? "نشطة فعليًا = سجلت إنفاقًا خلال آخر 3 أيام متاحة لكل منصة، لأن مواعيد تحديث المصادر مختلفة. الإنفاق والليدز من الـ3 أيام دي، أما الحكم بالبيع فمن تاريخ الحملة كله لأن الصفقة بتقفل بعد أسابيع."
            : "Operationally active = recorded spend during each platform's latest three available days, since sources refresh on different schedules. Spend and leads come from those days; the sales verdict comes from the campaign's whole history, because deals close weeks later."
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Activity size={16} className="text-brand" />
          {lang === "ar" ? "الحملات التي تعمل الآن" : "Campaigns running now"}
        </span>
      </SectionTitle>

      {representedPlatforms.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {representedPlatforms.map((platform) => {
            const window = platformWindows[platform];
            return (
              <Pill key={platform} tone="neutral">
                {PLATFORM_LABEL[platform][lang]}
                {window ? ` · ${window.from.slice(5)} → ${window.to.slice(5)}` : ""}
              </Pill>
            );
          })}
        </div>
      )}

      {!activity.rows.length ? (
        <EmptyState
          compact
          label={
            lang === "ar"
              ? "لا توجد حملة سجلت إنفاقًا في آخر 3 أيام متاحة."
              : "No campaign recorded spend in the latest three available days."
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
                ? "بتصرف حاليًا ولم تسجل ولا Won ولا فاتورة مدفوعة ولا أمر بيع مفوتر بالكامل طوال تاريخها، مش في آخر 3 أيام بس."
                : "Spending now and never recorded a single Won, paid invoice, or fully invoiced sales order across their entire history — not merely in the last three days."}
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
                  ? `${fmtNum(activity.zeroResult.length)} حملة تصرف بلا أي ليد`
                  : `${fmtNum(activity.zeroResult.length)} campaigns spending with zero leads`
              }
              icon={<AlertTriangle size={16} />}
            >
              {lang === "ar"
                ? "الليد بيوصل في نفس اليوم عادة، فصفر ليد مع إنفاق مستمر معناه غالبًا عطل في الاستهداف أو الفورم أو الصفحة."
                : "Leads normally arrive the same day, so zero leads against continuing spend usually means a broken target, form, or landing page."}
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
              tone="success"
              title={lang === "ar" ? "أفضل أداء حالي" : "Best current performance"}
            />
            <ActivitySpotlight
              row={activity.worst}
              tone="danger"
              title={lang === "ar" ? "أولوية المراجعة" : "Review priority"}
            />
          </div>

          <div className="divide-y divide-border rounded-xl border border-border">
            {activity.rows.slice(0, 6).map((row) => {
              const life = lifetime[row.key];
              const sold = !!life && (life.won > 0 || life.invoices > 0 || life.revenue > 0);
              return (
                <div
                  key={`${row.platforms.join("-")}:${row.key}`}
                  className="grid grid-cols-2 gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_repeat(6,auto)] sm:items-center sm:gap-4"
                >
                  <div className="col-span-2 min-w-0 sm:col-span-1">
                    <div className="truncate text-[13px] font-semibold text-text" title={row.name}>
                      {row.name || "—"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.platforms.map((platform) => (
                        <Pill key={platform} tone="neutral">
                          {PLATFORM_LABEL[platform][lang]}
                        </Pill>
                      ))}
                      {zeroKeys.has(row.key) && (
                        <Pill tone="danger">{lang === "ar" ? "صرف بلا ليدز" : "No leads"}</Pill>
                      )}
                      {atRiskKeys.has(row.key) && (
                        <Pill tone="warning">
                          {lang === "ar" ? "لم تبِع من قبل" : "Never sold"}
                        </Pill>
                      )}
                      {/* Without this a healthy campaign with a slow three days
                          reads exactly like one that has never sold anything. */}
                      {sold && (
                        <Pill tone="success">
                          {lang === "ar"
                            ? `إجمالي ${fmtUSD(life.revenue)} · ${fmtNum(life.won)} Won`
                            : `${fmtUSD(life.revenue)} lifetime · ${fmtNum(life.won)} Won`}
                        </Pill>
                      )}
                    </div>
                  </div>
                  <Mini
                    label={lang === "ar" ? "إنفاق 3 أيام" : "3-day spend"}
                    value={fmtUSD(row.spend)}
                  />
                  <Mini
                    label={lang === "ar" ? "ليدز المنصة" : "Platform leads"}
                    value={row.platformLeads === null ? "—" : fmtNum(row.platformLeads)}
                  />
                  <Mini
                    label={lang === "ar" ? "ليدز أودو" : "Odoo leads"}
                    value={fmtNum(row.crmLeads)}
                  />
                  <Mini label={lang === "ar" ? "مغلق" : "Won"} value={fmtNum(row.won)} />
                  <Mini
                    label={lang === "ar" ? "فواتير مدفوعة" : "Paid invoices"}
                    value={fmtNum(row.invoices)}
                  />
                  <Mini
                    label={lang === "ar" ? "أوامر بيع" : "Sales orders"}
                    value={fmtNum(row.salesOrders)}
                  />
                </div>
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
  tone,
  title,
}: {
  row: PerfRow | null;
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
        <Mini label={lang === "ar" ? "الإنفاق" : "Spend"} value={fmtUSD(row.spend)} />
        <Mini
          label={lang === "ar" ? "ليدز" : "Leads"}
          value={row.platformLeads === null ? "—" : fmtNum(row.platformLeads)}
        />
        <Mini label={lang === "ar" ? "Won" : "Won"} value={fmtNum(row.won)} />
        <Mini label={lang === "ar" ? "فواتير" : "Invoices"} value={fmtNum(row.invoices)} />
        <Mini
          label={lang === "ar" ? "أوامر بيع" : "Sales orders"}
          value={fmtNum(row.salesOrders)}
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
