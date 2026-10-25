import { useState } from "react";
import {
  ArrowUpLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileSpreadsheet,
  FilterX,
  ShieldCheck,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { useI18n } from "@/lib/i18n";
import type { AuditGroup, LostArchiveAuditResult } from "@/lib/lost-archive-audit";

const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
const percent = (value: number) => `${value.toFixed(1)}%`;

function GroupTable({ rows, title, ar }: { rows: AuditGroup[]; title: string; ar: boolean }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_12px_35px_rgba(15,23,42,.045)]">
      <div className="border-b border-slate-100 px-6 py-5">
        <h3 className="text-lg font-black text-slate-900">{title}</h3>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.length ? (
          rows.slice(0, 12).map((row) => (
            <div
              key={row.name}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-6 py-4 hover:bg-slate-50/80"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-800" title={row.name}>
                  {row.name}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-rose-500"
                    style={{ width: `${Math.max(1, Math.min(row.reviewPct, 100))}%` }}
                  />
                </div>
              </div>
              <div className="text-center">
                <p className="text-[11px] font-semibold text-slate-500">
                  {ar ? "كل الحالات" : "All cases"}
                </p>
                <p className="text-sm font-black tabular-nums text-slate-900">
                  {number(row.total)}
                </p>
              </div>
              <div className="min-w-20 text-center">
                <p className="text-[11px] font-semibold text-rose-600">
                  {ar ? "تحتاج مراجعة" : "Review"}
                </p>
                <p className="text-sm font-black tabular-nums text-rose-600">
                  {number(row.review)}{" "}
                  <span className="text-xs font-semibold text-slate-400">
                    · {percent(row.reviewPct)}
                  </span>
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="px-6 py-10 text-sm text-slate-500">
            {ar ? "لا توجد حالات للفلاتر المختارة." : "No cases for these filters."}
          </p>
        )}
      </div>
    </section>
  );
}

