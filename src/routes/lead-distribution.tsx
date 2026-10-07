import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { BookOpen, ExternalLink, Flame, Layers3, Search, Users } from "lucide-react";
import { DashboardPageHeader, PageSections } from "@/components/dashboard-bits";
import { DetailPanel } from "@/components/DetailPanel";
import { Card, ErrorState, Skeleton } from "@/components/ui-bits";
import { useApi } from "@/lib/use-api";
import { fmtNum, useI18n } from "@/lib/i18n";
import type {
  CourseLeadDistribution,
  CourseLeadGroup,
} from "@/lib/lead-course-distribution.server";
import type { LeadLifecycleBucket } from "@/lib/lead-course-distribution";

export const Route = createFileRoute("/lead-distribution")({ component: LeadDistributionPage });

type Dimension = "specialty" | "course";
type Selection = {
  dimension: Dimension;
  label: string;
  bucket?: LeadLifecycleBucket;
  stage?: string;
};

function bucketLabel(bucket: LeadLifecycleBucket, ar: boolean) {
  const labels = {
    lead_active: ar ? "Lead نشط" : "Active leads",
    lead_lost: ar ? "Lead مفقود" : "Lost leads",
    lead_other: ar ? "Lead مؤرشف" : "Archived leads",
    opportunity: "Opportunity",
  };
  return labels[bucket];
}

function stageLabel(stage: string, arabic: boolean) {
  if (!arabic) return stage;
  const names: Record<string, string> = {
    Lost: "Lost / مفقود",
    Archived: "مؤرشف",
    "Unspecified stage": "مرحلة غير محددة",
    "Long Follow Up": "متابعة طويلة",
    Open: "Open / مفتوح",
    New: "New / جديد",
    "Quotation Sent": "عرض سعر",
    Won: "Won / مكتمل",
    Preparation: "تجهيز",
  };
  return names[stage] ?? stage;
}

function LeadDistributionPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [dimension, setDimension] = useState<Dimension>("specialty");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useApi<CourseLeadDistribution>(
    "/api/lead-course-distribution",
  );
  const detailQuery = selected
    ? new URLSearchParams({
        dimension: selected.dimension,
        label: selected.label,
        ...(selected.bucket ? { bucket: selected.bucket } : {}),
        ...(selected.stage ? { stage: selected.stage } : {}),
        page: String(page),
      }).toString()
    : "";
  const detail = useApi<CourseLeadDistribution>(`/api/lead-course-distribution?${detailQuery}`, {
    enabled: Boolean(selected),
  });
  const groups = useMemo(() => {
    const source = dimension === "course" ? (data?.byCourse ?? []) : (data?.bySpecialty ?? []);
    const needle = search.trim().toLocaleLowerCase();
    return needle
      ? source.filter((group) => group.label.toLocaleLowerCase().includes(needle))
      : source;
  }, [data, dimension, search]);

  const open = (group: CourseLeadGroup, bucket?: LeadLifecycleBucket, stage?: string) => {
    setPage(1);
    setSelected({ dimension, label: group.label, bucket, stage });
  };

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  return (
    <PageSections>
      <DashboardPageHeader
        icon={<Layers3 size={22} />}
        title={ar ? "Leads حسب التخصص والكورس" : "Leads by specialty and course"}
        subtitle={
          ar
            ? "مسار كل سجل حسب تاريخ إنشائه في Odoo: Lead نشط أو مفقود، ثم Opportunity بمراحلها الحالية."
            : "Each Odoo record by creation date: active or lost lead, or opportunity with its current stage."
        }
        tone="sky"
        period={data ? `${data.period.from} → ${data.period.to}` : undefined}
      />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-24" />
          <Skeleton className="h-[460px]" />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-s-4 border-s-blue-600">
              <div className="text-xs text-text-muted">
                {ar ? "إجمالي السجلات التي دخلت" : "All records created"}
              </div>
              <div className="num mt-2 text-2xl font-bold text-text">{fmtNum(data.total)}</div>
            </Card>
            <Card className="border-s-4 border-s-emerald-600">
              <div className="text-xs text-text-muted">{bucketLabel("lead_active", ar)}</div>
              <div className="num mt-2 text-2xl font-bold text-text">
                {fmtNum(data.lifecycle.leadActive)}
              </div>
            </Card>
            <Card className="border-s-4 border-s-rose-500">
              <div className="text-xs text-text-muted">{bucketLabel("lead_lost", ar)}</div>
              <div className="num mt-2 text-2xl font-bold text-text">
                {fmtNum(data.lifecycle.leadLost)}
              </div>
            </Card>
            <Card className="border-s-4 border-s-violet-600">
              <div className="text-xs text-text-muted">{bucketLabel("opportunity", ar)}</div>
              <div className="num mt-2 text-2xl font-bold text-text">
                {fmtNum(data.lifecycle.opportunities)}
              </div>
            </Card>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-sm leading-7 text-slate-700">
            {ar
              ? "المعادلة: الإجمالي = Lead نشط + Lead مفقود + Opportunity"
              : "Total = active leads + lost leads + opportunities"}
            {data.lifecycle.leadOther > 0 && (
              <>
                {" "}
                + {fmtNum(data.lifecycle.leadOther)} {bucketLabel("lead_other", ar)}
              </>
            )}
            {". "}
            {ar
              ? "مراحل الـOpportunity تفصيل داخل عددها وليست سجلات إضافية. التصنيف يعكس نوع السجل الحالي في Odoo، وليس سجل حدث التحويل التاريخي."
              : "Opportunity stages break down that count; they are not additional records. This uses the current Odoo record type, not historical conversion events."}
            {data.unverified > 0 && (
              <span className="ms-2 text-amber-800">
                {fmtNum(data.unverified)}{" "}
                {ar ? "سجل يحتاج مراجعة الكورس." : "course assignments need review."}
              </span>
            )}
          </div>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
              <div
                className="flex rounded-xl bg-surface-2 p-1"
                role="tablist"
                aria-label={ar ? "طريقة التجميع" : "Grouping"}
              >
                {(["specialty", "course"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={dimension === tab}
                    onClick={() => {
                      setDimension(tab);
                      setSearch("");
                      setSelected(null);
                    }}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${dimension === tab ? "bg-surface text-brand shadow-sm" : "text-text-muted hover:text-text"}`}
                  >
                    {tab === "specialty" ? <Layers3 size={16} /> : <BookOpen size={16} />}
                    {tab === "specialty"
                      ? ar
                        ? "حسب التخصص"
                        : "By specialty"
                      : ar
                        ? "حسب الكورس"
                        : "By course"}
                  </button>
                ))}
              </div>
              <label className="relative block min-w-[210px] flex-1 sm:max-w-72">
                <Search size={16} className="absolute inset-y-0 my-auto ms-3 text-text-muted" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={ar ? "ابحث عن تخصص أو كورس" : "Find a specialty or course"}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 ps-10 text-sm text-text outline-none focus:border-brand"
                />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-start text-sm">
                <thead className="bg-surface-2 text-xs text-text-muted">
                  <tr>
                    <th className="min-w-[175px] px-4 py-3 text-start font-semibold">
                      {dimension === "course"
                        ? ar
                          ? "الكورس"
                          : "Course"
                        : ar
                          ? "التخصص"
                          : "Specialty"}
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      {ar ? "الإجمالي" : "Total"}
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      {bucketLabel("lead_active", ar)}
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      {bucketLabel("lead_lost", ar)}
                    </th>
                    <th className="px-3 py-3 text-center font-semibold">
                      {bucketLabel("opportunity", ar)}
                    </th>
                    {data.lifecycle.leadOther > 0 && (
                      <th className="px-3 py-3 text-center font-semibold">
                        {bucketLabel("lead_other", ar)}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <Fragment key={group.label}>
                      <tr className="border-t border-border transition-colors hover:bg-surface-2/60">
                        <th className="px-4 pt-4 pb-2 text-start font-semibold text-text">
                          <button
                            type="button"
                            onClick={() => open(group)}
                            className="text-start text-brand hover:underline"
                          >
                            {group.label}
                          </button>
                          {(group.hot > 0 || group.unverified > 0) && (
                            <span className="mt-1 block text-[11px] font-normal text-text-muted">
                              {group.hot > 0 && <>Hot: {fmtNum(group.hot)}</>}
                              {group.hot > 0 && group.unverified > 0 && " · "}
                              {group.unverified > 0 && (
                                <>
                                  {fmtNum(group.unverified)} {ar ? "بحاجة مراجعة" : "needs review"}
                                </>
                              )}
                            </span>
                          )}
                        </th>
                        <td className="num px-3 pt-4 pb-2 text-center font-bold">
                          <button
                            type="button"
                            onClick={() => open(group)}
                            className="rounded-lg px-3 py-1 text-brand hover:bg-brand/10"
                          >
                            {fmtNum(group.count)}
                          </button>
                        </td>
                        {(["lead_active", "lead_lost", "opportunity"] as const).map((bucket) => {
                          const value =
                            bucket === "lead_active"
                              ? group.leadActive
                              : bucket === "lead_lost"
                                ? group.leadLost
                                : group.opportunities;
                          return (
                            <td key={bucket} className="num px-3 pt-4 pb-2 text-center">
                              {value > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => open(group, bucket)}
                                  className={`rounded-lg px-3 py-1 font-semibold hover:bg-brand/10 ${bucket === "lead_lost" ? "text-rose-700" : bucket === "opportunity" ? "text-violet-700" : "text-emerald-700"}`}
                                >
                                  {fmtNum(value)}
                                </button>
                              ) : (
                                <span className="text-text-subtle">—</span>
                              )}
                            </td>
                          );
                        })}
                        {data.lifecycle.leadOther > 0 && (
                          <td className="num px-3 pt-4 pb-2 text-center">
                            {group.leadOther > 0 ? (
                              <button
                                type="button"
                                onClick={() => open(group, "lead_other")}
                                className="rounded-lg px-3 py-1 text-text hover:bg-brand/10"
                              >
                                {fmtNum(group.leadOther)}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        )}
                      </tr>
                      {group.opportunities > 0 && (
                        <tr className="bg-surface-2/40">
                          <td
                            colSpan={data.lifecycle.leadOther > 0 ? 6 : 5}
                            className="px-4 pb-4 pt-1"
                          >
                            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2 text-xs">
                              <span className="font-semibold text-violet-800">
                                {ar
                                  ? `تفصيل ${fmtNum(group.opportunities)} Opportunity حسب المرحلة:`
                                  : `${fmtNum(group.opportunities)} opportunities by stage:`}
                              </span>
                              {data.stages.map((stage) =>
                                group.opportunityStages[stage] ? (
                                  <button
                                    key={stage}
                                    type="button"
                                    onClick={() => open(group, "opportunity", stage)}
                                    className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-violet-900 transition-colors hover:border-violet-500 hover:bg-violet-100"
                                  >
                                    {stageLabel(stage, ar)}{" "}
                                    <strong className="num ms-1">
                                      {fmtNum(group.opportunityStages[stage])}
                                    </strong>
                                  </button>
                                ) : null,
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {!groups.length && (
                <div className="px-5 py-12 text-center text-sm text-text-muted">
                  {ar ? "لا توجد سجلات مطابقة" : "No matching records"}
                </div>
              )}
            </div>
            <div className="border-t border-border px-4 py-3 text-[11px] text-text-muted sm:px-5">
              {ar
                ? "كل رقم قابل للضغط لعرض السجلات وفتحها في Odoo. Hot أولوية متداخلة وليست جزءًا جديدًا من الإجمالي."
                : "Select any count to inspect records in Odoo. Hot is an overlapping priority, not an extra part of the total."}
            </div>
          </Card>
        </>
      )}

      <DetailPanel
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.label ?? ""}
        subtitle={
          selected
            ? `${selected.bucket ? `${bucketLabel(selected.bucket, ar)} · ` : ""}${selected.stage ? `${stageLabel(selected.stage, ar)} · ` : ""}${fmtNum(detail.data?.detail?.total ?? 0)} ${ar ? "سجل" : "records"}`
            : undefined
        }
        width="min(670px, 100vw)"
      >
        {detail.isLoading ? (
          <Skeleton className="h-80" />
        ) : detail.error ? (
          <ErrorState message={(detail.error as Error).message} onRetry={() => detail.refetch()} />
        ) : (
          <div className="space-y-2">
            {detail.data?.detail?.rows.map((row) => (
              <div key={row.id} className="rounded-xl border border-border bg-surface-2/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-text">
                      {row.contact}{" "}
                      <span className="num text-xs font-normal text-text-muted">#{row.id}</span>
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      {row.recordType === "lead" ? "Lead" : "Opportunity"} ·{" "}
                      {stageLabel(row.stage, ar)} · {row.createdAt.slice(0, 10)}
                    </div>
                  </div>
                  <a
                    href={row.odooUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"
                  >
                    <ExternalLink size={13} />
                    {ar ? "فتح في أودو" : "Open in Odoo"}
                  </a>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-md bg-surface-3 px-2 py-1">
                    {row.course} · {row.specialty}
                  </span>
                  {row.priority === "Hot" && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-amber-800">
                      <Flame size={12} /> Hot
                    </span>
                  )}
                  {!row.verified && (
                    <span className="rounded-md bg-amber-100 px-2 py-1 text-amber-800">
                      {ar ? "حقل الكورس يحتاج مراجعة" : "Course field needs review"}:{" "}
                      {row.rawCategory || "—"}
                    </span>
                  )}
                  {row.salesperson && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1">
                      <Users size={12} /> {row.salesperson}
                    </span>
                  )}
                  {row.actualStage && row.stage !== row.actualStage && (
                    <span className="rounded-md bg-surface-3 px-2 py-1">
                      Odoo: {row.actualStage}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {detail.data?.detail && detail.data.detail.total > detail.data.detail.pageSize && (
              <div className="flex items-center justify-between gap-3 py-3 text-xs text-text-muted">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded-lg border border-border px-3 py-2 disabled:opacity-40"
                >
                  {ar ? "السابق" : "Previous"}
                </button>
                <span>
                  {fmtNum(page)} /{" "}
                  {fmtNum(Math.ceil(detail.data.detail.total / detail.data.detail.pageSize))}
                </span>
                <button
                  type="button"
                  disabled={page * detail.data.detail.pageSize >= detail.data.detail.total}
                  onClick={() => setPage(page + 1)}
                  className="rounded-lg border border-border px-3 py-2 disabled:opacity-40"
                >
                  {ar ? "التالي" : "Next"}
                </button>
              </div>
            )}
          </div>
        )}
      </DetailPanel>
    </PageSections>
  );
}
