import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Notice, PageHeader, Segmented } from "@/components/ui-bits";
import { PriceAlertsTab, type ExceptionsResponse } from "@/components/pricing/PriceAlertsTab";
import {
  PriceComplianceTab,
  emptyComplianceFilters,
  type ComplianceFilters,
  type ComplianceResponse,
} from "@/components/pricing/PriceComplianceTab";
import { PriceCourseSummaryTab } from "@/components/pricing/PriceCourseSummaryTab";
import { PriceManageTab } from "@/components/pricing/PriceManageTab";
import {
  PriceSearchTab,
  emptySearchFilters,
  type SearchFilters,
} from "@/components/pricing/PriceSearchTab";
import { ADMIN_CODE_KEY, writeJson, type AuthState } from "@/components/pricing/pricing-ui";
import { useI18n } from "@/lib/i18n";

type Tab = "summary" | "search" | "manage" | "compliance" | "alerts";

const TABS: Tab[] = ["summary", "search", "manage", "compliance", "alerts"];

/**
 * The Price Book.
 *
 * One route with four panels rather than four routes, because they share a
 * price-book selection and an admin code, and a salesperson moving between
 * "what does this cost" and "was it sold correctly" should not lose either.
 * The active panel lives in the URL, so a link to the compliance view still
 * opens the compliance view.
 */
export const Route = createFileRoute("/pricing")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: PricingPage,
});

