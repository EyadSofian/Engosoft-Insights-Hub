import { useMemo, useState } from "react";
import { ArrowRight, Database, Tags } from "lucide-react";
import { Card, Segmented } from "@/components/ui-bits";
import { PageSection } from "@/components/dashboard-bits";
import type { PerformanceRecord } from "@/lib/lead-performance";

type Tab = "status" | "segment" | "contact" | "before-crm";
type Language = "ar" | "en";

const wording = {
  ar: {
    title: "افصل التصنيف عن حالة البيع والاتصال",
    hint: "كل سجل دخل أودو في شهر الاختيار يظهر مرة واحدة في حالة CRM الحالية. Fresh تصنيف مستقل، والمكالمة دليل مستقل.",
    status: "حالة CRM الآن",
    segment: "تصنيف Lead Segment",
    contact: "دليل الاتصال",
    before: "قبل دخول CRM",
    total: "إجمالي سجلات CRM الداخلة",
    statusHint: "الأعداد المعروضة تتجمع إلى الإجمالي؛ هذه حالة السجل الآن وليست تاريخ انتقالاته.",
    activeLead: "Lead نشط",
    lostLead: "Lead مفقود",
    openOpportunity: "Opportunity مفتوحة",
    wonOpportunity: "Opportunity Won",
    lostOpportunity: "Opportunity Lost",
    other: "حالة أخرى تحتاج مراجعة",
    segmentHint:
      "هذا حقل تصنيف حالي، لا مرحلة من مسار البيع. قد يبقى Fresh على Opportunity مفتوحة أو Won أو Lost.",
    freshCross: "الموسومون Fresh الآن موزعون على الحالات التالية",
    freshLead: "من نوع Lead",
    freshOpportunity: "من نوع Opportunity",
    freshNote: "Lead النشط ليس Fresh تلقائيًا؛ نعتمد على قيمة حقل Lead Segment نفسها.",
    blank: "الحقل فارغ",
    contactHint:
      "المكالمة بعد إنشاء السجل، مطابقة هاتف فريدة في Yeastar. لا تعني المكالمة بالضرورة رد العميل، وغيابها ليس حكمًا بعدم عمل السيلز.",
    group: "مجموعة السجلات",
    called: "لها محاولة PBX موثقة",
    noPbx: "لا تظهر لها محاولة PBX",
    unmatched: "الهاتف غير قابل للمطابقة الآمنة",
    noCoverage: "تغطية Yeastar غير كافية؛ لن نعرض صفرًا مضللًا.",
    all: "كل سجلات CRM",
    fresh: "الموسومة Fresh الآن",
    active: "Lead نشط حاليًا",
    outsideTitle: "سجلات لم تدخل CRM بعد",
    unavailable: "غير قابل للحساب من أودو وحده",
    outsideHint:
      "أودو لا يملك سجلًا لمن لم يدخل إليه. نحتاج قائمة أحداث مستقلة من نماذج الموقع ومنصات الإعلانات والرسائل، مع معرّف/هاتف قابل للمطابقة وتاريخ الحدث، ثم نطرح ما وصل CRM بعد إزالة التكرار. أرقام المنصات وحدها ليست عدد أشخاص لم يدخلوا CRM.",
    arrow: "الدخول المثبت إلى CRM",
  },
  en: {
    title: "Keep classification, sales state and contact evidence separate",
    hint: "Each record created in Odoo in the selected month appears once in its current CRM state. Fresh is a separate tag; a call is separate evidence.",
    status: "Current CRM state",
    segment: "Lead Segment tag",
    contact: "Contact evidence",
    before: "Before CRM",
    total: "CRM records created",
    statusHint:
      "The displayed counts add up to the total. They describe current state, not historical transitions.",
    activeLead: "Active Lead",
    lostLead: "Lost Lead",
    openOpportunity: "Open Opportunity",
    wonOpportunity: "Won Opportunity",
    lostOpportunity: "Lost Opportunity",
    other: "Other state to review",
    segmentHint:
      "This is a current classification field, not a sales stage. Fresh can remain on Open, Won or Lost Opportunities.",
    freshCross: "Records currently tagged Fresh are in these CRM states",
    freshLead: "Lead record type",
    freshOpportunity: "Opportunity record type",
    freshNote:
      "An active Lead is not automatically tagged Fresh; only the Lead Segment field decides this count.",
    blank: "Blank field",
    contactHint:
      "Calls after record creation with a unique Yeastar phone match. A call does not prove the customer answered; no visible call does not prove sales did nothing.",
    group: "Record group",
    called: "Documented PBX attempt",
    noPbx: "No PBX attempt visible",
    unmatched: "Phone cannot be safely matched",
    noCoverage: "Yeastar coverage is incomplete; no misleading zeros are shown.",
    all: "All CRM records",
    fresh: "Currently tagged Fresh",
    active: "Currently active Leads",
    outsideTitle: "Records not yet in CRM",
    unavailable: "Not measurable from Odoo alone",
    outsideHint:
      "Odoo has no record for a person who never entered it. This needs an independent event feed from website forms, ad platforms and messaging, with a matchable ID/phone and event time; then reconciled CRM arrivals and duplicates can be subtracted. Platform totals alone are not a count of people missing from CRM.",
    arrow: "Verified CRM entry",
  },
} as const;

