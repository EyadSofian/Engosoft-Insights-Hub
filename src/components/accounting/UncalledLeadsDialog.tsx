/**
 * The records behind "لم يتصل بها أحد" and "لم يتصل بها الموظف المسؤول".
 *
 * Both counters live on the employee tab and neither could be opened: a reader
 * who saw 995 un-contacted leads had no way to learn which 995, when they
 * arrived, or which of them still had a deal in them. This dialog is that list.
 *
 * It is kept out of `AccountingSubViews.tsx` because that file is already past
 * three thousand lines, and because the two mount sites — the company-wide
 * panel and one employee's profile sheet — differ only by the `employee` prop.
 */
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { ErrorState, Notice, Pill, Segmented, Skeleton } from "@/components/ui-bits";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import { MiniMetric } from "@/components/accounting/MiniMetric";
import { monthLabel } from "@/components/accounting/accounting-format";

export type UncalledScope = "none" | "owner";
type UncalledStatus = "fresh" | "critical" | "warning" | "stable";

interface UncalledLeadsResponse {
  ok: boolean;
  scope: UncalledScope;
  employee: string | null;
  range: { from: string; to: string };
  callsAvailable: boolean;
  callsError: string | null;
  lostAvailable: boolean;
  summary: {
    assignedLeads: number;
    calledByAny: number | null;
    uncalled: number | null;
    calledByOwner: number | null;
    ownerUncalled: number | null;
    rescuedByColleague: number | null;
    calls: number | null;
    callsPerLead: number | null;
    ownerCalls: number | null;
    ownerCallsPerLead: number | null;
    won: number;
    lost: number;
    closeRate: number | null;
    conversionRate: number | null;
    contactRate: number | null;
    ownerContactRate: number | null;
    severity: { fresh: number; critical: number; warning: number; stable: number };
  };
  months: Array<{
    month: string;
    leads: number;
    called: number;
    uncalled: number;
    ownerCalled: number;
    ownerUncalled: number;
    calls: number;
    callsPerLead: number | null;
    ownerCalls: number;
    ownerCallsPerLead: number | null;
    won: number;
    lost: number;
    closeRate: number | null;
    conversionRate: number | null;
    contactRate: number | null;
  }>;
  leads: {
    rows: Array<{
      id: string;
      contact: string;
      phone: string;
      salesperson: string;
      stage: string;
      course: string;
      priority: string;
      callingReply: string;
      createdAt: string;
      lastStageUpdate: string;
      ageDays: number | null;
      outcome: "won" | "lost" | "open";
      calledByAny: boolean;
      calledByOwner: boolean;
      totalCalls: number;
      calledBy: string[];
      latestCallAt: string | null;
      status: UncalledStatus;
      reasons: string[];
      url: string | null;
      latestCallUrl: string | null;
    }>;
    total: number;
    unfilteredTotal: number;
    page: number;
    pageSize: number;
    totalPages: number;
    hasNext: boolean;
  };
}

const UNCALLED_REASON_LABELS: Record<string, { ar: string; en: string }> = {
  hot_priority: { ar: "أولوية Hot", en: "Hot priority" },
  active_deal: { ar: "عرض سعر أو مهتم", en: "Live quotation or interest" },
  fresh_window: { ar: "جديد داخل مهلة الرد", en: "Inside response grace window" },
  reply_without_call: { ar: "رد مسجّل بلا مكالمة", en: "Reply logged, no PBX call" },
  stalled_stage: { ar: "مرحلة متوقفة", en: "Parked stage" },
  aging_untouched: { ar: "يكبر بلا تواصل", en: "Ageing untouched" },
  won_without_call: { ar: "رابح بلا مكالمة", en: "Won with no call" },
  junk_stage: { ar: "رقم خطأ أو بيانات قديمة", en: "Wrong number or old data" },
};

function uncalledStatusTone(status: UncalledStatus): "danger" | "warning" | "brand" | "neutral" {
  if (status === "critical") return "danger";
  if (status === "warning") return "warning";
  if (status === "fresh") return "brand";
  return "neutral";
}

function uncalledStatusLabel(status: UncalledStatus, lang: "ar" | "en"): string {
  if (status === "critical") return lang === "ar" ? "حرج" : "Critical";
  if (status === "warning") return lang === "ar" ? "للمتابعة" : "Watch";
  if (status === "fresh") return lang === "ar" ? "جديد داخل المهلة" : "New — in grace window";
  return lang === "ar" ? "غير عاجل" : "Not urgent";
}

