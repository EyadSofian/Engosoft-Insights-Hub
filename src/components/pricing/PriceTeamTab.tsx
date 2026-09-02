import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  Check,
  ChevronDown,
  Copy,
  Minus,
  UsersRound,
} from "lucide-react";
import { EmptyState, Skeleton } from "@/components/ui-bits";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import { bandText, fmtMoney, type AuditRow, type CatalogEntry } from "./pricing-ui";
import type { ComplianceResponse } from "./PriceComplianceTab";

type TeamRow = ComplianceResponse["bySalesperson"][number];

interface TeamMember {
  salesperson: string;
  lines: number;
  breaches: number;
  leakage: number;
  /** Share of this person's audited lines that stayed inside the band. */
  compliance: number;
  /** Change in that share against the previous period, in points. */
  trend?: number;
  worst?: AuditRow;
}

/** Two letters that survive being an Arabic or a Latin name. */
const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "؟";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
};

type SortKey = "severity" | "compliance" | "breaches" | "leakage" | "lines";

/**
 * Who needs a conversation, in the order they need it.
 *
 * The default order is by money given away rather than by breach count, because
 * one course sold 4,000 under the floor costs more than nine sold 50 under it,
 * and the manager only has so many conversations in a day.
 */
export function PriceTeamTab({
  data,
  previous,
  breachRows,
  catalog,
  loading,
  onOpenSalesperson,
  onSendDigest,
  sending,
  canWrite,
}: {
  data?: ComplianceResponse;
  /** The same aggregate for the preceding period of equal length, when known. */
  previous?: TeamRow[];
  breachRows: AuditRow[];
  catalog?: CatalogEntry[];
  loading: boolean;
  onOpenSalesperson: (salesperson: string) => void;
  onSendDigest: () => void;
  sending: boolean;
  canWrite: boolean;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [sort, setSort] = useState<SortKey>("severity");
  const [showIncentives, setShowIncentives] = useState(false);
  const [copied, setCopied] = useState("");

  const worstByPerson = useMemo(() => {
    const out = new Map<string, AuditRow>();
    for (const row of breachRows) {
      const key = row.salesperson || "";
      if (!key) continue;
      const current = out.get(key);
      if (!current || row.leakageAmount > current.leakageAmount) out.set(key, row);
    }
    return out;
  }, [breachRows]);

  const previousCompliance = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of previous ?? []) {
      if (row.lines > 0) out.set(row.salesperson, Math.max(0, 1 - row.breaches / row.lines));
    }
    return out;
  }, [previous]);

  const members: TeamMember[] = useMemo(() => {
    const rows = (data?.bySalesperson ?? []).map((row) => {
      const compliance = row.lines ? Math.max(0, 1 - row.breaches / row.lines) : 1;
      const before = previousCompliance.get(row.salesperson);
      return {
        ...row,
        compliance,
        trend: before === undefined ? undefined : (compliance - before) * 100,
        worst: worstByPerson.get(row.salesperson),
      };
    });
    const by: Record<SortKey, (a: TeamMember, b: TeamMember) => number> = {
      severity: (a, b) => b.leakage - a.leakage || b.breaches - a.breaches,
      compliance: (a, b) => a.compliance - b.compliance,
      breaches: (a, b) => b.breaches - a.breaches,
      leakage: (a, b) => b.leakage - a.leakage,
      lines: (a, b) => b.lines - a.lines,
    };
    return rows.sort(by[sort]);
  }, [data?.bySalesperson, previousCompliance, worstByPerson, sort]);

  const incentives = useMemo(
    () =>
      (catalog ?? [])
        .flatMap((entry) =>
          entry.prices
            .filter((price) => price.active && price.scope === "incentive")
            .map((price) => ({ entry, price })),
        )
        .slice(0, 24),
    [catalog],
  );

  /** A message the manager can paste into a chat, built from this period only. */
  const copyNotice = async (member: TeamMember) => {
    const own = breachRows
      .filter((row) => row.salesperson === member.salesperson)
      .slice(0, 5)
      .map(
        (row) =>
          `• ${row.productName || row.productCode} — ${fmtMoney(row.actualUnitPrice, row.currency, lang)} ${
            ar ? "بدل" : "vs"
          } ${fmtMoney(row.allowedMinimum, row.currency, lang)} (${row.invoiceNumber})`,
      )
      .join("\n");
    const text = ar
      ? `${member.salesperson}: ${fmtNum(member.breaches)} بند تحت الحد الأدنى من ${fmtNum(member.lines)} بند في الفترة.\n${own}`
      : `${member.salesperson}: ${fmtNum(member.breaches)} of ${fmtNum(member.lines)} lines sold below the floor this period.\n${own}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(member.salesperson);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      // Clipboard access can be refused; the invoices themselves stay one click away.
    }
  };

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: "severity", label: ar ? "الأكثر خطورة" : "Most severe" },
    { value: "compliance", label: ar ? "الأقل التزامًا" : "Lowest compliance" },
    { value: "breaches", label: ar ? "عدد المخالفات" : "Breach count" },
    { value: "leakage", label: ar ? "قيمة التجاوز" : "Value given away" },
    { value: "lines", label: ar ? "عدد البنود" : "Line count" },
  ];

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[14px] font-bold text-text">
              <UsersRound size={16} className="text-brand" aria-hidden="true" />
              {ar ? "من يحتاج متابعة" : "Who needs a conversation"}
            </h2>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {ar
                ? "الموظفون الذين باعوا تحت الحد الأدنى في هذه الفترة."
                : "Salespeople who sold below the approved floor in this period."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="hidden sm:inline">{ar ? "ترتيب حسب" : "Sort by"}</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                className="min-h-9 cursor-pointer rounded-lg border border-border bg-surface px-2 text-[12px] text-text"
                aria-label={ar ? "ترتيب قائمة الفريق" : "Sort the team list"}
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={onSendDigest}
              disabled={!canWrite || sending}
              title={
                canWrite
                  ? undefined
                  : ar
                    ? "الإرسال يحتاج صلاحية مدير"
                    : "Sending needs manager access"
              }
              className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-semibold text-text transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <BellRing size={14} aria-hidden="true" />
              {sending
                ? ar
                  ? "جارٍ الإرسال…"
                  : "Sending…"
                : ar
                  ? "إرسال ملخص المخالفات"
                  : "Send breach digest"}
            </button>
          </div>
        </div>

        {loading && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!loading && !members.length && (
          <div className="p-4">
            <EmptyState
              label={ar ? "لا أحد تحت الحد الأدنى" : "Nobody sold below the floor"}
              hint={
                ar
                  ? "كل البنود المحكوم عليها في هذه الفترة داخل النطاق المعتمد."
                  : "Every judged line in this period stayed inside the approved band."
              }
            />
          </div>
        )}

        {!loading &&
          members.map((member) => (
            <article
              key={member.salesperson}
              className="grid gap-x-4 gap-y-2.5 border-b border-border px-4 py-3.5 last:border-b-0 lg:grid-cols-[minmax(180px,1.1fr)_minmax(200px,1.2fr)_minmax(190px,1fr)_auto] lg:items-center"
            >
              {/* who */}
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-bold"
                  style={{
                    background:
                      member.compliance < 0.75 ? "var(--danger-soft)" : "var(--warning-soft)",
                    color: member.compliance < 0.75 ? "var(--danger)" : "var(--warning)",
                  }}
                >
                  {initialsOf(member.salesperson)}
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-[13px] font-semibold text-text">
                    <bdi>{member.salesperson || (ar ? "بدون موظف" : "Unassigned")}</bdi>
                  </h3>
                  <p className="num text-[10.5px] text-text-subtle">
                    {fmtNum(member.lines)} {ar ? "بند" : "lines"} ·{" "}
                    <span style={{ color: "var(--danger)" }}>
                      {fmtNum(member.breaches)} {ar ? "مخالفة" : "breaches"}
                    </span>
                  </p>
                </div>
              </div>

              {/* how well */}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span
                    className="num text-[17px] font-bold"
                    style={{
                      color: member.compliance < 0.75 ? "var(--danger)" : "var(--warning)",
                    }}
                  >
                    {fmtPct(member.compliance * 100, 0)}
                  </span>
                  <span className="text-[10.5px] text-text-subtle">
                    {ar ? "نسبة الالتزام" : "compliance"}
                  </span>
                  <Trend value={member.trend} />
                </div>
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full"
                  style={{ background: "var(--surface-2)" }}
                  role="img"
                  aria-label={`${ar ? "نسبة الالتزام" : "Compliance"} ${fmtPct(member.compliance * 100, 0)}`}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(3, member.compliance * 100)}%`,
                      background: member.compliance < 0.75 ? "var(--danger)" : "var(--warning)",
                    }}
                  />
                </div>
              </div>

              {/* what it cost */}
              <div className="min-w-0">
                <div className="num text-[13px] font-bold" style={{ color: "var(--danger)" }}>
                  {member.worst
                    ? fmtMoney(member.leakage, member.worst.currency, lang)
                    : fmtNum(Math.round(member.leakage))}
                </div>
                <div className="text-[10px] text-text-subtle">
                  {ar ? "قيمة التجاوز في الفترة" : "value given away this period"}
                </div>
                {member.worst && (
                  <p className="mt-1 truncate text-[10.5px] text-text-muted">
                    {ar ? "أسوأ حالة:" : "Worst case:"}{" "}
                    <bdi className="font-medium text-text">
                      {member.worst.productName || member.worst.productCode}
                    </bdi>{" "}
                    <span className="num">
                      {fmtMoney(member.worst.actualUnitPrice, member.worst.currency, lang)}
                    </span>{" "}
                    {ar ? "بدل" : "vs"}{" "}
                    <span className="num">
                      {fmtMoney(member.worst.allowedMinimum, member.worst.currency, lang)}
                    </span>
                  </p>
                )}
              </div>

              {/* what to do */}
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenSalesperson(member.salesperson)}
                  className="inline-flex min-h-9 cursor-pointer items-center rounded-lg px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: "var(--brand)" }}
                >
                  {ar ? "عرض الحالات" : "View cases"}
                </button>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => void copyNotice(member)}
                    className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
                  >
                    {copied === member.salesperson ? (
                      <>
                        <Check size={13} aria-hidden="true" style={{ color: "var(--success)" }} />
                        {ar ? "تم النسخ" : "Copied"}
                      </>
                    ) : (
                      <>
                        <Copy size={13} aria-hidden="true" />
                        {ar ? "نسخ رسالة تنبيه" : "Copy notice"}
                      </>
                    )}
                  </button>
                )}
              </div>
            </article>
          ))}
      </section>

      {/* Incentives are a reference sheet, not a competitor for the analysis. */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <button
          type="button"
          onClick={() => setShowIncentives((open) => !open)}
          aria-expanded={showIncentives}
          className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-start"
        >
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold text-text">
              {ar ? "قواعد الحافز المنشورة" : "Published incentive rules"}
            </h2>
            <p className="mt-0.5 text-[10.5px] text-text-muted">
              {ar
                ? "مرجع للحوافز المرتبطة بالبيع داخل السعر المعتمد."
                : "Reference for incentives attached to selling inside the approved price."}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
            <span className="num">{fmtNum(incentives.length)}</span>
            <ChevronDown
              size={16}
              className={`transition-transform ${showIncentives ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </span>
        </button>

        {showIncentives &&
          (incentives.length ? (
            <div className="border-t border-border">
              {incentives.map(({ entry, price }) => (
                <div
                  key={price.id}
                  className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-text">
                      <bdi>{entry.courseName}</bdi>
                    </div>
                    <div className="truncate text-[10.5px] text-text-muted">
                      {price.note || (ar ? "حافز بيع" : "Sales incentive")}
                    </div>
                  </div>
                  <span
                    className="num shrink-0 text-[12px] font-semibold"
                    style={{ color: "var(--success)" }}
                  >
                    {bandText(price, lang)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="border-t border-border p-4">
              <EmptyState
                label={ar ? "لا توجد قواعد حافز منشورة" : "No incentive rules published"}
              />
            </div>
          ))}
      </section>
    </div>
  );
}

function Trend({ value }: { value?: number }) {
  const { lang } = useI18n();
  if (value === undefined || !Number.isFinite(value)) return null;
  const flat = Math.abs(value) < 1;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  const color = flat ? "var(--text-subtle)" : value > 0 ? "var(--success)" : "var(--danger)";
  return (
    <span
      className="num inline-flex items-center gap-0.5 text-[11px] font-semibold"
      style={{ color }}
      title={lang === "ar" ? "مقارنة بالفترة السابقة" : "vs the previous period"}
    >
      <Icon size={12} strokeWidth={2.6} aria-hidden="true" />
      {flat ? "0" : `${value > 0 ? "+" : ""}${Math.round(value)}`}
    </span>
  );
}
