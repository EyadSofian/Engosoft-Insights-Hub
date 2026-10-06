import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BookOpen, ExternalLink, Flame, Layers3, Search, Users } from "lucide-react";
import { DashboardPageHeader, PageSections } from "@/components/dashboard-bits";
import { DetailPanel } from "@/components/DetailPanel";
import { Card, ErrorState, Skeleton } from "@/components/ui-bits";
import { useApi } from "@/lib/use-api";
import { fmtNum, useI18n } from "@/lib/i18n";
import type { CourseLeadDistribution, CourseLeadGroup } from "@/lib/lead-course-distribution.server";

export const Route = createFileRoute("/lead-distribution")({ component: LeadDistributionPage });

type Dimension = "specialty" | "course";
type Selection = { dimension: Dimension; label: string; stage?: string };

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
        ...(selected.stage ? { stage: selected.stage } : {}),
        page: String(page),
      }).toString()
    : "";
  const detail = useApi<CourseLeadDistribution>(
    `/api/lead-course-distribution?${detailQuery}`,
    { enabled: Boolean(selected) },
  );
  const groups = useMemo(() => {
    const source = dimension === "course" ? data?.byCourse ?? [] : data?.bySpecialty ?? [];
    const needle = search.trim().toLocaleLowerCase();
    return needle
      ? source.filter((group) => group.label.toLocaleLowerCase().includes(needle))
      : source;
  }, [data, dimension, search]);

  const open = (group: CourseLeadGroup, stage?: string) => {
    setPage(1);
    setSelected({ dimension, label: group.label, stage });
  };

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;
  return (
    <PageSections>
      <DashboardPageHeader
        icon={<Layers3 size={22} />}
        title={ar ? "Leads حسب التخصص والكورس" : "Leads by specialty and course"}
        subtitle={
          ar
            ? "كل Lead وOpportunity حسب تاريخ الإنشاء، بكورسها المسجل فعليًا في Odoo ومرحلتها الحالية."
            : "Leads and opportunities by creation date, their recorded Odoo course and current stage."
        }
        tone="sky"
        period={data ? `${data.period.from} → ${data.period.to}` : undefined}
      />

      {isLoading || !data ? (
        <><Skeleton className="h-24" /><Skeleton className="h-[460px]" /></>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="border-s-4 border-s-blue-600">
              <div className="text-xs text-text-muted">{ar ? "كل سجلات الـCRM" : "All CRM records"}</div>
              <div className="num mt-2 text-2xl font-bold text-text">{fmtNum(data.total)}</div>
            </Card>
            <Card className="border-s-4 border-s-emerald-600">
              <div className="text-xs text-text-muted">{ar ? "كورسات مؤكدة من أودو" : "Verified Odoo courses"}</div>
              <div className="num mt-2 text-2xl font-bold text-text">{fmtNum(data.total - data.unverified)}</div>
            </Card>
            <Card className="border-s-4 border-s-amber-500">
              <div className="text-xs text-text-muted">{ar ? "تحتاج تحديد أو مراجعة كورس" : "Course needs review"}</div>
              <div className="num mt-2 text-2xl font-bold text-text">{fmtNum(data.unverified)}</div>
            </Card>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
              <div className="flex rounded-xl bg-surface-2 p-1" role="tablist" aria-label={ar ? "طريقة التجميع" : "Grouping"}>
                {(["specialty", "course"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={dimension === tab}
                    onClick={() => { setDimension(tab); setSearch(""); setSelected(null); }}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${dimension === tab ? "bg-surface text-brand shadow-sm" : "text-text-muted hover:text-text"}`}
                  >
                    {tab === "specialty" ? <Layers3 size={16} /> : <BookOpen size={16} />}
                    {tab === "specialty" ? (ar ? "حسب التخصص" : "By specialty") : (ar ? "حسب الكورس" : "By course")}
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
              <table className="w-full min-w-[720px] text-start text-sm">
                <thead className="bg-surface-2 text-xs text-text-muted">
                  <tr>
                    <th className="min-w-[175px] px-4 py-3 text-start font-semibold">{dimension === "course" ? (ar ? "الكورس" : "Course") : (ar ? "التخصص" : "Specialty")}</th>
                    <th className="px-3 py-3 text-center font-semibold">{ar ? "الإجمالي" : "Total"}</th>
                    {data.stages.map((stage) => <th key={stage} className="min-w-[95px] px-3 py-3 text-center font-semibold">{stageLabel(stage, ar)}</th>)}
                    <th className="px-3 py-3 text-center font-semibold">Hot</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.label} className="border-t border-border transition-colors hover:bg-surface-2/60">
                      <th className="px-4 py-3 text-start font-semibold text-text">
                        <button type="button" onClick={() => open(group)} className="text-start text-brand hover:underline">{group.label}</button>
                        {group.unverified > 0 && <span className="mt-1 block text-[11px] font-normal text-amber-700">{fmtNum(group.unverified)} {ar ? "بحاجة مراجعة" : "needs review"}</span>}
                      </th>
                      <td className="num px-3 py-3 text-center font-bold"><button type="button" onClick={() => open(group)} className="rounded-lg px-3 py-1 text-brand hover:bg-brand/10">{fmtNum(group.count)}</button></td>
                      {data.stages.map((stage) => (
                        <td key={stage} className="num px-3 py-3 text-center">
                          {group.stages[stage] ? <button type="button" onClick={() => open(group, stage)} className="rounded-lg px-3 py-1 text-text hover:bg-brand/10 hover:text-brand">{fmtNum(group.stages[stage])}</button> : <span className="text-text-subtle">—</span>}
                        </td>
                      ))}
                      <td className="num px-3 py-3 text-center text-amber-700">{group.hot ? fmtNum(group.hot) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!groups.length && <div className="px-5 py-12 text-center text-sm text-text-muted">{ar ? "لا توجد سجلات مطابقة" : "No matching records"}</div>}
            </div>
            <div className="border-t border-border px-4 py-3 text-[11px] text-text-muted sm:px-5">
              {ar ? "اضغط على العدد أو المرحلة لعرض السجلات. Hot أولوية في Odoo وليست Stage. غير المصنف يبقى ظاهرًا للمراجعة." : "Select a count or stage to inspect records. Hot is an Odoo priority, not a stage. Unclassified records remain visible for review."}
            </div>
          </Card>
        </>
      )}

      <DetailPanel
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.label ?? ""}
        subtitle={selected ? `${selected.stage ? `${stageLabel(selected.stage, ar)} · ` : ""}${fmtNum(detail.data?.detail?.total ?? 0)} ${ar ? "سجل" : "records"}` : undefined}
        width="min(670px, 100vw)"
      >
        {detail.isLoading ? <Skeleton className="h-80" /> : detail.error ? <ErrorState message={(detail.error as Error).message} onRetry={() => detail.refetch()} /> : (
          <div className="space-y-2">
            {detail.data?.detail?.rows.map((row) => (
              <div key={row.id} className="rounded-xl border border-border bg-surface-2/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-text">{row.contact} <span className="num text-xs font-normal text-text-muted">#{row.id}</span></div>
                    <div className="mt-1 text-xs text-text-muted">{row.recordType === "lead" ? "Lead" : "Opportunity"} · {stageLabel(row.stage, ar)} · {row.createdAt.slice(0, 10)}</div>
                  </div>
                  <a href={row.odooUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10"><ExternalLink size={13} />{ar ? "فتح في أودو" : "Open in Odoo"}</a>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-md bg-surface-3 px-2 py-1">{row.course} · {row.specialty}</span>
                  {row.priority === "Hot" && <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-amber-800"><Flame size={12} /> Hot</span>}
                  {!row.verified && <span className="rounded-md bg-amber-100 px-2 py-1 text-amber-800">{ar ? "حقل الكورس يحتاج مراجعة" : "Course field needs review"}: {row.rawCategory || "—"}</span>}
                  {row.salesperson && <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1"><Users size={12} /> {row.salesperson}</span>}
                  {row.actualStage && row.stage !== row.actualStage && <span className="rounded-md bg-surface-3 px-2 py-1">Odoo: {row.actualStage}</span>}
                </div>
              </div>
            ))}
            {detail.data?.detail && detail.data.detail.total > detail.data.detail.pageSize && (
              <div className="flex items-center justify-between gap-3 py-3 text-xs text-text-muted">
                <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-border px-3 py-2 disabled:opacity-40">{ar ? "السابق" : "Previous"}</button>
                <span>{fmtNum(page)} / {fmtNum(Math.ceil(detail.data.detail.total / detail.data.detail.pageSize))}</span>
                <button type="button" disabled={page * detail.data.detail.pageSize >= detail.data.detail.total} onClick={() => setPage(page + 1)} className="rounded-lg border border-border px-3 py-2 disabled:opacity-40">{ar ? "التالي" : "Next"}</button>
              </div>
            )}
          </div>
        )}
      </DetailPanel>
    </PageSections>
  );
}
