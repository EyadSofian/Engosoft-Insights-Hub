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
import { mutedRiskCount, riskAlertPrefs, useRiskAlertPrefs } from "@/lib/campaign-risk-prefs";
import { Card, EmptyState, Notice, Pill, SectionTitle } from "./ui-bits";

export function CampaignActivityPanel({ activity }: { activity: CampaignActivity }) {
  const { lang } = useI18n();
  const prefs = useRiskAlertPrefs();
  // The only way back once the popup has been silenced for good.
  const muted = mutedRiskCount(activity.atRisk, prefs);
  const range = activity.window
    ? `${activity.window.from} → ${activity.window.to}`
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
            ? "نشطة فعليًا = سجلت إنفاقًا خلال آخر 3 أيام متاحة في مصدر الإعلانات."
            : "Operationally active = recorded spend during the latest three source days."
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Activity size={16} className="text-brand" />
          {lang === "ar" ? "الحملات التي تعمل الآن" : "Campaigns running now"}
        </span>
      </SectionTitle>

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
                ? "سجلت إنفاقًا حديثًا ولم تسجل Won أو فاتورة مدفوعة أو أمر بيع مفوتر بالكامل في نفس نافذة القياس."
                : "They recorded recent spend with no Won, paid invoice, or fully invoiced sales order in the same measurement window."}
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
                  ? `${fmtNum(activity.zeroResult.length)} حملة تصرف بلا نتيجة مسجلة`
                  : `${fmtNum(activity.zeroResult.length)} campaigns spending with no recorded result`
              }
              icon={<AlertTriangle size={16} />}
            >
              {activity.zeroResult
                .slice(0, 3)
                .map((row) => `${row.name}: ${fmtUSD(row.spend)}`)
                .join(" · ")}
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
              const zero =
                (row.platformLeads ?? 0) <= 0 &&
                row.crmLeads <= 0 &&
                row.won <= 0 &&
                row.invoices <= 0 &&
                row.salesOrders <= 0 &&
                row.revenue <= 0;
              return (
                <div
                  key={row.key}
                  className="grid grid-cols-2 gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_repeat(6,auto)] sm:items-center sm:gap-4"
                >
                  <div className="col-span-2 min-w-0 sm:col-span-1">
                    <div className="truncate text-[13px] font-semibold text-text" title={row.name}>
                      {row.name || "—"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.platforms.map((platform) => (
                        <Pill key={platform} tone="neutral">
                          {platform === "snapchat"
                            ? "Snapchat"
                            : platform === "tiktok"
                              ? "TikTok"
                              : "Meta"}
                        </Pill>
                      ))}
                      {zero && (
                        <Pill tone="danger">{lang === "ar" ? "صرف بلا نتيجة" : "No result"}</Pill>
                      )}
                    </div>
                  </div>
                  <Mini label={lang === "ar" ? "إنفاق 3 أيام" : "3-day spend"} value={fmtUSD(row.spend)} />
                  <Mini
                    label={lang === "ar" ? "ليدز المنصة" : "Platform leads"}
                    value={row.platformLeads === null ? "—" : fmtNum(row.platformLeads)}
                  />
                  <Mini label={lang === "ar" ? "ليدز أودو" : "Odoo leads"} value={fmtNum(row.crmLeads)} />
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
        <Mini
          label={lang === "ar" ? "فواتير" : "Invoices"}
          value={fmtNum(row.invoices)}
        />
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
      <div className="num mt-0.5 whitespace-nowrap text-[12px] font-semibold text-text">{value}</div>
    </div>
  );
}
