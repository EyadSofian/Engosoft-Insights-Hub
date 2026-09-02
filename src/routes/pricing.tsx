import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgePercent,
  BellRing,
  ClipboardCheck,
  Compass,
  Handshake,
  ListChecks,
  ScanSearch,
  Settings2,
  ShieldCheck,
  TrendingDown,
  TriangleAlert,
  UsersRound,
  Wallet,
} from "lucide-react";
import { Notice } from "@/components/ui-bits";
import { PriceAdvisorTab } from "@/components/pricing/PriceAdvisorTab";
import { PriceAlertsTab, type ExceptionsResponse } from "@/components/pricing/PriceAlertsTab";
import { CriticalInvoicesPanel } from "@/components/pricing/CriticalInvoicesPanel";
import {
  PriceComplianceTab,
  emptyComplianceFilters,
  type ComplianceFilters,
  type ComplianceResponse,
} from "@/components/pricing/PriceComplianceTab";
import {
  PriceCourseSummaryTab,
  type CatalogContentKind,
} from "@/components/pricing/PriceCourseSummaryTab";
import { PriceComplianceInfo } from "@/components/pricing/PriceComplianceInfo";
import { PriceManageTab } from "@/components/pricing/PriceManageTab";
import {
  PricingDrilldownBar,
  PricingKpiStrip,
  PricingPageHeader,
  PricingTabBar,
  type PricingKpi,
  type PricingTab,
} from "@/components/pricing/PricingChrome";
import {
  emptySearchFilters,
  type CatalogResponse,
  type SearchFilters,
} from "@/components/pricing/PriceSearchTab";
import { PriceTeamTab } from "@/components/pricing/PriceTeamTab";
import { activeOffers, isNegotiable, summarizeBreaches } from "@/components/pricing/course-pricing";
import {
  ADMIN_CODE_KEY,
  fmtMoney,
  writeJson,
  type AuthState,
} from "@/components/pricing/pricing-ui";
import { fmtNum, fmtPct, useI18n } from "@/lib/i18n";
import { useFilters } from "@/lib/filter-store";

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

const DAY = 86_400_000;
const isoDay = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * The window of the same length immediately before the one on screen.
 *
 * A delta is only honest against an equal span, so a 12-day window is compared
 * with the 12 days before it rather than with "last month". Returns null when
 * the period is open-ended, and the KPI strip then shows no comparison at all
 * rather than an invented one.
 */
function previousWindowOf(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to) return null;
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const span = end - start + DAY;
  return { from: isoDay(new Date(start - span)), to: isoDay(new Date(start - DAY)) };
}

function PricingPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const globalFilters = useFilters();
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
  const [catalogKind, setCatalogKind] = useState<CatalogContentKind>("all");
  const [catalogDemandOnly, setCatalogDemandOnly] = useState(true);
  const [kpiDrilldown, setKpiDrilldown] = useState<{
    id: string;
    request: number;
    targetTab: Tab;
  } | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setAdminCode(localStorage.getItem(ADMIN_CODE_KEY) ?? "");
    } catch {
      // Storage can be unavailable; the code is then typed per action.
    }
  }, []);

  useEffect(() => setQuickSearch(searchFilters.q), [searchFilters.q]);

  // A KPI is a shortcut into another data view. Once that view has rendered,
  // take the reader to it and move programmatic focus as one coherent action.
  // Keeping a request counter means pressing the same KPI again still works.
  useEffect(() => {
    if (!kpiDrilldown || tab !== kpiDrilldown.targetTab) return;
    let scrollTimer = 0;
    let focusTimer = 0;
    scrollTimer = window.setTimeout(() => {
      const target = resultsRef.current;
      if (!target) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const top = Math.max(0, window.scrollY + target.getBoundingClientRect().top - 8);
      window.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
      focusTimer = window.setTimeout(
        () => target.focus({ preventScroll: true }),
        reducedMotion ? 0 : 420,
      );
    }, 48);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(focusTimer);
    };
  }, [kpiDrilldown, tab]);

  // The period shown in the global top bar is the period the pricing audit uses.
  // Keeping a second silent date window here would make a correct percentage
  // look untrustworthy as soon as the user changes the top-level preset.
  useEffect(() => {
    const hasGlobalPeriod =
      Boolean(globalFilters.from || globalFilters.to) || globalFilters.range === "all";
    if (!hasGlobalPeriod && !globalFilters.dateBasis) return;
    setComplianceFilters((current) => {
      const from = hasGlobalPeriod ? (globalFilters.from ?? "") : current.from;
      const to = hasGlobalPeriod ? (globalFilters.to ?? "") : current.to;
      const dateBasis = globalFilters.dateBasis ?? current.dateBasis;
      if (from === current.from && to === current.to && dateBasis === current.dateBasis) {
        return current;
      }
      return { ...current, from, to, dateBasis, offset: 0 };
    });
  }, [globalFilters.dateBasis, globalFilters.from, globalFilters.range, globalFilters.to]);

  const setTab = (next: Tab) =>
    void navigate({ search: { tab: next === "prices" ? undefined : next } });

  const selectKpi = (id: string, targetTab: Tab) =>
    setKpiDrilldown((current) => ({
      id,
      targetTab,
      request: (current?.request ?? 0) + 1,
    }));

  const changeTab = (next: Tab) => {
    setKpiDrilldown(null);
    setTab(next);
  };

  const catalogPeriod = {
    from: complianceFilters.from,
    to: complianceFilters.to,
    dateBasis: complianceFilters.dateBasis,
  };

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
    queryKey: ["pricing-catalog-full", catalogPeriod],
    staleTime: 5 * 60_000,
    queryFn: () =>
      getJson<CatalogResponse>(`/api/pricing/catalog${query({ ...catalogPeriod, limit: 1000 })}`),
  });

  const filteredCatalog = useQuery({
    queryKey: ["pricing-catalog-filtered", searchFilters, catalogPeriod],
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
          ...catalogPeriod,
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

  /**
   * The period's totals, read without the table's own status filter.
   *
   * The strip is the page's headline, so pressing "below the floor" must not
   * rewrite the headline into "0% compliant" — which is what happens when the
   * KPIs and the filtered table share one request. The table keeps its filters;
   * the strip keeps the period.
   */
  const periodParams = {
    from: complianceFilters.from,
    to: complianceFilters.to,
    dateBasis: complianceFilters.dateBasis,
    currency: complianceFilters.currency,
    paymentMethod: complianceFilters.paymentMethod,
    salesperson: complianceFilters.salesperson,
    salesTeam: complianceFilters.salesTeam,
  };

  const snapshot = useQuery({
    queryKey: ["pricing-snapshot", periodParams],
    staleTime: 60_000,
    queryFn: () =>
      getJson<ComplianceResponse>(`/api/pricing/compliance${query({ ...periodParams, rows: 0 })}`),
  });

  const previousWindow = useMemo(
    () => previousWindowOf(complianceFilters.from, complianceFilters.to),
    [complianceFilters.from, complianceFilters.to],
  );

  const previousSnapshot = useQuery({
    queryKey: ["pricing-snapshot-previous", periodParams, previousWindow],
    enabled: Boolean(previousWindow),
    staleTime: 5 * 60_000,
    queryFn: () =>
      getJson<ComplianceResponse>(
        `/api/pricing/compliance${query({
          ...periodParams,
          from: previousWindow?.from,
          to: previousWindow?.to,
          rows: 0,
        })}`,
      ),
  });

  const compliance = useQuery({
    queryKey: ["pricing-compliance", complianceFilters, tab === "invoices"],
    enabled: tab === "invoices",
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
          sort: complianceFilters.sort,
          dir: complianceFilters.dir,
          limit: 50,
          offset: complianceFilters.offset,
        })}`,
      ),
  });

  /**
   * Every line sold below the floor in this period.
   *
   * The price list needs a breach count per course and the detail panel needs
   * the offending lines themselves, so both read one paged request rather than
   * one request per course. 500 is the endpoint's ceiling; past it the count on
   * a row is a floor, which the row says.
   */
  const breachRows = useQuery({
    queryKey: [
      "pricing-breach-rows",
      complianceFilters.from,
      complianceFilters.to,
      complianceFilters.dateBasis,
    ],
    enabled: tab === "prices" || tab === "team",
    staleTime: 60_000,
    queryFn: () =>
      getJson<ComplianceResponse>(
        `/api/pricing/compliance${query({
          from: complianceFilters.from,
          to: complianceFilters.to,
          dateBasis: complianceFilters.dateBasis,
          status: "below_minimum",
          limit: 500,
          offset: 0,
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
    void snapshot.refetch();
    void previousSnapshot.refetch();
    void compliance.refetch();
    void breachRows.refetch();
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
      void snapshot.refetch();
      void previousSnapshot.refetch();
      void compliance.refetch();
      void breachRows.refetch();
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
    setKpiDrilldown(null);
    setComplianceFilters({ ...emptyComplianceFilters, ...periodParams, salesperson, offset: 0 });
    setTab("invoices");
  };

  /** Every invoice for one course — not only the breaching ones. */
  const openInvoicesFor = (productCode: string) => {
    setKpiDrilldown(null);
    setComplianceFilters({ ...emptyComplianceFilters, ...periodParams, q: productCode, offset: 0 });
    setTab("invoices");
  };

  const showBreaches = (source: "below" | "leakage") => {
    selectKpi(source, "invoices");
    setComplianceFilters({
      ...emptyComplianceFilters,
      ...periodParams,
      status: "below_minimum",
      sort: source === "leakage" ? "gap" : "priority",
      dir: "desc",
      offset: 0,
    });
    setTab("invoices");
  };

  const showAllInvoices = () => {
    selectKpi("compliance", "invoices");
    setComplianceFilters({ ...emptyComplianceFilters, ...periodParams, offset: 0 });
    setTab("invoices");
  };

  const showNeedsReview = () => {
    selectKpi("review", "invoices");
    setComplianceFilters({
      ...emptyComplianceFilters,
      ...periodParams,
      severity: "needs_review",
      offset: 0,
    });
    setTab("invoices");
  };

  const searchPrices = (event: FormEvent) => {
    event.preventDefault();
    setKpiDrilldown(null);
    setCatalogKind("all");
    setCatalogDemandOnly(false);
    setSearchFilters({ ...emptySearchFilters, q: quickSearch.trim() });
    setTab("prices");
  };

  const entries = useMemo(() => fullCatalog.data?.entries ?? [], [fullCatalog.data]);

  const catalogCounts = useMemo(() => {
    const offerKeys = new Set<string>();
    let negotiable = 0;
    for (const entry of entries) {
      if (activeOffers(entry).length) {
        offerKeys.add(`${entry.code}:${entry.deliveryType}:${entry.subcategory}`);
      }
      if (isNegotiable(entry)) negotiable += 1;
    }
    return { offers: offerKeys.size, negotiable };
  }, [entries]);

  const breachMap = useMemo(
    () => summarizeBreaches(breachRows.data?.rows ?? []),
    [breachRows.data],
  );

  const kpis = snapshot.data?.kpis;
  const previousKpis = previousSnapshot.data?.kpis;
  const kpiLoading = snapshot.isLoading && !snapshot.data;

  const leakage = (snapshot.data?.byCurrency ?? [])
    .filter((entry) => entry.leakage > 0)
    .map((entry) => fmtMoney(entry.leakage, entry.currency, lang))
    .join(" + ");

  const complianceRate = kpis?.complianceRate;
  const complianceTone =
    complianceRate == null
      ? "neutral"
      : complianceRate < 0.8
        ? ("danger" as const)
        : complianceRate < 0.95
          ? ("warning" as const)
          : ("success" as const);

  const rateDelta =
    complianceRate != null && previousKpis?.complianceRate != null
      ? (complianceRate - previousKpis.complianceRate) * 100
      : undefined;

  const kpiItems: PricingKpi[] = [
    {
      id: "compliance",
      label: ar ? "نسبة الالتزام" : "Compliance",
      value: complianceRate == null ? "—" : fmtPct(complianceRate * 100, 0),
      question: kpis
        ? ar
          ? `${fmtNum(kpis.compliantLines)} بند ملتزم من ${fmtNum(kpis.judgedLines)}`
          : `${fmtNum(kpis.compliantLines)} of ${fmtNum(kpis.judgedLines)} judged lines`
        : undefined,
      tone: complianceTone,
      delta: rateDelta,
      Icon: ShieldCheck,
      onSelect: showAllInvoices,
      selectHint: ar ? "افتح كل الفواتير المحللة" : "Open all audited invoices",
      resultDescription: ar
        ? "كل بنود الفواتير التي حللها النظام خلال الفترة المختارة."
        : "Every invoice line audited during the selected period.",
      info: (
        <PriceComplianceInfo
          from={complianceFilters.from}
          to={complianceFilters.to}
          dateBasis={complianceFilters.dateBasis}
          kpis={kpis}
        />
      ),
    },
    {
      id: "below",
      label: ar ? "مبيعات أقل من الحد" : "Sold below the floor",
      value: kpis ? fmtNum(kpis.belowMinimumLines) : "—",
      question: ar ? "بنود بيع تحت الحد الأدنى المعتمد" : "Lines sold under the approved floor",
      tone: kpis?.belowMinimumLines ? "danger" : "neutral",
      delta:
        kpis && previousKpis ? kpis.belowMinimumLines - previousKpis.belowMinimumLines : undefined,
      deltaInvert: true,
      Icon: TrendingDown,
      onSelect: () => showBreaches("below"),
      selectHint: ar ? "افتح الفواتير المخالفة" : "Open the breaching invoices",
      resultDescription: ar
        ? "الفواتير مفلترة الآن على البنود المباعة تحت الحد الأدنى المعتمد."
        : "Invoices are now filtered to lines sold below the approved floor.",
    },
    {
      id: "leakage",
      label: ar ? "قيمة التجاوز" : "Value given away",
      value: leakage || "—",
      question: ar ? "الفرق بين ما حُصّل والحد الأدنى" : "Collected minus the approved floor",
      tone: leakage ? "danger" : "neutral",
      Icon: Wallet,
      onSelect: () => showBreaches("leakage"),
      selectHint: ar ? "افتح الفواتير المخالفة" : "Open the breaching invoices",
      resultDescription: ar
        ? "الفواتير التي كوّنت قيمة التجاوز، مرتبة لتبدأ بالأكثر تأثيرًا."
        : "Invoices behind this value, ordered with the largest impact first.",
    },
    {
      id: "review",
      label: ar ? "تحتاج مراجعة" : "Needs review",
      value: kpis ? fmtNum(kpis.needsReviewLines) : "—",
      question: ar
        ? "دفع غير معروف أو مختلط أو عرض منتهٍ"
        : "Unknown, mixed or expired-offer lines",
      tone: kpis?.needsReviewLines ? "warning" : "neutral",
      delta:
        kpis && previousKpis ? kpis.needsReviewLines - previousKpis.needsReviewLines : undefined,
      deltaInvert: true,
      Icon: TriangleAlert,
      onSelect: showNeedsReview,
      selectHint: ar ? "افتح البنود التي تحتاج مراجعة" : "Open the lines needing review",
      resultDescription: ar
        ? "بنود لا يمكن إصدار حكم نهائي عليها قبل مراجعة بيانات الدفع أو العرض."
        : "Lines that need payment or offer data reviewed before a final verdict.",
    },
    {
      id: "negotiable",
      label: ar ? "دورات قابلة للتفاوض" : "Negotiable courses",
      value: fullCatalog.data ? fmtNum(catalogCounts.negotiable) : "—",
      question: ar ? "بينها مساحة خصم مسموحة" : "Priced as a range, not a fixed number",
      Icon: Handshake,
      onSelect: () => {
        selectKpi("negotiable", "prices");
        setCatalogKind("negotiable");
        setCatalogDemandOnly(false);
        setSearchFilters(emptySearchFilters);
        setTab("prices");
      },
      selectHint: ar ? "افتح قائمة الأسعار" : "Open the price list",
      resultDescription: ar
        ? "القائمة مفلترة الآن على الدورات التي تسمح قواعدها بهامش تفاوض."
        : "The list is now filtered to courses whose rules allow a negotiation range.",
    },
    {
      id: "offers",
      label: ar ? "عروض سارية" : "Live offers",
      value: fullCatalog.data ? fmtNum(catalogCounts.offers) : "—",
      question: ar ? "دورات عليها عرض نافذ اليوم" : "Courses with an offer in force today",
      Icon: BadgePercent,
      onSelect: () => {
        selectKpi("offers", "prices");
        setCatalogKind("offer");
        setCatalogDemandOnly(false);
        setSearchFilters({ ...emptySearchFilters, liveOffers: true });
        setTab("prices");
      },
      selectHint: ar ? "اعرض هذه الدورات" : "Show these courses",
      resultDescription: ar
        ? "قائمة الأسعار مفلترة الآن على الدورات التي لها عرض ساري اليوم."
        : "The price list is now filtered to courses with a live offer today.",
    },
  ];

  const activeKpi = kpiDrilldown ? kpiItems.find((item) => item.id === kpiDrilldown.id) : undefined;

  const clearKpiDrilldown = () => {
    if (tab === "invoices") {
      setComplianceFilters({ ...emptyComplianceFilters, ...periodParams, offset: 0 });
    } else if (tab === "prices") {
      setSearchFilters(emptySearchFilters);
      setCatalogKind("all");
      setCatalogDemandOnly(true);
    }
    setKpiDrilldown(null);
  };

  const lastRun = snapshot.data?.freshness.lastRunAt ?? "";
  const basisLabel = ar
    ? { payment: "حسب تاريخ الدفع", sale: "حسب تاريخ البيع", invoice: "حسب تاريخ الفاتورة" }[
        complianceFilters.dateBasis
      ]
    : { payment: "by payment date", sale: "by sale date", invoice: "by invoice date" }[
        complianceFilters.dateBasis
      ];

  const tabDefinitions: PricingTab<Tab>[] = [
    { value: "prices", label: ar ? "قائمة الأسعار" : "Price list", Icon: ListChecks },
    {
      value: "invoices",
      label: ar ? "الفواتير والالتزام" : "Invoices & compliance",
      Icon: ClipboardCheck,
      badge: kpis?.belowMinimumLines || undefined,
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
    <div className="space-y-3.5">
      <PricingPageHeader
        title={ar ? "الأسعار والالتزام" : "Pricing & compliance"}
        description={
          ar
            ? "السعر المعتمد، الفواتير الفعلية، وأداء الفريق في مكان واحد."
            : "Approved prices, the invoices that were actually raised, and how the team sold."
        }
        period={
          <>
            <div>
              <bdi className="num">
                {complianceFilters.from || "—"} → {complianceFilters.to || "—"}
              </bdi>{" "}
              · {basisLabel}
            </div>
            <div className="mt-0.5">
              {lastRun
                ? `${ar ? "آخر تحليل" : "Last audit"} ${lastRun.slice(0, 16).replace("T", " ")}`
                : ar
                  ? "لم يُشغَّل التحليل بعد"
                  : "The audit has not run yet"}
              {fullCatalog.data ? ` · ${fmtNum(entries.length)} ${ar ? "دورة" : "courses"}` : ""}
            </div>
          </>
        }
        searchValue={quickSearch}
        onSearchValue={setQuickSearch}
        onSearchSubmit={searchPrices}
        action={
          <button
            type="button"
            onClick={() => void recalculate()}
            disabled={!canWrite || busy === "recalculate"}
            title={
              canWrite
                ? undefined
                : ar
                  ? "إعادة التحليل تحتاج صلاحية مدير"
                  : "Re-running the audit needs manager access"
            }
            className="inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ScanSearch
              size={15}
              className={busy === "recalculate" ? "animate-pulse" : ""}
              aria-hidden="true"
            />
            {busy === "recalculate"
              ? ar
                ? "جارٍ التحليل…"
                : "Auditing…"
              : ar
                ? "إعادة تحليل الفواتير"
                : "Re-run the audit"}
          </button>
        }
      />

      <PricingKpiStrip items={kpiItems} loading={kpiLoading} activeId={kpiDrilldown?.id} />

      <div
        ref={resultsRef}
        tabIndex={-1}
        aria-label={ar ? "نتائج المؤشر المختار" : "Selected indicator results"}
        className="scroll-mt-1 outline-none"
      />
      <PricingTabBar
        tabs={tabDefinitions}
        value={tab}
        onChange={changeTab}
        label={ar ? "أقسام لوحة الأسعار" : "Pricing dashboard sections"}
      />

      {activeKpi && <PricingDrilldownBar item={activeKpi} onClear={clearKpiDrilldown} />}

      {!!error && <Notice tone="danger">{error}</Notice>}
      {!!message && <Notice tone="info">{message}</Notice>}

      {tab === "prices" && (
        <>
          <CriticalInvoicesPanel
            rows={breachRows.data?.rows ?? []}
            total={breachRows.data?.total ?? 0}
            loading={breachRows.isLoading}
          />
          <PriceCourseSummaryTab
            filters={searchFilters}
            onFilters={(next) => {
              setKpiDrilldown(null);
              setSearchFilters(next);
            }}
            kind={catalogKind}
            onKind={(next) => {
              setKpiDrilldown(null);
              setCatalogKind(next);
            }}
            demandOnly={catalogDemandOnly}
            onDemandOnly={(next) => {
              setKpiDrilldown(null);
              setCatalogDemandOnly(next);
            }}
            data={catalogData}
            facets={facets.data}
            loading={catalogLoading}
            error={catalogError instanceof Error ? catalogError.message : undefined}
            onRetry={() =>
              void (hasCatalogFilters ? filteredCatalog.refetch() : fullCatalog.refetch())
            }
            breaches={breachMap}
            breachRows={breachRows.data?.rows ?? []}
            canWrite={canWrite}
            onOpenInvoicesFor={openInvoicesFor}
          />
        </>
      )}

      {tab === "invoices" && (
        <PriceComplianceTab
          data={compliance.data}
          filters={complianceFilters}
          onFilters={(next) => {
            setKpiDrilldown(null);
            setComplianceFilters(next);
          }}
          loading={compliance.isLoading}
          error={compliance.error instanceof Error ? compliance.error.message : undefined}
          onRetry={() => void compliance.refetch()}
          facets={{ currencies: ["SAR", "EGP"] }}
          onRecalculate={() => void recalculate()}
          recalculating={busy === "recalculate"}
          canWrite={canWrite}
        />
      )}

      {tab === "team" && (
        <PriceTeamTab
          data={snapshot.data}
          previous={previousSnapshot.data?.bySalesperson}
          breachRows={breachRows.data?.rows ?? []}
          catalog={entries}
          loading={snapshot.isLoading || breachRows.isLoading}
          onOpenSalesperson={openSalesperson}
          onSendDigest={() => void sendDigest()}
          sending={busy === "digest"}
          canWrite={canWrite}
        />
      )}

      {tab === "advisor" && <PriceAdvisorTab entries={entries} loading={fullCatalog.isLoading} />}

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
