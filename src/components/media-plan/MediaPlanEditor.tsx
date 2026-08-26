import { useEffect, useMemo, useState } from "react";
import { CirclePlus, CopyPlus, KeyRound, Loader2, Save, Trash2 } from "lucide-react";
import { Notice, Pill } from "@/components/ui-bits";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  nextMediaPlanMonth,
  plannedCourseBudget,
  type MediaPlanActivityBudget,
  type MediaPlanCourseTarget,
  type MonthlyMediaPlan,
} from "@/lib/media-plan";
import { fmtNum, fmtUSDFull, useI18n } from "@/lib/i18n";

const CODE_KEY = "engosoft-admin-code";
const inputClass =
  "min-h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none placeholder:text-text-subtle focus:border-brand focus:ring-2 focus:ring-brand/15";

interface EditorAuth {
  signedIn: boolean;
  via: "sso" | "admin-code" | null;
  name: string;
  sso: boolean;
  adminCode: boolean;
}

const clonePlan = (plan: MonthlyMediaPlan): MonthlyMediaPlan => ({
  ...plan,
  courses: plan.courses.map((row) => ({
    ...row,
    owners: [...row.owners],
    matchTerms: row.matchTerms ? [...row.matchTerms] : [],
  })),
  additionalActivities: plan.additionalActivities.map((row) => ({
    ...row,
    matchTerms: row.matchTerms ? [...row.matchTerms] : [],
  })),
});

