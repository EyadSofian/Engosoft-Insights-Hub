import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
  CircleCheckBig,
  Clock3,
  PhoneCall,
  TrendingDown,
  Users,
} from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import {
  BarList,
  Card,
  ErrorState,
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { AdSetOriginBadge } from "@/components/metric-bits";
import { DataTable, type Col } from "@/components/DataTable";
import type { AdSetOrigin, DataHealth, Grouped, Totals } from "@/lib/types";

export const Route = createFileRoute("/leads")({ component: Leads });

type WorkspaceTab = "overview" | "breakdowns" | "records";
type BreakdownKey = "stage" | "source" | "course" | "campaign" | "team" | "salesperson";

interface LeadRow {
  createdAt: string;
  contact: string;
  campaign: string;
  adName: string;
  adset: string;
  adsetOrigin: AdSetOrigin;
  course: string;
  stage: string;
  source: string;
  salesperson: string;
  salesTeam: string;
  subTeam: string;
  priority: string;
  closedAt: string;
  daysToClose: number | null;
}

interface OriginCohort {
  key: "campaign" | "other";
  leads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  lostRate: number | null;
  revenue: number;
  avgCloseDays: number | null;
  closeSample: number;
}

interface AttributionRow {
  key: string;
  name: string;
  leads: number;
  interested: number;
  quotations: number;
  won: number;
  lost: number;
  salesOrders: number;
  invoices: number;
  revenue: number;
  leadToWonRate: number | null;
  leadToInvoiceRate: number | null;
}

interface Resp {
  totals: Totals;
  pipeline: { followUp: number; fresh: number; stalled: number; activeDeals: number };
  salesFunnel: {
    funnel: {
      leads: number;
      interested: number;
      quotations: number;
      won: number;
      salesOrders: number;
      invoices: number;
    };
    sources: AttributionRow[];
    campaigns: (AttributionRow & { spend: number; roas: number | null })[];
  };
  origin: { cohorts: OriginCohort[]; otherBySource: Grouped[] };
  byStage: Grouped[];
  bySource: Grouped[];
  byCourse: Grouped[];
  byTeam: Grouped[];
  bySubTeam: Grouped[];
  bySalesperson: Grouped[];
  byCampaign: Grouped[];
  byPriority: Grouped[];
  byMonth: Grouped[];
  detail: { rows: LeadRow[]; total: number; truncated: boolean };
  health: DataHealth;
}

interface CallsResp {
  available: boolean;
  error?: string;
  totals?: {
    calls: number;
    answered: number;
    answerRate: number | null;
    analyzed: number;
    needsReview: number;
    talkSeconds: number;
    averageScore: number | null;
  };
  topEmployees?: {
    key: string;
    name: string;
    extension: string;
    totalCalls: number;
    answeredCalls: number;
  }[];
}

const rate = (numerator: number, denominator: number) =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

function Leads() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [breakdown, setBreakdown] = useState<BreakdownKey>("course");
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/leads");
  const calls = useApi<CallsResp>("/api/crm-calls");

  const breakdownRows = useMemo(() => {
    if (!data) return [];
    return {
      stage: data.byStage,
      source: data.bySource,
      course: data.byCourse,
      campaign: data.byCampaign,
      team: data.byTeam,
      salesperson: data.bySalesperson,
    }[breakdown];
  }, [breakdown, data]);

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const cols: Col<LeadRow>[] = [
    {
      key: "createdAt",
      header: t("created"),
      sticky: true,
      width: "120px",
      sortValue: (r) => r.createdAt,
      render: (r) => fmtDate(r.createdAt, lang),
    },
    {
      key: "contact",
      header: t("contact"),
      sortValue: (r) => r.contact,
      render: (r) => (
        <span className="block max-w-[160px] truncate" title={r.contact}>
          {r.contact || "—"}
        </span>
      ),
    },
    {
      key: "stage",
      header: t("stage"),
      sortValue: (r) => r.stage,
      render: (r) => (
        <Pill tone={r.stage.toLowerCase().includes("won") ? "success" : "neutral"}>
          {r.stage || "—"}
        </Pill>
      ),
    },
    {
      key: "course",
      header: t("course"),
      sortValue: (r) => r.course,
      render: (r) => r.course || "—",
    },
    {
      key: "source",
      header: t("source"),
      sortValue: (r) => r.source,
      render: (r) => r.source || "—",
    },
    {
      key: "campaign",
      header: t("campaign"),
      sortValue: (r) => r.campaign,
      render: (r) => (
        <span className="block max-w-[190px] truncate" title={r.campaign}>
          {r.campaign || "—"}
        </span>
      ),
    },
    {
      key: "adset",
      header: t("ad_set"),
      sortValue: (r) => r.adset,
      render: (r) => (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="max-w-[140px] truncate" title={r.adset}>
            {r.adset || "—"}
          </span>
          <AdSetOriginBadge origin={r.adsetOrigin} />
        </span>
      ),
    },
    {
      key: "salesperson",
      header: t("salesperson"),
      sortValue: (r) => r.salesperson,
      render: (r) => (
        <span className="block max-w-[160px] truncate" title={r.salesperson}>
          {r.salesperson || "—"}
        </span>
      ),
    },
    {
      key: "salesTeam",
      header: t("sales_team"),
      sortValue: (r) => r.salesTeam,
      render: (r) => r.salesTeam || "—",
    },
  ];

  const tabOptions: { key: WorkspaceTab; ar: string; en: string }[] = [
    { key: "overview", ar: "الملخص والقرارات", en: "Overview & actions" },
    { key: "breakdowns", ar: "التحليل", en: "Breakdowns" },
    { key: "records", ar: "سجل العملاء", en: "Lead records" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={lang === "ar" ? "CRM — إدارة العملاء" : "CRM — Customer management"}
        subtitle={
          lang === "ar"
            ? "البيع الحقيقي من الفواتير، وحالة الـCRM ظاهرة منفصلة، والمكالمات من PBX."
            : "Paid invoices define sales; CRM stages and PBX calls remain visible as separate signals."
        }
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-48" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <CrmCommandBar data={data} />

          <div className="hscroll flex gap-1 rounded-2xl border border-border bg-surface p-1 shadow-sm sm:w-fit">
            {tabOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setTab(option.key)}
                className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${tab === option.key ? "bg-navy text-white" : "text-text-muted hover:bg-surface-2 hover:text-text"}`}
              >
                {option[lang]}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[0.9fr_1.4fr]">
                <PipelineCard data={data} />
                <QualityTable rows={data.salesFunnel.campaigns} />
              </div>
              <div id="calls" className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <CallsPanel state={calls} />
                <SourceConversion rows={data.salesFunnel.sources} />
              </div>
            </div>
          )}

          {tab === "breakdowns" && (
            <Card>
              <SectionTitle
                hint={
                  lang === "ar"
                    ? "بدل ستة مربعات في نفس الوقت: اختار سؤالًا واحدًا واقرأ ترتيبه."
                    : "Choose one business question instead of scanning six cards at once."
                }
              >
                {lang === "ar" ? "توزيع العملاء" : "Lead breakdown"}
              </SectionTitle>
              <div className="hscroll mb-5 flex gap-2">
                {(
                  [
                    ["stage", t("by_stage")],
                    ["source", t("by_source")],
                    ["course", t("by_course")],
                    ["campaign", t("by_campaign")],
                    ["team", t("by_team")],
                    ["salesperson", t("by_salesperson")],
                  ] as [BreakdownKey, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setBreakdown(key)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${breakdown === key ? "border-brand bg-brand-soft text-brand" : "border-border text-text-muted hover:bg-surface-2"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="max-w-4xl">
                <BarList
                  items={breakdownRows.slice(0, 12).map((row) => ({
                    label: row.label,
                    value: row.count,
                    meta: (
                      <span>
                        <span className="num">{fmtNum(row.count)}</span>
                        <span className="num ms-1.5 text-[11px] text-text-muted">
                          ({fmtPct(row.share, 1)})
                        </span>
                      </span>
                    ),
                  }))}
                  format={fmtNum}
                />
              </div>
            </Card>
          )}

          {tab === "records" && (
            <DataTable
              rows={data.detail.rows}
              cols={cols}
              searchable={(r) =>
                `${r.contact} ${r.campaign} ${r.course} ${r.salesperson} ${r.source}`
              }
              initialSort={{ key: "createdAt", dir: -1 }}
              csvFilename="engosoft-crm-leads"
              maxHeight={680}
              truncatedNote={
                data.detail.truncated
                  ? lang === "ar"
                    ? `معروض ${fmtNum(data.detail.rows.length)} من ${fmtNum(data.detail.total)} صف.`
                    : `Showing ${fmtNum(data.detail.rows.length)} of ${fmtNum(data.detail.total)} rows.`
                  : undefined
              }
              csvRow={(r) => ({
                created: r.createdAt,
                contact: r.contact,
                stage: r.stage,
                course: r.course,
                source: r.source,
                campaign: r.campaign,
                ad_name: r.adName,
                ad_set: r.adset,
                salesperson: r.salesperson,
                sales_team: r.salesTeam,
              })}
            />
          )}
        </>
      )}
    </div>
  );
}

function CrmCommandBar({ data }: { data: Resp }) {
  const { lang } = useI18n();
  const invoiceConversion = rate(data.totals.orders, data.totals.totalLeads);
  const metrics = [
    {
      icon: Users,
      label: lang === "ar" ? "كل العملاء" : "All leads",
      value: fmtNum(data.totals.totalLeads),
      note: lang === "ar" ? "CRM + Lost المؤكد" : "CRM + confirmed Lost",
    },
    {
      icon: BadgeDollarSign,
      label: lang === "ar" ? "صفقات مدفوعة" : "Paid deals",
      value: fmtNum(data.totals.orders),
      note: lang === "ar" ? "عدد الفواتير المميزة" : "Distinct paid invoices",
    },
    {
      icon: CircleCheckBig,
      label: lang === "ar" ? "تحويل حقيقي" : "Paid conversion",
      value: fmtPct(invoiceConversion, 1),
      note: lang === "ar" ? "الفواتير ÷ كل الليدز" : "Invoices ÷ all leads",
    },
    {
      icon: Clock3,
      label: lang === "ar" ? "قيد المتابعة" : "Follow-up",
      value: fmtNum(data.pipeline.followUp),
      note: lang === "ar" ? "من غير Won وبيانات قديمة" : "Excludes Won and junk",
    },
    {
      icon: TrendingDown,
      label: "Closed Lost",
      value: fmtNum(data.totals.lost),
      note: fmtPct(data.totals.lostRate, 1),
    },
  ];

  return (
    <section className="relative overflow-hidden rounded-[28px] bg-navy px-4 py-5 text-white shadow-[0_20px_50px_rgba(4,31,59,0.16)] sm:px-6">
      <div className="pointer-events-none absolute -end-12 -top-20 size-56 rounded-full border-[38px] border-white/[0.035]" />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
            CRM CONTROL ROOM
          </p>
          <h2 className="mt-1 text-xl font-semibold sm:text-2xl">
            {fmtNum(data.totals.totalLeads)} {lang === "ar" ? "ليد أنتجوا" : "leads produced"}{" "}
            <span className="text-electric">{fmtNum(data.totals.orders)}</span>{" "}
            {lang === "ar" ? "فاتورة مدفوعة" : "paid invoices"}
          </h2>
        </div>
        <Pill tone="success">{lang === "ar" ? "المصدر: Accounting" : "Source: Accounting"}</Pill>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className="rounded-2xl border border-white/10 bg-white/[0.055] p-3 backdrop-blur-sm"
            >
              <div className="flex items-center gap-2 text-[11px] text-white/55">
                <Icon size={14} />
                <span>{metric.label}</span>
              </div>
              <div className="num mt-2 text-2xl font-semibold tracking-tight">{metric.value}</div>
              <div className="mt-1 text-[10px] text-white/45">{metric.note}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PipelineCard({ data }: { data: Resp }) {
  const { lang } = useI18n();
  const items = [
    [lang === "ar" ? "كل الليدز" : "All leads", data.totals.totalLeads, "var(--chart-1)"],
    [lang === "ar" ? "قيد المتابعة" : "Follow-up", data.pipeline.followUp, "var(--accent)"],
    [lang === "ar" ? "صفقات نشطة" : "Active deals", data.pipeline.activeDeals, "var(--warning)"],
    [lang === "ar" ? "فواتير مدفوعة" : "Paid invoices", data.totals.orders, "var(--success)"],
    ["Closed Lost", data.totals.lost, "var(--danger)"],
  ] as const;
  const peak = Math.max(...items.map((item) => item[1]), 1);
  return (
    <Card>
      <SectionTitle
        hint={
          lang === "ar"
            ? "الفاتورة هي البيع؛ Won يظل حالة CRM فقط."
            : "A paid invoice is the sale; Won remains a CRM-stage signal."
        }
      >
        {lang === "ar" ? "مسار القرار" : "Decision funnel"}
      </SectionTitle>
      <div className="space-y-3">
        {items.map(([label, value, color]) => (
          <div key={label}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <span className="text-text-muted">{label}</span>
              <span className="num font-semibold text-text">{fmtNum(value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(2, (value / peak) * 100)}%`, background: color }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4 text-center">
        <Mini label={lang === "ar" ? "جديدة" : "Fresh"} value={data.pipeline.fresh} />
        <Mini label={lang === "ar" ? "متوقفة" : "Stalled"} value={data.pipeline.stalled} />
        <Mini label="CRM Won" value={data.totals.won} />
      </div>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="num text-lg font-semibold text-text">{fmtNum(value)}</div>
      <div className="text-[10px] text-text-muted">{label}</div>
    </div>
  );
}

