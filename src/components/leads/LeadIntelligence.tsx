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

export function LeadIntelligence() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [course, setCourse] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(1);
  const [moreCampaigns, setMoreCampaigns] = useState(false);
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
                  ? "ست قراءات مترابطة للكورسات والحملات والإغلاق والمبيعات."
                  : "Six connected views of courses, campaigns, closing and sales."}
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
                <div
                  key={row.course}
                  className="flex justify-between rounded-xl bg-surface px-3 py-2 text-sm"
                >
                  <span>{row.course}</span>
                  <b className="num">{fmtNum(row.leads)}</b>
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
        id="lead-campaigns"
        index="02"
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
        index="03"
        title={A ? "رحلة الإغلاق" : "Close lifecycle"}
        description={
          A
            ? "الأيام من إنشاء الليد إلى Won أو Lost. الليد المفتوح خارج المتوسط."
            : "Days from lead creation to Won or Lost. Open leads are excluded."
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
        <div className="grid gap-3 sm:grid-cols-5">
          {data.lifecycle.buckets.map((bucket, i) => (
            <div key={bucket.label} className="rounded-xl bg-surface-2 p-3">
              <p className="num text-xs text-text-muted">
                {bucket.label} {A ? "يوم" : "days"}
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
        index="04"
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
        index="05"
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
        index="06"
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
