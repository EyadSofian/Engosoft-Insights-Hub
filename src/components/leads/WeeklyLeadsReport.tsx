import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, PhoneCall, PhoneMissed, RefreshCw, ShieldCheck } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtNum, useI18n } from "@/lib/i18n";
import { ErrorState, Skeleton } from "@/components/ui-bits";

interface WeeklyRow {
  id: string; createdAt: string; contact: string; course: string; salesperson: string;
  type: string; stage: string; status: string; callStatus: "answered" | "attempted_no_answer" | "no_pbx_record" | "unknown";
  attempts: number; answeredCalls: number; retriedNoAnswer: boolean;
  quality: "valid" | "invalid" | "unverified"; odooUrl: string;
}
interface WeeklyResponse {
  period: { from: string; to: string; fullWeekEnd: string };
  availability: { calls: boolean; quality: boolean; callsError: string | null };
  summary: {
    total: number; answered: number; attemptedNoAnswer: number; noPbxRecord: number;
    unknownCallStatus: number; retriedNoAnswer: number; oneAttemptNoAnswer: number;
    valid: number; invalid: number; unverified: number;
  };
  pagination: { page: number; pageSize: number; total: number; pages: number };
  courses: { course: string; total: number; answered: number; attemptedNoAnswer: number; noPbxRecord: number; retriedNoAnswer: number; valid: number; invalid: number }[];
  rows: WeeklyRow[];
}

