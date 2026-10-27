import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  FileSpreadsheet,
  FilterX,
  Layers3,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  DashboardPageHeader,
  PageSection,
  PageSections,
  SyncStatus,
} from "@/components/dashboard-bits";
import { ErrorState, Skeleton } from "@/components/ui-bits";
import { useApi } from "@/lib/use-api";
import { fmtNum, useI18n } from "@/lib/i18n";
import type { AuditGroup, LostArchiveAuditResult } from "@/lib/lost-archive-audit";

type Dimension = "courses" | "salespeople" | "campaigns";
const percent = (value: number) => `${value.toFixed(1)}%`;
const bounded = (value: number) => Math.max(0, Math.min(100, value));

function AuditGroupPanel({
  rows,
  title,
  description,
  ar,
  otherReasons,
}: {
  rows: AuditGroup[];
  title: string;
  description: string;
  ar: boolean;
  otherReasons?: { name: string; count: number }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, 8);
  return (
    <div className="quality-panel">
      <div className="quality-panel-heading">
        <h3 className="text-base font-bold text-text">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
      </div>
      {shown.length ? (
        <div className="quality-group-list">
          {shown.map((row) => (
            <div key={row.name} className="quality-group-row">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="min-w-0 break-words text-[13px] font-semibold text-text">
                  {row.name}
                </span>
                <span className="num shrink-0 text-[13px] font-bold text-rose-strong">
                  {fmtNum(row.review)} {ar ? "أُعيدت" : "returned"}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-muted">
                <span>
                  {fmtNum(row.total)} {ar ? "قرارًا تمت مراجعته" : "audited decisions"}
                </span>
                <span className="num font-semibold">{percent(row.reviewPct)}</span>
              </div>
              <div
                className="quality-meter mt-2"
                role="meter"
                aria-label={ar ? `نسبة الإعادة: ${row.name}` : `Return rate: ${row.name}`}
                aria-valuenow={bounded(row.reviewPct)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${bounded(row.reviewPct)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-5 py-8 text-sm text-text-muted">
          {ar ? "لا توجد حالات للفلاتر المختارة." : "No cases for these filters."}
        </p>
      )}
      {rows.length > 8 && (
        <button
          type="button"
          className="quality-show-more"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded
            ? ar
              ? "عرض أقل"
              : "Show fewer"
            : ar
              ? `عرض كل ${fmtNum(rows.length)} مجموعة`
              : `Show all ${fmtNum(rows.length)} groups`}
        </button>
      )}
      {otherReasons && otherReasons.length > 0 && (
        <details className="quality-original-reasons">
          <summary>
            {ar ? "عرض المسميات الأصلية للأسباب الأخرى" : "Show original labels for other reasons"}
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            {ar
              ? "هذه مسميات مجمعة من الشيت، وليست صفوف عملاء إضافية."
              : "These are grouped sheet labels, not additional customer rows."}
          </p>
          <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
            {otherReasons.map((reason) => (
              <div key={reason.name} className="quality-original-reason">
                <span className="min-w-0 break-words">{reason.name}</span>
                <b className="num shrink-0">{fmtNum(reason.count)}</b>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function LostQualityAudit({ initialMonth }: { initialMonth?: string }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [month, setMonth] = useState(initialMonth ?? "2026-10");
  const [course, setCourse] = useState("");
  const [salesperson, setSalesperson] = useState("");
  const [dimension, setDimension] = useState<Dimension>("courses");
  const query = new URLSearchParams({ month });
  if (course) query.set("course", course);
  if (salesperson) query.set("salesperson", salesperson);
  const { data, isLoading, error, refetch } = useApi<LostArchiveAuditResult>(
    `/api/lost-archive-audit?${query}`,
    { refetchInterval: 60_000 },
  );

  if (error) return <ErrorState message={error.message} />;
  if (isLoading || !data)
    return (
      <PageSections>
        <Skeleton className="h-28" />
        <Skeleton className="h-48" />
        <Skeleton className="h-72" />
      </PageSections>
    );

  const ready = data.status === "success" && data.rowCount > 0;
  const selected = data.selected;
  const groups = [...selected[dimension]].sort(
    (a, b) => b.review - a.review || b.total - a.total || a.name.localeCompare(b.name),
  );
  const dimensionNames = {
    courses: ar ? "الكورسات" : "Courses",
    salespeople: ar ? "فريق المبيعات" : "Sales team",
    campaigns: ar ? "الحملات" : "Campaigns",
  };
  const selectedLabel =
    data.months.find((item) => item.key === data.selectedMonth)?.label ?? data.selectedMonth;
  const syncLabel = data.syncedAt
    ? new Date(data.syncedAt).toLocaleString(ar ? "ar-EG" : "en-US", {
        timeZone: "Africa/Cairo",
      })
    : undefined;

  return (
    <PageSections>
      <DashboardPageHeader
        flush
        tone="sky"
        icon={<ShieldCheck size={21} />}
        title={ar ? "جودة الليدز ومراجعة Lost" : "Lead quality and Lost audit"}
        subtitle={
          ar
            ? "قرارات المراجعة في Google Sheet: ما اعتُمد، وما أُعيد للسيلز للمتابعة."
            : "Google Sheet audit decisions: what was accepted and what returned to sales."
        }
        period={ready ? selectedLabel : undefined}
        sync={<SyncStatus label={syncLabel} tone={ready ? "mint" : "amber"} />}
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void refetch()} className="quality-header-action">
              <RefreshCw size={14} aria-hidden="true" />
              {ar ? "تحديث" : "Refresh"}
            </button>
            <a
              href={data.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="quality-header-action"
            >
              <FileSpreadsheet size={14} aria-hidden="true" />
              {ar ? "الشيت الأصلي" : "Source sheet"}
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </div>
        }
      />

      {!ready ? (
        <section className="quality-unavailable" role="status">
          <CircleAlert size={20} aria-hidden="true" />
          <div>
            <h2 className="font-bold text-text">
              {ar ? "القراءة المباشرة للشيت غير متاحة" : "Direct sheet read is unavailable"}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">
              {ar
                ? "لن تُعرض الأصفار كنتيجة فعلية. يحتاج الشيت الخاص إلى صلاحية قراءة Google قبل عرض قرارات المراجعة."
                : "Zeros are not shown as actual results. The private sheet needs Google read access before audit decisions can be displayed."}
            </p>
          </div>
        </section>
      ) : (
        <>
          <PageSection
            title={ar ? "حدد نطاق المراجعة" : "Set the audit scope"}
            hint={
              ar
                ? "اختَر الشهر، ثم ضيّق النتائج بالكورس أو مسؤول المبيعات."
                : "Choose a month, then narrow the results by course or salesperson."
            }
            icon={<Layers3 size={16} />}
            tone="sky"
          >
            <div className="quality-filter-panel">
              <div
                className="quality-months"
                role="group"
                aria-label={ar ? "شهر المراجعة" : "Audit month"}
              >
                {data.months.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={data.selectedMonth === item.key}
                    onClick={() => {
                      setMonth(item.key);
                      setCourse("");
                      setSalesperson("");
                    }}
                    className="quality-month"
                    data-selected={data.selectedMonth === item.key ? "" : undefined}
                  >
                    <span>{ar ? item.label : item.key}</span>
                    <span className="num quality-month-count">{fmtNum(item.total)}</span>
                  </button>
                ))}
              </div>
              <div className="quality-filter-selects">
                <label>
                  <span>{ar ? "الكورس" : "Course"}</span>
                  <select value={course} onChange={(event) => setCourse(event.target.value)}>
                    <option value="">{ar ? "كل الكورسات" : "All courses"}</option>
                    {data.courseOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{ar ? "مسؤول المبيعات" : "Salesperson"}</span>
                  <select
                    value={salesperson}
                    onChange={(event) => setSalesperson(event.target.value)}
                  >
                    <option value="">{ar ? "كل الفريق" : "All salespeople"}</option>
                    {data.salespersonOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                {(course || salesperson) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCourse("");
                      setSalesperson("");
                    }}
                    className="quality-clear-filters"
                  >
                    <FilterX size={15} aria-hidden="true" />
                    {ar ? "مسح الفلاتر" : "Clear filters"}
                  </button>
                )}
              </div>
            </div>
          </PageSection>

          <PageSection
            title={ar ? "نتيجة قرارات المراجعة" : "Audit decision outcome"}
            hint={
              ar
                ? "هذه صفوف الشيت في النطاق المحدد، وليست حالة السجلات الحالية في أودو."
                : "These are sheet rows in the selected scope, not current Odoo record states."
            }
            icon={<ShieldCheck size={16} />}
            tone="mint"
            id="quality-outcome"
          >
            <div className="quality-outcome-grid">
              <article className="quality-outcome-hero">
                <p className="text-[12px] font-semibold text-white/80">
                  {ar ? "إجمالي قرارات Lost المراجَعة" : "Audited Lost decisions"}
                </p>
                <strong className="num mt-3 block text-5xl font-bold leading-none text-white">
                  {fmtNum(selected.total)}
                </strong>
                <div className="quality-outcome-meter mt-6" aria-hidden="true">
                  <span style={{ width: `${bounded(100 - selected.reviewPct)}%` }} />
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-white/85">
                  {ar
                    ? "الجزء الفاتح لقرارات Lost المعتمدة؛ الباقي أُعيد للسيلز. لا توجد مرحلة «معلّق» ضمن هذين القرارين."
                    : "The light segment shows accepted Lost decisions; the rest returned to sales. These decisions have no pending stage."}
                </p>
              </article>
              <article className="quality-result-card" data-tone="rose">
                <span className="quality-result-icon">
                  <CircleAlert size={18} aria-hidden="true" />
                </span>
                <h3>{ar ? "لم يُعتمد Lost" : "Lost not accepted"}</h3>
                <strong className="num">{fmtNum(selected.review)}</strong>
                <p>
                  {percent(selected.reviewPct)}{" "}
                  {ar
                    ? "من قرارات المراجعة؛ أُعيدت للسيلز للمتابعة."
                    : "of audited decisions; returned to sales for follow-up."}
                </p>
              </article>
              <article className="quality-result-card" data-tone="mint">
                <span className="quality-result-icon">
                  <CheckCircle2 size={18} aria-hidden="true" />
                </span>
                <h3>{ar ? "قرارات Lost المعتمدة" : "Accepted Lost decisions"}</h3>
                <strong className="num">{fmtNum(selected.approved)}</strong>
                <p>
                  {ar
                    ? "Validate = Yes في الشيت؛ لا يثبت أن السجل ما زال Lost في أودو."
                    : "Validate = Yes in the sheet; current Odoo Lost status is not implied."}
                </p>
              </article>
            </div>
          </PageSection>

          <div className="quality-analysis-grid">
            <PageSection
              title={ar ? "أسباب تسجيل Lost" : "Recorded Lost reasons"}
              hint={
                ar
                  ? "توزيع الأسباب داخل قرارات المجموعة المختارة."
                  : "Reason labels within the selected audited decisions."
              }
              icon={<CircleAlert size={16} />}
              tone="rose"
            >
              <AuditGroupPanel
                rows={selected.reasons}
                title={ar ? "السبب المسجل في الشيت" : "Sheet reason"}
                description={
                  ar
                    ? "الشريط يوضح نسبة الحالات المُعادة للسيلز داخل كل سبب."
                    : "The bar shows the returned share within each reason."
                }
                ar={ar}
                otherReasons={selected.otherReasons}
              />
            </PageSection>
            <PageSection
              title={ar ? "أين تركزت الإعادة للسيلز؟" : "Where did returns concentrate?"}
              hint={
                ar
                  ? "مرتب حسب عدد الحالات المُعادة؛ النسبة مقامها كل قرارات نفس المجموعة."
                  : "Ranked by returned count; each rate uses that group's audited decisions."
              }
              icon={<Layers3 size={16} />}
              tone="violet"
            >
              <div
                className="quality-dimension-tabs"
                role="group"
                aria-label={ar ? "طريقة التقسيم" : "Breakdown dimension"}
              >
                {(["courses", "salespeople", "campaigns"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={dimension === item}
                    data-selected={dimension === item ? "" : undefined}
                    onClick={() => setDimension(item)}
                  >
                    {dimensionNames[item]}
                  </button>
                ))}
              </div>
              <AuditGroupPanel
                key={dimension}
                rows={groups}
                title={dimensionNames[dimension]}
                description={
                  ar
                    ? "الأعلى أولًا حسب الحالات التي لم يُعتمد لها قرار Lost."
                    : "Highest returned counts first."
                }
                ar={ar}
              />
            </PageSection>
          </div>

          <PageSection
            title={ar ? "اكتمال البيانات وحدود القراءة" : "Data completeness and scope"}
            hint={
              ar
                ? "حقول ناقصة في صفوف الشيت؛ لا تُضاف إلى أعداد Lost."
                : "Missing fields in sheet rows; these are not additional Lost cases."
            }
            icon={<ShieldCheck size={16} />}
            tone="amber"
          >
            <div className="quality-coverage-grid">
              {[
                {
                  label: ar ? "بلا تاريخ إغلاق" : "Missing close date",
                  value: selected.missingClosedDate,
                },
                {
                  label: ar ? "بلا تاريخ إنشاء" : "Missing creation date",
                  value: selected.missingCreatedDate,
                },
                {
                  label: ar ? "بلا اسم حملة" : "Missing campaign",
                  value: selected.missingCampaign,
                },
              ].map((item) => (
                <div key={item.label} className="quality-coverage-card">
                  <strong className="num">{fmtNum(item.value)}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <p className="quality-scope-note">
              {ar
                ? "مراجعة الشيت توثق قرار Lost وقت المراجعة فقط. لا يحتوي الشيت CRM ID أو نوع Lead/Opportunity؛ لا نجمع أعداده مع أودو ولا نستنتج منه الحالة الحالية."
                : "The sheet records the audit decision, not today's CRM status. It has no CRM ID or Lead/Opportunity type, so its counts cannot be added to Odoo's Lost totals."}
            </p>
          </PageSection>

          <nav
            aria-label={ar ? "تقارير Lost المرتبطة" : "Related Lost reports"}
            className="quality-related"
          >
            <span className="text-xs font-bold text-text-muted">
              {ar ? "تقارير مرتبطة" : "Related reports"}
            </span>
            <Link to="/leads" search={{ view: "lost", month: data.selectedMonth }}>
              {ar ? "Lost حسب شهر دخول الليد" : "Lost by lead entry month"}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
            <Link to="/lost">
              {ar ? "لوست الداشبورد وأسباب الفقدان" : "Dashboard Lost and reasons"}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </nav>
        </>
      )}
    </PageSections>
  );
}
