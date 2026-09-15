import { useEffect, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pill } from "@/components/ui-bits";
import { fmtNum, useI18n } from "@/lib/i18n";
import {
  LEAD_QA_CONTACT_VERDICTS,
  LEAD_QA_QUALITY_VERDICTS,
  LEAD_QA_STATUSES,
  type LeadQaContactVerdict,
  type LeadQaQualityVerdict,
  type LeadQaStatus,
  type LeadQaVerification,
} from "@/lib/lead-qa";

/**
 * Manual lead QA: open the lead with its Yeastar and Chatwoot evidence, then
 * record a verdict. Not the AI call-quality score, and it never changes the
 * Odoo stage. The verdict is stored with the evidence the reviewer saw.
 */

const CODE_KEY = "engosoft:lead-qa-admin-code";

export const LEAD_QA_STATUS_LABEL: Record<
  LeadQaStatus,
  { ar: string; en: string; tone: "neutral" | "brand" | "success" | "warning" | "danger" }
> = {
  unverified: { ar: "لم يُتحقق", en: "Unverified", tone: "neutral" },
  verified_contacted: { ar: "تحقق: تم التواصل", en: "Verified contacted", tone: "success" },
  verified_uncontacted: { ar: "تحقق: لم يُتواصل", en: "Verified not contacted", tone: "danger" },
  verified_valid_lead: { ar: "تحقق: ليد صالح", en: "Verified valid lead", tone: "success" },
  verified_bad_lead: { ar: "تحقق: ليد غير صالح", en: "Verified bad lead", tone: "warning" },
  disputed: { ar: "متنازع عليه", en: "Disputed", tone: "danger" },
  needs_review: { ar: "يحتاج مراجعة", en: "Needs review", tone: "warning" },
};

const CONTACT_LABEL: Record<LeadQaContactVerdict, { ar: string; en: string }> = {
  "": { ar: "—", en: "—" },
  contacted: { ar: "تم التواصل", en: "Contacted" },
  not_contacted: { ar: "لم يتم التواصل", en: "Not contacted" },
  unclear: { ar: "غير واضح", en: "Unclear" },
};

const QUALITY_LABEL: Record<LeadQaQualityVerdict, { ar: string; en: string }> = {
  "": { ar: "—", en: "—" },
  valid: { ar: "صالح", en: "Valid" },
  invalid: { ar: "غير صالح", en: "Invalid" },
  unclear: { ar: "غير واضح", en: "Unclear" },
};

interface LeadQaResponse {
  configured: boolean;
  editable?: boolean;
  signedIn?: boolean;
  verifications: Record<string, LeadQaVerification>;
}

export function useLeadQaVerifications(ids: readonly string[]) {
  const key = [...new Set(ids.filter(Boolean))].sort().join(",");
  return useQuery<LeadQaResponse>({
    queryKey: ["lead-qa", key],
    enabled: key.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const response = await fetch(`/api/lead-qa?ids=${encodeURIComponent(key)}`, { credentials: "include" });
      if (!response.ok) throw new Error(`Lead QA request failed: ${response.status}`);
      return response.json();
    },
  });
}

export interface LeadQaSubject {
  id: string;
  label: string;
  salesperson?: string;
  url?: string | null;
  latestCallUrl?: string | null;
  latestChatUrl?: string | null;
}

type Evidence = Record<string, unknown> | undefined;

const readNumber = (evidence: Evidence, key: string) =>
  typeof evidence?.[key] === "number" ? (evidence[key] as number) : null;