/**
 * The drill-down behind the two un-contacted counters.
 *
 * `none` and `owner` are different populations and the header says so out loud:
 * a lead its owner ignored but a colleague called is inside `owner` and outside
 * `none`, which is the whole reason the two tiles never match.
 */
export function UncalledLeadsDialog({
  scope,
  employee,
  onOpenChange,
}: {
  scope: UncalledScope | null;
  employee?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { lang } = useI18n();
  const [sort, setSort] = useState<"urgent" | "newest" | "oldest">("newest");
  const [status, setStatus] = useState<UncalledStatus | "all">("all");
  const [page, setPage] = useState(1);

  // A new tile is a new question: reopening must not inherit the last filter.
  useEffect(() => {
    if (scope) {
      setSort("newest");
      setStatus("all");
      setPage(1);
    }
  }, [scope, employee]);
  useEffect(() => setPage(1), [sort, status]);

  const query =
    `/api/uncalled-leads?scope=${scope ?? "none"}&sort=${sort}&status=${status}&page=${page}&pageSize=50` +
    (employee ? `&employee=${encodeURIComponent(employee)}` : "");
  const { data, isLoading, error, refetch } = useApi<UncalledLeadsResponse>(query, {
    enabled: scope !== null,
  });

  const dayLabel = (days: number | null) =>
    days === null
      ? "—"
      : lang === "ar"
        ? days === 0
          ? "نفس اليوم"
          : `${fmtNum(days)} يوم`
        : days === 0
          ? "same day"
          : `${fmtNum(days)}d`;

  return (
    <Dialog open={scope !== null} onOpenChange={onOpenChange}>
      <DialogContent
        dir={lang === "ar" ? "rtl" : "ltr"}
        className="max-h-[88vh] w-[min(96vw,1080px)] max-w-none overflow-y-auto rounded-2xl border-border bg-surface p-0 text-text"
      >
        {scope && (
          <>
            <DialogHeader className="sticky top-0 z-10 border-b border-border bg-surface px-5 py-4 pe-12 text-start">
              <DialogTitle>
                {scope === "none"
                  ? lang === "ar"
                    ? "ليدز لم يتصل بها أحد"
                    : "Leads nobody called"
                  : lang === "ar"
                    ? "ليدز لم يتصل بها الموظف المسؤول"
                    : "Leads the assigned owner never called"}
                {employee ? ` — ${employee}` : ""}
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed text-text-muted">
                {scope === "none"
                  ? lang === "ar"
                    ? "لا توجد أي مكالمة على رقم الليد في Yeastar داخل الفترة المختارة — لا من الموظف المسؤول ولا من غيره."
                    : "No Yeastar call matched the lead's phone inside the selected window — not from its owner, not from anyone else."
                  : lang === "ar"
                    ? "الموظف المسؤول لم يتصل بها. القائمة تشمل ليدز اتصل بها زميل آخر، ولذلك رقمها أكبر دائمًا من «لم يتصل بها أحد»."
                    : "The assigned owner never dialled these. The list includes leads a colleague did call, which is why this figure always exceeds “nobody called”."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 p-4 sm:p-5">
              {isLoading ? (
                <Skeleton className="h-96" />
              ) : error ? (
                <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
              ) : data ? (
                <>
                  {!data.lostAvailable && (
                    <Notice tone="warning">
                      {lang === "ar"
                        ? "مصدر الليدز الخاسرة غير متاح الآن، فالمقام ناقص ونسبة الإغلاق تظهر «—» بدل رقم يبدو 100%."
                        : "The Lost feed is unavailable, so the denominator is incomplete and the close rate is withheld rather than shown as a flattering 100%."}
                    </Notice>
                  )}
                  {!data.callsAvailable && (
                    <Notice tone="warning">
                      {lang === "ar"
                        ? `مطابقة المكالمات غير متاحة الآن، فلا يمكن تأكيد من اتصل بمن. ${data.callsError ?? ""}`
                        : `Call matching is unavailable, so contact cannot be confirmed. ${data.callsError ?? ""}`}
                    </Notice>
                  )}

                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                    <MiniMetric
                      label={lang === "ar" ? "في هذه القائمة" : "In this list"}
                      value={fmtNum(data.leads.unfilteredTotal)}
                      hint={
                        lang === "ar"
                          ? `من ${fmtNum(data.summary.assignedLeads)} ليد موزعة`
                          : `of ${fmtNum(data.summary.assignedLeads)} assigned`
                      }
                    />
                    <MiniMetric
                      label={lang === "ar" ? "حالات حرجة" : "Critical"}
                      value={fmtNum(data.summary.severity.critical)}
                      hint={
                        lang === "ar"
                          ? `${fmtNum(data.summary.severity.warning)} للمتابعة`
                          : `${fmtNum(data.summary.severity.warning)} to watch`
                      }
                    />
                    <MiniMetric
                      label={lang === "ar" ? "جديد داخل المهلة" : "New — in grace window"}
                      value={fmtNum(data.summary.severity.fresh)}
                      hint={
                        lang === "ar"
                          ? "داخل مهلة الرد؛ لا يُصنف حرجًا في يوم إنشائه"
                          : "Inside the response grace period; never critical on creation day"
                      }
                    />
                    <MiniMetric
                      label={lang === "ar" ? "نسبة الإغلاق" : "Close rate"}
                      value={fmtPct(data.summary.closeRate, 1)}
                      hint={
                        lang === "ar"
                          ? `${fmtNum(data.summary.won)} رابحة · ${fmtNum(data.summary.lost)} خاسرة`
                          : `${fmtNum(data.summary.won)} won · ${fmtNum(data.summary.lost)} lost`
                      }
                    />
                    <MiniMetric
                      label={lang === "ar" ? "مكالمات المسؤول لكل ليد" : "Owner calls per lead"}
                      value={
                        data.summary.ownerCallsPerLead === null
                          ? "—"
                          : data.summary.ownerCallsPerLead.toFixed(2)
                      }
                      hint={
                        lang === "ar"
                          ? `${data.summary.ownerCalls === null ? "—" : fmtNum(data.summary.ownerCalls)} مكالمة من أصحاب الليدز على ليدز الفترة`
                          : `${data.summary.ownerCalls === null ? "—" : fmtNum(data.summary.ownerCalls)} calls by assigned owners on period leads`
                      }
                    />
                  </div>

                  {scope === "owner" && data.summary.rescuedByColleague !== null && (
                    <p className="rounded-xl border border-border bg-surface-2/50 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
                      {lang === "ar"
                        ? `منهم ${fmtNum(data.summary.rescuedByColleague)} ليد اتصل بها زميل آخر بدل الموظف المسؤول، والباقي (${fmtNum(data.summary.uncalled ?? 0)}) لم يتصل بها أحد إطلاقًا.`
                        : `${fmtNum(data.summary.rescuedByColleague)} of these were called by a colleague instead of their owner; the remaining ${fmtNum(data.summary.uncalled ?? 0)} were never called by anyone.`}
                    </p>
                  )}

                  {/* --- the monthly ratios --- */}
                  <article className="overflow-hidden rounded-2xl border border-border bg-surface">
                    <header className="border-b border-border bg-surface-2/65 px-4 py-3">
                      <b className="text-sm text-text">
                        {lang === "ar" ? "التوزيع بالشهر" : "Month by month"}
                      </b>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-text-muted">
                        {lang === "ar"
                          ? "كل ليد محسوب على شهر إنشائه هو، لا على شهر إقفاله. نسبة الإغلاق = الرابحة ÷ اللي اتحسم، والشهر اللي لسه ما حسمش حاجة يظهر «—» لا صفر."
                          : "Each lead counts against its own creation month, not its closing month. Close rate is won ÷ decided; a month that has decided nothing shows “—”, never a zero."}
                      </p>
                    </header>
                    <div className="table-wrap max-h-56 overflow-auto">
                      <table className="w-full min-w-[960px] text-start text-[11px]">
                        <thead className="sticky top-0 bg-surface-2/90 text-text-muted">
                          <tr>
                            <th className="px-3 py-2 text-start font-medium">
                              {lang === "ar" ? "الشهر" : "Month"}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">
                              {lang === "ar" ? "الليدز" : "Leads"}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">
                              {lang === "ar" ? "لم يتصل بها أحد" : "Nobody called"}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">
                              {lang === "ar" ? "لم يتصل بها المسؤول" : "Owner never called"}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">
                              {lang === "ar" ? "المكالمات" : "Calls"}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">
                              {lang === "ar" ? "مكالمات/ليد" : "Calls/lead"}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">
                              {lang === "ar" ? "مكالمات المسؤول" : "Owner calls"}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">
                              {lang === "ar" ? "مكالمات المسؤول/ليد" : "Owner calls/lead"}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">
                              {lang === "ar" ? "نسبة الإغلاق" : "Close rate"}
                            </th>
                            <th className="px-3 py-2 text-start font-medium">
                              {lang === "ar" ? "نسبة التواصل" : "Contact rate"}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {data.months.map((row) => (
                            <tr key={row.month} className="hover:bg-surface-2/40">
                              <td className="whitespace-nowrap px-3 py-2 font-medium text-text">
                                {monthLabel(row.month, lang)}
                              </td>
                              <td className="num px-3 py-2">{fmtNum(row.leads)}</td>
                              <td className="num px-3 py-2">{fmtNum(row.uncalled)}</td>
                              <td className="num px-3 py-2">{fmtNum(row.ownerUncalled)}</td>
                              <td className="num px-3 py-2">{fmtNum(row.calls)}</td>
                              <td className="num px-3 py-2">
                                {row.callsPerLead === null ? "—" : row.callsPerLead.toFixed(2)}
                              </td>
                              <td className="num px-3 py-2">{fmtNum(row.ownerCalls)}</td>
                              <td className="num px-3 py-2">
                                {row.ownerCallsPerLead === null
                                  ? "—"
                                  : row.ownerCallsPerLead.toFixed(2)}
                              </td>
                              <td className="num px-3 py-2">{fmtPct(row.closeRate, 1)}</td>
                              <td className="num px-3 py-2">{fmtPct(row.contactRate, 1)}</td>
                            </tr>
                          ))}
                          {data.months.length === 0 && (
                            <tr>
                              <td colSpan={10} className="px-3 py-4 text-text-muted">
                                {lang === "ar"
                                  ? "لا توجد ليدز في الفترة."
                                  : "No leads in this period."}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </article>

                  {/* --- controls --- */}
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="table-wrap scroll-hint-x">
                      <span className="mb-1.5 block text-xs font-medium text-text-muted">
                        {lang === "ar" ? "الترتيب" : "Order"}
                      </span>
                      <Segmented
                        value={sort}
                        onChange={setSort}
                        options={[
                          {
                            value: "urgent",
                            label: lang === "ar" ? "الأخطر ثم الأحدث" : "Most urgent",
                          },
                          { value: "newest", label: lang === "ar" ? "الأحدث" : "Newest" },
                          { value: "oldest", label: lang === "ar" ? "الأقدم" : "Oldest" },
                        ]}
                      />
                    </div>
                    <div className="table-wrap scroll-hint-x">
                      <span className="mb-1.5 block text-xs font-medium text-text-muted">
                        {lang === "ar" ? "الحالة" : "Severity"}
                      </span>
                      <Segmented
                        value={status}
                        onChange={setStatus}
                        options={[
                          {
                            value: "all",
                            label: `${lang === "ar" ? "الكل" : "All"} (${fmtNum(data.leads.unfilteredTotal)})`,
                          },
                          {
                            value: "fresh",
                            label: `${lang === "ar" ? "جديد داخل المهلة" : "New — in grace window"} (${fmtNum(data.summary.severity.fresh)})`,
                          },
                          {
                            value: "critical",
                            label: `${lang === "ar" ? "حرج" : "Critical"} (${fmtNum(data.summary.severity.critical)})`,
                          },
                          {
                            value: "warning",
                            label: `${lang === "ar" ? "للمتابعة" : "Watch"} (${fmtNum(data.summary.severity.warning)})`,
                          },
                          {
                            value: "stable",
                            label: `${lang === "ar" ? "غير عاجل" : "Not urgent"} (${fmtNum(data.summary.severity.stable)})`,
                          },
                        ]}
                      />
                    </div>
                  </div>

                  {/* --- the leads --- */}
                  <article className="overflow-hidden rounded-2xl border border-border bg-surface">
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/65 px-4 py-3">
                      <div>
                        <b className="text-sm text-text">
                          {lang === "ar" ? "الليدز" : "The leads"}
                        </b>
                        <p className="mt-0.5 text-[10px] text-text-muted">
                          <bdi dir="ltr" className="num">
                            {fmtNum(data.leads.total)}
                          </bdi>{" "}
                          {lang === "ar"
                            ? "ليد · كل زر يفتح السجل الأصلي"
                            : "leads · every button opens the source record"}
                        </p>
                      </div>
                      {data.leads.totalPages > 1 && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={data.leads.page <= 1}
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-semibold text-text disabled:opacity-40"
                          >
                            {lang === "ar" ? "السابق" : "Previous"}
                          </button>
                          <span className="num text-[10px] text-text-muted">
                            {data.leads.page} / {data.leads.totalPages}
                          </span>
                          <button
                            type="button"
                            disabled={!data.leads.hasNext}
                            onClick={() => setPage((current) => current + 1)}
                            className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-semibold text-text disabled:opacity-40"
                          >
                            {lang === "ar" ? "التالي" : "Next"}
                          </button>
                        </div>
                      )}
                    </header>
                    <div className="max-h-[26rem] divide-y divide-border overflow-auto">
                      {data.leads.rows.map((lead) => (
                        <div
                          key={lead.id}
                          className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <b className="truncate text-xs text-text">
                                {lead.contact || lead.phone || `#${lead.id}`}
                              </b>
                              <Pill tone={uncalledStatusTone(lead.status)}>
                                {uncalledStatusLabel(lead.status, lang)}
                              </Pill>
                            </div>
                            <small className="mt-1 block text-[10px] text-text-muted">
                              {lang === "ar" ? "أُنشئ" : "Created"}{" "}
                              <bdi dir="ltr" className="num">
                                {lead.createdAt.slice(0, 10) || "—"}
                              </bdi>
                              {" · "}
                              {lang === "ar" ? "عمره" : "age"}{" "}
                              <bdi dir="ltr" className="num">
                                {dayLabel(lead.ageDays)}
                              </bdi>
                              {" · "}
                              {lead.stage || "—"}
                              {lead.priority ? ` · ${lead.priority}` : ""}
                              {lead.course ? ` · ${lead.course}` : ""}
                            </small>
                            {!employee && (
                              <small className="mt-0.5 block truncate text-[10px] text-text-muted">
                                {lang === "ar" ? "المسؤول" : "Owner"}: {lead.salesperson || "—"}
                                {scope === "owner" && lead.calledBy.length > 0 && (
                                  <>
                                    {" "}
                                    · {lang === "ar" ? "اتصل بها" : "called by"}{" "}
                                    {lead.calledBy.join("، ")}
                                  </>
                                )}
                              </small>
                            )}
                            {lead.reasons.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {lead.reasons.map((reason) => (
                                  <span
                                    key={reason}
                                    className="rounded-md border border-border bg-surface-2/60 px-1.5 py-0.5 text-[9px] text-text-muted"
                                  >
                                    {UNCALLED_REASON_LABELS[reason]?.[lang] ?? reason}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <span className="flex shrink-0 flex-wrap gap-1.5">
                            {lead.latestCallUrl && (
                              <a
                                href={lead.latestCallUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border border-brand/20 bg-brand-soft/40 px-2.5 py-1.5 text-[10px] font-semibold text-brand hover:bg-brand-soft"
                              >
                                {lang === "ar" ? "مكالمة الزميل" : "Colleague's call"}
                                <ExternalLink size={11} className="ms-1 inline" />
                              </a>
                            )}
                            {lead.url ? (
                              <a
                                href={lead.url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border border-brand/20 px-2.5 py-1.5 text-[10px] font-semibold text-brand hover:bg-brand-soft"
                              >
                                {lang === "ar" ? "فتح الليد" : "Open lead"}
                                <ExternalLink size={11} className="ms-1 inline" />
                              </a>
                            ) : (
                              <bdi dir="ltr" className="num text-[10px] text-text-muted">
                                #{lead.id}
                              </bdi>
                            )}
                          </span>
                        </div>
                      ))}
                      {data.leads.rows.length === 0 && (
                        <p className="p-4 text-xs text-text-muted">
                          {lang === "ar"
                            ? "لا توجد ليدز مطابقة لهذا الاختيار."
                            : "No leads match this selection."}
                        </p>
                      )}
                    </div>
                  </article>

                  <p className="text-[10px] leading-relaxed text-text-muted">
                    {lang === "ar"
                      ? "المطابقة تتم بآخر 9 أرقام من رقم الهاتف بين Odoo و Yeastar، وداخل نفس الفترة فقط: مكالمة تمت قبل بداية الفترة أو بعد نهايتها لا تُحتسب. «عمر الليد» محسوب حتى نهاية الفترة المختارة، لا حتى اليوم."
                      : "Matching uses the last nine phone digits between Odoo and Yeastar, inside the selected window only: a call placed before it starts or after it ends does not count. Age is measured to the end of the selected window, not to today."}
                  </p>
                </>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
