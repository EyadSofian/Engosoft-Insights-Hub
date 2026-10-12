import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  ChartNoAxesCombined,
  CircleHelp,
  Gauge,
  Target,
  UsersRound,
} from "lucide-react";
import { Card, ErrorState, Skeleton } from "@/components/ui-bits";
import { PageSection, PageSections } from "@/components/dashboard-bits";
import { fmtNum, fmtPct, fmtRoas, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type { LeadIntelligenceResponse } from "@/lib/lead-intelligence.server";

const pct = (value: number | null) => fmtPct(value === null ? null : value * 100, 1);
const number = (value: number | null, unit = "") =>
  value === null ? "—" : `${fmtNum(value)}${unit}`;
const duration = (value: number | null, unit: string) =>
  value === null ? "—" : `${value.toFixed(1)}${unit}`;

function Stat({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "border-sky-strong/30 bg-sky-surface/40" : ""}>
      <p className="text-[11px] font-semibold text-text-muted">{label}</p>
      <p className="num mt-2 text-[25px] font-bold leading-none text-text">{value}</p>
      {note && <p className="mt-2 text-[11px] leading-snug text-text-muted">{note}</p>}
    </Card>
  );
}

function TableWrap({ children }: { children: ReactNode }) {
  return (
    <Card padded={false} className="overflow-x-auto">
      {children}
    </Card>
  );
}

const th = "px-3 py-3 text-start text-[11px] font-bold text-text-muted";
const td = "border-t border-border px-3 py-3 text-[12px] text-text";