const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === "all" || value === false) continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const detail = await response
      .clone()
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => undefined);
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function PricingPage() {
  const { lang, t } = useI18n();
  const navigate = useNavigate({ from: "/pricing" });
  const search = useSearch({ from: "/pricing" });
  const tab: Tab = search.tab ?? "summary";

  const [searchFilters, setSearchFilters] = useState<SearchFilters>(emptySearchFilters);
  const [complianceFilters, setComplianceFilters] =
    useState<ComplianceFilters>(emptyComplianceFilters);
  const [selectedBookId, setSelectedBookId] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [busy, setBusy] = useState<"" | "recalculate" | "digest">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      setAdminCode(localStorage.getItem(ADMIN_CODE_KEY) ?? "");
    } catch {
      // Storage can be unavailable; the code is then typed per action.
    }
  }, []);

  const setTab = (next: Tab) =>
    void navigate({ search: { tab: next === "search" ? undefined : next } });

  /* --- data ------------------------------------------------------------- */

  const catalog = useQuery({
    queryKey: ["pricing-catalog", searchFilters, selectedBookId],
    enabled: tab === "search" || tab === "summary",
    staleTime: 60_000,
    queryFn: () =>
      getJson<Parameters<typeof PriceSearchTab>[0]["data"]>(
        `/api/pricing/catalog${query({
          bookId: selectedBookId,
          q: searchFilters.q,
          specialization: searchFilters.specialization,
          subcategory: searchFilters.subcategory,
          deliveryType: searchFilters.deliveryType,
          paymentMethod: searchFilters.paymentMethod,
          currency: searchFilters.currency,
          country: searchFilters.country,
          liveOffers: searchFilters.liveOffers ? 1 : undefined,
        })}`,
      ),
  });

  const facets = useQuery({
    queryKey: ["pricing-facets", selectedBookId],
    staleTime: 5 * 60_000,
    queryFn: () =>
      getJson<Parameters<typeof PriceSearchTab>[0]["facets"]>(
        `/api/pricing/facets${query({ bookId: selectedBookId })}`,
      ),
  });

  const books = useQuery({
    queryKey: ["pricing-books"],
    enabled: tab === "manage",
    staleTime: 30_000,
    queryFn: () => getJson<Parameters<typeof PriceManageTab>[0]["books"]>("/api/pricing/books"),
  });

  const items = useQuery({
    queryKey: ["pricing-items", selectedBookId],
    enabled: tab === "manage",
    staleTime: 30_000,
    queryFn: () =>
      getJson<Parameters<typeof PriceManageTab>[0]["items"]>(
        `/api/pricing/items${query({ bookId: selectedBookId, limit: 300 })}`,
      ),
  });

  const compliance = useQuery({
    queryKey: ["pricing-compliance", complianceFilters],
    enabled: tab === "compliance",
    staleTime: 60_000,
    queryFn: () =>
      getJson<ComplianceResponse>(
        `/api/pricing/compliance${query({
          from: complianceFilters.from,
          to: complianceFilters.to,
          dateBasis: complianceFilters.dateBasis,
          currency: complianceFilters.currency,
          paymentMethod: complianceFilters.paymentMethod,
          salesperson: complianceFilters.salesperson,
          salesTeam: complianceFilters.salesTeam,
          status: complianceFilters.status,
          severity: complianceFilters.severity,
          q: complianceFilters.q,
          limit: 50,
          offset: complianceFilters.offset,
        })}`,
      ),
  });

  const exceptions = useQuery({
    queryKey: ["pricing-exceptions", complianceFilters.from, complianceFilters.to],
    enabled: tab === "alerts",
    staleTime: 60_000,
    queryFn: () =>
      getJson<ExceptionsResponse>(
        `/api/pricing/exceptions${query({
          from: complianceFilters.from,
          to: complianceFilters.to,
          limit: 100,
        })}`,
      ),
  });

  const auth: AuthState | undefined =
    books.data?.auth ?? items.data?.auth ?? exceptions.data?.auth ?? catalog.data?.auth;
  const canWrite = !!auth?.editable;

  const refreshAll = () => {
    void books.refetch();
    void items.refetch();
    void catalog.refetch();
    void facets.refetch();
    void compliance.refetch();
    void exceptions.refetch();
  };

  const recalculate = async () => {
    setBusy("recalculate");
    setError("");
    setMessage("");
    try {
      const result = (await writeJson(
        "/api/pricing/recalculate",
        "POST",
        { force: false },
        adminCode,
      )) as { run?: { auditedLines: number; skippedUnchanged: number; candidateLines: number } };
      const run = result.run;
      setMessage(
        lang === "ar"
          ? `تم تحليل ${run?.auditedLines ?? 0} بند جديد أو متغيّر من ${run?.candidateLines ?? 0}، وتم تخطي ${run?.skippedUnchanged ?? 0} بند لم يتغيّر.`
          : `Audited ${run?.auditedLines ?? 0} new or changed lines out of ${run?.candidateLines ?? 0}; ${run?.skippedUnchanged ?? 0} were unchanged and skipped.`,
      );
      void compliance.refetch();
      void exceptions.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The audit run failed.");
    } finally {
      setBusy("");
    }
  };

  const sendDigest = async () => {
    setBusy("digest");
    setError("");
    setMessage("");
    try {
      const result = (await writeJson(
        "/api/pricing/recalculate",
        "POST",
        { offline: true, notify: true },
        adminCode,
      )) as {
        digest?: { sent: number; newFindings: number; suppressed: number; skipped: boolean };
      };
      const digest = result.digest;
      setMessage(
        digest?.skipped
          ? lang === "ar"
            ? "لا توجد حالات جديدة لم يسبق التنبيه عليها."
            : "Nothing new to announce; every finding has already been sent."
          : lang === "ar"
            ? `تم إرسال ${digest?.newFindings ?? 0} حالة جديدة إلى ${digest?.sent ?? 0} مشترك.`
            : `Sent ${digest?.newFindings ?? 0} new findings to ${digest?.sent ?? 0} subscribers.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sending the digest failed.");
    } finally {
      setBusy("");
    }
  };

  const complianceFacets = useMemo(
    () => ({ currencies: facets.data?.facets?.currencies ?? ["SAR", "EGP"] }),
    [facets.data],
  );

  const tabLabel: Record<Tab, string> = {
    summary: t("pb_tab_summary"),
    search: t("pb_tab_search"),
    manage: t("pb_tab_manage"),
    compliance: t("pb_tab_compliance"),
    alerts: t("pb_tab_alerts"),
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t("price_book")} subtitle={t("price_book_sub")} />

      <div className="hscroll">
        <Segmented
          size="md"
          value={tab}
          onChange={setTab}
          options={TABS.map((value) => ({ value, label: tabLabel[value] }))}
        />
      </div>

      {!!error && <Notice tone="danger">{error}</Notice>}
      {!!message && <Notice tone="info">{message}</Notice>}

      {tab === "summary" && (
        <PriceCourseSummaryTab
          filters={searchFilters}
          onFilters={setSearchFilters}
          data={catalog.data}
          facets={facets.data}
          loading={catalog.isLoading}
          error={catalog.error instanceof Error ? catalog.error.message : undefined}
          onRetry={() => void catalog.refetch()}
        />
      )}

      {tab === "search" && (
        <PriceSearchTab
          filters={searchFilters}
          onFilters={setSearchFilters}
          data={catalog.data}
          facets={facets.data}
          loading={catalog.isLoading}
          error={catalog.error instanceof Error ? catalog.error.message : undefined}
          onRetry={() => void catalog.refetch()}
        />
      )}

      {tab === "manage" && (
        <PriceManageTab
          books={books.data}
          items={items.data}
          loading={books.isLoading || items.isLoading}
          selectedBookId={selectedBookId || items.data?.book?.id || ""}
          onSelectBook={setSelectedBookId}
          onChanged={refreshAll}
        />
      )}

      {tab === "compliance" && (
        <PriceComplianceTab
          data={compliance.data}
          filters={complianceFilters}
          onFilters={setComplianceFilters}
          loading={compliance.isLoading}
          facets={complianceFacets}
          onRecalculate={() => void recalculate()}
          recalculating={busy === "recalculate"}
          canWrite={canWrite}
        />
      )}

      {tab === "alerts" && (
        <PriceAlertsTab
          data={exceptions.data}
          loading={exceptions.isLoading}
          onSendDigest={() => void sendDigest()}
          sending={busy === "digest"}
          canWrite={canWrite}
          adminCode={adminCode}
        />
      )}
    </div>
  );
}