export function LeadQaControl({
  lead,
  evidence,
  verification,
}: {
  lead: LeadQaSubject;
  evidence?: Evidence;
  verification?: LeadQaVerification;
}) {
  const { lang } = useI18n();
  const A = lang === "ar";
  const queryClient = useQueryClient();
  const status = verification?.verificationStatus ?? "unverified";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    verificationStatus: status as LeadQaStatus,
    contactVerdict: (verification?.contactVerdict ?? "") as LeadQaContactVerdict,
    leadQualityVerdict: (verification?.leadQualityVerdict ?? "") as LeadQaQualityVerdict,
    reason: verification?.reason ?? "",
    notes: verification?.notes ?? "",
  });
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft({
      verificationStatus: status === "unverified" ? "needs_review" : status,
      contactVerdict: verification?.contactVerdict ?? "",
      leadQualityVerdict: verification?.leadQualityVerdict ?? "",
      reason: verification?.reason ?? "",
      notes: verification?.notes ?? "",
    });
    setError("");
    try {
      setCode(localStorage.getItem(CODE_KEY) ?? "");
    } catch {
      setCode("");
    }
  }, [open, status, verification]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/lead-qa", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...(code ? { "x-admin-secret": code } : {}) },
        body: JSON.stringify({
          crmLeadId: lead.id,
          ...draft,
          salesperson: lead.salesperson ?? "",
          evidenceSnapshot: evidence ?? {},
          evidenceVersion: typeof evidence?.version === "string" ? evidence.version : "",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (response.status === 401) {
        setNeedsCode(true);
        throw new Error(A ? "أدخل كود الإدارة لحفظ التحقق." : "Enter the admin code to save the verdict.");
      }
      if (!response.ok || !body.ok) throw new Error(body.error || `Request failed: ${response.status}`);
      try {
        if (code) localStorage.setItem(CODE_KEY, code);
      } catch {
        /* a blocked storage only means the code is asked for again */
      }
      await queryClient.invalidateQueries({ queryKey: ["lead-qa"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  };

  const contactStatus = typeof evidence?.contactStatus === "string" ? evidence.contactStatus : null;
  const label = LEAD_QA_STATUS_LABEL[status];
  const field = "min-h-10 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text outline-none focus:border-brand";

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[10px] font-semibold text-text hover:border-brand"
        title={A ? "التحقق اليدوي من الليد" : "Manual lead QA"}
      >
        <ShieldCheck size={11} />
        <Pill tone={label.tone}>{label[lang]}</Pill>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" dir={A ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{A ? "التحقق اليدوي من الليد" : "Manual lead verification"}</DialogTitle>
            <DialogDescription>
              {A
                ? "افتح الليد والمكالمة والمحادثة أولًا. هذا التحقق منفصل عن تقييم جودة المكالمات ولا يغيّر مرحلة Odoo."
                : "Open the lead, call and chat first. This is separate from the call-quality score and never changes the Odoo stage."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-surface-2 p-3 text-xs">
              <b className="block text-text">{lead.label}</b>
              <div className="mt-1 text-text-muted">
                {A ? "حالة الدليل" : "Evidence status"}:{" "}
                {contactStatus === "contacted"
                  ? A
                    ? "تم التواصل"
                    : "Contacted"
                  : contactStatus === "not_contacted"
                    ? A
                      ? "لم يُتواصل (دليل مكتمل)"
                      : "Not contacted (complete evidence)"
                    : A
                      ? "غير مؤكد — الدليل غير مكتمل"
                      : "Unconfirmed — evidence incomplete"}
                {" · "}
                {A ? "مكالمات" : "calls"} {fmtNum(readNumber(evidence, "totalCalls") ?? 0)}
                {" · "}
                {A ? "مكالمات المسؤول" : "owner calls"} {fmtNum(readNumber(evidence, "ownerCalls") ?? 0)}
                {" · "}
                {A ? "محادثات" : "chats"} {fmtNum(readNumber(evidence, "chatConversationCount") ?? 0)}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[
                  [lead.url, A ? "فتح الليد" : "Open lead"],
                  [lead.latestCallUrl, A ? "فتح المكالمة" : "Open call"],
                  [lead.latestChatUrl, A ? "فتح المحادثة" : "Open chat"],
                ]
                  .filter(([href]) => Boolean(href))
                  .map(([href, text]) => (
                    <a
                      key={String(text)}
                      href={String(href)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-brand/20 px-2 py-1 text-[10px] font-semibold text-brand hover:bg-brand-soft"
                    >
                      {text}
                      <ExternalLink size={10} className="ms-1 inline" />
                    </a>
                  ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs text-text-muted">{A ? "الحالة" : "Status"}</span>
              <select
                className={field}
                value={draft.verificationStatus}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, verificationStatus: event.target.value as LeadQaStatus }))
                }
              >
                {LEAD_QA_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {LEAD_QA_STATUS_LABEL[value][lang]}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs text-text-muted">{A ? "التواصل" : "Contact"}</span>
                <select
                  className={field}
                  value={draft.contactVerdict}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, contactVerdict: event.target.value as LeadQaContactVerdict }))
                  }
                >
                  {LEAD_QA_CONTACT_VERDICTS.map((value) => (
                    <option key={value || "blank"} value={value}>
                      {CONTACT_LABEL[value][lang]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-text-muted">{A ? "جودة الليد" : "Lead quality"}</span>
                <select
                  className={field}
                  value={draft.leadQualityVerdict}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      leadQualityVerdict: event.target.value as LeadQaQualityVerdict,
                    }))
                  }
                >
                  {LEAD_QA_QUALITY_VERDICTS.map((value) => (
                    <option key={value || "blank"} value={value}>
                      {QUALITY_LABEL[value][lang]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs text-text-muted">{A ? "السبب" : "Reason"}</span>
              <input
                className={field}
                maxLength={200}
                value={draft.reason}
                onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-text-muted">{A ? "ملاحظات" : "Notes"}</span>
              <textarea
                className={`${field} min-h-20 py-2`}
                maxLength={2000}
                value={draft.notes}
                onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>
            {needsCode ? (
              <label className="block">
                <span className="mb-1 block text-xs text-text-muted">{A ? "كود الإدارة" : "Admin code"}</span>
                <input
                  className={field}
                  type="password"
                  autoComplete="off"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
            ) : null}
            {verification?.verifiedAt ? (
              <p className="text-[11px] text-text-muted">
                {A ? "آخر تحقق" : "Last verified"}: {verification.verifiedBy || "—"} ·{" "}
                <bdi dir="ltr" className="num">
                  {verification.verifiedAt.slice(0, 16).replace("T", " ")}
                </bdi>
              </p>
            ) : null}
            {error ? <p className="text-xs text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold"
              >
                {A ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {saving ? (A ? "جارٍ الحفظ…" : "Saving…") : A ? "حفظ التحقق" : "Save verdict"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
