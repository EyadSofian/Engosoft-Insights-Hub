import { useEffect, useMemo, useRef, useState } from "react";
import {
  CopyPlus,
  FileSpreadsheet,
  History,
  Link2Off,
  Lock,
  Pencil,
  RefreshCw,
  Rocket,
  Undo2,
  Upload,
} from "lucide-react";
import { Card, EmptyState, Notice, Pill, SectionTitle, Skeleton } from "@/components/ui-bits";
import { useI18n } from "@/lib/i18n";
import {
  ADMIN_CODE_KEY,
  bandText,
  deliveryLabel,
  methodLabel,
  scopeLabel,
  writeJson,
  type AuthState,
  type PriceBookSummary,
  type PriceItem,
} from "./pricing-ui";

interface ItemsResponse {
  configured: boolean;
  book: PriceBookSummary | null;
  items: PriceItem[];
  total: number;
  auth: AuthState;
  error: string;
}

interface BooksResponse {
  configured: boolean;
  books: PriceBookSummary[];
  auth: AuthState;
  state: { lastRunAt: string; auditedLines: number; lastError: string } | null;
  error: string;
}

interface ChangeLogEntry {
  id: number;
  action: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  changedBy: string;
  changedAt: string;
  reason: string;
  courseName: string;
  productCode: string;
}

interface ImportSummary {
  ok: boolean;
  sourceName: string;
  sheets: string[];
  summary: {
    sourceRows: number;
    accepted: number;
    rejected: number;
    duplicateCodes: number;
    needsReview: number;
    onHold: number;
    unmapped: number;
    errors: number;
    warnings: number;
  };
  counts: Record<string, number>;
  duplicateCodes: {
    code: string;
    count: number;
    conflicting: boolean;
    occurrences: { sheet: string; row: number; course: string }[];
  }[];
  issues: {
    sheet: string;
    row: number;
    severity: string;
    code: string;
    message: string;
    detail: string;
  }[];
  unresolvedDates: { sheet: string; raw: string; dayFirst: string; monthFirst: string }[];
  committed: boolean;
  book?: PriceBookSummary | null;
}

const statusTone = (status: string) =>
  status === "published" ? "success" : status === "draft" ? "warning" : "neutral";

const todayIso = () => new Date().toISOString().slice(0, 10);

