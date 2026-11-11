import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  RefreshCw,
  Search,
  Users,
  TrendingDown,
  Wallet,
  ChartNoAxesCombined,
} from "lucide-react";
import { Card, Notice, Skeleton } from "@/components/ui-bits";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useFilters, filterStore } from "@/lib/filter-store";
import { fmtNum, fmtPct, fmtRoas, fmtUSDFull, fmtDateTime, useI18n } from "@/lib/i18n";
import { dailyCourseKey } from "@/lib/daily-updates";
import type { DailyUpdatesReport } from "@/lib/daily-updates.server";
import { useModalGuard } from "@/lib/ui-store";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

export const Route = createFileRoute("/daily-updates")({ component: DailyUpdates });
type Detail = { course: string; kind: "leads" | "lost" | "paid" | "invoices"; month: boolean };
const todayCairo = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const courseName = (s: string) =>
  ({
    Auto: "Automotive",
    Interior: "Interior Design",
    Mech: "Mechanical",
    Elec: "Electrical",
    Arch: "Architecture",
    Infra: "Infrastructure",
    Struc: "Structure",
  })[s] || s;

export function DailyUpdates() {
  const { lang } = useI18n(),
    ar = lang === "ar";
  const filters = useFilters();
  const [day, setDay] = useState(todayCairo);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  useModalGuard(Boolean(detail));
  useRegisterNexusView("daily_updates", { section: "daily-updates", parameters: { day } });
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters))
    if (v && !["from", "to", "range", "dateBasis"].includes(k)) params.set(k, String(v));
  params.set("day", day);
  const query = useQuery<DailyUpdatesReport>({
    queryKey: ["daily-updates", params.toString()],
    queryFn: async () => {
      const r = await fetch("/api/daily-updates?" + params);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Source unavailable");
      return d;
    },
    refetchInterval: 60000,
    staleTime: 15000,
    refetchOnMount: "always",
  });
  const data = query.data;
  const number = (n: number | null) => (n === null ? "—" : fmtNum(n));
  const percent = (n: number | null) => (n === null ? "—" : fmtPct(n * 100));
  const ratio = (n: number | null) => (n === null ? "—" : fmtRoas(n));
  const title = (kind: Detail["kind"]) =>
    ({
      leads: ar ? "الليدز التي دخلت" : "Created leads",
      lost: ar ? "حالات Lost بتاريخ اليوم" : "Lost records dated in the day",
      paid: ar ? "ليدز تحولت لدفع مثبت" : "Leads with evidenced payment",
      invoices: ar ? "بنود التحصيل" : "Collection lines",
    })[kind];
  const open = (course: string, kind: Detail["kind"], month = false) =>
    setDetail({ course, kind, month });
  const rows =
    data?.rows.filter((r) => courseName(r.course).toLowerCase().includes(search.toLowerCase())) ||
    [];
  const scoped = (course: string, month: boolean) => {
    filterStore.setDates(month ? day.slice(0, 7) + "-01" : day, day);
    filterStore.set({
      course: course === "Unclassified" ? undefined : course === "__all" ? filters.course : course,
      dateBasis: undefined,
    });
  };
  const detailRows =
    !data || !detail
      ? []
      : data.details[detail.kind].filter(
          (r) =>
            (detail.course === "__all" ||
              dailyCourseKey(r.course) === dailyCourseKey(detail.course)) &&
            (detail.month ||
              ("createdAt" in r ? r.createdAt === day : "date" in r ? r.date === day : false)),
        );
  const kpi = (
    label: string,
    value: string,
    note: string,
    Icon: typeof Users,
    color: string,
    kind: Detail["kind"],
    month = false,
  ) => (
    <button
      disabled={value === "—"}
      onClick={() => open("__all", kind, month)}
      className="rounded-2xl border border-border bg-surface p-4 text-start transition hover:border-brand disabled:cursor-default"
    >
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-text-muted">
        {label}
        <Icon size={17} className={color} />
      </div>
      <div className="num mt-3 text-3xl font-black tracking-tight text-text">{value}</div>
      <p className="mt-2 text-xs leading-5 text-text-muted">{note}</p>
    </button>
  );
  return (
    <main className="space-y-5">
      <header className="relative overflow-hidden rounded-[1.75rem] border border-border bg-text p-6 text-surface sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.16em] opacity-75">
              <CalendarClock size={16} />
              {ar ? "غرفة متابعة الكورسات" : "COURSE OPERATIONS BRIEF"}
            </span>
            <h1 className="mt-3 text-3xl font-black sm:text-4xl">
              {ar ? "دايلي أبديتس" : "Daily Updates"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 opacity-80">
              {ar
                ? "كل كورس، من دخول الليد إلى التحصيل. اليوم والشهر في مكان واحد — وافتح أي رقم لتراجع سجلاته."
                : "Every course, from lead entry to collection. One place for the day and month — open a figure to inspect its records."}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-bold">
              {ar ? "اليوم بتوقيت القاهرة" : "Day · Cairo time"}
              <input
                type="date"
                value={day}
                max={todayCairo()}
                min="2025-01-01"
                onChange={(e) => {
                  if (e.target.value) {
                    setDay(e.target.value);
                    setDetail(null);
                  }
                }}
                className="mt-2 block min-h-11 rounded-xl border border-white/20 bg-surface px-3 text-text"
              />
            </label>
            <button
              aria-label={ar ? "تحديث الدايلي أبديتس" : "Refresh daily updates"}
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/25 px-4 text-sm font-bold disabled:opacity-60"
            >
              <RefreshCw size={15} className={query.isFetching ? "animate-spin" : ""} />
              {ar ? "تحديث" : "Refresh"}
            </button>
          </div>
        </div>
      </header>
      <p className="text-xs leading-6 text-text-muted">
        {ar
          ? "تاريخ هذه الصفحة مستقل عن فلتر الفترة العلوي. باقي فلاتر الكورس والمنصة والفريق تُطبّق. اليوم الجاري أرقام مبدئية حتى اكتمال المزامنة."
          : "This page owns its day and month-to-date window, independently of the header date filter. Other course, platform and team filters apply. The current day remains provisional until source sync completes."}
      </p>
      {query.isError && (
        <Notice tone="warning">
          {ar
            ? "تعذر تحميل التحديثات؛ الأرقام غير المتاحة ليست صفرًا."
            : "Daily updates could not be read; unavailable figures are not zero."}
          <button className="ms-3 underline" onClick={() => query.refetch()}>
            {ar ? "إعادة المحاولة" : "Retry"}
          </button>
        </Notice>
      )}
      {query.isPending && <Skeleton className="h-72" />}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpi(
              ar ? "ليدز دخلت اليوم" : "Leads created in the day",
              number(data.totals.leadsDay),
              ar
                ? `الشهر حتى اليوم: ${number(data.totals.leadsMonth)} · Leads + Opportunities بدون تكرار الـID`
                : `Month to date: ${number(data.totals.leadsMonth)} · distinct CRM IDs, both record types`,
              Users,
              "text-brand",
              "leads",
            )}
            {kpi(
              ar ? "Lost بتاريخ اليوم" : "Lost dated in the day",
              number(data.totals.lostDay),
              ar
                ? `ليدز ${number(data.totals.lostLeadsDay)} · فرص ${number(data.totals.lostOpportunitiesDay)} · يشمل إنشاء أقدم`
                : `Leads ${number(data.totals.lostLeadsDay)} · Opportunities ${number(data.totals.lostOpportunitiesDay)} · includes older entries`,
              TrendingDown,
              "text-danger",
              "lost",
            )}
            {kpi(
              ar ? "تحصيل اليوم" : "Day collections",
              fmtUSDFull(data.totals.revenueDay),
              ar
                ? `${number(data.totals.invoicesDay)} فاتورة · حسب تاريخ الدفع`
                : `${number(data.totals.invoicesDay)} invoices · by payment date`,
              Wallet,
              "text-success",
              "invoices",
            )}
            {kpi(
              ar ? "تحصيل الشهر حتى اليوم" : "Month-to-date collections",
              fmtUSDFull(data.totals.revenueMonth),
              ar
                ? `ROAS الفترة: ${ratio(data.totals.roasMonth)} · ليس إسنادًا سببيًا`
                : `Period ROAS: ${ratio(data.totals.roasMonth)} · not causal attribution`,
              ChartNoAxesCombined,
              "text-brand",
              "invoices",
              true,
            )}
          </div>
          <Notice tone="info">
            {ar
              ? "اللوست هنا بنفس تعريف تقرير Lost: سجلات حالتها الحالية Lost وتاريخ خسارتها داخل اليوم؛ يشمل عملاء دخلوا قبل اليوم. ليس حصرًا لكل انتقالات Chatter أو العملاء الذين اتعمل لهم Lost ثم اتفتحوا من جديد."
              : "Lost uses the same definition as the Lost workspace: currently-Lost records with a loss date inside the day, including older entries. It is not a census of all Chatter transitions or reopened records."}
            {!data.chatterAvailable && (
              <span className="block">
                {ar
                  ? "تتبّع Chatter غير متاح لحساب الربط الحالي؛ لم نغيّر الصلاحيات أو نخمن أحداثًا."
                  : "Chatter tracking is unavailable to the current integration account; no permissions were changed and no events were guessed."}
              </span>
            )}
            {(data.fallbackDateCount || 0) > 0 && (
              <span className="block">
                {ar
                  ? fmtNum(data.fallbackDateCount) +
                    " حالة تستخدم تاريخًا بديلًا حسب سياسة Lost الحالية."
                  : fmtNum(data.fallbackDateCount) +
                    " records use a fallback date under the existing Lost policy."}
              </span>
            )}
          </Notice>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-text-muted">
            <span>
              {ar ? "قراءة التقرير" : "Report read"}: {fmtDateTime(data.generatedAt, lang)}
            </span>
            <span>
              {ar ? "مزامنة التحصيل" : "Collections sync"}:{" "}
              {data.sources.revenueSyncedAt ? fmtDateTime(data.sources.revenueSyncedAt, lang) : "—"}
            </span>
            <span>
              {ar
                ? "الليدز واللوست حسب الحالة وقت القراءة، مش لقطة تاريخية"
                : "Lead and Lost cohort states are current at read time, not historical snapshots"}
            </span>
          </div>
          {(data.errors.length > 0 || data.financialOnlyScope) && (
            <Notice tone="warning">
              {ar
                ? "بعض المصادر أو روابط الدفع ناقصة/قديمة؛ المقاييس المتأثرة تظهر —. وفلاتر الشركة أو البائع أو المصدر لا تعني أن صرف الإعلانات موزّع عليهم، لذلك يُحجب الصرف وROAS عندها."
                : "Some sources or paid links are unavailable/stale; affected metrics show —. Company, seller or source filters cannot allocate ad spend, so spend and ROAS are withheld for those scopes."}
            </Notice>
          )}
          {data.unlinkedInvoices > 0 && (
            <Notice tone="info">
              {ar
                ? fmtNum(data.unlinkedInvoices) +
                  " فاتورة موجبة في الشهر بلا رابط Opportunity حاسم. التحصيل يشملها، لكن التحويل لا يخمّن أصحابها؛ النسبة المعروضة حد أدنى موثّق."
                : fmtNum(data.unlinkedInvoices) +
                  " positive invoices this month have no unambiguous Opportunity link. Collections include them; conversion does not guess their leads, so the rate is an evidenced minimum."}
            </Notice>
          )}
          {(data.lossEvidenceCoverage?.ambiguousEvents || 0) +
            (data.lossEvidenceCoverage?.archiveWithoutLostEvidence || 0) >
            0 && (
            <Notice tone="info">
              {ar
                ? "فحص Chatter الإضافي وجد أحداثًا غير حاسمة. لا نضيفها تخمينًا، ولا نخلطها بعدد سجلات Lost بتاريخ الإغلاق المعروض."
                : "The optional Chatter check found inconclusive events. They are not guessed into, or mixed with, the displayed current-Lost close-date count."}
            </Notice>
          )}
          <Card className="overflow-hidden !p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
              <div>
                <h2 className="text-lg font-black">{ar ? "نبض كل كورس" : "The course pulse"}</h2>
                <p className="mt-1 text-xs text-text-muted">
                  {ar
                    ? "اضغط رقمًا للسجلات، أو افتح الحملات تحت الكورس."
                    : "Select a figure for records, or expand campaigns under a course."}
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
                <Search size={15} />
                <input
                  aria-label={ar ? "ابحث عن كورس" : "Search courses"}
                  placeholder={ar ? "ابحث عن كورس…" : "Search a course…"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-h-11 w-44 bg-transparent text-sm outline-none"
                />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-start text-sm">
                <thead className="bg-surface-2 text-xs text-text-muted">
                  <tr>
                    {[
                      ar ? "الكورس" : "Course",
                      ar ? "دخل اليوم / الشهر" : "Entered · day / MTD",
                      ar ? "Lost بتاريخ اليوم" : "Lost dated in day",
                      ar ? "تحويل لدفع موثّق · حد أدنى" : "Evidenced paid conversion · minimum",
                      ar ? "صرف اليوم" : "Day ad spend",
                      ar ? "ROAS اليوم / الشهر" : "ROAS · day / MTD",
                      ar ? "تحصيل اليوم / الشهر" : "Collections · day / MTD",
                      ar ? "الحملات" : "Campaigns",
                    ].map((h) => (
                      <th key={h} className="px-4 py-4 text-start font-bold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <CourseRows
                      key={row.key}
                      row={row}
                      ar={ar}
                      day={day}
                      expanded={expanded === row.key}
                      toggle={() => setExpanded(expanded === row.key ? null : row.key)}
                      open={open}
                      scoped={scoped}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <p className="p-8 text-center text-sm text-text-muted">
                {ar ? "لا توجد كورسات ضمن الاختيار." : "No courses in this selection."}
              </p>
            )}
          </Card>
          <details className="rounded-2xl border border-border bg-surface p-5">
            <summary className="cursor-pointer text-sm font-bold">
              {ar ? "الأرقام جايّة منين وبتتحسب إزاي؟" : "Sources and calculation rules"}
            </summary>
            <div className="mt-4 grid gap-4 text-xs leading-7 text-text-muted md:grid-cols-2">
              <p>
                {ar
                  ? "الليدز: سجلات Odoo بحسب تاريخ الإنشاء بتوقيت القاهرة، Lead وOpportunity كل ID مرة واحدة. مستبعد Recommendation وWhatsApp Broadcast وAutoDialer Broadcast من المصدر أو Lead Segment. هذا ليس حذفًا للعملاء ولا فلترًا على إيراداتهم."
                  : "Leads: Odoo creation date in Cairo; Lead and Opportunity IDs counted once. Recommendation, WhatsApp Broadcast and AutoDialer Broadcast are excluded by source or Lead Segment. This does not delete customers or remove their revenue."}
              </p>
              <p>
                {ar
                  ? "اللوست بتاريخ اليوم: نفس تقرير Lost بتاريخ الإغلاق: date_closed لليد، وlost_verification_date للفرصة مع بدائل السياسة الحالية المعلنة. النسبة أسفل الرقم تخص فقط ليدز دخلت في اليوم وحالتها الحالية Lost؛ لا نقسم لوست لعملاء أقدم على ليدز جديدة."
                  : "Day-dated Lost matches the Lost close-date workspace: Lead date_closed and Opportunity lost_verification_date, with the existing disclosed fallback policy. The secondary rate uses only entries created that day that are currently Lost; older losses are not divided by new entries."}
              </p>
              <p>
                {ar
                  ? "التحويل: عدد سجلات مجموعة الدخول المرتبطة بأوامر بيع ذات تحصيل موجب حتى اليوم ÷ عدد سجلات نفس المجموعة. يُحسب الربط بمعرف Opportunity، وليس تشابه الاسم أو عدد الفواتير. المجموعة اليومية غير الشهرية، والفاتورة المستردة بالكامل لا تُحسب كتسجيل مدفوع."
                  : "Conversion: distinct entry-cohort IDs linked to net-positive paid orders through the chosen day ÷ the same entry-cohort size. Exact Opportunity links, not customer-name guesses or invoice counts. Day and month cohorts are separate; fully refunded orders are not paid registrations."}
              </p>
              <p>
                {ar
                  ? "التحصيل: نفس بنود Accounting وفلاترها، بتاريخ الدفع؛ إشعار الخصم بتاريخ إصداره، والمنتج 1047 مستبعد حسب السياسة الحالية. ROAS = تحصيل الفترة ÷ صرف نفس الفترة؛ قد يكون البيع من ليد أقدم، فليس عائدًا سببيًا للإعلان. صرف الكورس بنفس إسناد صفحة الكورسات، وليس فاتورة مستقلة لكل كورس."
                  : "Collections: the same Accounting lines and filters, by payment date; credit notes use issue date. Product 1047 follows the existing exclusion policy. ROAS = period collections ÷ period ad spend; older leads may contribute sales, so this is not causal ad return. Course spend uses the existing course attribution, not a separate course bill."}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-[11px] text-text-muted">
              <span>
                {ar ? "قراءة الصفحة" : "Report read"}: {fmtDateTime(data.generatedAt, lang)}
              </span>
              <span>
                {ar ? "مزامنة التحصيل" : "Collections sync"}:{" "}
                {data.sources.revenueSyncedAt
                  ? fmtDateTime(data.sources.revenueSyncedAt, lang)
                  : "—"}
              </span>
              <span>
                {ar ? "روابط البيع" : "Order links"}:{" "}
                {data.sources.linksSyncedAt ? fmtDateTime(data.sources.linksSyncedAt, lang) : "—"}
              </span>
            </div>
          </details>
          <Dialog
            open={Boolean(detail)}
            onOpenChange={(v) => {
              if (!v) setDetail(null);
            }}
          >
            <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto rounded-2xl bg-surface text-text">
              <DialogTitle>
                {detail &&
                  `${detail.course === "__all" ? (ar ? "كل الكورسات" : "All courses") : courseName(detail.course)} · ${title(detail.kind)}`}
              </DialogTitle>
              <DialogDescription>
                {detail?.month ? data.monthFrom : day} → {day} · {fmtNum(detailRows.length)}{" "}
                {ar ? "سجل" : "records"}
              </DialogDescription>
              <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
                <table className="w-full text-start text-xs">
                  <thead className="sticky top-0 bg-surface-2">
                    <tr>
                      <th className="p-3 text-start">{ar ? "السجل" : "Record"}</th>
                      <th className="p-3 text-start">
                        {ar ? "المصدر / الشركة" : "Source / company"}
                      </th>
                      <th className="p-3 text-start">
                        {ar ? "الحالة / القيمة" : "State / amount"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.slice(0, 500).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-3">
                          {"url" in r ? (
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-bold text-brand underline"
                            >
                              {r.name} ↗
                            </a>
                          ) : "invoice" in r ? (
                            r.invoice
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-3">
                          {"source" in r ? r.source : "company" in r ? r.company : "—"}
                        </td>
                        <td className="p-3">
                          {"amount" in r
                            ? fmtUSDFull(r.amount)
                            : "status" in r
                              ? ar
                                ? { open: "مفتوح", won: "ناجح", lost: "مفقود", lead: "ليد نشط" }[
                                    r.status
                                  ] || r.status
                                : r.status
                              : "recordType" in r
                                ? ar
                                  ? r.recordType === "lead"
                                    ? "ليد"
                                    : "فرصة بيعية"
                                  : r.recordType
                                : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detailRows.length > 500 && (
                <p className="text-xs text-text-muted">
                  {ar
                    ? "معروض أول 500 سجل؛ الإجمالي أعلى القائمة شامل."
                    : "Showing the first 500 records; the total above includes all."}
                </p>
              )}
              {detail && detail.course !== "Unclassified" && (
                <Link
                  to={
                    detail.kind === "invoices"
                      ? "/accounting"
                      : detail.kind === "lost"
                        ? "/lost"
                        : "/leads"
                  }
                  onClick={() => scoped(detail.course, detail.month)}
                  className="inline-flex items-center gap-2 text-sm font-bold text-brand"
                >
                  {ar
                    ? "فتح التقرير المرتبط بنفس الكورس والفترة"
                    : "Open related report · same course and period"}
                  <ArrowUpRight size={15} />
                </Link>
              )}
              {detail?.kind === "lost" && (
                <p className="text-xs text-text-muted">
                  {ar
                    ? "في تقرير Lost اختر «حركة Lost · تاريخ الإغلاق». هذه سجلات حالتها الحالية Lost بتاريخ خسارة داخل اليوم، وليست كل انتقالات Chatter."
                    : "In Lost, choose the movement/close-date view. These are currently-Lost records dated in the day, not every Chatter transition."}
                </p>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </main>
  );
}

function CourseRows({
  row,
  ar,
  day,
  expanded,
  toggle,
  open,
  scoped,
}: {
  row: DailyUpdatesReport["rows"][number];
  ar: boolean;
  day: string;
  expanded: boolean;
  toggle: () => void;
  open: (course: string, kind: Detail["kind"], month?: boolean) => void;
  scoped: (course: string, month: boolean) => void;
}) {
  const num = (n: number | null) => (n === null ? "—" : fmtNum(n));
  const pct = (n: number | null) => (n === null ? "—" : fmtPct(n * 100));
  const roas = (n: number | null) => (n === null ? "—" : fmtRoas(n));
  const figure = (value: string, kind: Detail["kind"], month = false, tone = "text-brand") => (
    <button
      disabled={value === "—"}
      onClick={() => open(row.course, kind, month)}
      className={`num min-h-9 font-black underline decoration-dotted underline-offset-4 disabled:cursor-default disabled:no-underline ${tone}`}
    >
      {value}
    </button>
  );
  return (
    <>
      <tr className="border-t border-border align-top hover:bg-surface-2/50">
        <td className="px-4 py-4">
          <p className="font-black">{courseName(row.course)}</p>
          <p className="mt-2 text-[11px] text-text-muted">{day}</p>
        </td>
        <td className="px-4 py-3">
          {figure(num(row.leadsDay), "leads")}
          <div className="text-xs text-text-muted">
            {ar ? "الشهر" : "MTD"}: {figure(num(row.leadsMonth), "leads", true, "text-text-muted")}
          </div>
        </td>
        <td className="px-4 py-3">
          {figure(num(row.lostDay), "lost", false, "text-danger")}
          <div className="text-[11px] leading-6 text-text-muted">
            {ar ? "ليدز" : "Leads"} {num(row.lostLeadsDay)} · {ar ? "فرص" : "Opp."}{" "}
            {num(row.lostOpportunitiesDay)}
          </div>
          <div className="text-[11px] text-text-muted">
            {ar ? "Lost من دخول اليوم" : "Lost of day entries"}: {num(row.cohortLostDay)} ·{" "}
            {pct(row.cohortLostRate)}
          </div>
        </td>
        <td className="px-4 py-3">
          {figure(pct(row.conversionDay), "paid")}
          <div className="text-[11px] text-text-muted">
            {num(row.paidDayCohort)} / {num(row.leadsDay)} {ar ? "من دخول اليوم" : "day entries"}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {ar ? "الشهر" : "MTD"}:{" "}
            {figure(pct(row.conversionMonth), "paid", true, "text-text-muted")} (
            {num(row.paidMonthCohort)}/{num(row.leadsMonth)})
          </div>
        </td>
        <td className="num px-4 py-5 font-bold">
          {fmtUSDFull(row.spendDay)}
          <div className="mt-2 text-[11px] font-normal text-text-muted">
            {ar ? "الشهر" : "MTD"}: {fmtUSDFull(row.spendMonth)}
          </div>
        </td>
        <td className="num px-4 py-5 font-bold">
          {roas(row.roasDay)}
          <div className="mt-2 text-xs font-normal text-text-muted">
            {ar ? "الشهر" : "MTD"}: {roas(row.roasMonth)}
          </div>
        </td>
        <td className="px-4 py-3">
          {figure(fmtUSDFull(row.revenueDay), "invoices", false, "text-success")}
          <div className="text-xs text-text-muted">
            {ar ? "الشهر" : "MTD"}:{" "}
            {figure(fmtUSDFull(row.revenueMonth), "invoices", true, "text-text-muted")}
          </div>
        </td>
        <td className="px-4 py-3">
          <button
            aria-expanded={expanded}
            onClick={toggle}
            className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-border px-3 text-xs font-bold"
          >
            <span>
              {row.campaigns.length} {ar ? "حملة" : "campaigns"}
            </span>
            <ChevronDown size={14} className={expanded ? "rotate-180" : ""} />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="border-y border-brand/15 bg-brand-soft/20 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-bold">
                {courseName(row.course)} ·{" "}
                {ar ? "الحملات المسجلة في الشهر" : "Campaigns observed this month"}
              </h3>
              <Link
                to="/courses"
                search={{ view: "ads" }}
                onClick={() => scoped(row.course, true)}
                className="text-xs font-bold text-brand"
              >
                {ar ? "فتح إعلانات الكورس" : "Open course ads"} ↗
              </Link>
            </div>
            <p className="mb-3 text-xs leading-6 text-text-muted">
              {ar
                ? "وجود صرف لا يثبت أن الحملة Active الآن. ليدز الحملة هنا مرتبطة باسم الحملة في CRM؛ الصفر لا يثبت عدم وجود ليدز بلا إسناد."
                : "Spend is not proof that a campaign is Active now. Campaign leads use CRM campaign-name attribution; zero does not rule out unattributed leads."}
            </p>
            {row.campaigns.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {row.campaigns.map((c) => (
                  <Link
                    key={c.key}
                    to="/campaigns"
                    onClick={() => {
                      scoped(row.course, true);
                      filterStore.set({ campaign: c.name, campaignKey: c.key });
                    }}
                    className="rounded-xl border border-border bg-surface p-4 hover:border-brand"
                  >
                    <p className="break-words font-bold text-brand">{c.name} ↗</p>
                    <p className="mt-1 text-[11px] text-text-muted">{c.platforms.join(" · ")}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <span>
                        {ar ? "صرف اليوم" : "Day spend"}
                        <b className="num mt-1 block">{fmtUSDFull(c.spendDay)}</b>
                      </span>
                      <span>
                        {ar ? "صرف الشهر" : "MTD spend"}
                        <b className="num mt-1 block">{fmtUSDFull(c.spendMonth)}</b>
                      </span>
                      <span>
                        {ar ? "ليدز اليوم" : "Day leads"}
                        <b className="num mt-1 block">{num(c.leadsDay)}</b>
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                {ar
                  ? "لا توجد حملات يمكن إسنادها للكورس في الفترة."
                  : "No attributable campaign rows in this period."}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