const stateOf = (row: PerformanceRecord) => `${row.recordType}:${row.status}`;

export function LeadClassificationAudit({
  records,
  lang,
  callsAvailable,
}: {
  records: PerformanceRecord[];
  lang: Language;
  callsAvailable: boolean;
}) {
  const t = wording[lang];
  const [tab, setTab] = useState<Tab>("status");
  const summary = useMemo(() => {
    const buckets: { key: string; label: string; color: string }[] = [
      { key: "lead:lead", label: t.activeLead, color: "border-sky-strong text-sky-strong" },
      { key: "lead:lost", label: t.lostLead, color: "border-rose-strong text-rose-strong" },
      { key: "opportunity:open", label: t.openOpportunity, color: "border-brand text-brand" },
      {
        key: "opportunity:won",
        label: t.wonOpportunity,
        color: "border-mint-strong text-mint-strong",
      },
      {
        key: "opportunity:lost",
        label: t.lostOpportunity,
        color: "border-amber-strong text-amber-strong",
      },
    ];
    const counts = new Map<string, number>();
    const segments = new Map<string, number>();
    const fresh = records.filter((row) => row.leadSegment.trim().toLowerCase() === "fresh");
    for (const row of records) {
      counts.set(stateOf(row), (counts.get(stateOf(row)) ?? 0) + 1);
      const segment = row.leadSegment.trim() || t.blank;
      segments.set(segment, (segments.get(segment) ?? 0) + 1);
    }
    const covered = buckets.reduce((sum, bucket) => sum + (counts.get(bucket.key) ?? 0), 0);
    const statusRows = buckets.map((bucket) => ({ ...bucket, count: counts.get(bucket.key) ?? 0 }));
    if (covered !== records.length)
      statusRows.push({
        key: "other",
        label: t.other,
        color: "border-border text-text",
        count: records.length - covered,
      });
    const contactRows = [
      { label: t.all, rows: records },
      { label: t.fresh, rows: fresh },
      { label: t.active, rows: records.filter((row) => stateOf(row) === "lead:lead") },
    ].map(({ label, rows }) => ({
      label,
      total: rows.length,
      called: rows.filter((row) => row.attempts !== null && row.attempts > 0).length,
      noPbx: rows.filter((row) => row.attempts === 0).length,
      unmatched: rows.filter((row) => row.attempts === null).length,
    }));
    return {
      statusRows,
      segmentRows: [...segments.entries()].sort((a, b) => b[1] - a[1]),
      freshStatus: statusRows
        .map((row) => ({ ...row, count: fresh.filter((item) => stateOf(item) === row.key).length }))
        .filter((row) => row.count > 0),
      contactRows,
      freshCount: fresh.length,
      freshLeadCount: fresh.filter((row) => row.recordType === "lead").length,
      freshOpportunityCount: fresh.filter((row) => row.recordType === "opportunity").length,
    };
  }, [records, t]);

  return (
    <PageSection
      id="performance-classification"
      title={t.title}
      hint={t.hint}
      icon={<Tags size={16} />}
      tone="sky"
      action={
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "status", label: t.status },
            { value: "segment", label: t.segment },
            { value: "contact", label: t.contact },
            { value: "before-crm", label: t.before },
          ]}
        />
      }
    >
      {tab === "status" && (
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
            <div>
              <div className="text-xs text-text-muted">{t.total}</div>
              <div className="num mt-1 text-3xl font-bold text-text">
                {records.length.toLocaleString()}
              </div>
            </div>
            <p className="max-w-xl text-xs leading-5 text-text-muted">{t.statusHint}</p>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {summary.statusRows.map((row) => (
              <div
                key={row.key}
                className={`rounded-xl border-t-[3px] bg-surface-2/65 px-3 py-3 ${row.color}`}
              >
                <div className="num text-2xl font-bold">{row.count.toLocaleString()}</div>
                <div className="mt-1 text-[12px] font-semibold text-text">{row.label}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {tab === "segment" && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card>
            <p className="mb-3 text-xs leading-5 text-text-muted">{t.segmentHint}</p>
            <div className="divide-y divide-border">
              {summary.segmentRows.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-text">{label}</span>
                  <strong className="num text-text">{count.toLocaleString()}</strong>
                </div>
              ))}
            </div>
          </Card>
          <Card className="border-sky-strong/25 bg-sky-surface/40">
            <div className="text-xs font-semibold text-sky-strong">Lead Segment = Fresh</div>
            <div className="num mt-1 text-3xl font-bold text-text">
              {summary.freshCount.toLocaleString()}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-sky-strong/20 bg-surface/80 px-3 py-2">
                <div className="text-text-muted">{t.freshLead}</div>
                <b className="num mt-1 block text-xl text-text">
                  {summary.freshLeadCount.toLocaleString()}
                </b>
              </div>
              <div className="rounded-xl border border-brand/20 bg-surface/80 px-3 py-2">
                <div className="text-text-muted">{t.freshOpportunity}</div>
                <b className="num mt-1 block text-xl text-text">
                  {summary.freshOpportunityCount.toLocaleString()}
                </b>
              </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-text-muted">{t.freshNote}</p>
            <p className="mt-2 text-xs leading-5 text-text-muted">{t.freshCross}</p>
            <div className="mt-3 divide-y divide-border">
              {summary.freshStatus.map((row) => (
                <div key={row.key} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-text">{row.label}</span>
                  <b className="num text-text">{row.count.toLocaleString()}</b>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
      {tab === "contact" && (
        <Card>
          <p className="mb-4 text-xs leading-5 text-text-muted">{t.contactHint}</p>
          {!callsAvailable && (
            <p className="rounded-xl bg-amber-surface px-3 py-2 text-sm text-amber-strong">
              {t.noCoverage}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-start text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-muted">
                  <th className="py-2 text-start">{t.group}</th>
                  <th className="py-2 text-end">{t.total}</th>
                  <th className="py-2 text-end">{t.called}</th>
                  <th className="py-2 text-end">{t.noPbx}</th>
                  <th className="py-2 text-end">{t.unmatched}</th>
                </tr>
              </thead>
              <tbody>
                {summary.contactRows.map((row) => (
                  <tr key={row.label} className="border-b border-border/70 last:border-0">
                    <th className="py-3 text-start font-semibold text-text">{row.label}</th>
                    <td className="num py-3 text-end">{row.total.toLocaleString()}</td>
                    <td className="num py-3 text-end text-mint-strong">
                      {callsAvailable ? row.called.toLocaleString() : "—"}
                    </td>
                    <td className="num py-3 text-end text-amber-strong">
                      {callsAvailable ? row.noPbx.toLocaleString() : "—"}
                    </td>
                    <td className="num py-3 text-end text-text-muted">
                      {callsAvailable ? row.unmatched.toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === "before-crm" && (
        <Card className="border-dashed border-amber-strong/40 bg-amber-surface/35">
          <div className="flex items-start gap-4">
            <Database className="mt-1 shrink-0 text-amber-strong" size={24} />
            <div>
              <div className="text-sm font-semibold text-text">{t.outsideTitle}</div>
              <div className="mt-1 text-2xl font-bold text-text">—</div>
              <p className="mt-1 text-xs font-semibold text-amber-strong">{t.unavailable}</p>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-text-muted">{t.outsideHint}</p>
              <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-xs text-text">
                <ArrowRight size={14} />
                {t.arrow}: <b className="num">{records.length.toLocaleString()}</b>
              </div>
            </div>
          </div>
        </Card>
      )}
    </PageSection>
  );
}