function QualityTable({ rows }: { rows: AttributionRow[] }) {
  const { lang } = useI18n();
  const ranked = [...rows]
    .filter((row) => row.key !== "__unattributed__" && row.leads >= 20)
    .sort((a, b) => (b.leadToInvoiceRate ?? 0) - (a.leadToInvoiceRate ?? 0) || a.lost - b.lost)
    .slice(0, 8);
  return (
    <Card>
      <SectionTitle
        hint={
          lang === "ar"
            ? "ترتيب شفاف: الفواتير ÷ الليدز، وبجواره Lost. أقل من 20 ليد مستبعد من الترتيب."
            : "Transparent ranking: invoices ÷ leads beside Lost; fewer than 20 leads are excluded."
        }
      >
        {lang === "ar" ? "جودة الليدز حسب الحملة" : "Lead quality by campaign"}
      </SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] text-text-muted">
              <th className="pb-2 text-start">{lang === "ar" ? "الحملة" : "Campaign"}</th>
              <th className="pb-2 text-end">{lang === "ar" ? "ليدز" : "Leads"}</th>
              <th className="pb-2 text-end">{lang === "ar" ? "فواتير" : "Invoices"}</th>
              <th className="pb-2 text-end">{lang === "ar" ? "التحويل" : "Conversion"}</th>
              <th className="pb-2 text-end">Lost</th>
              <th className="pb-2 text-end">{lang === "ar" ? "الحكم" : "Verdict"}</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => {
              const lostRate = rate(row.lost, row.leads);
              const strong = (row.leadToInvoiceRate ?? 0) >= 10 && (lostRate ?? 100) <= 25;
              const weak = (row.leadToInvoiceRate ?? 0) < 5 || (lostRate ?? 0) > 35;
              return (
                <tr key={row.key} className="border-b border-border/70 last:border-0">
                  <td
                    className="max-w-[250px] truncate py-3 pe-4 font-medium text-text"
                    title={row.name}
                  >
                    {row.name}
                  </td>
                  <td className="num py-3 text-end">{fmtNum(row.leads)}</td>
                  <td className="num py-3 text-end">{fmtNum(row.invoices)}</td>
                  <td className="num py-3 text-end font-semibold">
                    {fmtPct(row.leadToInvoiceRate, 1)}
                  </td>
                  <td className="num py-3 text-end text-text-muted">{fmtPct(lostRate, 1)}</td>
                  <td className="py-3 text-end">
                    <Pill tone={strong ? "success" : weak ? "danger" : "warning"}>
                      {strong
                        ? lang === "ar"
                          ? "قوية"
                          : "Strong"
                        : weak
                          ? lang === "ar"
                            ? "ضعيفة"
                            : "Weak"
                          : lang === "ar"
                            ? "متابعة"
                            : "Watch"}
                    </Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CallsPanel({ state }: { state: ReturnType<typeof useApi<CallsResp>> }) {
  const { lang } = useI18n();
  const totals = state.data?.totals;
  return (
    <Card className="relative overflow-hidden">
      <SectionTitle
        action={
          <Link
            to="/teams"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand"
          >
            {lang === "ar" ? "أداء الموظفين" : "Employee performance"}
            <ArrowLeft size={13} />
          </Link>
        }
        hint={
          lang === "ar"
            ? "من Engosoft Calls Hub وYeastar، ويتحمل منفصلًا حتى لا يؤخر CRM."
            : "From Engosoft Calls Hub and Yeastar, loaded independently so CRM stays fast."
        }
      >
        <span className="inline-flex items-center gap-2">
          <PhoneCall size={17} className="text-brand" />
          {lang === "ar" ? "المكالمات والمتابعة" : "Calls & follow-up"}
        </span>
      </SectionTitle>
      {state.isLoading ? (
        <Skeleton className="h-28" />
      ) : !state.data?.available || !totals ? (
        <div className="rounded-xl bg-warning-soft p-4 text-sm text-warning">
          {lang === "ar"
            ? "بيانات المكالمات غير متاحة مؤقتًا؛ أرقام CRM مازالت شغالة."
            : "Calls are temporarily unavailable; CRM figures remain available."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <CallMetric
              label={lang === "ar" ? "كل المكالمات" : "All calls"}
              value={fmtNum(totals.calls)}
            />
            <CallMetric
              label={lang === "ar" ? "تم الرد" : "Answered"}
              value={fmtNum(totals.answered)}
            />
            <CallMetric
              label={lang === "ar" ? "نسبة الرد" : "Answer rate"}
              value={fmtPct(totals.answerRate, 1)}
            />
            <CallMetric
              label={lang === "ar" ? "تحتاج مراجعة" : "Needs review"}
              value={fmtNum(totals.needsReview)}
              danger={totals.needsReview > 0}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {state.data.topEmployees?.map((employee) => (
              <span
                key={employee.key}
                className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[11px] text-text-muted"
              >
                <b className="text-text">{employee.name}</b> ·{" "}
                <span className="num">{fmtNum(employee.totalCalls)}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function CallMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-3">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className={`num mt-1 text-xl font-semibold ${danger ? "text-danger" : "text-text"}`}>
        {value}
      </div>
    </div>
  );
}

function SourceConversion({ rows }: { rows: AttributionRow[] }) {
  const { lang } = useI18n();
  const ranked = [...rows]
    .filter((row) => row.key !== "__unattributed__" && row.name !== "—" && row.leads >= 20)
    .sort((a, b) => (b.leadToInvoiceRate ?? 0) - (a.leadToInvoiceRate ?? 0))
    .slice(0, 6);
  return (
    <Card>
      <SectionTitle
        hint={
          lang === "ar"
            ? "على أساس الفواتير المدفوعة، وليس مرحلة Won."
            : "Based on paid invoices, not the Won stage."
        }
      >
        {lang === "ar" ? "أعلى مصادر تحويلًا" : "Highest-converting sources"}
      </SectionTitle>
      <div className="space-y-2.5">
        {ranked.map((row, index) => (
          <div
            key={row.key}
            className="flex items-center gap-3 rounded-xl border border-border p-3"
          >
            <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text">{row.name}</div>
              <div className="mt-0.5 text-[10px] text-text-muted">
                {fmtNum(row.invoices)} {lang === "ar" ? "فاتورة من" : "invoices from"}{" "}
                {fmtNum(row.leads)} {lang === "ar" ? "ليد" : "leads"}
              </div>
            </div>
            <span className="num text-sm font-bold text-success">
              {fmtPct(row.leadToInvoiceRate, 1)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