const newKey = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function MediaPlanEditor({
  open,
  onOpenChange,
  mode,
  plan,
  editable,
  auth,
  storeError,
  existingMonths,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "edit" | "create";
  plan: MonthlyMediaPlan;
  editable: boolean;
  auth: EditorAuth;
  storeError: string;
  existingMonths: string[];
  onSaved: (month: string) => void;
}) {
  const { lang } = useI18n();
  const [draft, setDraft] = useState<MonthlyMediaPlan>(() => clonePlan(plan));
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const copy = clonePlan(plan);
    let candidateMonth = nextMediaPlanMonth(copy.month);
    while (existingMonths.includes(candidateMonth)) {
      candidateMonth = nextMediaPlanMonth(candidateMonth);
    }
    setDraft(
      mode === "create"
        ? {
            ...copy,
            month: candidateMonth,
            status: "draft",
            basisMonth: copy.month,
          }
        : copy,
    );
    setCode(localStorage.getItem(CODE_KEY) ?? "");
    setError("");
  }, [open, mode, plan, existingMonths]);

  const totals = useMemo(() => {
    const courseLeads = draft.courses.reduce((sum, row) => sum + row.targetLeads, 0);
    const courseBudget = draft.courses.reduce((sum, row) => sum + plannedCourseBudget(row), 0);
    const additional = draft.additionalActivities.reduce((sum, row) => sum + row.budgetUsd, 0);
    return { courseLeads, courseBudget, additional };
  }, [draft]);

  const patchCourse = (key: string, patch: Partial<MediaPlanCourseTarget>) =>
    setDraft((current) => ({
      ...current,
      courses: current.courses.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));

  const patchActivity = (key: string, patch: Partial<MediaPlanActivityBudget>) =>
    setDraft((current) => ({
      ...current,
      additionalActivities: current.additionalActivities.map((row) =>
        row.key === key ? { ...row, ...patch } : row,
      ),
    }));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...draft,
        leadTarget: draft.paidLeadTarget + draft.organicWebinarLeadTarget,
      };
      const response = await fetch("/api/media-plan", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...(code ? { "x-admin-secret": code } : {}),
        },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok)
        throw new Error(body.error || `Request failed: ${response.status}`);
      if (code) localStorage.setItem(CODE_KEY, code);
      onSaved(draft.month);
      onOpenChange(false);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  };

  const needsCode = !auth.signedIn && auth.adminCode;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={lang === "ar" ? "left" : "right"}
        className="w-full overflow-y-auto p-0 sm:max-w-5xl"
      >
        <SheetHeader className="border-b border-border bg-brand-soft/40 p-4 sm:p-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-brand">
            {mode === "create" ? <CopyPlus size={16} /> : <Save size={16} />}
            {mode === "create"
              ? lang === "ar"
                ? "إنشاء خطة شهر جديد"
                : "Create a new month"
              : lang === "ar"
                ? "تعديل الخطة"
                : "Edit media plan"}
          </div>
          <SheetTitle className="text-xl font-bold text-text">
            {lang === "ar" ? "محرر خطة الميديا" : "Media plan editor"}
          </SheetTitle>
          <SheetDescription>
            {lang === "ar"
              ? "عدّل التارجت والميزانية والدورات والمسؤولين. كلمات المطابقة هي اللي بتربط أسماء الحملات والدورات بالخطة تلقائيًا."
              : "Edit targets, budgets, courses and owners. Match terms connect live campaign and course names to the plan."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 p-4 sm:p-6">
          {!editable && (
            <Notice tone="warning" title={lang === "ar" ? "التعديل غير مفعّل" : "Editing disabled"}>
              {lang === "ar"
                ? "الحفظ محتاج DATABASE_URL ومعاه DASHBOARD_ADMIN_SECRET أو SSO."
                : "Saving requires DATABASE_URL plus DASHBOARD_ADMIN_SECRET or SSO."}
            </Notice>
          )}
          {!!storeError && <Notice tone="warning">{storeError}</Notice>}
          {!!auth.signedIn && auth.via === "sso" && (
            <Notice tone="info">
              {lang === "ar"
                ? `داخل باسم ${auth.name || "مستخدم"} — مش محتاج كود إدارة.`
                : `Signed in as ${auth.name || "user"} — no admin code required.`}
            </Notice>
          )}

          <EditorSection title={lang === "ar" ? "أساس الخطة" : "Plan foundation"}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={lang === "ar" ? "شهر الخطة" : "Plan month"}>
                <input
                  type="month"
                  value={draft.month}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, month: event.target.value }))
                  }
                  disabled={mode === "edit"}
                  className={inputClass}
                />
              </Field>
              <Field label={lang === "ar" ? "الحالة" : "Status"}>
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      status: event.target.value === "approved" ? "approved" : "draft",
                    }))
                  }
                  className={inputClass}
                >
                  <option value="draft">{lang === "ar" ? "مسودة" : "Draft"}</option>
                  <option value="approved">{lang === "ar" ? "معتمدة" : "Approved"}</option>
                </select>
              </Field>
              <NumberField
                label={lang === "ar" ? "Paid Leads" : "Paid leads"}
                value={draft.paidLeadTarget}
                onChange={(value) => setDraft((current) => ({ ...current, paidLeadTarget: value }))}
              />
              <NumberField
                label={lang === "ar" ? "Organic + Webinar" : "Organic + webinar"}
                value={draft.organicWebinarLeadTarget}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, organicWebinarLeadTarget: value }))
                }
              />
              <NumberField
                label={lang === "ar" ? "ميزانية الليدز بالدولار" : "Lead budget (USD)"}
                value={draft.leadGenerationBudgetUsd}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, leadGenerationBudgetUsd: value }))
                }
              />
              <NumberField
                label={lang === "ar" ? "تارجت المبيعات بالدولار" : "Sales target (USD)"}
                value={draft.salesTargetUsd}
                onChange={(value) => setDraft((current) => ({ ...current, salesTargetUsd: value }))}
              />
              <div className="rounded-xl border border-border bg-surface-2 px-3 py-2.5">
                <div className="text-[11px] text-text-muted">
                  {lang === "ar" ? "إجمالي تارجت الليدز" : "Total lead target"}
                </div>
                <div className="num mt-1 text-lg font-bold text-text">
                  {fmtNum(draft.paidLeadTarget + draft.organicWebinarLeadTarget)}
                </div>
              </div>
              {needsCode && (
                <Field
                  label={lang === "ar" ? "كود الإدارة" : "Admin code"}
                  icon={<KeyRound size={13} />}
                >
                  <input
                    type="password"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="off"
                    className={inputClass}
                  />
                </Field>
              )}
            </div>
          </EditorSection>

          <EditorSection
            title={lang === "ar" ? "الدورات والمسؤولون" : "Courses and owners"}
            action={
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    courses: [
                      ...current.courses,
                      {
                        key: newKey("course"),
                        label: "",
                        targetLeads: 0,
                        targetCpl: 0,
                        owners: [],
                        matchTerms: [],
                      },
                    ],
                  }))
                }
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-brand"
              >
                <CirclePlus size={14} /> {lang === "ar" ? "أضف دورة" : "Add course"}
              </button>
            }
          >
            <div className="space-y-2.5">
              {draft.courses.map((row) => (
                <div
                  key={row.key}
                  className="grid gap-2 rounded-2xl border border-border bg-surface-2/60 p-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_.65fr_.65fr_1fr_1.2fr_auto]"
                >
                  <Field label={lang === "ar" ? "اسم الدورة" : "Course"}>
                    <input
                      value={row.label}
                      onChange={(event) => patchCourse(row.key, { label: event.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <NumberField
                    label={lang === "ar" ? "ليدز" : "Leads"}
                    value={row.targetLeads}
                    onChange={(value) => patchCourse(row.key, { targetLeads: value })}
                  />
                  <NumberField
                    label="CPL $"
                    value={row.targetCpl}
                    step="0.01"
                    onChange={(value) => patchCourse(row.key, { targetCpl: value })}
                  />
                  <Field label={lang === "ar" ? "المسؤولون" : "Owners"}>
                    <input
                      value={row.owners.join(", ")}
                      onChange={(event) =>
                        patchCourse(row.key, {
                          owners: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Sayed, Shazly"
                      className={inputClass}
                    />
                  </Field>
                  <Field label={lang === "ar" ? "كلمات ربط الحملات" : "Campaign match terms"}>
                    <input
                      value={(row.matchTerms ?? []).join(", ")}
                      onChange={(event) =>
                        patchCourse(row.key, {
                          matchTerms: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder={
                        lang === "ar" ? "اسم، اختصار، اسم حملة" : "name, alias, campaign term"
                      }
                      className={inputClass}
                    />
                  </Field>
                  <button
                    type="button"
                    aria-label={lang === "ar" ? "حذف الدورة" : "Delete course"}
                    disabled={draft.courses.length === 1}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        courses: current.courses.filter((course) => course.key !== row.key),
                      }))
                    }
                    className="mt-5 grid size-10 place-items-center rounded-xl text-danger hover:bg-danger-soft disabled:opacity-30"
                  >
                    <Trash2 size={16} />
                  </button>
                  <div className="text-[10px] text-text-subtle sm:col-span-2 lg:col-span-6">
                    {lang === "ar" ? "ميزانية الدورة المحسوبة" : "Calculated course budget"}:{" "}
                    <strong className="num text-text">
                      {fmtUSDFull(plannedCourseBudget(row))}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </EditorSection>

          <EditorSection
            title={lang === "ar" ? "أنشطة خارج ميزانية الليدز" : "Activities outside lead budget"}
            action={
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    additionalActivities: [
                      ...current.additionalActivities,
                      { key: newKey("activity"), label: "", budgetUsd: 0, matchTerms: [] },
                    ],
                  }))
                }
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-brand"
              >
                <CirclePlus size={14} /> {lang === "ar" ? "أضف نشاط" : "Add activity"}
              </button>
            }
          >
            <div className="space-y-2">
              {draft.additionalActivities.map((row) => (
                <div
                  key={row.key}
                  className="grid gap-2 rounded-2xl border border-border bg-surface-2/60 p-3 sm:grid-cols-[1fr_1fr_8rem_auto]"
                >
                  <Field label={lang === "ar" ? "النشاط" : "Activity"} className="min-w-0 flex-1">
                    <input
                      value={row.label}
                      onChange={(event) => patchActivity(row.key, { label: event.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label={lang === "ar" ? "كلمات ربط الحملات" : "Campaign match terms"}>
                    <input
                      value={(row.matchTerms ?? []).join(", ")}
                      onChange={(event) =>
                        patchActivity(row.key, {
                          matchTerms: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="web, signup"
                      className={inputClass}
                    />
                  </Field>
                  <NumberField
                    label={lang === "ar" ? "Budget $" : "Budget $"}
                    value={row.budgetUsd}
                    onChange={(value) => patchActivity(row.key, { budgetUsd: value })}
                    className="w-32"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        additionalActivities: current.additionalActivities.filter(
                          (activity) => activity.key !== row.key,
                        ),
                      }))
                    }
                    className="mt-5 grid size-10 shrink-0 place-items-center rounded-xl text-danger hover:bg-danger-soft"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </EditorSection>

          <div className="grid gap-2 rounded-2xl border border-[#173b61] bg-[#071a31] p-4 text-white sm:grid-cols-4">
            <Summary
              label={lang === "ar" ? "ليدز الدورات" : "Course leads"}
              value={fmtNum(totals.courseLeads)}
            />
            <Summary
              label={lang === "ar" ? "ميزانية الدورات" : "Course budget"}
              value={fmtUSDFull(totals.courseBudget)}
            />
            <Summary
              label={lang === "ar" ? "احتياطي الليدز" : "Lead reserve"}
              value={fmtUSDFull(draft.leadGenerationBudgetUsd - totals.courseBudget)}
            />
            <Summary
              label={lang === "ar" ? "الأنشطة الإضافية" : "Extra activities"}
              value={fmtUSDFull(totals.additional)}
            />
          </div>

          {totals.courseLeads !== draft.paidLeadTarget && (
            <Notice tone="warning">
              {lang === "ar"
                ? `مجموع ليدز الدورات ${fmtNum(totals.courseLeads)} لا يساوي Paid Target ${fmtNum(draft.paidLeadTarget)}. يمكن الحفظ، لكن الفرق سيظهر كملاحظة في المتابعة.`
                : `Course leads (${fmtNum(totals.courseLeads)}) do not equal the paid target (${fmtNum(draft.paidLeadTarget)}). You can save, but the gap remains visible.`}
            </Notice>
          )}
          {!!error && <Notice tone="warning">{error}</Notice>}

          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 py-3 backdrop-blur">
            <div className="flex flex-wrap gap-1.5">
              <Pill tone={draft.status === "approved" ? "success" : "warning"}>
                {draft.status === "approved"
                  ? lang === "ar"
                    ? "معتمدة"
                    : "Approved"
                  : lang === "ar"
                    ? "مسودة"
                    : "Draft"}
              </Pill>
              <Pill tone="neutral">{draft.month}</Pill>
            </div>
            <button
              type="button"
              onClick={save}
              disabled={
                !editable ||
                saving ||
                !draft.month ||
                draft.courses.some((row) => !row.label.trim())
              }
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-white disabled:opacity-45"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {lang === "ar" ? "احفظ الخطة" : "Save plan"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EditorSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-text">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  icon,
  children,
  className = "",
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-text-muted">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = "1",
  className = "",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <input
        type="number"
        min={0}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        className={`${inputClass} num`}
      />
    </Field>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[.06] p-3">
      <div className="text-[10px] text-white/55">{label}</div>
      <div className="num mt-1 text-base font-bold">{value}</div>
    </div>
  );
}