export function LeadIntelligence() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const [course, setCourse] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(1);
  const path = `/api/lead-intelligence?focusCourse=${encodeURIComponent(course)}&focusOwner=${encodeURIComponent(owner)}&page=${page}`;
  const { data, isLoading, error, refetch } = useApi<LeadIntelligenceResponse>(path);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  if (!data || isLoading)
    return (
      <PageSections>
        <Skeleton className="h-24" />
        <Skeleton className="h-56" />
        <Skeleton className="h-[500px]" />
      </PageSections>
    );

  const maxDay = Math.max(
    1,
    ...data.daily.map((day) => day.leads),
    ...data.daily.map((day) => day.target ?? 0),
  );
  const maxBucket = Math.max(1, ...data.lifecycle.buckets.map((bucket) => bucket.count));
  const periodLabel =
    data.period.from && data.period.to
      ? `${data.period.from} → ${data.period.to}`
      : A
        ? "كل الفترات"
        : "All periods";

  return (
    <PageSections className="gap-after-header">
      <Card className="border-sky-strong/20 bg-gradient-to-br from-sky-surface/60 via-surface to-surface">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-sky-strong">
              LEAD INTELLIGENCE / 06 VIEWS
            </p>
            <h2 className="mt-1 text-[20px] font-bold text-text">
              {A ? "من أول ليد إلى قرار توزيع الكورس" : "From first lead to course allocation"}
            </h2>
            <p className="mt-1 text-[12px] text-text-muted">
              {A
                ? "كل الأرقام تتبع الفترة المختارة في الفلتر العام."
                : "Every metric follows the selected global reporting period."}{" "}
              <bdi className="num">{periodLabel}</bdi>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="text-[11px] font-semibold text-text-muted">
              {A ? "الكورس" : "Course"}
              <select
                aria-label={A ? "فلتر الكورس" : "Course filter"}
                value={course || data.filters.course}
                onChange={(event) => {
                  setCourse(event.target.value);
                  setPage(1);
                }}
                className="mt-1 block min-h-10 min-w-40 rounded-xl border border-border bg-surface px-3 text-[12px] text-text"
              >
                <option value="">{A ? "كل الكورسات" : "All courses"}</option>
                {data.filters.courses.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-semibold text-text-muted">
              {A ? "مسؤول المبيعات" : "Salesperson"}
              <select
                aria-label={A ? "فلتر مسؤول المبيعات" : "Salesperson filter"}
                value={owner || data.filters.owner}
                onChange={(event) => {
                  setOwner(event.target.value);
                  setPage(1);
                }}
                className="mt-1 block min-h-10 min-w-40 rounded-xl border border-border bg-surface px-3 text-[12px] text-text"
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
      </Card>

      <PageSection
        level="primary"
        title={A ? "01 / الهدف مقابل الليدز الفعلية" : "01 / Lead target versus actual"}
        hint={
          A
            ? "الهدف الشهري الكامل من Media Plan المعتمد؛ المتوقع يُحسب لأيام الفترة المختارة."
            : "Full approved monthly media-plan target; expected delivery uses selected calendar days."
        }
        icon={<Target size={17} />}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={A ? "ليدز وصلت" : "Leads received"}
            value={fmtNum(data.totals.leads)}
            accent
          />
          <Stat label={A ? "تم الفوز" : "Won"} value={fmtNum(data.totals.won)} />
          <Stat label={A ? "Lost" : "Lost"} value={fmtNum(data.totals.lost)} />
          <Stat label={A ? "ما زالت مفتوحة" : "Still open"} value={fmtNum(data.totals.open)} />
        </div>
        <TableWrap>
          <table className="w-full min-w-[800px]">
            <thead>
              <tr>
                <th className={th}>{A ? "الكورس" : "Course"}</th>
                <th className={th}>{A ? "الهدف" : "Target"}</th>
                <th className={th}>{A ? "المتوقع للفترة" : "Expected in period"}</th>
                <th className={th}>{A ? "وصل" : "Actual"}</th>
                <th className={th}>{A ? "الإنجاز" : "Achievement"}</th>
                <th className={th}>{A ? "المطلوب يوميًا" : "Daily pace"}</th>
                <th className={th}>{A ? "الحالة" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {data.courses.map((row) => (
                <tr key={row.course}>
                  <td className={`${td} font-bold`}>{row.course}</td>
                  <td className={td}>{number(row.target)}</td>
                  <td className={td}>
                    {row.expectedLeads === null ? "—" : row.expectedLeads.toFixed(1)}
                  </td>
                  <td className={td}>{fmtNum(row.leads)}</td>
                  <td className={td}>{pct(row.achievement)}</td>
                  <td className={td}>
                    {row.dailyTarget === null ? "—" : row.dailyTarget.toFixed(1)}
                  </td>
                  <td className={td}>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-bold ${row.target === null ? "bg-surface-3 text-text-muted" : row.leads >= row.target ? "bg-mint-surface text-mint-strong" : "bg-amber-surface text-amber-strong"}`}
                    >
                      {row.target === null
                        ? row.targetCoverage === "target_not_allocated_to_salesperson"
                          ? A
                            ? "هدف الكورس، غير موزع للأفراد"
                            : "Course target not assigned per person"
                          : A
                            ? "لا توجد خطة معتمدة"
                            : "No approved plan"
                        : row.leads >= row.target
                          ? A
                            ? "حقق الهدف"
                            : "Met"
                          : A
                            ? "أقل من الهدف"
                            : "Below target"}
                    </span>
                    {row.target !== null &&
                      row.leads < row.target &&
                      row.expectedLeads !== null && (
                        <small className="mt-1 block text-[10px] text-text-muted">
                          {row.leads >= row.expectedLeads
                            ? A
                              ? "على مسار الفترة"
                              : "On period pace"
                            : A
                              ? "أقل من مسار الفترة"
                              : "Behind period pace"}
                        </small>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <Card>
          <div className="mb-3 flex items-center gap-2 text-[12px] font-bold text-text">
            <CalendarDays size={15} />
            {A ? "الليدز يومًا بيوم" : "Daily lead arrivals"}
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto pe-1">
            {data.daily.map((day) => (
              <div
                key={day.day}
                className="grid grid-cols-[82px_1fr_58px] items-center gap-3 text-[11px]"
              >
                <bdi className="num text-text-muted">{day.day.slice(5)}</bdi>
                <div className="relative h-4 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="absolute inset-y-0 start-0 rounded-full bg-sky-strong"
                    style={{ width: `${Math.max(0, (day.leads / maxDay) * 100)}%` }}
                  />
                  {day.target !== null && (
                    <div
                      className="absolute inset-y-0 border-s-2 border-amber-strong"
                      style={{ insetInlineStart: `${Math.min(100, (day.target / maxDay) * 100)}%` }}
                    />
                  )}
                </div>
                <span className="num font-bold text-text">
                  {fmtNum(day.leads)}
                  {day.target !== null && (
                    <small className="font-normal text-text-muted">
                      {" "}
                      / {day.target.toFixed(1)}
                    </small>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-text-muted">
            {A
              ? "الخط الذهبي = متوسط الهدف اليومي. اليوم بدون ليد يظهر صفرًا."
              : "Amber marker = daily target. Days without a lead appear as zero."}
          </p>
        </Card>
      </PageSection>

      <PageSection
        level="primary"
        title={A ? "02 / الليدز حسب الحملة" : "02 / Leads by campaign"}
        hint={
          A
            ? "عدد ليدز Odoo وحالتها، مع صرف الحملة والتحصيل المنسوب إليها."
            : "Odoo leads and outcomes with campaign spend and attributed paid revenue."
        }
        icon={<ChartNoAxesCombined size={17} />}
      >
        <TableWrap>
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className={th}>{A ? "الحملة" : "Campaign"}</th>
                <th className={th}>Leads</th>
                <th className={th}>Won</th>
                <th className={th}>Lost</th>
                <th className={th}>{A ? "الصرف" : "Spend"}</th>
                <th className={th}>CPL</th>
                <th className={th}>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((row, index) => (
                <tr key={`${row.name}-${index}`}>
                  <td className={`${td} max-w-72 truncate font-semibold`} title={row.name}>
                    {row.name}
                  </td>
                  <td className={td}>{fmtNum(row.leads)}</td>
                  <td className={td}>{fmtNum(row.won)}</td>
                  <td className={td}>{fmtNum(row.lost)}</td>
                  <td className={td}>{fmtUSD(row.spend)}</td>
                  <td className={td}>{fmtUSD(row.cpl)}</td>
                  <td className={`${td} font-bold`}>{fmtRoas(row.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </PageSection>

      <PageSection
        level="primary"
        title={A ? "03 / رحلة إغلاق الليد" : "03 / Lead close lifecycle"}
        hint={
          A
            ? "المدة من إنشاء الليد إلى تاريخ Won أو Lost. الليدز المفتوحة خارج متوسط الإغلاق."
            : "Days from creation to Won or Lost; open leads are excluded from close time."
        }
        icon={<Gauge size={17} />}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label={A ? "متوسط الإغلاق" : "Average close"}
            value={duration(data.lifecycle.averageDays, A ? " يوم" : " days")}
          />
          <Stat
            label={A ? "الوسيط" : "Median close"}
            value={duration(data.lifecycle.medianDays, A ? " يوم" : " days")}
          />
          <Stat
            label={A ? "العينة بتاريخ إغلاق" : "Dated closures"}
            value={fmtNum(data.lifecycle.sample)}
            note={
              data.lifecycle.missingCloseDate
                ? `${fmtNum(data.lifecycle.missingCloseDate)} ${A ? "بدون تاريخ إغلاق موثوق" : "without a reliable close date"}`
                : undefined
            }
          />
        </div>
        <Card>
          <div className="grid gap-3 sm:grid-cols-5">
            {data.lifecycle.buckets.map((bucket) => (
              <div key={bucket.label}>
                <p className="num text-[11px] font-semibold text-text-muted">
                  {bucket.label} {A ? "يوم" : "days"}
                </p>
                <p className="num my-2 text-[22px] font-bold text-text">{fmtNum(bucket.count)}</p>
                <div className="h-2 rounded-full bg-surface-3">
                  <div
                    className="h-2 rounded-full bg-violet-strong"
                    style={{ width: `${(bucket.count / maxBucket) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <TableWrap>
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className={th}>Lead</th>
                <th className={th}>{A ? "الكورس" : "Course"}</th>
                <th className={th}>{A ? "المسؤول" : "Owner"}</th>
                <th className={th}>{A ? "تاريخ الإنشاء" : "Created"}</th>
                <th className={th}>{A ? "الإغلاق" : "Closed"}</th>
                <th className={th}>{A ? "الأيام" : "Days"}</th>
              </tr>
            </thead>
            <tbody>
              {data.lifecycle.records.map((row) => (
                <tr key={`${row.status}-${row.id}`}>
                  <td className={td}>
                    <a
                      href={row.odooUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-sky-strong"
                    >
                      #{row.id}
                      <ArrowUpRight size={12} />
                    </a>
                  </td>
                  <td className={td}>{row.course || "—"}</td>
                  <td className={td}>{row.owner || "—"}</td>
                  <td className={`${td} num`}>{row.createdAt?.slice(0, 10) || "—"}</td>
                  <td className={`${td} num`}>{row.closedAt?.slice(0, 10) || "—"}</td>
                  <td className={`${td} num font-bold`}>{number(row.closeDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <div className="flex items-center justify-between text-[11px] text-text-muted">
          <span>
            {fmtNum(data.lifecycle.total)} {A ? "ليد مغلق" : "closed leads"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="rounded-lg border border-border px-2 py-1 disabled:opacity-40"
            >
              {A ? "السابق" : "Previous"}
            </button>
            <span className="num">
              {data.lifecycle.page}/{data.lifecycle.pages}
            </span>
            <button
              type="button"
              disabled={page >= data.lifecycle.pages}
              onClick={() => setPage(page + 1)}
              className="rounded-lg border border-border px-2 py-1 disabled:opacity-40"
            >
              {A ? "التالي" : "Next"}
            </button>
          </div>
        </div>
      </PageSection>

      <PageSection
        level="primary"
        title={A ? "04 / جودة الليدز والنتيجة" : "04 / Lead quality and outcome"}
        hint={
          A
            ? "Won وLost لكل كورس مع نسبة الحسم والتتبع للحملات."
            : "Won, Lost, settled conversion and campaign attribution by course."
        }
        icon={<BadgeCheck size={17} />}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label={A ? "نسبة الفوز من المحسوم" : "Win rate of settled"}
            value={pct(
              data.totals.won + data.totals.lost
                ? data.totals.won / (data.totals.won + data.totals.lost)
                : null,
            )}
          />
          <Stat
            label={A ? "نسبة Lost من كل الليدز" : "Lost share of leads"}
            value={pct(data.totals.leads ? data.totals.lost / data.totals.leads : null)}
          />
          <Stat
            label={A ? "ليدز منسوبة لحملة" : "Campaign attributed"}
            value={pct(data.totals.leads ? data.totals.attributedLeads / data.totals.leads : null)}
          />
        </div>
        <TableWrap>
          <table className="w-full min-w-[650px]">
            <thead>
              <tr>
                <th className={th}>{A ? "الكورس" : "Course"}</th>
                <th className={th}>Leads</th>
                <th className={th}>Won</th>
                <th className={th}>Lost</th>
                <th className={th}>{A ? "مفتوح" : "Open"}</th>
                <th className={th}>{A ? "فوز/محسوم" : "Win / settled"}</th>
                <th className={th}>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {data.courses.map((row) => (
                <tr key={row.course}>
                  <td className={`${td} font-semibold`}>{row.course}</td>
                  <td className={td}>{fmtNum(row.leads)}</td>
                  <td className={td}>{fmtNum(row.won)}</td>
                  <td className={td}>{fmtNum(row.lost)}</td>
                  <td className={td}>{fmtNum(row.open)}</td>
                  <td className={td}>
                    {pct(row.won + row.lost ? row.won / (row.won + row.lost) : null)}
                  </td>
                  <td className={td}>{fmtRoas(row.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </PageSection>

      <PageSection
        level="primary"
        title={A ? "05 / الكورس × مسؤول المبيعات" : "05 / Course × salesperson"}
        hint={
          A
            ? "التوصية تبدأ بعد 10 ليدز و5 حالات محسومة؛ الليدز المفتوحة لا تُحسب خسارة."
            : "Recommendations require at least 10 leads and 5 settled outcomes; open leads are not losses."
        }
        icon={<UsersRound size={17} />}
      >
        <TableWrap>
          <table className="w-full min-w-[720px]">
            <thead>
              <tr>
                <th className={th}>{A ? "الكورس" : "Course"}</th>
                <th className={th}>{A ? "المسؤول" : "Salesperson"}</th>
                <th className={th}>Leads</th>
                <th className={th}>Won</th>
                <th className={th}>Lost</th>
                <th className={th}>{A ? "مفتوح" : "Open"}</th>
                <th className={th}>{A ? "تحويل المحسوم" : "Settled conversion"}</th>
                <th className={th}>{A ? "قراءة التوزيع" : "Allocation signal"}</th>
              </tr>
            </thead>
            <tbody>
              {data.salespeople.map((row) => (
                <tr key={`${row.course}-${row.owner}`}>
                  <td className={`${td} font-semibold`}>{row.course}</td>
                  <td className={td}>{row.owner}</td>
                  <td className={td}>{fmtNum(row.leads)}</td>
                  <td className={td}>{fmtNum(row.won)}</td>
                  <td className={td}>{fmtNum(row.lost)}</td>
                  <td className={td}>{fmtNum(row.open)}</td>
                  <td className={td}>{pct(row.settledRate)}</td>
                  <td className={td}>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${row.verdict === "grow" ? "bg-mint-surface text-mint-strong" : row.verdict === "review" ? "bg-amber-surface text-amber-strong" : "bg-surface-3 text-text-muted"}`}
                    >
                      {row.verdict === "grow"
                        ? A
                          ? "جرّب زيادة الحصة"
                          : "Try more leads"
                        : row.verdict === "review"
                          ? A
                            ? "راجع قبل التوزيع"
                            : "Review allocation"
                          : A
                            ? "عينة غير كافية"
                            : "Insufficient sample"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </PageSection>

      <PageSection
        level="primary"
        title={A ? "06 / مركز اقتصاديات الليد" : "06 / Lead economics"}
        hint={
          A
            ? "فلتر الكورس والمسؤول بالأعلى يطبق على كل الأقسام. الصرف لا يُقسم على الموظفين."
            : "Course and owner filters apply throughout. Ad spend is not apportioned to salespeople."
        }
        icon={<CircleHelp size={17} />}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="CPL"
            value={fmtUSD(data.totals.cpl)}
            note={A ? "الصرف ÷ ليدز Odoo" : "Spend ÷ Odoo leads"}
          />
          <Stat
            label="CAC"
            value={fmtUSD(data.totals.cac)}
            note={A ? "الصرف ÷ Won" : "Spend ÷ Won"}
          />
          <Stat
            label="ROAS"
            value={fmtRoas(data.totals.roas)}
            note={A ? "التحصيل ÷ الصرف" : "Paid revenue ÷ spend"}
          />
          <Stat
            label="ROI"
            value={pct(data.totals.roi)}
            note={
              A
                ? "(التحصيل − الصرف) ÷ الصرف؛ تكلفة الإعلان فقط"
                : "(Revenue − spend) ÷ spend; ad cost only"
            }
          />
          <Stat
            label={A ? "قيمة العميل المرصودة" : "Observed LTV proxy"}
            value={fmtUSD(data.totals.observedLtv)}
            note={
              A
                ? "كل التحصيل التاريخي ÷ أسماء العملاء الدافعين"
                : "All-time paid revenue ÷ named paying customers"
            }
          />
          <Stat label={A ? "التحصيل" : "Paid revenue"} value={fmtUSD(data.totals.revenue)} />
          <Stat label="Won" value={fmtNum(data.totals.won)} />
          <Stat label="Lost" value={fmtNum(data.totals.lost)} />
        </div>
        <Card className="bg-surface-2">
          <div className="flex items-start gap-2">
            <CircleHelp size={16} className="mt-0.5 shrink-0 text-sky-strong" />
            <p className="text-[11px] leading-relaxed text-text-muted">
              {A
                ? "الليدز تُنسب لشهر إنشائها وحالتها الحالية، بينما الإيراد يُنسب لتاريخ دفع الفاتورة؛ لذلك ROAS وROI مقاييس للفترة وليست ربحية نفس مجموعة الليدز. قيمة العميل المرصودة تستخدم كل التحصيل التاريخي وأسماء العملاء الدافعين، وليست Lifetime Value تنبؤية."
                : "Leads follow their creation date and current outcome; revenue follows invoice payment date. ROAS and ROI are period metrics, not same-cohort profit. Observed customer value uses all-time paid revenue and named paying partners; it is not predictive lifetime value."}
            </p>
          </div>
        </Card>
      </PageSection>
    </PageSections>
  );
}