const monthEnd = (from: string): string => {
  const [year, month] = from.split("-").map(Number);
  if (!year || !month) return "";
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

/**
 * The manager's page: import, edit, publish, and see what changed.
 *
 * Editing is only ever offered on a draft. A published book renders read-only
 * with an explanation, because the guarantee that an old invoice keeps being
 * judged against the price that was live when it was sold depends on nobody
 * being able to edit a published row in place — including through this screen.
 */
export function PriceManageTab({
  books,
  items,
  loading,
  selectedBookId,
  onSelectBook,
  onChanged,
}: {
  books?: BooksResponse;
  items?: ItemsResponse;
  loading: boolean;
  selectedBookId: string;
  onSelectBook: (id: string) => void;
  onChanged: () => void;
}) {
  const { lang, t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PriceItem | null>(null);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState<ChangeLogEntry[]>([]);

  useEffect(() => {
    try {
      setCode(localStorage.getItem(ADMIN_CODE_KEY) ?? "");
    } catch {
      // A private window with storage blocked still works; the code is typed.
    }
  }, []);

  const auth = books?.auth ?? items?.auth;
  const book = items?.book ?? null;
  const isDraft = book?.status === "draft";
  const canWrite = !!auth?.editable;
  const needsCode = !auth?.signedIn && !!auth?.adminCode;

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const note = await action();
      if (code) {
        try {
          localStorage.setItem(ADMIN_CODE_KEY, code);
        } catch {
          // Not being able to remember the code is not a failure to save.
        }
      }
      setMessage(note);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action failed.");
    } finally {
      setBusy("");
    }
  };

  const loadLog = async () => {
    setShowLog((open) => !open);
    if (log.length || !book) return;
    try {
      const response = await fetch(`/api/pricing/changelog?bookId=${encodeURIComponent(book.id)}`);
      const body = (await response.json()) as { entries?: ChangeLogEntry[] };
      setLog(body.entries ?? []);
    } catch {
      setError(lang === "ar" ? "تعذّر قراءة سجل التعديلات." : "The change log could not be read.");
    }
  };

  const unlinked = useMemo(
    () => (items?.items ?? []).filter((item) => !item.odooProductId).length,
    [items?.items],
  );

  return (
    <div className="space-y-4">
      {!canWrite && (
        <Notice tone="warning" title={lang === "ar" ? "التعديل غير مفعّل" : "Editing is disabled"}>
          {lang === "ar"
            ? "الحفظ يحتاج DATABASE_URL ومعه DASHBOARD_ADMIN_SECRET أو تسجيل دخول SSO. الصفحة تعمل للقراءة."
            : "Saving needs DATABASE_URL plus DASHBOARD_ADMIN_SECRET or an SSO session. The page still reads."}
        </Notice>
      )}
      {!!auth?.signedIn && auth.via === "sso" && (
        <Notice tone="info">
          {lang === "ar"
            ? `داخل باسم ${auth.name || "مستخدم"} — لا حاجة لكود إدارة.`
            : `Signed in as ${auth.name || "user"} — no admin code needed.`}
        </Notice>
      )}
      {!!error && <Notice tone="danger">{error}</Notice>}
      {!!message && <Notice tone="info">{message}</Notice>}

      {needsCode && canWrite && (
        <Card>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">
              {lang === "ar" ? "كود الإدارة" : "Admin code"}
            </span>
            <input
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              className="min-h-11 w-full max-w-sm rounded-lg border border-border bg-surface px-3 text-[13px]"
              placeholder={lang === "ar" ? "مطلوب للحفظ والنشر" : "Required to save and publish"}
            />
          </label>
        </Card>
      )}

      {/* --- versions ---------------------------------------------------- */}
      <Card>
        <SectionTitle
          hint={
            lang === "ar"
              ? "كل نشر ينتج نسخة جديدة. النسخ القديمة تبقى كما هي عشان الفواتير القديمة تظل مربوطة بالسعر اللي كان ساري وقت البيع."
              : "Each publish creates a version. Older versions stay exactly as they were, so past invoices keep the price that was live when they were sold."
          }
          action={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowImport((open) => !open)}
                disabled={!canWrite}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Upload size={15} aria-hidden="true" />
                {t("pb_import")}
              </button>
              <button
                type="button"
                onClick={loadLog}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text"
              >
                <History size={15} aria-hidden="true" />
                {t("pb_change_log")}
              </button>
            </div>
          }
        >
          {lang === "ar" ? "نسخ قائمة الأسعار" : "Price book versions"}
        </SectionTitle>

        {loading && <Skeleton className="h-24 w-full rounded-xl" />}
        {!loading && !books?.books.length && <EmptyState label={t("pb_no_book")} />}

        <div className="hscroll">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="text-start text-[11px] uppercase tracking-wide text-text-subtle">
                <th className="py-2 text-start font-semibold">
                  {lang === "ar" ? "النسخة" : "Version"}
                </th>
                <th className="py-2 text-start font-semibold">
                  {lang === "ar" ? "الاسم" : "Name"}
                </th>
                <th className="py-2 text-start font-semibold">
                  {lang === "ar" ? "الفترة" : "Effective"}
                </th>
                <th className="py-2 text-start font-semibold">
                  {lang === "ar" ? "الحالة" : "Status"}
                </th>
                <th className="py-2 text-start font-semibold">
                  {lang === "ar" ? "الصفوف" : "Rows"}
                </th>
                <th className="py-2 text-start font-semibold">
                  {lang === "ar" ? "إجراءات" : "Actions"}
                </th>
              </tr>
            </thead>
            <tbody>
              {(books?.books ?? []).map((row) => (
                <tr
                  key={row.id}
                  className={`border-t border-border ${row.id === selectedBookId ? "bg-brand-soft/40" : ""}`}
                >
                  <td className="py-2 tabular-nums">v{row.version}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => onSelectBook(row.id)}
                      className="cursor-pointer text-start font-medium text-brand underline-offset-2 hover:underline"
                    >
                      {row.name}
                    </button>
                    <div className="text-[11px] text-text-subtle">{row.sourceName}</div>
                  </td>
                  <td className="py-2 whitespace-nowrap tabular-nums">
                    {row.effectiveFrom || "—"} → {row.effectiveTo || "—"}
                  </td>
                  <td className="py-2">
                    <Pill tone={statusTone(row.status)}>
                      {row.status === "published"
                        ? t("pb_published")
                        : row.status === "draft"
                          ? t("pb_draft")
                          : t("pb_archived")}
                    </Pill>
                  </td>
                  <td className="py-2 tabular-nums">{row.itemCount}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {row.status === "draft" && (
                        <button
                          type="button"
                          disabled={!canWrite || busy !== ""}
                          onClick={() =>
                            run("publish", async () => {
                              await writeJson(
                                "/api/pricing/publish",
                                "POST",
                                { bookId: row.id, action: "publish" },
                                code,
                              );
                              return lang === "ar"
                                ? "تم النشر. شغّل إعادة التحليل عشان التقارير تستخدم الأسعار الجديدة."
                                : "Published. Re-run the audit so the reports use the new prices.";
                            })
                          }
                          className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ background: "var(--brand)" }}
                        >
                          <Rocket size={13} aria-hidden="true" />
                          {t("pb_publish")}
                        </button>
                      )}
                      {row.status === "archived" && (
                        <button
                          type="button"
                          disabled={!canWrite || busy !== ""}
                          onClick={() =>
                            run("rollback", async () => {
                              await writeJson(
                                "/api/pricing/publish",
                                "POST",
                                { bookId: row.id, action: "rollback" },
                                code,
                              );
                              return lang === "ar"
                                ? "تم الرجوع لهذه النسخة. التاريخ محفوظ ولم يُحذف شيء."
                                : "Rolled back to this version. Nothing was deleted.";
                            })
                          }
                          className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 text-[12px] font-medium text-text disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Undo2 size={13} aria-hidden="true" />
                          {t("pb_rollback")}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!canWrite || busy !== ""}
                        onClick={() => {
                          const from = todayIso().slice(0, 8) + "01";
                          void run("copy", async () => {
                            const result = await writeJson(
                              "/api/pricing/books",
                              "POST",
                              {
                                name: `${row.name} — copy`,
                                effectiveFrom: from,
                                effectiveTo: monthEnd(from),
                                taxInclusive: row.taxInclusive,
                                baseCurrency: row.baseCurrency,
                                notes: `Copied from v${row.version}`,
                                copyFromId: row.id,
                              },
                              code,
                            );
                            const created = result.book as PriceBookSummary | undefined;
                            if (created) onSelectBook(created.id);
                            return lang === "ar"
                              ? "تم إنشاء مسودة جديدة بنفس الأسعار. عدّلها ثم انشرها."
                              : "A new draft was created with the same prices. Edit it, then publish.";
                          });
                        }}
                        className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 text-[12px] font-medium text-text disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <CopyPlus size={13} aria-hidden="true" />
                        {lang === "ar" ? "نسخة جديدة" : "New version"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showImport && (
        <ImportPanel
          code={code}
          disabled={!canWrite}
          preview={preview}
          onPreview={setPreview}
          onCommitted={(created) => {
            setPreview(null);
            setShowImport(false);
            if (created) onSelectBook(created.id);
            setMessage(
              lang === "ar"
                ? "تم إنشاء مسودة من الملف. راجعها ثم اضغط نشر."
                : "A draft was created from the file. Review it, then publish.",
            );
            onChanged();
          }}
        />
      )}

      {showLog && (
        <Card>
          <SectionTitle>{t("pb_change_log")}</SectionTitle>
          {!log.length && (
            <EmptyState label={lang === "ar" ? "لا تعديلات بعد" : "No changes yet"} />
          )}
          <ul className="space-y-2">
            {log.map((entry) => (
              <li
                key={entry.id}
                className="border-t border-border pt-2 text-[12px] first:border-t-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="neutral">{entry.action}</Pill>
                  <span className="font-medium text-text">
                    {entry.courseName || entry.productCode || "—"}
                  </span>
                  <span className="text-text-subtle">
                    {entry.changedAt.slice(0, 19).replace("T", " ")}
                  </span>
                  <span className="text-text-muted">{entry.changedBy}</span>
                </div>
                {!!entry.reason && <p className="mt-0.5 text-text-muted">{entry.reason}</p>}
                {!!entry.newValue && (
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-2 p-2 text-[11px] text-text-muted">
                    {JSON.stringify(entry.newValue)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* --- rows -------------------------------------------------------- */}
      <Card>
        <SectionTitle
          hint={
            book
              ? `${book.name} · v${book.version} · ${items?.total ?? 0} ${lang === "ar" ? "صف" : "rows"}`
              : undefined
          }
          action={
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Pill tone={unlinked ? "warning" : "success"}>
                <Link2Off size={11} className="me-1" aria-hidden="true" />
                {lang === "ar" ? `${unlinked} غير مربوط` : `${unlinked} unlinked`}
              </Pill>
              {!isDraft && (
                <Pill tone="neutral">
                  <Lock size={11} className="me-1" aria-hidden="true" />
                  {lang === "ar" ? "للقراءة فقط" : "Read-only"}
                </Pill>
              )}
            </div>
          }
        >
          {lang === "ar" ? "صفوف الأسعار" : "Price rows"}
        </SectionTitle>

        {!isDraft && book && (
          <Notice tone="info">
            {lang === "ar"
              ? "دي نسخة منشورة، والتعديل عليها مقفول عن قصد. اعمل «نسخة جديدة» عشان تعدّل، والفواتير القديمة تفضل مربوطة بأسعارها."
              : "This version is published, and editing it is deliberately closed. Use “New version” to change prices; past invoices keep the ones they were judged against."}
          </Notice>
        )}

        {loading && <Skeleton className="mt-3 h-64 w-full rounded-xl" />}

        {!loading && !!items?.items.length && (
          <div className="hscroll mt-3">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-subtle">
                  <th className="py-2 text-start font-semibold">{t("pb_code")}</th>
                  <th className="py-2 text-start font-semibold">
                    {lang === "ar" ? "الدورة" : "Course"}
                  </th>
                  <th className="py-2 text-start font-semibold">{t("pb_delivery")}</th>
                  <th className="py-2 text-start font-semibold">
                    {lang === "ar" ? "النوع" : "Scope"}
                  </th>
                  <th className="py-2 text-start font-semibold">{t("pb_payment_method")}</th>
                  <th className="py-2 text-start font-semibold">
                    {lang === "ar" ? "السعر" : "Price"}
                  </th>
                  <th className="py-2 text-start font-semibold">
                    {lang === "ar" ? "الحالة" : "State"}
                  </th>
                  <th className="py-2 text-start font-semibold" />
                </tr>
              </thead>
              <tbody>
                {items.items.map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="py-2 tabular-nums">{item.rawProductCode || "—"}</td>
                    <td className="py-2">
                      <div className="font-medium text-text">{item.courseName}</div>
                      <div className="text-[11px] text-text-subtle">
                        {item.sourceSheet}:{item.sourceRow} · {item.subcategory}
                      </div>
                    </td>
                    <td className="py-2">{deliveryLabel(item.deliveryType, lang)}</td>
                    <td className="py-2">{scopeLabel(item.pricingScope, lang)}</td>
                    <td className="py-2">{methodLabel(item.paymentMethod, lang)}</td>
                    <td className="py-2 tabular-nums">
                      {bandText(
                        {
                          exact: item.exactPrice,
                          minimum: item.minimumPrice,
                          maximum: item.maximumPrice,
                          currency: item.currency,
                        },
                        lang,
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {item.onHold && (
                          <Pill tone="danger">{lang === "ar" ? "موقوف" : "Hold"}</Pill>
                        )}
                        {!item.active && (
                          <Pill tone="warning">{lang === "ar" ? "غير منشور" : "Inactive"}</Pill>
                        )}
                        {item.requiresReview && <Pill tone="warning">{t("pb_needs_review")}</Pill>}
                        {!item.odooProductId && (
                          <Pill tone="neutral">{lang === "ar" ? "بدون أودو" : "No Odoo id"}</Pill>
                        )}
                      </div>
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        disabled={!isDraft || !canWrite}
                        onClick={() => setEditing(item)}
                        title={
                          isDraft
                            ? undefined
                            : lang === "ar"
                              ? "النسخة المنشورة غير قابلة للتعديل"
                              : "A published version cannot be edited"
                        }
                        className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 text-[12px] font-medium text-text disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Pencil size={13} aria-hidden="true" />
                        {lang === "ar" ? "تعديل" : "Edit"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <EditDialog
          item={editing}
          code={code}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setMessage(
              lang === "ar" ? "تم حفظ التعديل في السجل." : "Saved, and recorded in the log.",
            );
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/* --- import ---------------------------------------------------------------- */

const DEFAULT_TABS =
  "Management, Mech & Elec, BIM all, Architecture & Decor, Civil Courses, Others";

/**
 * Import preview.
 *
 * Nothing here publishes. The screen exists so a person sees the row count, the
 * duplicate codes, and any date the file writes ambiguously *before* a draft is
 * created — and the draft still has to be published separately after that.
 */
function ImportPanel({
  code,
  disabled,
  preview,
  onPreview,
  onCommitted,
}: {
  code: string;
  disabled: boolean;
  preview: ImportSummary | null;
  onPreview: (preview: ImportSummary | null) => void;
  onCommitted: (book: PriceBookSummary | null) => void;
}) {
  const { lang } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<"xlsx" | "google_sheet">("xlsx");
  const [sheetUrl, setSheetUrl] = useState("");
  const [tabs, setTabs] = useState(DEFAULT_TABS);
  const [dateReading, setDateReading] = useState<"unresolved" | "day_first" | "month_first">(
    "unresolved",
  );
  const [name, setName] = useState("");
  const [from, setFrom] = useState(todayIso().slice(0, 8) + "01");
  const [to, setTo] = useState("");
  const [taxInclusive, setTaxInclusive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const payload = async (commit?: boolean) => {
    const base: Record<string, unknown> = {
      source,
      offerDateReading: dateReading,
      baseCurrency: "SAR",
      localCurrency: "EGP",
    };
    if (source === "xlsx") {
      const file = fileRef.current?.files?.[0];
      if (!file)
        throw new Error(lang === "ar" ? "اختر ملف الأسعار أولًا." : "Choose the workbook first.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      base.contentBase64 = btoa(binary);
      base.fileName = file.name;
    } else {
      base.sheetUrl = sheetUrl;
      base.tabs = tabs
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
    if (commit) {
      base.commit = {
        name: name || (lang === "ar" ? "قائمة أسعار" : "Price list"),
        effectiveFrom: from,
        effectiveTo: to,
        taxInclusive,
        baseCurrency: "SAR",
        notes: "",
      };
    }
    return base;
  };

  const send = async (commit: boolean) => {
    setBusy(true);
    setError("");
    try {
      const result = (await writeJson(
        "/api/pricing/import/preview",
        "POST",
        await payload(commit),
        code,
      )) as unknown as ImportSummary;
      if (commit) onCommitted(result.book ?? null);
      else onPreview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <SectionTitle
        hint={
          lang === "ar"
            ? "الملف أو الشيت يتحول لمسودة فقط. لا شيء يدخل التقارير قبل ما تراجع المعاينة وتضغط نشر."
            : "A file or sheet becomes a draft only. Nothing reaches the reports until you review this preview and publish."
        }
      >
        <span className="inline-flex items-center gap-2">
          <FileSpreadsheet size={16} aria-hidden="true" />
          {lang === "ar" ? "استيراد قائمة أسعار" : "Import a price list"}
        </span>
      </SectionTitle>

      {!!error && <Notice tone="danger">{error}</Notice>}

      <div className="flex flex-wrap gap-2">
        {(["xlsx", "google_sheet"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSource(value)}
            className={`min-h-11 cursor-pointer rounded-lg border px-3 text-[13px] font-medium ${
              source === value ? "border-brand text-brand" : "border-border text-text-muted"
            }`}
          >
            {value === "xlsx"
              ? lang === "ar"
                ? "ملف Excel"
                : "Excel file"
              : lang === "ar"
                ? "Google Sheet"
                : "Google Sheet"}
          </button>
        ))}
      </div>

      {source === "xlsx" ? (
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="block w-full text-[13px] text-text file:me-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:text-[13px]"
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">Google Sheet URL</span>
            <input
              value={sheetUrl}
              onChange={(event) => setSheetUrl(event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">
              {lang === "ar" ? "أسماء التبويبات (مفصولة بفاصلة)" : "Tab names (comma separated)"}
            </span>
            <input
              value={tabs}
              onChange={(event) => setTabs(event.target.value)}
              className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px]"
            />
          </label>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted">
            {lang === "ar" ? "اسم النسخة" : "Version name"}
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={lang === "ar" ? "أسعار سبتمبر" : "September prices"}
            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted">
            {lang === "ar" ? "سارية من" : "Effective from"}
          </span>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted">
            {lang === "ar" ? "سارية حتى" : "Effective to"}
          </span>
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted">
            {lang === "ar" ? "الأسعار شاملة الضريبة؟" : "Prices include tax?"}
          </span>
          <select
            value={taxInclusive ? "yes" : "no"}
            onChange={(event) => setTaxInclusive(event.target.value === "yes")}
            className="min-h-11 rounded-lg border border-border bg-surface px-2.5 text-[13px]"
          >
            <option value="yes">{lang === "ar" ? "شاملة الضريبة" : "Tax inclusive"}</option>
            <option value="no">{lang === "ar" ? "بدون ضريبة" : "Tax exclusive"}</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void send(false)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} aria-hidden="true" />
          {lang === "ar" ? "معاينة" : "Preview"}
        </button>
        <button
          type="button"
          disabled={disabled || busy || !preview?.ok}
          onClick={() => void send(true)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: "var(--brand)" }}
        >
          {lang === "ar" ? "إنشاء مسودة" : "Create draft"}
        </button>
      </div>

      {preview?.ok && (
        <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-3">
          <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
            {[
              [lang === "ar" ? "صفوف المصدر" : "Source rows", preview.summary.sourceRows],
              [lang === "ar" ? "قواعد مقبولة" : "Rules accepted", preview.summary.accepted],
              [lang === "ar" ? "صفوف مرفوضة" : "Rows rejected", preview.summary.rejected],
              [lang === "ar" ? "أكواد مكررة" : "Duplicate codes", preview.summary.duplicateCodes],
              [lang === "ar" ? "تحتاج مراجعة" : "Needs review", preview.summary.needsReview],
              [lang === "ar" ? "موقوفة" : "On hold", preview.summary.onHold],
              [lang === "ar" ? "غير مربوطة بأودو" : "Unlinked", preview.summary.unmapped],
              [lang === "ar" ? "تنبيهات" : "Warnings", preview.summary.warnings],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-surface p-2">
                <div className="text-[11px] text-text-muted">{label}</div>
                <div className="text-[16px] font-semibold tabular-nums text-text">{value}</div>
              </div>
            ))}
          </div>

          {!!preview.unresolvedDates.length && (
            <Notice tone="warning" title={lang === "ar" ? "تاريخ ملتبس" : "Ambiguous date"}>
              <ul className="space-y-1 text-[12px]">
                {preview.unresolvedDates.map((entry) => (
                  <li key={`${entry.sheet}${entry.raw}`}>
                    <span className="font-medium">{entry.sheet}</span>: “{entry.raw}” —{" "}
                    {entry.dayFirst} {lang === "ar" ? "أو" : "or"} {entry.monthFirst}
                  </li>
                ))}
              </ul>
              <label className="mt-2 flex flex-col gap-1">
                <span className="text-[11px] font-medium">
                  {lang === "ar" ? "اقرأ التاريخ كـ" : "Read the date as"}
                </span>
                <select
                  value={dateReading}
                  onChange={(event) => setDateReading(event.target.value as typeof dateReading)}
                  className="min-h-11 max-w-xs rounded-lg border border-border bg-surface px-2.5 text-[13px]"
                >
                  <option value="unresolved">
                    {lang === "ar"
                      ? "اترك العروض غير منشورة حتى القرار"
                      : "Leave offers unpublished until decided"}
                  </option>
                  <option value="day_first">
                    {lang === "ar" ? "يوم/شهر/سنة" : "Day / month / year"}
                  </option>
                  <option value="month_first">
                    {lang === "ar" ? "شهر/يوم/سنة" : "Month / day / year"}
                  </option>
                </select>
              </label>
              <p className="mt-1 text-[11px]">
                {lang === "ar"
                  ? "اختر ثم اضغط معاينة مرة أخرى. العروض لا تُنشر تلقائيًا بتاريخ مخمّن."
                  : "Choose, then preview again. An offer is never published on a guessed date."}
              </p>
            </Notice>
          )}

          {!!preview.duplicateCodes.length && (
            <div>
              <p className="mb-1 text-[12px] font-semibold text-text">
                {lang === "ar"
                  ? "أكواد متكررة (كل الصفوف محفوظة، ولا يُحذف أي صف)"
                  : "Duplicate codes (every row is kept; none is dropped)"}
              </p>
              <ul className="space-y-1 text-[12px] text-text-muted">
                {preview.duplicateCodes.slice(0, 15).map((entry) => (
                  <li key={entry.code}>
                    <span className="font-medium text-text">{entry.code}</span> ×{entry.count}
                    {entry.conflicting && (
                      <Pill tone="warning">
                        {lang === "ar" ? "أسعار مختلفة" : "prices disagree"}
                      </Pill>
                    )}{" "}
                    — {entry.occurrences.map((hit) => `${hit.sheet}:${hit.row}`).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!preview.issues.length && (
            <details>
              <summary className="cursor-pointer text-[12px] font-semibold text-text">
                {lang === "ar"
                  ? `ملاحظات الاستيراد (${preview.issues.length})`
                  : `Import notes (${preview.issues.length})`}
              </summary>
              <ul className="mt-2 space-y-1 text-[11px] text-text-muted">
                {preview.issues.slice(0, 60).map((issue, index) => (
                  <li key={`${issue.code}${issue.row}${index}`}>
                    <Pill tone={issue.severity === "warning" ? "warning" : "neutral"}>
                      {issue.severity}
                    </Pill>{" "}
                    {issue.sheet}:{issue.row} — {issue.message} {issue.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

/* --- single-row editor ----------------------------------------------------- */

/**
 * Edit one number without re-entering the row.
 *
 * The dialog opens on the values already stored and sends only the fields that
 * actually changed, so the change log records the edit rather than a re-save of
 * everything.
 */
function EditDialog({
  item,
  code,
  onClose,
  onSaved,
}: {
  item: PriceItem;
  code: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { lang } = useI18n();
  const [draft, setDraft] = useState({
    exactPrice: item.exactPrice,
    minimumPrice: item.minimumPrice,
    maximumPrice: item.maximumPrice,
    validFrom: item.validFrom,
    validTo: item.validTo,
    active: item.active,
    onHold: item.onHold,
    requiresReview: item.requiresReview,
    note: item.note,
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const numberField = (label: string, key: "exactPrice" | "minimumPrice" | "maximumPrice") => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-text-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        value={draft[key] ?? ""}
        onChange={(event) =>
          setDraft((current) => ({
            ...current,
            // An emptied box means "no published price", which is not zero.
            [key]: event.target.value === "" ? null : Number(event.target.value),
          }))
        }
        className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px] tabular-nums"
      />
    </label>
  );

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(draft)) {
        if (JSON.stringify(value) !== JSON.stringify(item[key as keyof PriceItem])) {
          patch[key] = value;
        }
      }
      if (!Object.keys(patch).length) {
        onClose();
        return;
      }
      await writeJson(
        "/api/pricing/items",
        "PUT",
        { reason, updates: [{ id: item.id, patch }] },
        code,
      );
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-0 sm:place-items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={lang === "ar" ? "تعديل السعر" : "Edit price"}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-4 sm:rounded-2xl sm:p-5">
        <h2 className="text-[15px] font-semibold text-text">{item.courseName}</h2>
        <p className="mt-0.5 text-[12px] text-text-muted">
          {item.rawProductCode} · {methodLabel(item.paymentMethod, lang)} · {item.currency} ·{" "}
          {scopeLabel(item.pricingScope, lang)}
        </p>

        {!!error && (
          <div className="mt-3">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {numberField(lang === "ar" ? "السعر الرسمي" : "List price", "exactPrice")}
          {numberField(lang === "ar" ? "الحد الأدنى" : "Floor", "minimumPrice")}
          {numberField(lang === "ar" ? "الحد الأقصى" : "Ceiling", "maximumPrice")}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">
              {lang === "ar" ? "سارٍ من" : "Valid from"}
            </span>
            <input
              type="date"
              value={draft.validFrom}
              onChange={(event) => setDraft((c) => ({ ...c, validFrom: event.target.value }))}
              className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-text-muted">
              {lang === "ar" ? "سارٍ حتى" : "Valid to"}
            </span>
            <input
              type="date"
              value={draft.validTo}
              onChange={(event) => setDraft((c) => ({ ...c, validTo: event.target.value }))}
              className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px]"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-4">
          {(
            [
              ["active", lang === "ar" ? "منشور" : "Published"],
              ["onHold", lang === "ar" ? "موقوف عن البيع" : "On hold"],
              ["requiresReview", lang === "ar" ? "يحتاج مراجعة" : "Needs review"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px]"
            >
              <input
                type="checkbox"
                checked={Boolean(draft[key])}
                onChange={(event) => setDraft((c) => ({ ...c, [key]: event.target.checked }))}
                className="size-4 accent-[var(--brand)]"
              />
              {label}
            </label>
          ))}
        </div>

        <label className="mt-3 flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted">
            {lang === "ar" ? "ملاحظة" : "Note"}
          </span>
          <textarea
            value={draft.note}
            onChange={(event) => setDraft((c) => ({ ...c, note: event.target.value }))}
            rows={2}
            className="rounded-lg border border-border bg-surface p-2 text-[13px]"
          />
        </label>

        <label className="mt-3 flex flex-col gap-1">
          <span className="text-[11px] font-medium text-text-muted">
            {lang === "ar" ? "سبب التعديل (يُحفظ في السجل)" : "Reason (recorded in the log)"}
          </span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-11 rounded-lg border border-border bg-surface px-3 text-[13px]"
          />
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 cursor-pointer rounded-lg border border-border px-3 text-[13px] font-medium text-text"
          >
            {lang === "ar" ? "إلغاء" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="min-h-11 cursor-pointer rounded-lg px-4 text-[13px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--brand)" }}
          >
            {busy ? (lang === "ar" ? "جارٍ الحفظ…" : "Saving…") : lang === "ar" ? "حفظ" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
