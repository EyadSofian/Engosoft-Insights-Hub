import { useEffect, useState } from "react";
import { KeyRound, Loader2, Save, Target } from "lucide-react";
import { Notice, Pill } from "@/components/ui-bits";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fmtUSDFull, useI18n } from "@/lib/i18n";
import { monthLabel } from "@/components/accounting/AccountingSubViews";

/** Where the admin code is kept between visits. Never sent anywhere but this app. */
const CODE_KEY = "engosoft-admin-code";

interface TargetRow {
  employeeId: string;
  name: string;
  teamLeader: string;
  supervisor: string;
  branch: string;
  target: number | null;
  note: string;
  source: "published" | "edited";
}

interface TargetsResponse {
  ok: boolean;
  month: string;
  months: string[];
  editable: boolean;
  auth: {
    signedIn: boolean;
    via: "sso" | "admin-code" | null;
    name: string;
    sso: boolean;
    adminCode: boolean;
  };
  storeError: string;
  rows: TargetRow[];
}

/**
 * Editing a published quota.
 *
 * An empty box is not zero. It means "no quota published for this person this
 * month" — maternity leave, or the Operation staff who sell without a quota —
 * and it renders as an em dash rather than 0%, so the two are never confused.
 * Typing `0` is a real zero and is kept as one.
 */
