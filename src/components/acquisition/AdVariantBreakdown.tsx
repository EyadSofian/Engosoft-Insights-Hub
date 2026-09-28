import type { GrainRow } from "@/lib/closed-loop";
import { fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";

/** Exact Ad ID rows beneath a combined Ad Name. Never repeats the group totals. */
export function AdVariantBreakdown({
  ads,
  spendAvailable,
  onOpenCreative,
  compact = false,
}: {
  ads: readonly GrainRow[];
  spendAvailable: boolean;
  onOpenCreative: (creativeId: string) => void;
  compact?: boolean;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const pending = A ? "بانتظار المزامنة" : "Pending sync";
  if (compact) {
    return (
      <div className="space-y-2">
        {ads.map((ad) => (
          <div
            key={ad.key}
            className="rounded-lg border border-border bg-surface-2 p-2 text-[10px] text-text-muted"
          >
            <p className="truncate font-semibold text-text" title={ad.campaignName}>
              {A ? "الحملة" : "Campaign"}: {ad.campaignName || "—"}
            </p>
            <p className="truncate" title={ad.adsetName}>
              Ad Set: {ad.adsetName || "—"}
            </p>
            <p className="font-mono">Ad ID: {ad.adId || "—"}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1">
              <span>
                {A ? "الصرف" : "Spend"}: {spendAvailable ? fmtUSD(ad.spend) : pending}
              </span>
              <span>
                {A ? "الليدز" : "Leads"}: {fmtNum(ad.leads)}
              </span>
              <span>
                {A ? "سعر الليد" : "CPL"}:{" "}
                {spendAvailable && ad.cpl !== null
                  ? fmtUSD(ad.cpl)
                  : spendAvailable
                    ? "—"
                    : pending}
              </span>
              <span>
                {A ? "البيع" : "Won"}: {fmtNum(ad.won)}
              </span>
              <span>
                {A ? "اللوست" : "Lost"}: {fmtNum(ad.lost)}
              </span>
              <span>
                {A ? "التحويل" : "Conversion"}:{" "}
                {ad.leads ? fmtPct((ad.won / ad.leads) * 100, 1) : "—"}
              </span>
              <span>
                {A ? "المبيعات" : "Revenue"}: {fmtUSD(ad.revenue)}
              </span>
              <span>
                ROAS:{" "}
                {spendAvailable ? (ad.roas === null ? "—" : `${ad.roas.toFixed(2)}×`) : pending}
              </span>
            </div>
            {ad.creativeId && (
              <button
                type="button"
                onClick={() => onOpenCreative(ad.creativeId)}
                className="mt-1.5 font-semibold text-brand hover:underline"
              >
                {A ? "عرض أصل الكرياتيف" : "View creative asset"}
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }
  const headers = A
    ? [
        "الحملة",
        "Ad Set",
        "Ad ID",
        "الصرف",
        "الليدز",
        "سعر الليد",
        "البيع",
        "اللوست",
        "التحويل",
        "المبيعات",
        "ROAS",
        "الأصل",
      ]
    : [
        "Campaign",
        "Ad set",
        "Ad ID",
        "Spend",
        "Leads",
        "CPL",
        "Won",
        "Lost",
        "Conversion",
        "Revenue",
        "ROAS",
        "Asset",
      ];
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[1120px] text-xs">
        <thead className="bg-surface-2 text-text-muted">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="whitespace-nowrap px-2.5 py-2 text-start font-semibold"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ads.map((ad) => (
            <tr key={ad.key} className="border-t border-border">
              <td className="max-w-[200px] truncate px-2.5 py-2" title={ad.campaignName}>
                {ad.campaignName || "—"}
              </td>
              <td className="max-w-[200px] truncate px-2.5 py-2" title={ad.adsetName}>
                {ad.adsetName || "—"}
              </td>
              <td className="px-2.5 py-2 font-mono text-[10px] text-text-muted">
                {ad.adId || "—"}
              </td>
              <td className="num whitespace-nowrap px-2.5 py-2">
                {spendAvailable ? fmtUSD(ad.spend) : pending}
              </td>
              <td className="num px-2.5 py-2">{fmtNum(ad.leads)}</td>
              <td className="num whitespace-nowrap px-2.5 py-2">
                {spendAvailable && ad.cpl !== null
                  ? fmtUSD(ad.cpl)
                  : spendAvailable
                    ? "—"
                    : pending}
              </td>
              <td className="num px-2.5 py-2">{fmtNum(ad.won)}</td>
              <td className="num px-2.5 py-2">{fmtNum(ad.lost)}</td>
              <td className="num px-2.5 py-2">
                {ad.leads ? fmtPct((ad.won / ad.leads) * 100, 1) : "—"}
              </td>
              <td className="num whitespace-nowrap px-2.5 py-2">{fmtUSD(ad.revenue)}</td>
              <td className="num px-2.5 py-2">
                {spendAvailable ? (ad.roas === null ? "—" : `${ad.roas.toFixed(2)}×`) : pending}
              </td>
              <td className="px-2.5 py-2">
                {ad.creativeId ? (
                  <button
                    type="button"
                    onClick={() => onOpenCreative(ad.creativeId)}
                    className="whitespace-nowrap font-semibold text-brand hover:underline"
                  >
                    {A ? "عرض الأصل" : "View asset"}
                  </button>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
