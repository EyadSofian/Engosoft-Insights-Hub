import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BellRing,
  ClipboardCheck,
  Compass,
  ListChecks,
  Search,
  Settings2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Notice, Skeleton } from "@/components/ui-bits";
import { PriceAdvisorTab } from "@/components/pricing/PriceAdvisorTab";
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
  emptySearchFilters,
  type CatalogResponse,
  type SearchFilters,
} from "@/components/pricing/PriceSearchTab";
import { PriceTeamTab } from "@/components/pricing/PriceTeamTab";
import {
  ADMIN_CODE_KEY,
  fmtMoney,
  writeJson,
  type AuthState,
} from "@/components/pricing/pricing-ui";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";

type Tab = "prices" | "invoices" | "team" | "advisor" | "manage" | "alerts";

const TABS: Tab[] = ["prices", "invoices", "team", "advisor", "manage", "alerts"];
const LEGACY_TABS: Record<string, Tab> = {
  summary: "prices",
  search: "prices",
  compliance: "invoices",
};

export const Route = createFileRoute("/pricing")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const raw = typeof search.tab === "string" ? search.tab : "";
    const tab = LEGACY_TABS[raw] ?? (TABS.includes(raw as Tab) ? (raw as Tab) : undefined);
    return { tab: tab === "prices" ? undefined : tab };
  },
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
  const { lang } = useI18n();
  const ar = lang === "ar";
  const navigate = useNavigate({ from: "/pricing" });
  const search = useSearch({ from: "/pricing" });
  const tab: Tab = search.tab ?? "prices";

  const [searchFilters, setSearchFilters] = useState<SearchFilters>(emptySearchFilters);
  const [quickSearch, setQuickSearch] = useState("");
  const [complianceFilters, setComplianceFilters] =
    useState<ComplianceFilters>(emptyComplianceFilters);
  const [selectedBookId, setSelectedBookId] = useState("");
  const [manageQuery, setManageQuery] = useState("");
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

  useEffect(() => setQuickSearch(searchFilters.q), [searchFilters.q]);

  const setTab = (next: Tab) =>
    void navigate({ search: { tab: next === "prices" ? undefined : next } });

  const hasCatalogFilters = useMemo(
    () =>
      Boolean(searchFilters.q) ||
      searchFilters.specialization !== "all" ||
      searchFilters.subcategory !== "all" ||
      searchFilters.deliveryType !== "all" ||
      searchFilters.paymentMethod !== "all" ||
      searchFilters.currency !== "all" ||
      searchFilters.country !== "all" ||
      searchFilters.liveOffers,
    [searchFilters],
  );

  const fullCatalog = useQuery({
    queryKey: ["pricing-catalog-full"],
    staleTime: 5 * 60_000,
    queryFn: () => getJson<CatalogResponse>(`/api/pricing/catalog${query({ limit: 1000 })}`),
  });

  const filteredCatalog = useQuery({
    queryKey: ["pricing-catalog-filtered", searchFilters],
    enabled: tab === "prices" && hasCatalogFilters,
    staleTime: 60_000,
    queryFn: () =>
      getJson<CatalogResponse>(
        `/api/pricing/catalog${query({
          q: searchFilters.q,
          specialization: searchFilters.specialization,
          subcategory: searchFilters.subcategory,
          deliveryType: searchFilters.deliveryType,
          paymentMethod: searchFilters.paymentMethod,
          currency: searchFilters.currency,
          country: searchFilters.country,
          liveOffers: searchFilters.liveOffers ? 1 : undefined,
          limit: 1000,
        })}`,
      ),
  });

  const facets = useQuery({
    queryKey: ["pricing-facets"],
    staleTime: 5 * 60_000,
    queryFn: () =>
      getJson<Parameters<typeof PriceCourseSummaryTab>[0]["facets"]>("/api/pricing/facets"),
  });

  const books = useQuery({
    queryKey: ["pricing-books"],
    enabled: tab === "manage",
    staleTime: 30_000,
    queryFn: () => getJson<Parameters<typeof PriceManageTab>[0]["books"]>("/api/pricing/books"),
  });

  const items = useQuery({
    queryKey: ["pricing-items", selectedBookId, manageQuery],
    enabled: tab === "manage",
    staleTime: 30_000,
    queryFn: () =>
      getJson<Parameters<typeof PriceManageTab>[0]["items"]>(
        `/api/pricing/items${query({ bookId: selectedBookId, q: manageQuery, limit: 500 })}`,
      ),
  });

  const compliance = useQuery({
    queryKey: ["pricing-compliance", complianceFilters, tab === "invoices"],
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
          rows: tab === "invoices" ? undefined : 0,
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

  const catalogData = hasCatalogFilters ? filteredCatalog.data : fullCatalog.data;
  const catalogLoading = hasCatalogFilters ? filteredCatalog.isLoading : fullCatalog.isLoading;
  const catalogError = hasCatalogFilters ? filteredCatalog.error : fullCatalog.error;
  const auth: AuthState | undefined =
    books.data?.auth ?? items.data?.auth ?? exceptions.data?.auth ?? fullCatalog.data?.auth;
  const canWrite = !!auth?.editable;

  const refreshAll = () => {
    void books.refetch();
    void items.refetch();
    void fullCatalog.refetch();
    void filteredCatalog.refetch();
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
        ar
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
          ? ar
            ? "لا توجد حالات جديدة لم يسبق التنبيه عليها."
            : "Nothing new to announce; every finding has already been sent."
          : ar
            ? `تم إرسال ${digest?.newFindings ?? 0} حالة جديدة إلى ${digest?.sent ?? 0} مشترك.`
            : `Sent ${digest?.newFindings ?? 0} new findings to ${digest?.sent ?? 0} subscribers.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sending the digest failed.");
    } finally {
      setBusy("");
    }
  };

  const openSalesperson = (salesperson: string) => {
    setComplianceFilters({ ...emptyComplianceFilters, salesperson, offset: 0 });
    setTab("invoices");
  };

  const searchPrices = (event: FormEvent) => {
    event.preventDefault();
    setSearchFilters({ ...emptySearchFilters, q: quickSearch.trim() });
    setTab("prices");
  };

  const entries = fullCatalog.data?.entries ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const activeOfferCourses = new Set(
    entries
      .filter((entry) =>
        entry.prices.some(
          (price) =>
            price.active &&
            price.scope === "offer" &&
            (!price.validFrom || price.validFrom <= today) &&
            (!price.validTo || price.validTo >= today),
        ),
      )
      .map((entry) => `${entry.code}:${entry.deliveryType}:${entry.subcategory}`),
  ).size;
  const leakage = (compliance.data?.byCurrency ?? [])
    .filter((entry) => entry.leakage > 0)
    .map((entry) => fmtMoney(entry.leakage, entry.currency, lang))
    .join(" + ");
  const complianceRate = compliance.data?.kpis.complianceRate;
  const complianceTone =
    complianceRate == null
      ? undefined
      : complianceRate < 0.8
        ? ("danger" as const)
        : complianceRate < 0.95
          ? ("warning" as const)
          : ("success" as const);

  const metrics: { label: string; value: string; tone?: "danger" | "warning" | "success" }[] = [
    {
      label: ar ? "الالتزام بالأسعار" : "Price compliance",
      value: complianceRate == null ? "—" : fmtPct(complianceRate * 100, 0),
      tone: complianceTone,
    },
    {
      label: ar ? "تحت الحد الأدنى" : "Below the floor",
      value: compliance.data ? fmtNum(compliance.data.kpis.belowMinimumLines) : "—",
      tone: "danger",
    },
    {
      label: ar ? "قيمة الفارق" : "Price gap",
      value: leakage || "—",
      tone: "danger",
    },
    {
      label: ar ? "تحتاج مراجعة" : "Needs review",
      value: compliance.data ? fmtNum(compliance.data.kpis.needsReviewLines) : "—",
      tone: "warning",
    },
    {
      label: ar ? "دورات منشورة" : "Published courses",
      value: fullCatalog.data ? fmtNum(entries.length) : "—",
    },
    {
      label: ar ? "عروض سارية" : "Live offers",
      value: fullCatalog.data ? fmtNum(activeOfferCourses) : "—",
    },
  ];

  const tabDefinitions: { value: Tab; label: string; Icon: LucideIcon; admin?: boolean }[] = [
    { value: "prices", label: ar ? "قائمة الأسعار" : "Price list", Icon: ListChecks },
    {
      value: "invoices",
      label: ar ? "الفواتير والالتزام" : "Invoices & compliance",
      Icon: ClipboardCheck,
    },
    { value: "team", label: ar ? "أداء الفريق" : "Team performance", Icon: UsersRound },
    { value: "advisor", label: ar ? "اقتراح السعر" : "Price advisor", Icon: Compass },
    {
      value: "manage",
      label: ar ? "إدارة الأسعار" : "Manage prices",
      Icon: Settings2,
      admin: true,
    },
    { value: "alerts", label: ar ? "التنبيهات والربط" : "Alerts & links", Icon: BellRing },
  ];

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-[22px] border border-[#1c3942] bg-[#10262d] shadow-sm">
        <div className="grid gap-5 px-5 py-5 text-white lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center lg:px-7">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
              ENGOSOFT · SALES CONTROL
            </div>
            <h1 className="mt-2 text-[23px] font-black tracking-tight sm:text-[27px]">
              {ar ? "لوحة الأسعار والالتزام البيعي" : "Pricing & sales compliance"}
            </h1>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-white/62">
              {ar
                ? "السعر المعتمد، الفواتير الفعلية، أداء الفريق، وقرار البيع في مكان واحد."
                : "Approved pricing, actual invoices, team behavior and the sales decision in one place."}
            </p>
          </div>
          <form onSubmit={searchPrices} className="relative" role="search">
            <Search
              size={16}
              className="pointer-events-none absolute inset-y-0 start-3 my-auto text-white/45"
              aria-hidden="true"
            />
            <input
              value={quickSearch}
              onChange={(event) => setQuickSearch(event.target.value)}
              placeholder={ar ? "ابحث باسم الدورة أو الكود" : "Search course name or code"}
              aria-label={ar ? "بحث في الأسعار" : "Search prices"}
              className="min-h-12 w-full rounded-xl border border-white/15 bg-white/7 ps-10 pe-3 text-[13px] text-white outline-none placeholder:text-white/38 focus:border-white/35 focus:bg-white/10"
            />
          </form>
        </div>

        <div className="grid grid-cols-2 border-t border-white/10 bg-surface sm:grid-cols-3 xl:grid-cols-6">
          {metrics.map((metric, index) => (
            <div
              key={metric.label}
              className={`min-h-[82px] px-4 py-3 ${index ? "border-s border-border" : ""} ${index > 1 ? "border-t border-border sm:border-t-0" : ""} ${index > 2 ? "sm:border-t sm:border-border xl:border-t-0" : ""}`}
            >
              <div className="text-[10px] font-semibold text-text-muted">{metric.label}</div>
              {compliance.isLoading && index < 4 ? (
                <Skeleton className="mt-2 h-7 w-20 rounded-lg" />
              ) : (
                <div
                  className={`mt-1 text-[21px] font-black tabular-nums ${
                    metric.tone === "danger"
                      ? "text-danger"
                      : metric.tone === "warning"
                        ? "text-warning"
                        : metric.tone === "success"
                          ? "text-success"
                          : "text-text"
                  }`}
                >
                  {metric.value}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <nav
        className="hscroll rounded-2xl border border-border bg-surface px-2 shadow-sm"
        aria-label={ar ? "أقسام لوحة الأسعار" : "Pricing dashboard sections"}
      >
        <div className="flex min-w-max items-stretch">
          {tabDefinitions.map(({ value, label, Icon, admin }) => (
            <button
              type="button"
              key={value}
              onClick={() => setTab(value)}
              className={`relative inline-flex min-h-14 items-center gap-2 px-4 text-[12px] font-bold transition ${
                admin ? "ms-2 border-s border-border" : ""
              } ${tab === value ? "text-text" : "text-text-muted hover:text-text"}`}
              aria-current={tab === value ? "page" : undefined}
            >
              <Icon size={15} className={tab === value ? "text-brand" : "text-text-subtle"} />
              {label}
              {tab === value && (
                <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand" />
              )}
            </button>
          ))}
        </div>
      </nav>

      {!!error && <Notice tone="danger">{error}</Notice>}
      {!!message && <Notice tone="info">{message}</Notice>}

      {tab === "prices" && (
        <PriceCourseSummaryTab
          filters={searchFilters}
          onFilters={setSearchFilters}
          data={catalogData}
          facets={facets.data}
          loading={catalogLoading}
          error={catalogError instanceof Error ? catalogError.message : undefined}
          onRetry={() =>
            void (hasCatalogFilters ? filteredCatalog.refetch() : fullCatalog.refetch())
          }
          embeddedSearch={false}
        />
      )}

      {tab === "invoices" && (
        <PriceComplianceTab
          data={compliance.data}
          filters={complianceFilters}
          onFilters={setComplianceFilters}
          loading={compliance.isLoading}
          facets={{ currencies: ["SAR", "EGP"] }}
          onRecalculate={() => void recalculate()}
          recalculating={busy === "recalculate"}
          canWrite={canWrite}
          showOverview={false}
          showTeamBreakdown={false}
        />
      )}

      {tab === "team" && (
        <PriceTeamTab
          data={compliance.data}
          catalog={entries}
          loading={compliance.isLoading || fullCatalog.isLoading}
          onOpenSalesperson={openSalesperson}
          onSendDigest={() => void sendDigest()}
          sending={busy === "digest"}
          canWrite={canWrite}
        />
      )}

      {tab === "advisor" && <PriceAdvisorTab entries={entries} />}

      {tab === "manage" && (
        <PriceManageTab
          books={books.data}
          items={items.data}
          loading={books.isLoading || items.isLoading}
          selectedBookId={selectedBookId || items.data?.book?.id || ""}
          onSelectBook={setSelectedBookId}
          itemQuery={manageQuery}
          onItemQuery={setManageQuery}
          onChanged={refreshAll}
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
          onResolveLinks={() => void recalculate()}
          resolvingLinks={busy === "recalculate"}
        />
      )}
    </div>
  );
}