export function TargetEditor({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { lang } = useI18n();
  const [data, setData] = useState<TargetsResponse | null>(null);
  const [month, setMonth] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!open) return;
    setCode(localStorage.getItem(CODE_KEY) ?? "");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    fetch(`/api/targets${month ? `?month=${month}` : ""}`, { credentials: "include" })
      .then((response) => response.json() as Promise<TargetsResponse>)
      .then((body) => {
        setData(body);
        setMonth(body.month);
        setDraft(
          Object.fromEntries(
            body.rows.map((row) => [row.employeeId, row.target === null ? "" : String(row.target)]),
          ),
        );
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not load the targets."),
      )
      .finally(() => setLoading(false));
  }, [open, month]);

  const total = Object.values(draft).reduce((sum, value) => {
    const parsed = Number(value);
    return value.trim() === "" || !Number.isFinite(parsed) ? sum : sum + parsed;
  }, 0);

  const changed = (data?.rows ?? []).filter((row) => {
    const current = draft[row.employeeId] ?? "";
    const original = row.target === null ? "" : String(row.target);
    return current.trim() !== original;
  });

  const save = async () => {
    if (!data || !changed.length) return;
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const response = await fetch("/api/targets", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...(code ? { "x-admin-secret": code } : {}),
        },
        body: JSON.stringify({
          month,
          edits: changed.map((row) => {
            const value = (draft[row.employeeId] ?? "").trim();
            return { employeeId: row.employeeId, target: value === "" ? null : Number(value) };
          }),
        }),
      });
      const body = (await response.json()) as { ok: boolean; error?: string; saved?: number };
      if (!response.ok || !body.ok)
        throw new Error(body.error || `Request failed: ${response.status}`);

      if (code) localStorage.setItem(CODE_KEY, code);
      setSaved(
        lang === "ar"
          ? `اتحفظ ${body.saved} تارجت لشهر ${monthLabel(month, lang)}.`
          : `Saved ${body.saved} targets for ${monthLabel(month, lang)}.`,
      );
      onSaved();
      // Re-read so "edited" badges and the roster reflect what was stored.
      setMonth((current) => current);
      const refreshed = await fetch(`/api/targets?month=${month}`, { credentials: "include" });
      setData((await refreshed.json()) as TargetsResponse);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  };

  const needsCode = !!data && !data.auth.signedIn && data.auth.adminCode;
  const blocked = !!data && !data.editable;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={lang === "ar" ? "left" : "right"}
        className="w-full sm:max-w-3xl overflow-y-auto p-0"
      >
        <SheetHeader className="border-b border-border bg-brand-soft/40 p-4 sm:p-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-brand">
            <Target size={16} />
            <span>{lang === "ar" ? "إدارة التارجت" : "Manage targets"}</span>
          </div>
          <SheetTitle className="mt-1 text-xl font-bold text-text">
            {lang === "ar" ? "تعديل تارجت الموظفين" : "Edit employee targets"}
          </SheetTitle>
          <SheetDescription className="text-sm text-text-muted">
            {lang === "ar"
              ? "الخانة الفاضية معناها «مفيش تارجت منشور» — زي أجازة الوضع وموظفي العمليات — وبتظهر شرطة مش صفر. لو كتبت 0 يبقى صفر حقيقي."
              : "An empty box means no quota is published — maternity leave, Operation staff — and shows as a dash, not 0%. Typing 0 is a real zero."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-4 sm:p-6">
          {blocked && (
            <Notice
              tone="warning"
              title={lang === "ar" ? "التعديل غير مفعّل" : "Editing is not enabled"}
            >
              {lang === "ar"
                ? "محتاج DATABASE_URL عشان التعديلات تتخزن، ومعاه DASHBOARD_ADMIN_SECRET أو ربط المساحة بـ ENGOSOFT_SSO_SECRET."
                : "This needs DATABASE_URL to store edits, plus DASHBOARD_ADMIN_SECRET or the workspace connected via ENGOSOFT_SSO_SECRET."}
            </Notice>
          )}
          {!!data?.storeError && <Notice tone="warning">{data.storeError}</Notice>}
          {!!data?.auth.signedIn && data.auth.via === "sso" && (
            <Notice tone="info">
              {lang === "ar"
                ? `داخل من المساحة باسم ${data.auth.name || "مستخدم"} — مش محتاج كود.`
                : `Signed in from the workspace as ${data.auth.name || "user"} — no code needed.`}
            </Notice>
          )}

          <div className="grid gap-3 sm:grid-cols-[minmax(160px,.6fr)_1fr]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">
                {lang === "ar" ? "الشهر" : "Month"}
              </span>
              <select
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="min-h-11 w-full cursor-pointer rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              >
                {(data?.months ?? []).map((value) => (
                  <option key={value} value={value}>
                    {monthLabel(value, lang)}
                  </option>
                ))}
              </select>
            </label>

            {needsCode && (
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
                  <KeyRound size={13} />
                  {lang === "ar" ? "كود الإدارة" : "Admin code"}
                </span>
                <input
                  type="password"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="off"
                  placeholder={lang === "ar" ? "يتكتب مرة واحدة" : "Entered once"}
                  className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none placeholder:text-text-subtle focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
              </label>
            )}
          </div>

          {loading && (
            <div className="flex items-center gap-2 py-8 text-sm text-text-muted">
              <Loader2 size={16} className="animate-spin" />
              {lang === "ar" ? "بيحمّل…" : "Loading…"}
            </div>
          )}

          {!loading && !!data && (
            <div className="table-wrap scroll-hint-x rounded-2xl border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-3 py-2.5 text-start">
                      {lang === "ar" ? "الموظف" : "Employee"}
                    </th>
                    <th className="px-3 py-2.5 text-start">{lang === "ar" ? "الفريق" : "Team"}</th>
                    <th className="px-3 py-2.5 text-end">{lang === "ar" ? "التارجت" : "Target"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.employeeId} className="border-t border-border">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-text">{row.name}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                          <span>#{row.employeeId}</span>
                          {row.source === "edited" && (
                            <Pill tone="brand">{lang === "ar" ? "معدّل" : "edited"}</Pill>
                          )}
                          {!!row.note && <span className="truncate">· {row.note}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-text-muted">{row.teamLeader}</td>
                      <td className="px-3 py-2.5 text-end">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={draft[row.employeeId] ?? ""}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [row.employeeId]: event.target.value,
                            }))
                          }
                          placeholder={lang === "ar" ? "بدون تارجت" : "no target"}
                          className="num min-h-10 w-32 rounded-xl border border-border bg-surface px-3 text-end text-sm text-text outline-none placeholder:text-text-subtle focus:border-brand focus:ring-2 focus:ring-brand/15"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-surface-2">
                  <tr>
                    <td className="px-3 py-2.5 text-xs font-semibold text-text" colSpan={2}>
                      {lang === "ar" ? "إجمالي التارجت" : "Total target"}
                    </td>
                    <td className="num px-3 py-2.5 text-end text-sm font-bold text-text">
                      {fmtUSDFull(total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {!!error && <Notice tone="warning">{error}</Notice>}
          {!!saved && <Notice tone="info">{saved}</Notice>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <span className="text-xs text-text-muted">
              {changed.length
                ? lang === "ar"
                  ? `${changed.length} تغيير لسه ماتحفظش`
                  : `${changed.length} unsaved change(s)`
                : lang === "ar"
                  ? "مفيش تغييرات"
                  : "No changes"}
            </span>
            <button
              type="button"
              onClick={save}
              disabled={saving || !changed.length || blocked}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white transition-opacity disabled:opacity-45"
              style={{ background: "var(--brand)" }}
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {lang === "ar" ? "احفظ التارجت" : "Save targets"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