function shiftWeek(day: string, weeks: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

export function WeeklyLeadsReport() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [week, setWeek] = useState("");
  const [page, setPage] = useState(1);
  const query = useApi<WeeklyResponse>(`/api/weekly-lead-followup?${week ? `week=${week}&` : ""}page=${page}`);
  const data = query.data;
  const summary = data?.summary;
  const canNext = !!data && data.period.fullWeekEnd < new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const move = (direction: number) => {
    if (!data) return;
    setWeek(shiftWeek(data.period.from, direction));
    setPage(1);
  };
  const callLabel = (row: WeeklyRow) => {
    if (row.callStatus === "answered") return A ? `تم الرد · ${row.attempts} محاولة` : `Answered · ${row.attempts} attempts`;
    if (row.callStatus === "attempted_no_answer") return row.retriedNoAnswer
      ? A ? `لم يرد · تكررت المحاولة (${row.attempts})` : `No answer · retried (${row.attempts})`
      : A ? "لم يرد · محاولة واحدة" : "No answer · one attempt";
    if (row.callStatus === "no_pbx_record") return A ? "لا توجد مكالمة موثّقة" : "No PBX call recorded";
    return A ? "غير معروف" : "Unknown";
  };
  return (
    <section className="space-y-5" dir={A ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div>
          <h2 className="text-xl font-extrabold text-text">{A ? "متابعة ليدز الأسبوع" : "This week's lead follow-up"}</h2>
          <p className="mt-1 text-sm text-text-muted">{A ? "دفعة الليدز حسب تاريخ إنشائها في أودو، والمكالمات الموثّقة في السنترال، وحكم الجودة اليدوي." : "Odoo creation-date cohort, PBX call evidence and manual lead-quality verdicts."}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => move(-1)} disabled={!data} className="rounded-xl border border-border px-3 py-2 text-sm font-bold text-text disabled:opacity-50" aria-label={A ? "الأسبوع السابق" : "Previous week"}><ChevronRight className={A ? "" : "rotate-180"} size={18} /></button>
          <span className="min-w-[190px] text-center text-sm font-bold text-text" dir="ltr">{data ? `${data.period.from} → ${data.period.to}` : "…"}</span>
          <button type="button" onClick={() => move(1)} disabled={!canNext} className="rounded-xl border border-border px-3 py-2 text-sm font-bold text-text disabled:opacity-50" aria-label={A ? "الأسبوع التالي" : "Next week"}><ChevronLeft className={A ? "" : "rotate-180"} size={18} /></button>
          <button type="button" onClick={() => query.refetch()} className="rounded-xl border border-border px-3 py-2 text-text" aria-label={A ? "تحديث" : "Refresh"}><RefreshCw size={17} className={query.isFetching ? "animate-spin" : ""} /></button>
        </div>
      </div>
      {query.isPending ? <Skeleton className="h-80" /> : query.isError ? <ErrorState message={query.error instanceof Error ? query.error.message : String(query.error)} onRetry={() => query.refetch()} /> : data && summary ? <>
        {!data.availability.calls && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{A ? "خدمة المكالمات غير متاحة الآن؛ حالة الاتصال غير معروفة، وليست صفر مكالمات." : "Calls Hub is unavailable; call status is unknown, not zero calls."}</div>}
        {!data.availability.quality && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{A ? "أحكام جودة الليد غير متاحة الآن، ولذلك تظهر غير متحقق منها." : "Manual lead QA is unavailable; quality is shown as unverified."}</div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: A ? "ليدز دخلت هذا الأسبوع" : "Leads created", value: summary.total, icon: <ShieldCheck size={20} />, tone: "text-blue-700 bg-blue-50" },
            { label: A ? "ردّوا على مكالمة" : "Answered a call", value: summary.answered, icon: <PhoneCall size={20} />, tone: "text-emerald-700 bg-emerald-50" },
            { label: A ? "اتصلنا ولم يردوا" : "Called, no answer", value: summary.attemptedNoAnswer, icon: <PhoneMissed size={20} />, tone: "text-orange-700 bg-orange-50" },
            { label: A ? "لم تُوثّق مكالمة" : "No PBX call recorded", value: summary.noPbxRecord, icon: <PhoneMissed size={20} />, tone: "text-rose-700 bg-rose-50" },
          ].map((card) => <div key={card.label} className="rounded-2xl border border-border bg-surface p-5 shadow-sm"><div className={`mb-4 inline-flex rounded-xl p-2 ${card.tone}`}>{card.icon}</div><p className="text-sm text-text-muted">{card.label}</p><strong className="mt-1 block text-3xl font-extrabold text-text">{fmtNum(card.value)}</strong></div>)}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-bold text-text">{A ? "المتابعة بعد عدم الرد" : "Follow-up after no answer"}</h3><p className="mt-3 text-sm text-text-muted">{A ? "محاولة واحدة فقط" : "Only one recorded attempt"} <strong className="float-end text-text">{fmtNum(summary.oneAttemptNoAnswer)}</strong></p><p className="mt-2 text-sm text-text-muted">{A ? "محاولتان أو أكثر دون رد" : "Two or more attempts without answer"} <strong className="float-end text-text">{fmtNum(summary.retriedNoAnswer)}</strong></p><p className="mt-3 text-xs text-text-muted">{A ? "عدد المحاولات لا يثبت ترتيبها الزمني، والمحادثات خارج السنترال ليست ضمن هذا القياس." : "Attempt totals do not prove their order; non-PBX conversations are not counted."}</p></div>
          <div className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-bold text-text">{A ? "جودة الليد · تحقق يدوي" : "Lead quality · manual review"}</h3><p className="mt-3 text-sm text-text-muted">{A ? "صالح" : "Valid"} <strong className="float-end text-emerald-700">{fmtNum(summary.valid)}</strong></p><p className="mt-2 text-sm text-text-muted">{A ? "غير صالح" : "Invalid"} <strong className="float-end text-rose-700">{fmtNum(summary.invalid)}</strong></p><p className="mt-2 text-sm text-text-muted">{A ? "لم يُتحقق منه" : "Unverified"} <strong className="float-end text-text">{fmtNum(summary.unverified)}</strong></p></div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border p-4"><h3 className="font-bold text-text">{A ? "المتابعة حسب الكورس" : "Follow-up by course"}</h3></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-surface-2 text-text-muted"><tr>{[A ? "الكورس" : "Course", A ? "الداخل" : "Created", A ? "ردوا" : "Answered", A ? "لم يردوا" : "No answer", A ? "أُعيدت المحاولة" : "Retried", A ? "بدون سجل مكالمة" : "No PBX record", A ? "جودة صالحة" : "Valid QA"].map((h) => <th key={h} className="px-4 py-3 text-start font-semibold">{h}</th>)}</tr></thead><tbody>{data.courses.map((course) => <tr key={course.course} className="border-t border-border"><td className="px-4 py-3 font-bold text-text">{course.course}</td>{[course.total, course.answered, course.attemptedNoAnswer, course.retriedNoAnswer, course.noPbxRecord, course.valid].map((value, index) => <td key={index} className="px-4 py-3 tabular-nums text-text">{fmtNum(value)}</td>)}</tr>)}</tbody></table></div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border p-4"><h3 className="font-bold text-text">{A ? "تفاصيل الليدز" : "Lead records"} · {fmtNum(summary.total)}</h3></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-surface-2 text-text-muted"><tr>{[A ? "الليد" : "Lead", A ? "التاريخ" : "Created", A ? "الكورس" : "Course", A ? "الموظف" : "Owner", A ? "المكالمة" : "Call evidence", A ? "الجودة" : "Quality", A ? "أودو" : "Odoo"].map((h) => <th key={h} className="px-4 py-3 text-start font-semibold">{h}</th>)}</tr></thead><tbody>{data.rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="px-4 py-3 font-semibold text-text">{row.contact || `#${row.id}`}<span className="block text-xs font-normal text-text-muted">{row.stage}</span></td><td className="px-4 py-3 text-text-muted" dir="ltr">{row.createdAt.slice(0, 10)}</td><td className="px-4 py-3 text-text">{row.course || "—"}</td><td className="px-4 py-3 text-text-muted">{row.salesperson || "—"}</td><td className="px-4 py-3 text-text">{callLabel(row)}</td><td className="px-4 py-3 text-text">{row.quality === "valid" ? A ? "صالح" : "Valid" : row.quality === "invalid" ? A ? "غير صالح" : "Invalid" : A ? "غير متحقق" : "Unverified"}</td><td className="px-4 py-3"><a href={row.odooUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline">{A ? "افتح" : "Open"}<ExternalLink size={14} /></a></td></tr>)}</tbody></table></div>
          <div className="flex items-center justify-between border-t border-border p-4 text-sm text-text-muted"><span>{A ? `صفحة ${page} من ${data.pagination.pages}` : `Page ${page} of ${data.pagination.pages}`}</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">{A ? "السابق" : "Previous"}</button><button type="button" disabled={page >= data.pagination.pages} onClick={() => setPage(page + 1)} className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-40">{A ? "التالي" : "Next"}</button></div></div>
        </div>
      </> : null}
    </section>
  );
}
