import { ArrowUpRight, BadgeCheck, Info, MessageCircle, RefreshCw, Wallet } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtDateTime, fmtNum, fmtUSDFull, useI18n } from "@/lib/i18n";
import { Card, Notice, Skeleton } from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import type { MarketingCostsReport } from "@/lib/marketing-costs.server";
import type { CampaignCostRow } from "@/lib/marketing-costs";
import { PLATFORM_LABEL } from "@/lib/constants";
import type { Platform } from "@/lib/types";

export function MarketingCosts({ compact = false }: { compact?: boolean }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const csvText = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
  const { data, isLoading, error, refetch, isFetching } = useApi<MarketingCostsReport>(
    `/api/marketing-costs${compact ? "?compact=1" : ""}`,
    { refetchInterval: 300000 },
  );
  if (isLoading)
    return (
      <Card>
        <p className="mb-3 text-sm font-semibold">
          {ar
            ? "جارٍ مطابقة مصروفات الإعلانات وواتساب…"
            : "Reading advertising and WhatsApp costs…"}
        </p>
        <Skeleton className="h-24" />
      </Card>
    );
  if (error || !data)
    return (
      <Notice tone="warning">
        {ar
          ? "مصروفات واتساب غير متاحة حاليًا؛ لم تُعتبر صفرًا ولم تتغير أرقام الإعلانات."
          : "WhatsApp costs are currently unavailable, not zero. Advertising figures are unchanged."}
        <button className="ms-3 underline" onClick={() => refetch()}>
          {ar ? "إعادة المحاولة" : "Retry"}
        </button>
      </Notice>
    );
  const wa = data.whatsapp;
  const dailyDates = [
    ...new Set([...data.ads.daily.map((p) => p.date), ...wa.daily.map((p) => p.date)]),
  ].sort();
  const dailyRows = dailyDates.map((date) => {
    const ad = data.ads.complete ? data.ads.daily.find((p) => p.date === date)?.spend || 0 : null;
    const cost =
      wa.complete && !wa.foreignCurrency
        ? wa.daily.find((p) => p.date === date)?.costUsd || 0
        : null;
    return {
      date,
      ad,
      cost,
      total:
        ad !== null && cost !== null && !data.scopeNarrowed && !data.possibleCostOverlap
          ? ad + cost
          : null,
    };
  });
  const category = (key: string) =>
    ({
      MARKETING: ar ? "تسويقية" : "Marketing",
      UTILITY: ar ? "خدمية / متابعة" : "Utility",
      SERVICE: ar ? "خدمة عملاء — رمز المزود" : "Service — provider code",
      AUTHENTICATION: ar ? "تحقق" : "Authentication",
      AUTHENTICATION_INTERNATIONAL: ar ? "تحقق دولي" : "International authentication",
    })[key] || (ar ? "تصنيف آخر" : key);
  const matchLabel = (key: string) =>
    ({
      before_invoice_day: ar
        ? "رسالة قبل يوم الفاتورة · مؤشر مساعدة"
        : "Message before invoice day · assisted",
      same_day_unknown_order: ar ? "نفس اليوم · الترتيب غير مثبت" : "Same day · order unproven",
      phone_unavailable: ar ? "لا يوجد رقم قابل للمطابقة" : "No usable phone evidence",
      no_match: ar ? "لا توجد مطابقة في الفترة" : "No match in period",
    })[key] || key;
  const metric = (label: string, value: number | null, note: string, accent = false) => (
    <div
      className={`min-w-0 rounded-2xl border p-4 ${accent ? "border-brand/25 bg-brand-soft/40" : "border-border bg-surface"}`}
    >
      <p className="text-xs font-semibold leading-5 text-text-muted">{label}</p>
      <p className="num mt-2 text-2xl font-black tracking-tight text-text">{fmtUSDFull(value)}</p>
      <p className="mt-2 text-[12px] leading-5 text-text-muted">{note}</p>
    </div>
  );
  const campaignCols: Col<CampaignCostRow>[] = [
    {
      key: "campaign",
      header: ar ? "حملة البرودكاست" : "Broadcast campaign",
      sticky: true,
      always: true,
      sortValue: (r) => r.campaign,
      render: (r) => (
        <span>
          <span className="block font-bold">{r.campaign}</span>
          <span className="text-[11px] text-text-muted">{r.templates.join(" · ")}</span>
        </span>
      ),
    },
    {
      key: "accepted",
      header: ar ? "مقبولة في Chatwoot" : "Accepted by Chatwoot",
      align: "right",
      sortValue: (r) => r.accepted,
      render: (r) => fmtNum(r.accepted),
    },
    {
      key: "estimated",
      header: ar ? "تقدير تكلفة — ليس فاتورة" : "Cost scenario — not a bill",
      align: "right",
      sortValue: (r) => r.estimatedUsd ?? -1,
      render: (r) => fmtUSDFull(r.estimatedUsd),
    },
    {
      key: "revenue",
      header: ar ? "فواتير ساهمت بمتابعتها" : "Assisted invoice value",
      align: "right",
      sortValue: (r) => r.assistedRevenue,
      render: (r) => (
        <span>
          {fmtUSDFull(r.assistedRevenue)}
          <span className="block text-[11px] text-text-muted">
            {fmtNum(r.assistedInvoices)}{" "}
            {ar ? "فاتورة · ليس إسنادًا سببيًا" : "invoices · not causal attribution"}
          </span>
        </span>
      ),
    },
    {
      key: "operator",
      header: ar ? "مشغّل الإرسال" : "Dispatch operator",
      render: (r) => r.operators.join(" · ") || "—",
    },
    {
      key: "errors",
      header: ar ? "أخطاء المهمة كاملة" : "Whole-job errors",
      align: "right",
      sortValue: (r) => r.errors,
      render: (r) => fmtNum(r.errors),
    },
    {
      key: "skipped",
      header: ar ? "متخطاة — كامل المهمة" : "Whole-job skipped",
      align: "right",
      sortValue: (r) => r.skipped,
      render: (r) => fmtNum(r.skipped),
    },
    {
      key: "jobs",
      header: ar ? "مهام" : "Jobs",
      align: "right",
      sortValue: (r) => r.jobs,
      render: (r) => fmtNum(r.jobs),
    },
  ];
  const invoiceCols: Col<(typeof wa.records)[number]>[] = [
    {
      key: "movement",
      header: ar ? "الفاتورة" : "Invoice",
      sticky: true,
      always: true,
      render: (r) => r.movement,
      sortValue: (r) => r.movement,
    },
    {
      key: "date",
      header: ar ? "تاريخ الفاتورة" : "Invoice date",
      render: (r) => r.invoiceDate || "—",
      sortValue: (r) => r.invoiceDate,
    },
    {
      key: "value",
      header: ar ? "القيمة" : "Value",
      align: "right",
      render: (r) => fmtUSDFull(r.revenue),
      sortValue: (r) => r.revenue,
    },
    {
      key: "source",
      header: ar ? "مصدر Odoo الأصلي" : "Original Odoo source",
      render: (r) => r.source || "—",
      sortValue: (r) => r.source,
    },
    {
      key: "match",
      header: ar ? "دليل الربط" : "Match evidence",
      render: (r) => matchLabel(r.match),
    },
    {
      key: "campaign",
      header: ar ? "آخر حملة قبل يوم الفاتورة" : "Last campaign before invoice day",
      render: (r) => r.campaign || "—",
    },
    {
      key: "candidates",
      header: ar ? "الحملات المطابقة" : "Matching campaigns",
      render: (r) => r.matchingCampaigns.join(" · ") || "—",
    },
  ];
  return (
    <section
      aria-label={ar ? "مصروفات الإعلانات وواتساب" : "Advertising and WhatsApp costs"}
      className="space-y-4"
    >
      <Card className="overflow-hidden !p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-brand-soft p-2.5 text-brand">
              <Wallet size={20} />
            </span>
            <div>
              <h2 className="font-bold text-text">
                {ar ? "مصروفات الإعلانات وواتساب" : "Advertising and WhatsApp costs"}
              </h2>
              <p className="mt-1 text-xs leading-6 text-text-muted">
                {ar
                  ? "الاستهلاك غير السحب البنكي. تكلفة واتساب لا تدخل مرة ثانية في صرف الإعلانات أو CPL."
                  : "Usage is not a bank charge. WhatsApp is not counted again in ad spend or advertising CPL."}
              </p>
            </div>
          </div>
          {compact ? (
            <a
              href="/accounting?view=messaging-costs"
              className="inline-flex items-center gap-1 text-xs font-bold text-brand"
            >
              {ar ? "التفاصيل والمطابقة" : "Details and reconciliation"}
              <ArrowUpRight size={15} />
            </a>
          ) : (
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-xs font-semibold"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
              {ar ? "تحديث" : "Refresh"}
            </button>
          )}
        </header>
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {metric(
            ar ? "استهلاك الإعلانات" : "Advertising usage",
            data.ads.complete ? data.ads.spendUsd : null,
            ar
              ? "من مصادر الإعلانات الحالية، لنفس الفلاتر."
              : "Existing advertising sources, under the selected filters.",
          )}
          {metric(
            ar ? "استهلاك حساب واتساب — قبل الضريبة" : "WhatsApp account usage — before tax",
            wa.reportedCostUsd,
            ar
              ? "قراءة Meta المباشرة للحساب كاملًا، وليست البرودكاست وحده."
              : "Direct Meta account-level read, not Broadcast alone.",
            true,
          )}
          {metric(
            ar ? "الإجمالي بدون تكرار" : "Combined usage without duplication",
            data.combinedUsageUsd,
            data.scopeNarrowed
              ? ar
                ? "لا نجمع تكلفة حساب واتساب كاملة مع فلتر فرعي غير موزع."
                : "Account-wide WhatsApp cost is not combined with an unallocated sub-filter."
              : ar
                ? "الإعلانات + واتساب. هذا استهلاك وليس سحوبات البطاقة."
                : "Advertising + WhatsApp. Usage, not card withdrawals.",
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-surface-2/50 px-5 py-3 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1">
            <BadgeCheck size={13} />
            {wa.complete
              ? ar
                ? "Meta متصل"
                : "Meta connected"
              : ar
                ? "قراءة واتساب ناقصة / غير متاحة"
                : "WhatsApp unavailable / partial"}
          </span>
          <span>
            {ar ? "الفترة" : "Period"}:{" "}
            <span className="num">
              {data.from} → {data.to}
            </span>
          </span>
          <span>
            {ar ? "تحديث" : "Read at"}: {fmtDateTime(data.generatedAt, lang)}
          </span>
        </div>
      </Card>
      {(data.notApplicable || data.scopeNarrowed) && (
        <Notice tone="info">
          {data.notApplicable
            ? ar
              ? "فلتر المنصة المختار لا يشمل واتساب Meta؛ لم تُعرض تكلفته كأنها تخص منصة أخرى."
              : "The selected platform excludes Meta WhatsApp; its costs are not assigned to another platform."
            : ar
              ? "مصروف واتساب على مستوى الحساب، وليس موزعًا بدقة على فلتر الكورس أو الموظف أو الشركة أو حملة الإعلانات. المبيعات تتبع فلاترك، وتفاصيل الإرسال للحساب كاملًا."
              : "WhatsApp spend is account-wide, not precisely allocated to the course, employee, company or advertising-campaign filter. Revenue follows your filters; dispatch details cover the whole account."}
        </Notice>
      )}
      {!wa.complete && (
        <Notice tone="warning">
          {ar
            ? "تعذّر إكمال قراءة كل حسابات واتساب للفترة؛ الرقم غير المتاح ليس صفرًا. اختر فترة لا تتجاوز سنة، أو أعد المحاولة."
            : "Not all WhatsApp accounts could be read. Unavailable is not zero. Select up to one year, or retry."}
        </Notice>
      )}
      {data.possibleCostOverlap && (
        <Notice tone="warning">
          {ar
            ? "ظهرت فئة تسويق رسائل LITE؛ أُوقِف الجمع مع الإعلانات إلى أن نتأكد من عدم التداخل في الفوترة."
            : "A LITE messaging category appeared. Combined spend is withheld until billing overlap is ruled out."}
        </Notice>
      )}
      {compact ? null : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            {metric(
              ar ? "تحصيل مصدر WhatsApp Broadcast" : "Collections sourced to WhatsApp Broadcast",
              wa.broadcastRevenue,
              ar
                ? `${fmtNum(wa.broadcastInvoices)} فاتورة. صافي إشعارات الخصم المسندة لنفس المصدر.`
                : `${fmtNum(wa.broadcastInvoices)} invoices. Net of credit notes assigned to the same source.`,
            )}
            {metric(
              ar
                ? "تحصيل باقي مصادر واتساب الصريحة"
                : "Collections from other explicit WhatsApp sources",
              wa.otherWhatsAppRevenue,
              ar
                ? "WhatsApp وUChat حسب مصدر Odoo، وليست مبيعات إضافية لإجمالي الشركة."
                : "WhatsApp and UChat by Odoo source; not additional company revenue.",
            )}
            {metric(
              ar ? "مبيعات بمصادر أخرى سبقها إرسال" : "Other-source sales preceded by a dispatch",
              data.campaigns.complete && data.campaigns.phoneCoverageComplete
                ? wa.assistedRevenue
                : null,
              ar
                ? "تطابق رقم + رسالة قبل يوم الفاتورة. مستبعد منه مصدر Broadcast، وليس إثباتًا لسبب البيع."
                : "Phone match + a dispatch before invoice day. Excludes Broadcast-source sales; not proof of causation.",
            )}
          </div>
          <Card>
            <h3 className="mb-3 inline-flex items-center gap-2 font-bold">
              <MessageCircle size={17} className="text-brand" />
              {ar ? "تغطية الإرسال والربط" : "Dispatch and matching coverage"}
            </h3>
            <div className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <span className="block text-xs text-text-muted">
                  {ar ? "مقبولة في Chatwoot" : "Accepted by Chatwoot"}
                </span>
                <b className="num text-xl">{data.campaigns.complete ? fmtNum(wa.accepted) : "—"}</b>
              </div>
              <div>
                <span className="block text-xs text-text-muted">
                  {ar ? "وصلت حسب حجم Meta للحساب" : "Meta account delivered volume"}
                </span>
                <b className="num text-xl">{wa.complete ? fmtNum(wa.volume) : "—"}</b>
              </div>
              <div>
                <span className="block text-xs text-text-muted">
                  {ar ? "مهام إرسال في الفترة" : "Dispatch jobs in period"}
                </span>
                <b className="num text-xl">
                  {data.campaigns.complete ? fmtNum(data.campaigns.totalJobs) : "—"}
                </b>
              </div>
              <div>
                <span className="block text-xs text-text-muted">
                  {ar
                    ? "فواتير بنفس يوم الرسالة — غير محسومة"
                    : "Same-day invoices — sequence unproven"}
                </span>
                <b className="num text-xl">{fmtNum(wa.sameDay)}</b>
              </div>
            </div>
            <p className="mt-3 text-xs leading-6 text-text-muted">
              {ar
                ? `تم فحص ${fmtNum(data.campaigns.scannedJobs)} مهمة محفوظة. قبول التطبيق لا يعني التسليم أو القراءة. ${fmtNum(wa.undatedOrUpperBound)} رسالة استُخدم لها وقت انتهاء المهمة كحد زمني محافظ بدل وقت رسالة مثبت.`
                : `${fmtNum(data.campaigns.scannedJobs)} stored jobs scanned. App acceptance is not delivery or read. ${fmtNum(wa.undatedOrUpperBound)} messages use job completion as a conservative time bound instead of a proven message time.`}
            </p>
          </Card>
          {(!data.campaigns.complete || !data.campaigns.phoneCoverageComplete) && (
            <Notice tone="warning">
              {ar
                ? "تغطية مهام الإرسال أو أرقام فواتير Odoo غير مكتملة. لا تعتبر المبيعات غير المرتبطة دليلًا على عدم وجود متابعة."
                : "Campaign history or Odoo invoice phone coverage is incomplete. An unmatched invoice does not prove absence of follow-up."}
            </Notice>
          )}
          {wa.serviceCostAnomaly && (
            <Notice tone="warning">
              {ar
                ? "Meta أعاد تكلفة تحت رمز SERVICE. احتُفظ بالمبلغ كما أرسله المزود؛ هذا التصنيف يحتاج مراجعة ولا يعني أن كل رد خدمة عملاء مدفوع."
                : "Meta returned a cost under SERVICE. The provider amount is preserved; the classification needs review and does not imply every service reply is charged."}
            </Notice>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-3 font-bold">
                {ar ? "تكلفة واتساب حسب التصنيف" : "WhatsApp cost by category"}
              </h3>
              <p className="mb-3 text-xs leading-5 text-text-muted">
                {ar
                  ? "تحليلات Meta تقريبية وقد تختلف عن الفاتورة. الأرقام بالدولار فقط إذا كانت عملة الحساب USD."
                  : "Meta analytics are approximate and may differ from invoices. USD is shown only for USD accounts."}
              </p>
              {wa.categories.map((c) => (
                <div
                  key={`${c.currency}:${c.category}`}
                  className="flex items-center justify-between gap-3 border-t border-border py-3 text-sm"
                >
                  <span>
                    {category(c.category)}
                    <small className="block text-text-muted">
                      {fmtNum(c.volume)} {ar ? "رسالة وصلت" : "delivered messages"}
                    </small>
                  </span>
                  <span className="num text-end font-bold">
                    {c.currency === "USD"
                      ? fmtUSDFull(c.cost)
                      : `${c.cost.toFixed(2)} ${c.currency}`}
                    <small className="block font-normal text-text-muted">
                      {c.volume
                        ? `${(c.cost / c.volume).toFixed(4)} ${c.currency} / ${ar ? "رسالة" : "message"}`
                        : "—"}
                    </small>
                  </span>
                </div>
              ))}
            </Card>
            <Card>
              <h3 className="mb-3 font-bold">
                {ar ? "أين صُرفت تكلفة الحساب؟" : "Account usage by business number"}
              </h3>
              {wa.phones.map((p) => (
                <div
                  key={`${p.accountId}:${p.phone}`}
                  className="flex justify-between gap-3 border-t border-border py-3 text-sm"
                >
                  <span className="num">
                    {p.phone}
                    <small className="block text-text-muted">
                      {fmtNum(p.volume)} {ar ? "رسالة" : "messages"}
                    </small>
                  </span>
                  <b className="num">
                    {p.currency === "USD"
                      ? fmtUSDFull(p.cost)
                      : `${p.cost.toFixed(2)} ${p.currency}`}
                  </b>
                </div>
              ))}
              <p className="mt-3 text-xs leading-6 text-text-muted">
                {ar
                  ? "صناديق Chatwoot المشتركة في نفس WABA لا تضاعف فاتورته. الأرقام تشمل أنظمة الإرسال الأخرى، وليس تطبيق الحملات وحده."
                  : "Chatwoot inboxes sharing a WABA do not duplicate its bill. Includes other sending systems, not just Campaigns."}
              </p>
            </Card>
          </div>
          <details className="card p-4">
            <summary className="cursor-pointer font-bold">
              {ar ? "الصرف يومًا بيوم" : "Daily usage comparison"}
            </summary>
            <p className="my-3 text-xs leading-6 text-text-muted">
              {ar
                ? "واتساب بتوقيت الرياض، والإعلانات بحسب توقيت حساب المنصة؛ نفس عنوان اليوم لا يثبت تطابق ساعات القياس. المبالغ ليست سحوبات بنكية."
                : "WhatsApp uses Riyadh time; ads use platform account reporting time. The same day label does not prove identical hourly boundaries. These are not bank charges."}
            </p>
            <p className="mb-3 text-xs text-text-muted">
              {data.ads.platforms
                .map(
                  (p) =>
                    `${PLATFORM_LABEL[p.platform as Platform]?.[lang] || p.platform}: ${fmtUSDFull(p.spend)}`,
                )
                .join(" · ")}
            </p>
            <DataTable
              rows={dailyRows}
              cols={[
                {
                  key: "date",
                  header: ar ? "اليوم" : "Day",
                  render: (r) => r.date,
                  sortValue: (r) => r.date,
                },
                {
                  key: "ad",
                  header: ar ? "الإعلانات" : "Advertising",
                  align: "right",
                  render: (r) => fmtUSDFull(r.ad),
                  sortValue: (r) => r.ad ?? -1,
                },
                {
                  key: "cost",
                  header: ar ? "حساب واتساب" : "WhatsApp account",
                  align: "right",
                  render: (r) => fmtUSDFull(r.cost),
                  sortValue: (r) => r.cost ?? -1,
                },
                {
                  key: "total",
                  header: ar ? "الإجمالي غير المكرر" : "Combined usage",
                  align: "right",
                  render: (r) => fmtUSDFull(r.total),
                  sortValue: (r) => r.total ?? -1,
                },
              ]}
              rowKey={(r) => r.date}
              csvFilename={`marketing-usage-daily-${data.from}-${data.to}`}
              csvRow={(r) => ({
                Date: r.date,
                Advertising_USD: r.ad ?? "",
                WhatsApp_USD: r.cost ?? "",
                Combined_USD: r.total ?? "",
              })}
            />
          </details>
          <details className="card p-4" open>
            <summary className="cursor-pointer font-bold">
              {ar
                ? "الحملات: الإرسال والتكلفة التقديرية والمبيعات المرتبطة"
                : "Campaigns: dispatches, cost scenarios and assisted sales"}
            </summary>
            <p className="my-3 text-xs leading-6 text-text-muted">
              {ar
                ? "التقدير = المقبول في التطبيق × متوسط تكلفة رسالة وصلت من نفس التصنيف في حساب Meta. يستخدم تصنيف القالب الحالي، ولا يثبت تكلفة الحملة أو التسليم، ولا يُضاف إلى تكلفة الحساب. تُسند الفاتورة لآخر حملة سبقت يومها مرة واحدة؛ مشغّل الإرسال ليس بالضرورة البائع أو الميديا باير. أخطاء وتخطي المهمة تخص كامل عمرها."
                : "Scenario = app-accepted messages × Meta account average delivered-message cost for the current template category. Not a campaign bill or delivery proof; not added to account cost. Each invoice is allocated once to its last preceding-day campaign. The dispatch operator is not necessarily the salesperson or media buyer. Errors/skips cover the whole job."}
            </p>
            <DataTable
              rows={wa.campaigns}
              cols={campaignCols}
              searchable={(r) => `${r.campaign} ${r.templates.join(" ")} ${r.operators.join(" ")}`}
              rowKey={(r) => r.campaign}
              csvFilename={`whatsapp-campaigns-${data.from}-${data.to}`}
              csvRow={(r) => ({
                Campaign: csvText(r.campaign),
                Accepted: r.accepted,
                Cost_scenario_USD: r.estimatedUsd ?? "",
                Assisted_invoice_value: r.assistedRevenue,
                Assisted_invoices: r.assistedInvoices,
                Operators: csvText(r.operators.join(" / ")),
              })}
            />
          </details>
          <details className="card p-4">
            <summary className="cursor-pointer font-bold">
              {ar ? "الفواتير ودليل ارتباطها بالحملات" : "Invoices and campaign-match evidence"}
            </summary>
            <p className="my-3 text-xs leading-6 text-text-muted">
              {ar
                ? "المصدر الأصلي محفوظ. المطابقة لا تغيّر مصدر العميل ولا أرقام الليدز أو الإيراد. رسائل نفس يوم الفاتورة منفصلة لأن تاريخ الفاتورة لا يثبت ساعة البيع. إسناد المساعدة لا يشمل إشعارات الخصم."
                : "Original sources are preserved. Matching does not change lead or revenue totals. Same-day messages stay separate because invoice dates do not prove the sale time. Assisted allocation excludes credit notes."}
            </p>
            <DataTable
              rows={wa.records}
              cols={invoiceCols}
              searchable={(r) => `${r.movement} ${r.source} ${r.campaign}`}
              rowKey={(r) => `${r.company}:${r.movement}`}
              csvFilename={`whatsapp-invoice-evidence-${data.from}-${data.to}`}
              csvRow={(r) => ({
                Invoice: csvText(r.movement),
                Invoice_date: r.invoiceDate,
                Reporting_date: r.reportingDate,
                USD: r.revenue,
                Original_source: csvText(r.source),
                Match: r.match,
                Campaign: csvText(r.campaign),
              })}
            />
          </details>
          <Card>
            <h3 className="mb-2 inline-flex items-center gap-2 font-bold">
              <Info size={17} />
              {ar
                ? "السحوبات والضريبة — منفصلة عن الاستهلاك"
                : "Card charges and tax — separate from usage"}
            </h3>
            <p className="text-sm leading-7 text-text-muted">
              {ar
                ? "إيصالات الدفع وكشف البطاقة غير موصولين كمصدر دوري مثبت حتى الآن؛ لذلك المسحوب، والضريبة، وفرق التسوية غير متاحة وليست صفرًا. لا نطبق نسبة ضريبة افتراضية، ولا نعتبر استهلاك Meta سحبًا بنكيًا. مقارنة التسوية تحتاج تواريخ الدفع وأرقام الإيصالات ومنتج Meta لكل عملية."
                : "Payment receipts/card statements are not yet connected as a verified recurring source. Charges, tax and the reconciliation difference are unavailable, not zero. No assumed tax rate is applied, and Meta usage is not treated as a bank charge. Reconciliation needs payment dates, receipt IDs and each transaction's Meta product."}
            </p>
          </Card>
        </>
      )}
    </section>
  );
}
