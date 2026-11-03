import { Link } from "@tanstack/react-router";
import { Activity, ArrowUpRight } from "lucide-react";
import { useFilters } from "@/lib/filter-store";
import { useApi } from "@/lib/use-api";
import { fmtNum, fmtUSD, useI18n } from "@/lib/i18n";

interface DeliveryState {
  platform: string; name: string; account: string; deliveryState: string;
  spend24h: number | null; platformLeads24h: number | null; checkedAt: string;
}
interface SnapchatOverview {
  activity: {
    delivery: Record<string, DeliveryState>;
    platformHealth: { platform: string; ok: boolean; active: number; checkedAt: string }[];
  };
}

/** Snapchat's campaign status is live; individual ad status is not in this feed. */
export function SnapchatLiveStatus() {
  const filters = useFilters();
  const { lang } = useI18n();
  const A = lang === "ar";
  const query = useApi<SnapchatOverview>("/api/overview", { enabled: filters.platform === "snapchat" });
  if (filters.platform !== "snapchat") return null;
  const health = query.data?.activity.platformHealth.find((item) => item.platform === "snapchat");
  const active = Object.values(query.data?.activity.delivery ?? {})
    .filter((item) => item.platform === "snapchat" && item.deliveryState === "active")
    .sort((a, b) => (b.spend24h ?? 0) - (a.spend24h ?? 0));
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm" dir={A ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="rounded-xl bg-amber-50 p-2 text-amber-700"><Activity size={20} /></span><div><h2 className="font-extrabold text-text">{A ? "حالة حملات سناب المباشرة" : "Live Snapchat campaigns"}</h2><p className="text-xs text-text-muted">{health ? `${A ? "آخر فحص" : "Checked"}: ${new Date(health.checkedAt).toLocaleString(A ? "ar-EG" : "en-US")}` : A ? "جارٍ فحص المصدر" : "Checking source"}</p></div></div>
        <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm font-bold text-blue-700 hover:underline">{A ? "تفاصيل الحملات" : "Campaign details"}<ArrowUpRight size={15} /></Link>
      </div>
      {query.isError ? <p className="mt-4 text-sm text-rose-700">{A ? "تعذّر تحميل الحالة المباشرة؛ لا نفترض أن الحملات متوقفة." : "Live status unavailable; campaigns are not assumed paused."}</p> : query.isPending ? <p className="mt-4 text-sm text-text-muted">{A ? "جارٍ التحميل…" : "Loading…"}</p> : <>
        <p className="mt-4 text-sm font-semibold text-text">{health?.ok ? A ? `${fmtNum(active.length)} حملات شغّالة حسب آخر فحص` : `${fmtNum(active.length)} serving campaigns at last check` : A ? "مصدر الحالة غير متاح" : "Status feed unavailable"}</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">{active.map((item) => <div key={`${item.account}:${item.name}`} className="rounded-xl border border-border bg-surface-2 p-4"><p className="font-bold text-text">{item.name}</p><p className="mt-1 text-xs text-text-muted">{item.account}</p><div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-text"><span>{A ? "صرف آخر 24 ساعة" : "Last 24h spend"}: <strong>{item.spend24h === null ? "—" : fmtUSD(item.spend24h)}</strong></span><span>{A ? "ليدز المنصة آخر 24 ساعة" : "Platform leads last 24h"}: <strong>{item.platformLeads24h === null ? "—" : fmtNum(item.platformLeads24h)}</strong></span></div></div>)}</div>
        <p className="mt-3 text-xs text-text-muted">{A ? "الحالة هنا على مستوى الحملة فقط. لا يتوفر فحص موثوق لكل إعلان منفرد من هذا المصدر، وصرف اليوم قابل للتغيّر حتى إغلاق اليوم." : "Status is campaign-level only. This feed cannot verify every individual ad; today's spend remains provisional."}</p>
      </>}
    </section>
  );
}