export function LostQualityAudit() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [month, setMonth] = useState("2026-10");
  const [course, setCourse] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [dimension, setDimension] = useState<"courses" | "salespeople" | "campaigns">("courses");
  const query = new URLSearchParams({ month });
  if (course) query.set("course", course);
  if (salesperson) query.set("salesperson", salesperson);
  const { data, isLoading, error, refetch } = useApi<LostArchiveAuditResult>(
    `/api/lost-archive-audit?${query}`,
    { refetchInterval: 60_000 },
  );

  if (error)
    return (
      <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
        {error.message}
      </div>
    );
  if (isLoading || !data)
    return (
      <div className="animate-pulse rounded-[32px] bg-slate-100 p-14 text-slate-500">
        {ar ? "تحميل مراجعة اللوست..." : "Loading Lost audit..."}
      </div>
    );

  const ready = data.status === "success" && data.rowCount > 0;
  const selected = data.selected;
  const groups =
    dimension === "courses"
      ? selected.courses
      : dimension === "salespeople"
        ? selected.salespeople
        : selected.campaigns;
  const title =
    dimension === "courses"
      ? ar
        ? "الكورسات"
        : "Courses"
      : dimension === "salespeople"
        ? ar
          ? "فريق المبيعات"
          : "Sales team"
        : ar
          ? "الحملات"
          : "Campaigns";
  const selectedLabel =
    data.months.find((item) => item.key === data.selectedMonth)?.label ?? data.selectedMonth;

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      <header className="relative overflow-hidden rounded-[32px] bg-[#102238] px-7 py-8 text-white shadow-[0_24px_50px_rgba(16,34,56,.18)] sm:px-9">
        <div className="pointer-events-none absolute -left-14 -top-28 h-72 w-72 rounded-full bg-[#65d6ca]/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 right-10 h-60 w-60 rounded-full bg-[#fc8869]/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-black tracking-[.18em] text-[#8dded5]">
              {" "}
              <ShieldCheck size={16} />{" "}
              {ar ? "مراجعة مستقلة · Google Sheet" : "INDEPENDENT AUDIT · GOOGLE SHEET"}
            </p>
            <h1 className="text-3xl font-black leading-tight sm:text-4xl">
              {ar ? "جودة الليدز واللوست" : "Lead quality & Lost audit"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
              {ar
                ? "هل قرار الـLost وسببه مُراجع؟ شوف الفجوات بسرعة حسب الشهر والكورس والبياع، من غير خلطها بعدد الليدز الجديدة أو الـOpportunities."
                : "Audit whether Lost decisions and reasons were reviewed, by month, course and salesperson—separate from new-lead and opportunity counts."}
            </p>
          </div>
          <a
            href={data.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/20"
          >
            <FileSpreadsheet size={16} /> {ar ? "فتح الشيت الأصلي" : "Open source sheet"}{" "}
            <ArrowUpLeft size={14} />
          </a>
        </div>
        <div className="relative mt-7 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-full px-3 py-1.5 font-bold ${ready ? "bg-emerald-300/15 text-emerald-200" : "bg-amber-300/15 text-amber-100"}`}
          >
            {ready
              ? ar
                ? "قراءة مباشرة من Google Sheets"
                : "Direct Google Sheets read"
              : ar
                ? "القراءة المباشرة غير متاحة"
                : "Direct read unavailable"}
          </span>
          {data.syncedAt && (
            <span className="text-slate-300">
              {new Date(data.syncedAt).toLocaleString(ar ? "ar-EG" : "en-US", {
                timeZone: "Africa/Cairo",
              })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-full border border-white/20 px-3 py-1.5 font-semibold text-slate-200 hover:bg-white/10"
          >
            {ar ? "تحديث العرض" : "Refresh view"}
          </button>
        </div>
      </header>

      {!ready ? (
        <section className="rounded-[28px] border border-amber-200 bg-amber-50 px-7 py-8 text-amber-950">
          <h2 className="text-xl font-black">
            {ar
              ? "الشيت اتفحص، لكن صلاحية القراءة المباشرة لم تكتمل"
              : "Sheet analyzed; direct read-only access is not ready"}
          </h2>
          <p className="mt-2 text-sm leading-7">
            {ar
              ? "لن نعرض أصفارًا وكأنها نتيجة فعلية. يحتاج الشيت الخاص إلى تفويض Google للقراءة فقط؛ بعدها سيقرأه الداشبورد مباشرة من دون n8n أو حفظ صفوفه في قاعدة البيانات."
              : "We won't present zeros as business results. The private sheet needs read-only Google authorization; the dashboard then reads it directly without n8n or storing its rows in the database."}
          </p>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4 rounded-[26px] border border-slate-200 bg-white px-5 py-5">
            <div
              className="flex flex-wrap gap-2"
              role="tablist"
              aria-label={ar ? "شهر المراجعة" : "Audit month"}
            >
              {data.months.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={month === item.key}
                  onClick={() => {
                    setMonth(item.key);
                    setCourse("");
                    setSalesperson("");
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${month === item.key ? "bg-[#102238] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {ar ? item.label : item.key}{" "}
                  <span className="ms-1 text-[11px] opacity-70">{number(item.total)}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                aria-label={ar ? "فلتر الكورس" : "Filter course"}
                value={course}
                onChange={(event) => setCourse(event.target.value)}
                className="max-w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
              >
                <option value="">{ar ? "كل الكورسات" : "All courses"}</option>
                {data.courseOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                aria-label={ar ? "فلتر البياع" : "Filter salesperson"}
                value={salesperson}
                onChange={(event) => setSalesperson(event.target.value)}
                className="max-w-56 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
              >
                <option value="">{ar ? "كل البياعين" : "All salespeople"}</option>
                {data.salespersonOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              {(course || salesperson) && (
                <button
                  type="button"
                  onClick={() => {
                    setCourse("");
                    setSalesperson("");
                  }}
                  aria-label={ar ? "مسح الفلاتر" : "Clear filters"}
                  className="rounded-xl border border-slate-200 px-3 text-slate-500"
                >
                  <FilterX size={17} />
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[26px] border border-slate-200 bg-white p-6">
              <div className="mb-6 flex items-center gap-2 text-xs font-bold text-slate-500">
                <Clock3 size={16} />{" "}
                {ar
                  ? `حالات Lost في مراجعة ${selectedLabel}`
                  : `Lost cases reviewed in ${selectedLabel}`}
              </div>
              <p className="text-5xl font-black tabular-nums tracking-tight text-slate-900">
                {number(selected.total)}
              </p>
              <p className="mt-3 text-xs leading-6 text-slate-500">
                {ar
                  ? "هذا عدد صفوف الشيت، وليس معدل Lost من كل الليدز."
                  : "Sheet rows—not a Lost rate of all leads."}
              </p>
            </div>
            <div className="rounded-[26px] border border-[#f5c7bd] bg-[#fff4f0] p-6">
              <div className="mb-6 flex items-center gap-2 text-xs font-bold text-[#bb533d]">
                <CircleAlert size={17} />{" "}
                {ar ? "قرارات/أسباب تحتاج مراجعة" : "Decisions/reasons needing review"}
              </div>
              <p className="text-5xl font-black tabular-nums tracking-tight text-[#a93929]">
                {number(selected.review)}
              </p>
              <p className="mt-3 text-xs font-bold text-[#bb533d]">
                {percent(selected.reviewPct)}{" "}
                {ar ? "من حالات Lost في هذه المراجعة" : "of audited Lost cases"}
              </p>
            </div>
            <div className="rounded-[26px] border border-[#cae8e3] bg-[#edf9f5] p-6">
              <div className="mb-6 flex items-center gap-2 text-xs font-bold text-[#297c70]">
                <CheckCircle2 size={17} /> {ar ? "حالات اعتمدها المراجع" : "Reviewer accepted"}
              </div>
              <p className="text-5xl font-black tabular-nums tracking-tight text-[#176f62]">
                {number(selected.approved)}
              </p>
              <p className="mt-3 text-xs leading-6 text-[#408b80]">
                {ar
                  ? "Validate = Yes داخل الشيت، وليس إثبات بيع أو تحويل."
                  : "Validate = Yes in the sheet, not a paid conversion."}
              </p>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
            <GroupTable
              rows={selected.reasons}
              title={ar ? "لماذا سُجّلوا Lost؟" : "Recorded Lost reasons"}
              ar={ar}
            />
            <div className="space-y-5">
              <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_12px_35px_rgba(15,23,42,.045)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-[#b74d39]">
                      {ar ? "أين تتركز المراجعة؟" : "REVIEW HOTSPOTS"}
                    </p>
                    <h2 className="mt-1 text-xl font-black text-slate-900">
                      {ar ? "افتح زاوية واحدة، وشوف العدد والنسبة" : "One angle at a time"}
                    </h2>
                  </div>
                  <div className="flex rounded-xl bg-slate-100 p-1">
                    {(["courses", "salespeople", "campaigns"] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setDimension(item)}
                        className={`rounded-lg px-3 py-2 text-xs font-bold ${dimension === item ? "bg-white text-[#102238] shadow-sm" : "text-slate-500"}`}
                      >
                        {item === "courses"
                          ? ar
                            ? "كورس"
                            : "Course"
                          : item === "salespeople"
                            ? ar
                              ? "بياع"
                              : "Sales"
                            : ar
                              ? "حملة"
                              : "Campaign"}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-xs leading-6 text-slate-500">
                  {ar
                    ? "العدد الأحمر هو حالات Validate = No فقط؛ النسبة من حالات Lost لنفس الصف."
                    : "Red count means Validate = No; percentage is within that row's audited Lost cases."}
                </p>
              </section>
              <GroupTable rows={groups} title={title} ar={ar} />
            </div>
          </div>

          <section className="rounded-[28px] border border-slate-200 bg-[#f6f8fa] px-6 py-6">
            <p className="mb-4 text-sm font-black text-slate-900">
              {ar
                ? "حدود البيانات — لازم تظهر جنب الأرقام"
                : "Data limits—read alongside the figures"}
            </p>
            <div className="grid gap-3 text-xs leading-6 text-slate-600 sm:grid-cols-3">
              <p>
                <strong className="block text-lg text-slate-900">
                  {number(selected.missingClosedDate)}
                </strong>
                {ar ? "بلا تاريخ إغلاق في الشيت" : "without a close date"}
              </p>
              <p>
                <strong className="block text-lg text-slate-900">
                  {number(selected.missingCreatedDate)}
                </strong>
                {ar
                  ? "بلا تاريخ إنشاء؛ لا تصلح لتحليل Cohort"
                  : "without creation date; not cohort-ready"}
              </p>
              <p>
                <strong className="block text-lg text-slate-900">
                  {number(selected.missingCampaign)}
                </strong>
                {ar
                  ? "بلا اسم حملة؛ لا تُنسب لميديا باير"
                  : "without campaign; don't assign a media buyer"}
              </p>
            </div>
            <p className="mt-5 border-t border-slate-200 pt-4 text-xs leading-6 text-slate-500">
              {ar
                ? data.caveat
                : "This sheet audits Lost records, not new-lead cohorts or the overall CRM Lost rate. Validate=No indicates a disputed closure or reason—not Fresh or automatically unqualified. It lacks CRM IDs and Lead/Opportunity type, so it is not merged into Odoo metrics."}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
