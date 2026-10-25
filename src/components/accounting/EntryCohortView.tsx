import { Info, Users } from "lucide-react";
import { Card, ErrorState, Notice, SectionTitle, Skeleton } from "@/components/ui-bits";
import { monthLabel } from "@/components/accounting/accounting-format";
import { fmtNum, fmtPct, fmtUSDFull, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { EntryMonthCohortResult } from "@/lib/revenue-cohort";

interface CohortResponse extends Partial<EntryMonthCohortResult> {
  ok: boolean;
  available: boolean;
  reason: string | null;
  linksRefreshedAt: string | null;
  ignoredFilters: string[];
  labels: {
    collected: { en: string; ar: string };
    generated: { en: string; ar: string };
  };
}

/**
 * Customer entry-month cohorts: for the customers who entered in each month,
 * how many paid invoices and how much paid revenue they produced so far.
 * Separate from monthly collections, and labelled so the two are never read
 * as the same number.
 */
export function EntryCohortView() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const { data, isLoading, error, refetch } = useApi<CohortResponse>("/api/revenue-cohorts");
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (isLoading || !data) return <Skeleton className="h-96" />;

  const reconciliation = data.reconciliation;
  const money = (value: number | null | undefined) => (value == null ? "—" : fmtUSDFull(value));
  const days = (value: number | null | undefined) =>
    value == null ? "—" : A ? `${fmtNum(value)} يوم` : `${fmtNum(value)} days`;

  return (
    <div className="space-y-4">
      <Notice tone="info" icon={<Info size={16} />}>
        <b>{A ? data.labels.generated.ar : data.labels.generated.en}</b>
        {" — "}
        {A
          ? `إيراد مدفوع بأي تاريخ دفع حتى ${data.asOf ?? "اليوم"}، منسوب لشهر إنشاء سجل CRM عبر رابط أمر البيع ← الفرصة. هذا ليس «${data.labels.collected.ar}» الذي يعتمد تاريخ الدفع في تقرير التحصيل.`
          : `Paid at any payment date up to ${data.asOf ?? "today"}, credited to the month the CRM record was created through the sale order → opportunity link. This is not "${data.labels.collected.en}", which follows payment date in the collection report.`}
      </Notice>

      {!data.available ? (
        <Notice tone="warning">
          {A
            ? "روابط أوامر البيع بالفرص غير متاحة بعد، لذلك لا يمكن بناء الكوهورت بدقة."
            : "Sale-order links to opportunities are not available yet, so cohorts cannot be built exactly."}
        </Notice>
      ) : null}

      {data.ignoredFilters.length ? (
        <Notice tone="warning">
          {A
            ? `هذا التقرير لا يطبق فلاتر: ${data.ignoredFilters.join("، ")}. الكوهورت مجموعة سجلات CRM كاملة.`
            : `This report does not apply: ${data.ignoredFilters.join(", ")}. A cohort is the whole CRM population.`}
        </Notice>
      ) : null}

      <Card>
        <SectionTitle
          hint={
            A
              ? "شهر الدخول = شهر إنشاء سجل CRM. العملاء = سجلات CRM مميزة."
              : "Entry month = month the CRM record was created. Customers = distinct CRM records."
          }
        >
          <span className="inline-flex items-center gap-2">
            <Users size={16} />
            {A ? "كوهورت دخول العملاء والإيراد" : "Customer entry-month revenue cohorts"}
          </span>
        </SectionTitle>
        <div className="table-wrap scroll-hint-x">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2 text-start">{A ? "شهر الدخول" : "Entry month"}</th>
                <th className="px-3 py-2 text-end">
                  {A ? "ليدز/عملاء CRM فريدة" : "Unique CRM leads"}
                </th>
                <th className="px-3 py-2 text-end">{A ? "مكسوب" : "Won"}</th>
                <th className="px-3 py-2 text-end">
                  {A ? "عملاء بفاتورة مدفوعة" : "Customers with paid invoice"}
                </th>
                <th className="px-3 py-2 text-end">
                  {A ? "فواتير مدفوعة مميزة" : "Distinct paid invoices"}
                </th>
                <th className="px-3 py-2 text-end">{A ? "الإيراد المدفوع" : "Paid revenue"}</th>
                <th className="px-3 py-2 text-end">{A ? "تحويل لفاتورة" : "Invoice conversion"}</th>
                <th className="px-3 py-2 text-end">
                  {A ? "متوسط الإيراد لكل عميل" : "Avg paid revenue / customer"}
                </th>
                <th className="px-3 py-2 text-end">
                  {A ? "الوقت لأول فاتورة (وسيط)" : "Time to first invoice (median)"}
                </th>
              </tr>
            </thead>
            <tbody>
              {(data.rows ?? []).map((row) => (
                <tr key={row.entryMonth} className="border-t border-border">
                  <td className="px-3 py-2.5">{monthLabel(row.entryMonth, lang)}</td>
                  <td className="num px-3 py-2.5 text-end">{fmtNum(row.uniqueLeads)}</td>
                  <td className="num px-3 py-2.5 text-end">{fmtNum(row.won)}</td>
                  <td className="num px-3 py-2.5 text-end">
                    {fmtNum(row.customersWithPaidInvoice)}
                  </td>
                  <td className="num px-3 py-2.5 text-end">{fmtNum(row.distinctPaidInvoices)}</td>
                  <td className="num px-3 py-2.5 text-end font-semibold">
                    {money(row.paidRevenue)}
                  </td>
                  <td className="num px-3 py-2.5 text-end">
                    {fmtPct(row.invoiceConversionRate, 1)}
                  </td>
                  <td className="num px-3 py-2.5 text-end">
                    {money(row.averagePaidRevenuePerCustomer)}
                  </td>
                  <td className="num px-3 py-2.5 text-end">{days(row.medianDaysToFirstInvoice)}</td>
                </tr>
              ))}
              {data.totals ? (
                <tr className="border-t-2 border-border bg-surface-2/60 font-semibold">
                  <td className="px-3 py-2.5">{A ? "الإجمالي" : "Total"}</td>
                  <td className="num px-3 py-2.5 text-end">{fmtNum(data.totals.uniqueLeads)}</td>
                  <td className="num px-3 py-2.5 text-end">{fmtNum(data.totals.won)}</td>
                  <td className="num px-3 py-2.5 text-end">
                    {fmtNum(data.totals.customersWithPaidInvoice)}
                  </td>
                  <td className="num px-3 py-2.5 text-end">
                    {fmtNum(data.totals.distinctPaidInvoices)}
                  </td>
                  <td className="num px-3 py-2.5 text-end">{money(data.totals.paidRevenue)}</td>
                  <td className="num px-3 py-2.5 text-end">
                    {fmtPct(data.totals.invoiceConversionRate, 1)}
                  </td>
                  <td className="num px-3 py-2.5 text-end">
                    {money(data.totals.averagePaidRevenuePerCustomer)}
                  </td>
                  <td className="num px-3 py-2.5 text-end">
                    {days(data.totals.medianDaysToFirstInvoice)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {reconciliation ? (
        <Card padded>
          <SectionTitle
            hint={
              A
                ? "كل فواتير الحسابات المدفوعة حتى تاريخ اليوم؛ الأجزاء تجمع دائمًا للإجمالي."
                : "Every Accounting paid line up to today; the parts always add up to the total."
            }
          >
            {A ? "مطابقة مع الحسابات" : "Reconciliation to Accounting"}
          </SectionTitle>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                [
                  A ? "إجمالي الحسابات حتى اليوم" : "Accounting total to date",
                  money(reconciliation.totalAccountingRevenue),
                ],
                [
                  A ? "كوهورت الفترة" : "Cohorts in the window",
                  money(reconciliation.cohortRevenue),
                ],
                [
                  A ? "كوهورتات أخرى" : "Other entry months",
                  money(reconciliation.otherCohortsRevenue),
                ],
                [
                  A ? "مرتبط بفرصة خارج CRM المحمّل" : "Linked to an opportunity not in CRM",
                  money(reconciliation.linkedUnknownCrmRevenue),
                ],
                [
                  A ? "غير مرتبط بفرصة" : "Not linked to an opportunity",
                  money(reconciliation.unlinkedRevenue),
                ],
                [A ? "نسبة الربط" : "Linked share", fmtPct(reconciliation.linkedShare, 1)],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5"
              >
                <dt className="text-text-muted">{label}</dt>
                <dd className="num font-semibold text-text">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}
    </div>
  );
}
