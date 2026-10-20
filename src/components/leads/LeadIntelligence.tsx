import { useState } from "react";
import { ArrowUpRight, ChevronDown, Target } from "lucide-react";
import { ErrorState, Skeleton } from "@/components/ui-bits";
import { fmtNum, fmtPct, fmtRoas, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { LeadIntelligenceResponse } from "@/lib/lead-intelligence.server";

const pct = (value: number | null) => fmtPct(value === null ? null : value * 100, 1);
const num = (value: number | null) => (value === null ? "—" : fmtNum(value));
const tone = ["bg-sky-strong", "bg-violet-strong", "bg-amber-strong", "bg-mint-strong"];

function Section({
  id,
  index,
  title,
  description,
  children,
}: {
  id: string;
  index: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-28 overflow-hidden rounded-[26px] border border-border bg-surface shadow-sm"
    >
      <div className="flex gap-4 border-b border-border bg-surface-2/60 px-5 py-5 sm:px-7">
        <span className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-strong text-xs font-black text-white">
          {index}
        </span>
        <div>
          <h3 className="text-lg font-bold text-text">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
        </div>
      </div>
      <div className="space-y-5 p-5 sm:p-7">{children}</div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  color = "sky",
}: {
  label: string;
  value: string;
  detail?: string;
  color?: "sky" | "mint" | "amber" | "violet";
}) {
  const colors = {
    sky: "text-sky-strong bg-sky-surface",
    mint: "text-mint-strong bg-mint-surface",
    amber: "text-amber-strong bg-amber-surface",
    violet: "text-violet-strong bg-violet-surface",
  };
  return (
    <div className={`rounded-2xl p-4 ${colors[color]}`}>
      <p className="text-xs font-semibold opacity-85">{label}</p>
      <p className="num mt-2 text-2xl font-black">{value}</p>
      {detail && <p className="mt-1 text-[11px] leading-relaxed opacity-80">{detail}</p>}
    </div>
  );
}

function Expand({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-border bg-surface-2/40">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-sky-strong">
        {label}
        <ChevronDown size={16} className="transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

function CourseSourceDetails({
  course,
  leads,
  sources,
  arabic,
}: {
  course: string;
  leads: number;
  sources: LeadIntelligenceResponse["courses"][number]["sources"];
  arabic: boolean;
}) {
  return (
    <details className="group mt-4 rounded-xl border border-border bg-surface-2/50 open:bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-bold text-sky-strong marker:hidden">
        <span>
          {arabic ? `مصادر ليدز ${course} والحملات` : `${course} lead sources and campaigns`}
        </span>
        <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        <p className="text-[11px] leading-relaxed text-text-muted">
          {arabic
            ? `توزيع ${fmtNum(leads)} ليد من نفس عدد الكارت حسب المصدر المسجل في Odoo؛ الضغط على المصدر يعرض حملاته وحالة الليدز.`
            : `Breakdown of the same ${fmtNum(leads)} Odoo leads shown on this card. Open a source for campaigns and lead outcomes.`}
        </p>
        {sources.length === 0 ? (
          <p className="text-xs text-text-muted">
            {arabic
              ? "لا توجد ليدز لهذا الكورس في الفترة."
              : "No leads for this course in the period."}
          </p>
        ) : (
          sources.map((source) => {
            const bestCampaign = [...source.campaigns]
              .filter((campaign) => campaign.won > 0)
              .sort(
                (a, b) =>
                  b.won - a.won ||
                  b.won / b.leads - a.won / a.leads ||
                  b.leads - a.leads ||
                  a.name.localeCompare(b.name),
              )[0];
            return (
              <details
                key={source.source}
                className="group/source overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
              >
                <summary className="cursor-pointer list-none p-3 marker:hidden hover:bg-sky-surface/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-xs font-bold text-text">
                      <ChevronDown
                        size={14}
                        className="shrink-0 text-sky-strong transition-transform group-open/source:rotate-180"
                      />
                      <span className="truncate" title={source.source}>
                        {arabic && source.source === "Unspecified source"
                          ? "مصدر غير محدد"
                          : source.source}
                      </span>
                    </span>
                    <span className="num shrink-0 text-xs font-black text-text">
                      {fmtNum(source.leads)}{" "}
                      <span className="text-sky-strong">· {pct(source.share)}</span>
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full bg-sky-strong"
                      style={{ width: `${source.share * 100}%` }}
                    />
                  </div>
                  <p className="num mt-2 text-[10px] text-text-muted">
                    {arabic ? "نشط" : "Open"} {fmtNum(source.open)} · Won {fmtNum(source.won)} ·
                    Lost {fmtNum(source.lost)}
                  </p>
                </summary>
                <div className="space-y-2 border-t border-border bg-surface-2/40 p-3">
                  <p className="text-[11px] font-semibold text-text-muted">
                    {arabic ? "حملات المصدر" : "Source campaigns"} ·{" "}
                    {fmtNum(source.campaigns.length)}
                  </p>
                  {source.campaigns.map((campaign, index) => (
                    <div
                      key={`${campaign.name}-${index}`}
                      className="rounded-lg border border-border bg-surface px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className="min-w-0 break-words text-xs font-bold text-text"
                          title={campaign.name || undefined}
                        >
                          {campaign.name ||
                            (arabic ? "حملة غير محددة في Odoo" : "Campaign not recorded in Odoo")}
                        </span>
                        {campaign === bestCampaign && (
                          <span className="rounded-full bg-mint-surface px-2 py-0.5 text-[10px] font-bold text-mint-strong">
                            {arabic ? "الأعلى في Won" : "Most Won"}
                          </span>
                        )}
                      </div>
                      <p className="num mt-1.5 text-[11px] text-text-muted">
                        {fmtNum(campaign.leads)} {arabic ? "ليد" : "leads"} ·{" "}
                        {arabic ? "نشط" : "Open"} {fmtNum(campaign.open)} · Won{" "}
                        {fmtNum(campaign.won)} · Lost {fmtNum(campaign.lost)}
                      </p>
                    </div>
                  ))}
                  <p className="text-[10px] leading-relaxed text-text-muted">
                    {arabic
                      ? "الحملات مجمّعة من حقل الحملة في Odoo؛ «الأعلى في Won» حسب عدد العملاء المحوّلين، وليس ROAS."
                      : "Campaigns use the Odoo campaign field. Most Won ranks conversions by count, not ROAS."}
                  </p>
                </div>
              </details>
            );
          })
        )}
      </div>
    </details>
  );
}

function OutcomeStrip({
  won,
  lost,
  open,
  total,
  arabic,
  lostAvailable,
}: {
  won: number;
  lost: number;
  open: number;
  total: number;
  arabic: boolean;
  lostAvailable: boolean;
}) {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-[11px] font-semibold text-text-muted">
        {arabic ? "مصير نفس الليدز الواردة" : "Outcome of these same leads"}
      </p>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        {[
          { label: arabic ? "ناجح" : "Won", count: won, style: "bg-mint-surface text-mint-strong" },
          {
            label: arabic ? "مفقود" : "Lost",
            count: lost,
            style: "bg-amber-surface text-amber-strong",
          },
          { label: arabic ? "مفتوح" : "Open", count: open, style: "bg-surface-2 text-text-muted" },
        ].map((item) => (
          <div key={item.label} className={`rounded-xl px-1.5 py-2 ${item.style}`}>
            <p className="text-[10px] font-bold">{item.label}</p>
            <p className="num mt-0.5 text-sm font-black">
              {!lostAvailable && item.label !== (arabic ? "ناجح" : "Won")
                ? "—"
                : fmtNum(item.count)}
            </p>
            <p className="num text-[10px] font-bold">
              {!lostAvailable && item.label !== (arabic ? "ناجح" : "Won")
                ? "—"
                : pct(total ? item.count / total : null)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CohortAnalysis({
  data,
  arabic,
  course,
  onCourseChange,
  lostAvailable,
}: {
  data: LeadIntelligenceResponse["cohorts"];
  arabic: boolean;
  course: string;
  onCourseChange: (course: string) => void;
  lostAvailable: boolean;
}) {
  const selected =
    data.courses.find((row) => row.course === course) ??
    data.courses.find((row) => row.course.toUpperCase() === "CFM") ??
    data.courses[0];
  if (!selected)
    return (
      <p className="text-sm text-text-muted">
        {arabic ? "لا توجد ليدز في الفترة." : "No leads in this period."}
      </p>
    );
  const maxHistory = Math.max(1, ...selected.history.map((row) => row.lostRate60 ?? 0));
  return (
    <div className="space-y-5">
      {!lostAvailable && (
        <div className="rounded-xl border border-amber-strong/30 bg-amber-surface px-4 py-3 text-xs font-bold text-amber-strong">
          {arabic
            ? "مصدر المفقود في Odoo غير متاح حاليًا. أعداد ونِسَب الخسارة والمعيار التاريخي غير قابلة للاعتماد حتى تكتمل المزامنة."
            : "Odoo Lost source is unavailable. Loss counts, rates and the historical benchmark are not reliable until sync recovers."}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-strong/20 bg-sky-surface/50 p-4">
        <div>
          <p className="text-sm font-black text-text">
            {arabic
              ? "تابع نفس مجموعة الليدز من يوم دخولها"
              : "Follow the same lead cohort from creation"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            {arabic
              ? "الشهر الأول = الأيام 0–29؛ الثاني = الأيام 30–59. النِسَب المكتملة تُحسب فقط لليدز التي مرّت عليها الفترة كاملة، والنتائج حتى الآن منفصلة عنها."
              : "Month 1 = days 0–29; Month 2 = days 30–59. Final rates include only leads that completed the full window; observed-to-date counts are separate."}
          </p>
        </div>
        <label className="text-xs font-bold text-text-muted">
          {arabic ? "الدورة" : "Course"}
          <select
            className="ms-2 min-h-10 rounded-xl border border-border bg-surface px-3 text-sm font-bold text-text"
            value={selected.course}
            onChange={(event) => onCourseChange(event.target.value)}
          >
            {data.courses.map((row) => (
              <option key={row.course} value={row.course}>
                {row.course}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label={arabic ? "عدد الليدز الأصلية" : "Original leads"}
          value={fmtNum(selected.total)}
          detail={`${selected.course} · ${arabic ? "تاريخ الإنشاء داخل الفترة المختارة" : "created in the selected period"}`}
        />
        <Metric
          label={arabic ? "ناجح حتى الآن" : "Won so far"}
          value={`${fmtNum(selected.current.won)} · ${pct(selected.current.wonRate)}`}
          color="mint"
        />
        <Metric
          label={arabic ? "مفقود حتى الآن" : "Lost so far"}
          value={
            lostAvailable
              ? `${fmtNum(selected.current.lost)} · ${pct(selected.current.lostRate)}`
              : "—"
          }
          color="amber"
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[selected.month1, selected.month2].map((window, index) => {
          const complete = window.eligible === selected.total;
          return (
            <div
              key={index}
              className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-4 py-3">
                <div>
                  <p className="text-sm font-black text-text">
                    {arabic
                      ? `الشهر ${index + 1 === 1 ? "الأول" : "الثاني"}`
                      : `Month ${index + 1}`}
                  </p>
                  <p className="num text-[11px] text-text-muted">
                    {index ? "30–59" : "0–29"}{" "}
                    {arabic ? "يومًا من إنشاء الليد" : "days from creation"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-bold ${complete ? "bg-mint-surface text-mint-strong" : "bg-amber-surface text-amber-strong"}`}
                >
                  {complete ? (arabic ? "مكتمل" : "Complete") : arabic ? "جزئي" : "Partial"}
                </span>
              </div>
              <div className="space-y-3 p-4">
                <p className="text-xs text-text-muted">
                  {arabic ? "اكتملت مدة المتابعة لـ" : "Fully observed"}{" "}
                  <b className="num text-text">
                    {fmtNum(window.eligible)} / {fmtNum(selected.total)}
                  </b>
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    {
                      label: arabic ? "ناجح تراكمي" : "Cumulative won",
                      count: window.won,
                      rate: window.wonRate,
                      color: "text-mint-strong",
                    },
                    {
                      label: arabic ? "مفقود تراكمي" : "Cumulative lost",
                      count: window.lost,
                      rate: window.lostRate,
                      color: "text-amber-strong",
                    },
                    {
                      label: arabic ? "ظل مفتوحًا" : "Still open",
                      count: window.open,
                      rate: window.eligible ? window.open / window.eligible : null,
                      color: "text-text",
                    },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-surface-2 px-2 py-3">
                      <p className="text-[10px] text-text-muted">{item.label}</p>
                      <p className={`num mt-1 text-xl font-black ${item.color}`}>
                        {!lostAvailable &&
                        item.label !== (arabic ? "ناجح تراكمي" : "Cumulative won")
                          ? "—"
                          : fmtNum(item.count)}
                      </p>
                      <p className="num text-[11px] font-bold text-text-muted">
                        {!lostAvailable &&
                        item.label !== (arabic ? "ناجح تراكمي" : "Cumulative won")
                          ? "—"
                          : pct(item.rate)}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-text-muted">
                  {lostAvailable && index
                    ? arabic
                      ? `إضافي خلال الشهر الثاني: ${fmtNum(window.additionalWon)} ناجح، ${fmtNum(window.additionalLost)} مفقود.`
                      : `Additional in month 2: ${fmtNum(window.additionalWon)} won, ${fmtNum(window.additionalLost)} lost.`
                    : null}
                  {lostAvailable && !complete
                    ? ` ${arabic ? "المُسجَّل حتى الآن داخل هذه النافذة" : "Observed so far within this window"}: ${fmtNum(window.observedWon)} ${arabic ? "ناجح" : "won"} · ${fmtNum(window.observedLost)} ${arabic ? "مفقود" : "lost"}.`
                    : ""}
                  {lostAvailable && window.undated
                    ? ` ${fmtNum(window.undated)} ${arabic ? "حالة محسومة بلا تاريخ إغلاق، غير موزعة زمنيًا" : "settled records without a close date; timing unknown"}.`
                    : ""}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="rounded-2xl border border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h4 className="text-sm font-black text-text">
              {arabic
                ? "مقارنة الخسارة عبر آخر 12 شهر إنشاء"
                : "Lost rate by creation month · last 12 months"}
            </h4>
            <p className="mt-1 text-xs text-text-muted">
              {arabic
                ? "كل عمود: نسبة المفقود خلال 60 يومًا من الليدز التي أكملت 60 يومًا؛ لا تُستنتج نتيجة للشهور غير المكتملة."
                : "Each bar: lost within 60 days ÷ leads observed for 60 days. Immature months have no final rate."}
            </p>
          </div>
          <div className="text-xs text-text-muted">
            {arabic ? "معيار الشهور السابقة" : "Prior-month benchmark"}{" "}
            <b className="num text-amber-strong">
              {lostAvailable ? pct(selected.benchmark60.rate) : "—"}
            </b>{" "}
            <span className="num">
              {lostAvailable
                ? `(${fmtNum(selected.benchmark60.lost)}/${fmtNum(selected.benchmark60.eligible)})`
                : ""}
            </span>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-6 gap-2 md:grid-cols-12" dir="ltr">
          {selected.history.map((month) => (
            <div
              key={month.month}
              className="min-w-0 text-center"
              title={
                lostAvailable
                  ? `${month.month}: ${month.lost60}/${month.mature60} lost in 60 days; ${month.leads} leads`
                  : `${month.month}: Lost source unavailable`
              }
            >
              <div className="flex h-28 items-end rounded-lg bg-surface-2 p-1">
                <div
                  className={`w-full rounded-md ${!lostAvailable || month.lostRate60 === null ? "bg-surface-3" : "bg-amber-strong"}`}
                  style={{
                    height:
                      !lostAvailable || month.lostRate60 === null
                        ? "4px"
                        : `${Math.max(4, (month.lostRate60 / maxHistory) * 100)}%`,
                  }}
                />
              </div>
              <p className="num mt-1 text-[10px] font-bold text-text">{month.month.slice(5)}</p>
              <p className="num text-[10px] text-text-muted">
                {lostAvailable ? pct(month.lostRate60) : "—"}
              </p>
            </div>
          ))}
        </div>
        <details className="mt-4 rounded-xl border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-sky-strong">
            {arabic ? "اعرض أعداد كل شهر بالتفصيل" : "Show each month's counts"}
          </summary>
          <div className="overflow-x-auto border-t border-border p-3">
            <table className="w-full min-w-[620px] text-start text-xs">
              <thead>
                <tr className="text-text-muted">
                  <th className="p-2 text-start">{arabic ? "شهر الإنشاء" : "Creation month"}</th>
                  <th className="p-2 text-start">{arabic ? "ليدز" : "Leads"}</th>
                  <th className="p-2 text-start">{arabic ? "مكتمل 30 يوم" : "30d mature"}</th>
                  <th className="p-2 text-start">{arabic ? "مفقود 30 يوم" : "30d lost"}</th>
                  <th className="p-2 text-start">{arabic ? "مكتمل 60 يوم" : "60d mature"}</th>
                  <th className="p-2 text-start">{arabic ? "مفقود 60 يوم" : "60d lost"}</th>
                </tr>
              </thead>
              <tbody>
                {selected.history.map((row) => (
                  <tr key={row.month} className="border-t border-border">
                    <td className="num p-2">{row.month}</td>
                    <td className="num p-2">{fmtNum(row.leads)}</td>
                    <td className="num p-2">{fmtNum(row.mature30)}</td>
                    <td className="num p-2">
                      {lostAvailable ? `${fmtNum(row.lost30)} · ${pct(row.lostRate30)}` : "—"}
                    </td>
                    <td className="num p-2">{fmtNum(row.mature60)}</td>
                    <td className="num p-2">
                      {lostAvailable ? `${fmtNum(row.lost60)} · ${pct(row.lostRate60)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <div className="rounded-2xl border border-border p-4 sm:p-5">
        <h4 className="text-sm font-black text-text">
          {arabic ? "أسباب المفقود من نفس الليدز" : "Lost reasons in this cohort"}
        </h4>
        <p className="mt-1 text-xs text-text-muted">
          {arabic
            ? "النسبة من إجمالي المفقود، بتصنيف الأسباب المسجلة في Odoo."
            : "Share of all lost leads, grouped from Odoo's recorded reasons."}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {lostAvailable &&
            selected.reasons.map((reason) => (
              <div
                key={reason.canonicalReasonKey}
                className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs"
              >
                <span>
                  {arabic ? reason.canonicalReasonLabelAr : reason.canonicalReasonLabelEn}
                </span>
                <b className="num text-text">
                  {fmtNum(reason.count)} · {fmtPct(reason.share, 1)}
                </b>
              </div>
            ))}
          {lostAvailable && !selected.reasons.length && (
            <p className="text-xs text-text-muted">
              {arabic ? "لا توجد حالات مفقودة في الفترة." : "No lost leads in the period."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function LeadIntelligence() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [course, setCourse] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(1);
  const [moreCampaigns, setMoreCampaigns] = useState(false);
  const [cohortCourse, setCohortCourse] = useState("CFM");
  const path = `/api/lead-intelligence?focusCourse=${encodeURIComponent(course)}&focusOwner=${encodeURIComponent(owner)}&page=${page}`;
  const { data, isLoading, error, refetch } = useApi<LeadIntelligenceResponse>(path);
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (!data || isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-44" />
        <Skeleton className="h-96" />
      </div>
    );

  const targetCourses = data.courses.filter((row) => row.target !== null);
  const otherCourses = data.courses.filter((row) => row.target === null && row.leads > 0);
  const displayCourses = targetCourses.length
    ? targetCourses
    : data.courses.filter((row) => row.leads > 0).slice(0, 6);
  const campaigns = data.campaigns.filter((row) => row.leads > 0 || (row.spend && row.spend > 0));
  const campaignShown = moreCampaigns
    ? campaigns
    : campaigns.filter((row) => row.leads > 0).slice(0, 7);
  const settled = data.totals.won + data.totals.lost;
  const sellers = data.salespeople.filter((row) => row.verdict !== "insufficient");
  const topSellers = sellers
    .filter((row) => row.verdict === "grow")
    .sort((a, b) => (b.leadRate ?? 0) - (a.leadRate ?? 0))
    .slice(0, 4);
  const reviewSellers = sellers
    .filter((row) => row.verdict === "review")
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 4);
  const maxDaily = Math.max(
    1,
    ...data.daily.map((row) => row.leads),
    ...data.daily.map((row) => row.target ?? 0),
  );
  const maxBucket = Math.max(1, ...data.lifecycle.buckets.map((row) => row.count));

  return (
    <div className="space-y-6 pb-10">
      <header className="relative overflow-hidden rounded-[28px] bg-gradient-to-bl from-[#122a63] via-[#15254b] to-[#0b142b] p-6 text-white shadow-xl sm:p-8">
        <div className="absolute -left-14 -top-20 h-64 w-64 rounded-full bg-sky-strong/25 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <p className="text-[11px] font-black tracking-[0.2em] text-sky-200">
                ENGOSOFT / LEAD INTELLIGENCE
              </p>
              <h2 className="mt-3 text-2xl font-black sm:text-3xl">
                {A ? "من الليد إلى قرار توزيع الكورس" : "From lead to course allocation"}
              </h2>
              <p className="mt-2 text-sm text-slate-200">
                {A
                  ? "سبع قراءات مترابطة للكورسات ومجموعات الليدز والحملات والإغلاق والمبيعات."
                  : "Seven connected views of courses, cohorts, campaigns, closing and sales."}
              </p>
              <p className="num mt-3 text-xs text-sky-200">
                {data.period.from} → {data.period.to}
              </p>
            </div>
            <div className="grid min-w-[210px] grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-white/10 p-3">
                <p className="num text-2xl font-black">{fmtNum(data.totals.leads)}</p>
                <p className="text-xs text-slate-200">{A ? "ليد" : "Leads"}</p>
              </div>
              <div className="rounded-xl bg-white/10 p-3">
                <p className="num text-2xl font-black text-emerald-300">
                  {fmtNum(data.totals.won)}
                </p>
                <p className="text-xs text-slate-200">Won</p>
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3 border-t border-white/15 pt-5">
            <label className="text-xs font-bold text-slate-200">
              {A ? "الكورس" : "Course"}
              <select
                aria-label={A ? "فلتر الكورس" : "Course filter"}
                value={course || data.filters.course}
                onChange={(e) => {
                  setCourse(e.target.value);
                  setPage(1);
                }}
                className="mt-1 block min-h-10 min-w-44 rounded-xl border border-white/25 bg-[#182e5c] px-3 text-sm text-white"
              >
                <option value="">{A ? "كل الكورسات" : "All courses"}</option>
                {data.filters.courses.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-200">
              {A ? "مسؤول المبيعات" : "Salesperson"}
              <select
                aria-label={A ? "فلتر مسؤول المبيعات" : "Salesperson filter"}
                value={owner || data.filters.owner}
                onChange={(e) => {
                  setOwner(e.target.value);
                  setPage(1);
                }}
                className="mt-1 block min-h-10 min-w-52 max-w-64 rounded-xl border border-white/25 bg-[#182e5c] px-3 text-sm text-white"
              >
                <option value="">{A ? "كل المسؤولين" : "All salespeople"}</option>
                {data.filters.owners.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </header>

      {!data.lostAvailable && (
        <div className="rounded-2xl border border-amber-strong/30 bg-amber-surface px-5 py-4 text-sm font-semibold text-amber-strong">
          {A
            ? "تنبيه جودة البيانات: مصدر Lost في Odoo غير متاح الآن. لا تعتبر الصفر الظاهر في أي تفاصيل قديمة نسبة خسارة حقيقية؛ مؤشرات الخسارة الجديدة معروضة كغير متاحة حتى تعود المزامنة."
            : "Data quality alert: the Odoo Lost source is unavailable. Zero in older breakdowns is not a real loss rate; the new loss metrics show as unavailable until sync recovers."}
        </div>
      )}

      <Section
        id="lead-target"
        index="01"
        title={A ? "تارجت كل كورس" : "Course lead target"}
        description={
          A
            ? "الليدز الفعلية من كورس الليد في Odoo، والأهداف من خطة الميديا."
            : "Actual leads use the Odoo lead course; targets come from the media plan."
        }
      >
        <div className="rounded-2xl border border-sky-strong/20 bg-sky-surface/60 px-4 py-3 text-xs leading-relaxed text-text sm:text-sm">
          <b>{A ? "اقرأ الكارت كده:" : "How to read each card:"}</b>{" "}
          {A
            ? `وصل فعلًا مقابل المطلوب حتى ${data.period.to || "نهاية الفترة"}. لكل شهر: المطلوب = هدف الشهر × أيام الفترة داخل الشهر ÷ أيام الشهر. هدف الشهر الكامل معروض منفصلًا.`
            : `Actual leads are compared with the pace through ${data.period.to || "the period end"}. For each month, period pace = full-month target × selected days in that month ÷ days in the month.`}{" "}
          <a href="/media-plan" className="font-bold text-sky-strong underline underline-offset-2">
            {A ? "افتح خطة الميديا" : "Open media plan"}
          </a>
        </div>
        {targetCourses.some((row) => row.targetCoverage.startsWith("draft")) && (
          <div className="rounded-xl border border-amber-strong/30 bg-amber-surface px-4 py-3 text-xs font-semibold text-amber-strong">
            {A
              ? "«مسودة» تعني أن أهداف خطة الميديا لم تُعتمد بعد. أعداد الليدز الفعلية مأخوذة من Odoo، والمقارنة مع الهدف استرشادية."
              : "Draft means the media-plan targets are not yet approved. Actual lead counts come from Odoo; target comparisons are provisional."}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {displayCourses.map((row) => {
            const expected = row.expectedLeads === null ? null : Math.ceil(row.expectedLeads);
            const difference = expected === null ? null : row.leads - expected;
            const progress = expected ? Math.min(100, (row.leads / expected) * 100) : 0;
            return (
              <div
                key={row.course}
                className={`rounded-2xl border bg-surface p-4 shadow-sm ${difference === null ? "border-border" : difference >= 0 ? "border-mint-strong/30" : "border-amber-strong/30"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-base font-black text-text">{row.course}</p>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.target === null ? "bg-surface-3 text-text-muted" : row.targetCoverage.startsWith("draft") ? "bg-amber-surface text-amber-strong" : "bg-sky-surface text-sky-strong"}`}
                  >
                    {row.target === null
                      ? A
                        ? "بلا هدف"
                        : "No target"
                      : row.targetCoverage.startsWith("draft")
                        ? A
                          ? "مسودة"
                          : "Draft"
                        : A
                          ? "معتمد"
                          : "Approved"}
                  </span>
                </div>
                <div className="mt-4 flex items-baseline justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-text-muted">
                  <span>{A ? "هدف الشهر كاملًا" : "Full-month target"}</span>
                  <b className="num text-base font-black text-text">
                    {num(row.target)} {A ? "ليد" : "leads"}
                  </b>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-sky-surface px-3 py-3">
                    <p className="text-[11px] font-bold text-sky-strong">
                      {A ? "وصل فعلًا" : "Actually received"}
                    </p>
                    <p className="num mt-1 text-2xl font-black text-text">{fmtNum(row.leads)}</p>
                  </div>
                  <div className="rounded-xl bg-surface-2 px-3 py-3">
                    <p className="text-[11px] font-bold text-text-muted">
                      {A
                        ? `المطلوب حتى ${data.period.to || "اليوم"}`
                        : `Needed by ${data.period.to || "today"}`}
                    </p>
                    <p className="num mt-1 text-2xl font-black text-text">{num(expected)}</p>
                  </div>
                </div>
                <p
                  className={`mt-3 text-xs font-bold ${difference === null ? "text-text-muted" : difference >= 0 ? "text-mint-strong" : "text-amber-strong"}`}
                >
                  {difference === null
                    ? A
                      ? "لا يوجد هدف للمقارنة"
                      : "No target to compare"
                    : difference >= 0
                      ? A
                        ? `أعلى من المطلوب حتى الآن بـ ${fmtNum(difference)} ليد`
                        : `${fmtNum(difference)} leads ahead of pace`
                      : A
                        ? `ناقص ${fmtNum(-difference)} ليد للوصول لمسار الفترة`
                        : `${fmtNum(-difference)} more leads needed to reach pace`}
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full rounded-full ${difference === null ? "bg-sky-strong" : difference >= 0 ? "bg-mint-strong" : "bg-amber-strong"}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap justify-between gap-1 text-[11px] text-text-muted">
                  <span>
                    {A ? "تحقيق المطلوب حتى اليوم" : "Period pace achieved"}{" "}
                    <b className="num text-text">{pct(expected ? row.leads / expected : null)}</b>
                  </span>
                  <span>
                    {A ? "متوسط الخطة اليومي" : "Daily plan average"}{" "}
                    <b className="num">{row.dailyTarget?.toFixed(1) ?? "—"}</b>{" "}
                    {A ? "ليد" : "leads"}
                  </span>
                </div>
                <OutcomeStrip
                  won={row.won}
                  lost={row.lost}
                  open={row.open}
                  total={row.leads}
                  arabic={A}
                  lostAvailable={data.lostAvailable}
                />
                <CourseSourceDetails
                  course={row.course}
                  leads={row.leads}
                  sources={row.sources}
                  arabic={A}
                />
              </div>
            );
          })}
        </div>
        {otherCourses.length > 0 && (
          <Expand
            label={
              A
                ? `كورسات أخرى بلا هدف في الخطة (${otherCourses.length})`
                : `Other courses without a plan target (${otherCourses.length})`
            }
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {otherCourses.map((row) => (
                <div key={row.course} className="rounded-xl bg-surface px-3 py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span>{row.course}</span>
                    <b className="num">{fmtNum(row.leads)}</b>
                  </div>
                  <OutcomeStrip
                    won={row.won}
                    lost={row.lost}
                    open={row.open}
                    total={row.leads}
                    arabic={A}
                    lostAvailable={data.lostAvailable}
                  />
                  <CourseSourceDetails
                    course={row.course}
                    leads={row.leads}
                    sources={row.sources}
                    arabic={A}
                  />
                </div>
              ))}
            </div>
          </Expand>
        )}
        <div>
          <p className="mb-3 text-sm font-bold text-text">
            {A ? "وصول الليدز يومًا بيوم" : "Daily lead arrivals"}
          </p>
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface-2/40 p-4">
            <div className="flex h-36 min-w-max items-end gap-2">
              {data.daily.map((day) => (
                <div key={day.day} className="flex w-8 flex-col items-center gap-1">
                  <span className="num text-[10px] font-bold text-text">{day.leads}</span>
                  <div className="relative flex h-24 w-5 items-end rounded-md bg-surface-3">
                    <div
                      className="w-full rounded-md bg-sky-strong"
                      style={{ height: `${Math.max(2, (day.leads / maxDaily) * 100)}%` }}
                    />
                    {day.target !== null && (
                      <span
                        className="absolute inset-x-0 border-t-2 border-amber-strong"
                        style={{ bottom: `${Math.min(100, (day.target / maxDaily) * 100)}%` }}
                      />
                    )}
                  </div>
                  <span className="num text-[9px] text-text-muted">{day.day.slice(8)}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            {A
              ? "الأعمدة = الليدز الفعلية؛ الخط الذهبي = متوسط الهدف اليومي من الخطة."
              : "Bars = actual leads; amber line = daily plan pace."}
          </p>
        </div>
      </Section>

      <Section
        id="lead-cohorts"
        index="02"
        title={A ? "مصير الليدز خلال شهر وشهرين" : "Lead cohort · month 1 and 2"}
        description={
          A
            ? "نفس الليدز حسب تاريخ إنشائها: ناجح ومفقود ومفتوح بعد أول 30 يوم ثم 60 يوم، مع معيار الخسارة التاريخي."
            : "The same creation-date cohort through day 30 and day 60, with a historical loss benchmark."
        }
      >
        <CohortAnalysis
          data={data.cohorts}
          arabic={A}
          course={course || cohortCourse}
          onCourseChange={setCohortCourse}
          lostAvailable={data.lostAvailable}
        />
      </Section>

      <Section
        id="lead-campaigns"
        index="03"
        title={A ? "الحملات التي جابت الليدز" : "Campaign lead delivery"}
        description={
          A
            ? "كل حملة مع عدد الليدز وWon وLost والصرف والعائد المنسوب إليها."
            : "Campaign leads, outcomes, spend and attributed return."
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {campaignShown.map((row, i) => (
            <div
              key={`${row.name}-${i}`}
              className="rounded-2xl border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="mb-2 inline-block rounded-full bg-violet-surface px-2 py-0.5 text-[10px] font-bold text-violet-strong">
                    {row.course === "Multiple"
                      ? A
                        ? "أكثر من كورس"
                        : "Multiple courses"
                      : row.course || (A ? "كورس غير محدد" : "Unassigned course")}
                  </span>
                  <p className="break-words text-sm font-bold text-text">{row.name || "—"}</p>
                </div>
                <span className="num shrink-0 rounded-xl bg-sky-surface px-2 py-1 text-base font-black text-sky-strong">
                  {fmtNum(row.leads)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                <span>
                  Won <b className="num text-mint-strong">{fmtNum(row.won)}</b>
                </span>
                <span>
                  Lost <b className="num text-amber-strong">{fmtNum(row.lost)}</b>
                </span>
                <span>
                  {A ? "الصرف" : "Spend"} <b className="num text-text">{fmtUSD(row.spend)}</b>
                </span>
                <span>
                  CPL <b className="num text-text">{fmtUSD(row.cpl)}</b>
                </span>
                <span>
                  ROAS <b className="num text-sky-strong">{fmtRoas(row.roas)}</b>
                </span>
              </div>
            </div>
          ))}
        </div>
        {campaigns.length > 7 && (
          <button
            type="button"
            onClick={() => setMoreCampaigns(!moreCampaigns)}
            className="rounded-xl border border-sky-strong/30 px-4 py-2 text-xs font-bold text-sky-strong"
          >
            {moreCampaigns
              ? A
                ? "عرض الأهم فقط"
                : "Show highlights"
              : A
                ? `عرض كل الحملات (${campaigns.length})`
                : `Show all campaigns (${campaigns.length})`}
          </button>
        )}
      </Section>

      <Section
        id="lead-lifecycle"
        index="04"
        title={A ? "رحلة الإغلاق" : "Close lifecycle"}
        description={
          A
            ? "المدة بالأيام التقويمية من إنشاء الليد إلى إغلاقه. تشمل فقط الليدز المنشأة في الفترة المختارة التي أصبحت ناجحة أو مفقودة؛ الليدز المفتوحة مستبعدة."
            : "Calendar days from lead creation to closure. Only leads created in the selected period that are now Won or Lost are included; open leads are excluded."
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label={A ? "المتوسط" : "Average"}
            value={
              data.lifecycle.averageDays === null
                ? "—"
                : `${data.lifecycle.averageDays.toFixed(1)} ${A ? "يوم" : "days"}`
            }
            color="violet"
          />
          <Metric
            label={A ? "الوسيط" : "Median"}
            value={
              data.lifecycle.medianDays === null
                ? "—"
                : `${data.lifecycle.medianDays.toFixed(1)} ${A ? "يوم" : "days"}`
            }
            color="sky"
          />
          <Metric
            label={A ? "حالات مغلقة بتاريخ واضح" : "Dated closures"}
            value={fmtNum(data.lifecycle.sample)}
            color="mint"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-surface-2/50 px-4 py-3 text-xs text-text-muted">
          <span>
            {A ? "تاريخ إنشاء الليد" : "Lead creation dates"}:{" "}
            <b className="num text-text">
              {data.period.from} → {data.period.to}
            </b>
          </span>
          {data.lifecycle.observedMaxDays !== null && (
            <span>
              {A ? "أطول مدة إغلاق مرصودة" : "Longest observed closure"}:{" "}
              <b className="num text-text">
                {fmtNum(data.lifecycle.observedMaxDays)} {A ? "يوم" : "days"}
              </b>
            </span>
          )}
          {data.lifecycle.missingCloseDate > 0 && (
            <span className="font-semibold text-amber-strong">
              {A
                ? `${fmtNum(data.lifecycle.missingCloseDate)} حالة بلا تاريخ إغلاق صالح؛ خارج حساب المدة`
                : `${fmtNum(data.lifecycle.missingCloseDate)} records have no valid closure date and are excluded from duration metrics`}
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["won", data.lifecycle.won, A ? "ناجحة" : "Won", "text-mint-strong"],
              ["lost", data.lifecycle.lost, A ? "مفقودة" : "Lost", "text-amber-strong"],
            ] as const
          ).map(([status, summary, label, color]) => (
            <div
              key={status}
              className="flex items-baseline justify-between gap-3 rounded-xl border border-border px-4 py-3"
            >
              <span className={`text-sm font-bold ${color}`}>{label}</span>
              <span className="num text-sm text-text">
                <b>{fmtNum(summary.count)}</b>
                <span className="mx-2 text-text-muted">·</span>
                {A ? "متوسط" : "Average"}{" "}
                <b>{summary.averageDays === null ? "—" : summary.averageDays.toFixed(1)}</b>{" "}
                {A ? "يوم" : "days"}
              </span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {data.lifecycle.buckets.map((bucket, i) => (
            <div key={bucket.label} className="rounded-xl bg-surface-2 p-3">
              <p className="num text-xs text-text-muted">
                {bucket.label === "0"
                  ? A
                    ? "نفس اليوم"
                    : "Same day"
                  : bucket.label === "1"
                    ? A
                      ? "يوم واحد"
                      : "1 day"
                    : `${bucket.label} ${A ? "يوم" : "days"}`}
              </p>
              <p className="num my-2 text-xl font-black text-text">{fmtNum(bucket.count)}</p>
              <div className="h-2 rounded-full bg-surface-3">
                <div
                  className={`h-2 rounded-full ${tone[i % tone.length]}`}
                  style={{ width: `${(bucket.count / maxBucket) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <Expand
          label={
            A
              ? `تفاصيل كل ليد مغلق (${fmtNum(data.lifecycle.total)})`
              : `Individual closed leads (${fmtNum(data.lifecycle.total)})`
          }
        >
          <div className="space-y-2">
            {data.lifecycle.records.map((row) => (
              <div
                key={`${row.status}-${row.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-xs"
              >
                <a
                  href={row.odooUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-sky-strong"
                >
                  #{row.id}
                  <ArrowUpRight size={12} />
                </a>
                <span
                  className={
                    row.status === "won"
                      ? "font-bold text-mint-strong"
                      : "font-bold text-amber-strong"
                  }
                >
                  {row.status === "won" ? (A ? "ناجحة" : "Won") : A ? "مفقودة" : "Lost"}
                </span>
                <span>
                  {row.course || "—"} · {row.owner || "—"}
                </span>
                <span className="num text-text-muted">
                  {row.createdAt.slice(0, 10)} → {row.closedAt.slice(0, 10)}
                </span>
                <b className="num text-text">
                  {num(row.closeDays)} {A ? "يوم" : "days"}
                </b>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 text-xs">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded-lg border border-border px-3 py-1 disabled:opacity-40"
              >
                {A ? "السابق" : "Previous"}
              </button>
              <span className="num">
                {data.lifecycle.page} / {data.lifecycle.pages}
              </span>
              <button
                disabled={page >= data.lifecycle.pages}
                onClick={() => setPage(page + 1)}
                className="rounded-lg border border-border px-3 py-1 disabled:opacity-40"
              >
                {A ? "التالي" : "Next"}
              </button>
            </div>
          </div>
        </Expand>
      </Section>

      <Section
        id="lead-quality"
        index="05"
        title={A ? "الجودة والنتيجة حسب الكورس" : "Course quality and outcome"}
        description={
          A
            ? "Won وLost والمفتوح لكل كورس، ونسبة الفوز من الحالات المحسومة."
            : "Won, Lost and open leads by course, with settled win rate."
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric
            label={A ? "Won من المحسوم" : "Won of settled"}
            value={pct(settled ? data.totals.won / settled : null)}
            color="mint"
          />
          <Metric
            label={A ? "Lost من كل الليدز" : "Lost of all leads"}
            value={pct(data.totals.leads ? data.totals.lost / data.totals.leads : null)}
            color="amber"
          />
          <Metric
            label={A ? "منسوب لحملة" : "Campaign attributed"}
            value={pct(data.totals.leads ? data.totals.attributedLeads / data.totals.leads : null)}
            color="violet"
          />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {data.courses
            .filter((row) => row.leads > 0)
            .map((row) => (
              <div key={row.course} className="rounded-2xl border border-border p-4">
                <div className="flex items-center justify-between">
                  <b className="text-sm text-text">{row.course}</b>
                  <span className="num text-sm font-black text-text">
                    {fmtNum(row.leads)} Leads
                  </span>
                </div>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="bg-mint-strong"
                    style={{ width: `${(row.won / row.leads) * 100}%` }}
                  />
                  <div
                    className="bg-amber-strong"
                    style={{ width: `${(row.lost / row.leads) * 100}%` }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  <span className="text-mint-strong">
                    Won <b className="num">{row.won}</b>
                  </span>
                  <span className="text-amber-strong">
                    Lost <b className="num">{row.lost}</b>
                  </span>
                  <span className="text-text-muted">
                    {A ? "مفتوح" : "Open"} <b className="num">{row.open}</b>
                  </span>
                  <span className="ms-auto font-bold text-sky-strong">
                    ROAS {fmtRoas(row.roas)}
                  </span>
                </div>
              </div>
            ))}
        </div>
      </Section>

      <Section
        id="lead-sales"
        index="06"
        title={A ? "الكورس × مسؤول المبيعات" : "Course × salesperson"}
        description={
          A
            ? "إشارة التوزيع تبدأ بعد 10 ليدز و5 حالات محسومة؛ المفتوح ليس خسارة."
            : "Allocation signals require 10 leads and 5 settled outcomes. Open leads are not losses."
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            {
              label: A ? "جرّب زيادة الحصة" : "Try more leads",
              rows: topSellers,
              style: "bg-mint-surface text-mint-strong",
            },
            {
              label: A ? "راجع قبل التوزيع" : "Review allocation",
              rows: reviewSellers,
              style: "bg-amber-surface text-amber-strong",
            },
          ].map((group) => (
            <div key={group.label} className="overflow-hidden rounded-2xl border border-border">
              <h4 className={`px-4 py-3 text-sm font-bold ${group.style}`}>{group.label}</h4>
              <div className="divide-y divide-border">
                {group.rows.length ? (
                  group.rows.map((row) => (
                    <div key={`${row.course}-${row.owner}`} className="px-4 py-3">
                      <p className="text-sm font-bold text-text">{row.owner}</p>
                      <p className="mt-1 text-xs text-text-muted">
                        {row.course} · <b className="num">{row.leads}</b> Leads ·{" "}
                        <b className="num text-mint-strong">{row.won}</b> Won ·{" "}
                        <b className="num text-amber-strong">{row.lost}</b> Lost ·{" "}
                        <b className="num">{pct(row.settledRate)}</b> {A ? "من المحسوم" : "settled"}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="px-4 py-5 text-xs text-text-muted">
                    {A ? "لا توجد عينة كافية" : "No qualifying sample"}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
        <Expand
          label={
            A
              ? `كل تقاطعات الكورسات والمسؤولين (${data.salespeople.length})`
              : `All course and salesperson pairs (${data.salespeople.length})`
          }
        >
          <div className="max-h-[440px] space-y-2 overflow-y-auto">
            {data.salespeople.map((row) => (
              <div
                key={`${row.course}-${row.owner}`}
                className="grid gap-2 rounded-xl bg-surface px-3 py-2 text-xs sm:grid-cols-[1fr_1.5fr_1fr]"
              >
                <b>{row.course}</b>
                <span>{row.owner}</span>
                <span className="num">
                  {row.leads} Leads · {row.won} Won · {row.lost} Lost
                </span>
              </div>
            ))}
          </div>
        </Expand>
      </Section>

      <Section
        id="lead-economics"
        index="07"
        title={A ? "اقتصاديات الليد" : "Lead economics"}
        description={
          A
            ? "فلاتر الكورس والمسؤول في الأعلى تسري هنا. الصرف غير موزع على مسؤولي المبيعات."
            : "Course and salesperson filters apply here. Ad spend is not split among salespeople."
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="CPL"
            value={fmtUSD(data.totals.cpl)}
            detail={A ? "صرف الإعلانات ÷ ليدز Odoo" : "Ad spend ÷ Odoo leads"}
          />
          <Metric
            label="CAC"
            value={fmtUSD(data.totals.cac)}
            detail={A ? "صرف الإعلانات ÷ Won" : "Ad spend ÷ Won"}
            color="violet"
          />
          <Metric
            label="ROAS"
            value={fmtRoas(data.totals.roas)}
            detail={A ? "تحصيل الحملات المرتبطة ÷ الصرف" : "Campaign-linked paid revenue ÷ spend"}
            color="mint"
          />
          <Metric
            label={A ? "عائد الإنفاق الإعلاني" : "Ad-cost return"}
            value={pct(data.totals.roi)}
            detail={
              A ? "(التحصيل المنسوب − الصرف) ÷ الصرف" : "(Attributed revenue − spend) ÷ spend"
            }
            color="amber"
          />
          <Metric
            label={A ? "قيمة العميل المرصودة" : "Observed customer value"}
            value={fmtUSD(data.totals.observedLtv)}
            detail={
              A ? "التحصيل التاريخي ÷ العملاء الدافعين" : "All-time paid revenue ÷ paying customers"
            }
            color="violet"
          />
          <Metric
            label={A ? "التحصيل المنسوب" : "Attributed revenue"}
            value={fmtUSD(data.totals.attributedRevenue)}
            color="sky"
          />
          <Metric label="Won" value={fmtNum(data.totals.won)} color="mint" />
          <Metric label="Lost" value={fmtNum(data.totals.lost)} color="amber" />
        </div>
        <p className="rounded-xl bg-surface-2 p-4 text-xs leading-relaxed text-text-muted">
          {A
            ? "الليدز حسب تاريخ إنشائها وحالتها الحالية، والتحصيل حسب تاريخ الدفع. ROAS وعائد الإنفاق مؤشرات للفترة وليسا ربحية نفس مجموعة الليدز. قيمة العميل المرصودة ليست توقعًا للقيمة المستقبلية."
            : "Leads use creation date and current outcome; revenue uses payment date. ROAS and ad-cost return are period indicators, not cohort profit. Observed customer value is not a future LTV forecast."}
        </p>
      </Section>
    </div>
  );
}
