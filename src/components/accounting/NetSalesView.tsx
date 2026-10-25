import { Fragment, useState } from "react";
import {
  ArrowDownRight,
  BadgeCheck,
  BookOpenText,
  ChevronDown,
  ReceiptText,
  ShieldAlert,
} from "lucide-react";
import { monthLabel } from "./accounting-format";
import { ErrorState, Skeleton } from "@/components/ui-bits";
import { fmtPct, useI18n } from "@/lib/i18n";
import type { NetSalesMonth } from "@/lib/net-sales";
import { useApi } from "@/lib/use-api";

const fmtUSDFull = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface NetSalesResponse {
  period: { from: string; to: string };
  months: NetSalesMonth[];
  total: Omit<NetSalesMonth, "month" | "accounts" | "companies">;
  companies: string[];
  scope: "report" | "all" | "selected-company";
  accountCodes: { sales: string[]; gateway: string[]; vat: string[]; rounding: string[] };
  fxRates: { EGP: number; SAR: number };
}

export function NetSalesView() {
  const { lang } = useI18n();
  const [scope, setScope] = useState<"report" | "all">("report");
  const { data, isLoading, error, refetch } = useApi<NetSalesResponse>(
    `/api/accounting-net-sales?scope=${scope}`,
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;

  const ar = lang === "ar";
  const feeRate = data.total.salesUsd
    ? (data.total.gatewayFeesUsd / data.total.salesUsd) * 100
    : null;
  const rows = [...data.months].reverse();
  const maxSales = Math.max(1, ...rows.map((row) => Math.abs(row.salesUsd)));

  return (
    <section className="space-y-5" aria-label={ar ? "صافي المبيعات" : "Net company sales"}>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2 text-xs">
        <span className="px-2 font-semibold text-text-muted">
          {ar ? "نطاق الشركات" : "Company scope"}
        </span>
        <button
          type="button"
          onClick={() => setScope("report")}
          className={`rounded-lg px-3 py-2 font-semibold ${scope === "report" ? "bg-brand text-white" : "text-text hover:bg-surface-2"}`}
        >
          {ar ? "مصر + السعودية (حسب PDF)" : "Egypt + KSA (PDF scope)"}
        </button>
        <button
          type="button"
          onClick={() => setScope("all")}
          className={`rounded-lg px-3 py-2 font-semibold ${scope === "all" ? "bg-brand text-white" : "text-text hover:bg-surface-2"}`}
        >
          {ar ? "كل شركات الداشبورد" : "All dashboard companies"}
        </button>
        {data.scope === "selected-company" && (
          <span className="text-text-muted">
            {ar
              ? "فلتر الشركة العلوي يطبّق على التابين"
              : "The top company filter overrides this scope"}
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-[24px] border border-sky-200 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 px-5 py-6 text-white shadow-sm sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-200">
              <BadgeCheck size={17} />
              {ar ? "الرقم البيعي الحقيقي من قيود Odoo" : "Company sales from posted Odoo entries"}
            </div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl num">
              {fmtUSDFull(data.total.netSalesUsd)}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
              {ar
                ? "مبيعات النشاط بدون ضريبة القيمة المضافة، بعد خصم رسوم بوابات التحصيل والتقسيط المسجلة. شهادات المنتج 246 والإيرادات الأخرى خارج الرقم الرئيسي."
                : "Operating sales excluding VAT, less posted payment-platform and installment collection fees. Product 246 certificates and other income are outside the headline."}
            </p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-xs leading-6 text-slate-200">
            <div>
              {ar ? "فترة القيود" : "Posting period"}:{" "}
              <b className="num text-white">
                {data.period.from} → {data.period.to}
              </b>
            </div>
            <div>
              {ar ? "الشركات" : "Companies"}:{" "}
              <b className="text-white">{data.companies.join(" · ")}</b>
            </div>
            <div>
              {ar ? "أساس التاريخ" : "Date basis"}:{" "}
              <b className="text-white">{ar ? "تاريخ القيد المحاسبي" : "Journal entry date"}</b>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/15 pt-4 text-sm">
          <span className="num font-semibold">{fmtUSDFull(data.total.salesUsd)}</span>
          <span className="text-slate-300">{ar ? "مبيعات قبل الضريبة" : "Sales before VAT"}</span>
          <span className="text-slate-400">−</span>
          <span className="num font-semibold text-amber-300">
            {fmtUSDFull(data.total.gatewayFeesUsd)}
          </span>
          <span className="text-slate-300">{ar ? "رسوم التحصيل" : "Collection fees"}</span>
          <span className="text-slate-400">=</span>
          <span className="num font-bold text-emerald-300">
            {fmtUSDFull(data.total.netSalesUsd)}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={ar ? "مبيعات بدون ضريبة" : "Sales excluding VAT"}
          value={fmtUSDFull(data.total.salesUsd)}
          note={ar ? "حسابات إيراد النشاط المرحّلة" : "Posted operating income accounts"}
        />
        <Metric
          label={ar ? "رسوم المنصات والتقسيط" : "Platform and installment fees"}
          value={fmtUSDFull(data.total.gatewayFeesUsd)}
          note={`5121807 · ${feeRate === null ? "—" : fmtPct(feeRate, 1)} ${ar ? "من المبيعات" : "of sales"}`}
          warm
        />
        <Metric
          label={ar ? "ضريبة مخرجات مسجلة" : "Posted output VAT"}
          value={fmtUSDFull(data.total.outputVatUsd)}
          note={ar ? "للتوضيح فقط؛ غير مخصومة مرة ثانية" : "For reconciliation; not deducted again"}
        />
        <Metric
          label={ar ? "Write-Off / فروق تقريب" : "Write-offs / rounding"}
          value={fmtUSDFull(data.total.roundingUsd)}
          note={ar ? "رقابي منفصل؛ ليس Waiver مؤكّدًا" : "Separate control; not confirmed waivers"}
        />
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-bold text-text">
            <BookOpenText size={18} className="text-brand" />
            {ar ? "تحليل شهري مفصل" : "Detailed monthly analysis"}
          </h3>
          <span className="text-xs text-text-muted">
            {ar
              ? "غيّر الفترة من الفلتر العلوي لعرض شهور أخرى"
              : "Change the top date filter to see other months"}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="mt-6 rounded-xl bg-surface-2 p-5 text-sm text-text-muted">
            {ar
              ? "لا توجد قيود مرحّلة في الفترة المحددة."
              : "No posted entries in the selected period."}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[920px] table-fixed text-sm">
              <thead className="bg-surface-2 text-text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="w-[18%] px-4 py-3 text-start">
                    {ar ? "الشهر" : "Month"}
                  </th>
                  <th scope="col" className="w-[17%] px-4 py-3 text-end">
                    {ar ? "مبيعات قبل الضريبة" : "Sales ex VAT"}
                  </th>
                  <th scope="col" className="w-[16%] px-4 py-3 text-end">
                    {ar ? "رسوم التحصيل" : "Collection fees"}
                  </th>
                  <th scope="col" className="w-[18%] px-4 py-3 text-end">
                    {ar ? "صافي بعد الرسوم" : "Net after fees"}
                  </th>
                  <th scope="col" className="w-[15%] px-4 py-3 text-end">
                    {ar ? "ضريبة مخرجات" : "Output VAT"}
                  </th>
                  <th scope="col" className="w-[16%] px-4 py-3 text-end">
                    {ar ? "فروق تقريب" : "Rounding"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.month}>
                    <tr className="border-b border-border align-top">
                      <td className="px-4 py-3.5">
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === row.month ? null : row.month)}
                          className="flex w-full items-center gap-2 text-start font-semibold text-text hover:text-brand"
                          aria-expanded={expanded === row.month}
                        >
                          <ChevronDown
                            size={15}
                            className={`shrink-0 transition-transform ${expanded === row.month ? "rotate-180" : ""}`}
                          />
                          <span>{monthLabel(row.month, lang)}</span>
                        </button>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full bg-brand"
                            style={{
                              width: `${Math.min(100, (Math.abs(row.salesUsd) / maxSales) * 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                      <MoneyCell value={row.salesUsd} />
                      <MoneyCell value={row.gatewayFeesUsd} warm />
                      <MoneyCell value={row.netSalesUsd} strong />
                      <MoneyCell value={row.outputVatUsd} />
                      <MoneyCell value={row.roundingUsd} />
                    </tr>
                    {expanded === row.month && (
                      <tr className="border-b border-border bg-surface-2/50">
                        <td colSpan={6} className="px-4 py-3">
                          <MonthDetail row={row} ar={ar} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="bg-surface-2 font-semibold text-text">
                <tr className="border-t border-border">
                  <td className="px-4 py-3">{ar ? "إجمالي الفترة" : "Period total"}</td>
                  <MoneyCell value={data.total.salesUsd} />
                  <MoneyCell value={data.total.gatewayFeesUsd} warm />
                  <MoneyCell value={data.total.netSalesUsd} strong />
                  <MoneyCell value={data.total.outputVatUsd} />
                  <MoneyCell value={data.total.roundingUsd} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-4 text-sm leading-7 text-text-muted sm:p-5">
          <h3 className="mb-2 flex items-center gap-2 font-bold text-text">
            <ReceiptText size={17} className="text-brand" />
            {ar ? "بنود لا تدخل في الصافي" : "Outside the net sales figure"}
          </h3>
          <div className="flex justify-between gap-2">
            <span>{ar ? "شهادات المنتج 246" : "Product 246 certificates"}</span>
            <b className="num text-text">{fmtUSDFull(data.total.certificateUsd)}</b>
          </div>
          <div className="flex justify-between gap-2">
            <span>{ar ? "إيرادات أخرى غير مبيعات النشاط" : "Other, non-operating income"}</span>
            <b className="num text-text">{fmtUSDFull(data.total.otherIncomeUsd)}</b>
          </div>
          <p className="mt-2 text-xs">
            {ar
              ? "الرسوم البنكية العامة والاشتراكات ليست رسوم تحصيل منصات، ولم تُخصم هنا."
              : "General bank fees and subscriptions are not platform collection fees and are not subtracted here."}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm leading-7 text-amber-950 sm:p-5">
          <h3 className="mb-2 flex items-center gap-2 font-bold">
            <ShieldAlert size={17} />
            {ar ? "تنبيه محاسبي بخصوص الـWaiver" : "Accounting note on waivers"}
          </h3>
          <p>
            {ar
              ? "القيود الموسومة Write-Off التي وجدناها في Odoo تذهب إلى حسابات فروق التقريب 40000016/17. نعرض صافيها للمراجعة، ولا نعتبرها إعفاءات بيع أو نخصمها من الصافي بدون حساب Waiver معتمد من المحاسبة."
              : "The observed Write-Off journal items post to rounding accounts 40000016/17. Their net is visible for review, but is not treated as a sales waiver or deducted without an accounting-approved waiver account."}
          </p>
          <p className="mt-2 text-xs">
            {ar
              ? "المبالغ بالدولار محوّلة بسعر الداشبورد الحالي (والدرهم 3.6725)، وقد تختلف عن PDF الربح والخسارة الذي يستخدم سعر الصرف التاريخي."
              : "USD uses dashboard FX rates (AED at 3.6725) and can differ from the historical rates in Odoo's P&L PDF."}
          </p>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  note,
  warm = false,
}: {
  label: string;
  value: string;
  note: string;
  warm?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-text-muted">
        {warm ? (
          <ArrowDownRight size={15} className="text-amber-500" />
        ) : (
          <ReceiptText size={15} className="text-brand" />
        )}
        {label}
      </div>
      <div className="num mt-2 text-2xl font-bold text-text">{value}</div>
      <div className="mt-1 text-xs text-text-muted">{note}</div>
    </div>
  );
}

function MoneyCell({
  value,
  strong = false,
  warm = false,
}: {
  value: number;
  strong?: boolean;
  warm?: boolean;
}) {
  return (
    <td
      className={`num px-4 py-3.5 text-end tabular-nums ${strong ? "font-bold text-emerald-700" : warm ? "text-amber-700" : "text-text"}`}
    >
      {fmtUSDFull(value)}
    </td>
  );
}

function MonthDetail({ row, ar }: { row: NetSalesMonth; ar: boolean }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3 text-xs font-normal text-text-muted">
      <div className="font-semibold text-text">
        {ar ? "تفصيل الشركات والحسابات" : "Company and account detail"}
      </div>
      {row.companies.map((company) => (
        <div key={company.name} className="border-b border-border pb-1.5 last:border-0">
          <div className="font-semibold text-text">{company.name}</div>
          <div className="num">
            {ar ? "مبيعات" : "Sales"} {fmtUSDFull(company.salesUsd)} · {ar ? "رسوم" : "Fees"}{" "}
            {fmtUSDFull(company.gatewayFeesUsd)}
          </div>
        </div>
      ))}
      {row.accounts.map((account) => (
        <div key={`${account.code}-${account.name}`} className="flex justify-between gap-2">
          <span>
            {account.code} · {account.name} <span className="num">({account.entries})</span>
          </span>
          <b className="num text-text">{fmtUSDFull(account.amountUsd)}</b>
        </div>
      ))}
      <div className="border-t border-border pt-2">
        {ar ? "شهادات 246" : "Certificates 246"}:{" "}
        <b className="num">{fmtUSDFull(row.certificateUsd)}</b> ·{" "}
        {ar ? "إيراد آخر" : "Other income"}: <b className="num">{fmtUSDFull(row.otherIncomeUsd)}</b>
      </div>
    </div>
  );
}
