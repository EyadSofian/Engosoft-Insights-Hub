import {
  companyContext,
  odooAccessibleCompanies,
  odooCallWithPolicy,
  odooConfig,
  odooConfigured,
} from "./odoo.server";
import { DEFAULT_FX_RATES } from "./fx-rates";

export interface ProfitabilityLine {
  id: string;
  label: string;
  value: number;
  level: number;
}

export interface ProfitabilitySnapshot {
  from: string;
  to: string;
  currency: string;
  sourceCurrency: string;
  fxRate: number;
  reportId: number;
  postedOnly: true;
  companies: { id: number; name: string }[];
  netProfit: number | null;
  income: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  otherIncome: number | null;
  costOfRevenue: number | null;
  expenses: number | null;
  depreciation: number | null;
  lines: ProfitabilityLine[];
  fetchedAt: string;
}

export interface ProfitabilityResult {
  status: "ready" | "refreshing" | "loading" | "error";
  snapshot: ProfitabilitySnapshot | null;
  monthlyStatus: "ready" | "loading" | "error";
  monthly: ProfitabilityMonth[];
  error?: string;
}

export type ProfitabilitySnapshotResult = Pick<
  ProfitabilityResult,
  "status" | "snapshot" | "error"
>;

export interface ProfitabilityMonth {
  month: string;
  from: string;
  to: string;
  status: "ready" | "loading" | "error";
  snapshot: ProfitabilitySnapshot | null;
  error?: string;
}

interface OdooReportOptions {
  companies?: { id: number; name: string }[];
  date?: Record<string, unknown>;
  comparison?: Record<string, unknown>;
  all_entries?: boolean;
  unfold_all?: boolean;
  unfolded_lines?: unknown[];
  [key: string]: unknown;
}

interface OdooReportLine {
  id?: string;
  name?: string;
  level?: number;
  columns?: { name?: string; no_format?: number | string | null; currency_symbol?: string | null }[];
}

interface OdooReportInformation {
  lines?: OdooReportLine[];
}

const REPORT_ID = Number(process.env.ODOO_PNL_REPORT_ID || 11);
const TTL = 30 * 60 * 1000;
const cache = new Map<string, { value: ProfitabilitySnapshot; expiresAt: number }>();
const running = new Map<string, Promise<ProfitabilitySnapshot>>();
const monthlyCache = new Map<string, { value: ProfitabilitySnapshot; expiresAt: number }>();
const monthlyErrors = new Map<string, string>();
const monthlyRunning = new Map<string, Promise<void>>();

const clean = (value: string): string =>
  value
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const valueOf = (line: OdooReportLine): number | null => {
  for (const column of [...(line.columns ?? [])].reverse()) {
    if (column.no_format === null || column.no_format === undefined) continue;
    const value = Number(column.no_format);
    if (Number.isFinite(value)) return value;
  }
  return null;
};

const findLine = (lines: ProfitabilityLine[], label: string): number | null => {
  const wanted = clean(label);
  const exact = lines.find((line) => clean(line.label) === wanted);
  return exact?.value ?? null;
};

function monthWindows(
  from: string,
  to: string,
  company?: string,
  fxRate: number = DEFAULT_FX_RATES.SAR,
) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || start > end)
    return [];
  const windows: { month: string; from: string; to: string; key: string }[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    const monthEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    const windowFrom = monthStart < from ? from : monthStart;
    const windowTo = monthEnd > to ? to : monthEnd;
    const label = `${year}-${String(month + 1).padStart(2, "0")}`;
    windows.push({
      month: label,
      from: windowFrom,
      to: windowTo,
      key: `${windowFrom}|${windowTo}|${company || "all"}|${fxRate}`,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return windows;
}

function startMonthlyRefresh(
  key: string,
  from: string,
  to: string,
  company?: string,
  fxRate: number = DEFAULT_FX_RATES.SAR,
) {
  let job = monthlyRunning.get(key);
  if (job) return job;
  const windows = monthWindows(from, to, company, fxRate);
  job = (async () => {
    // Bound concurrency so a 12-month view does not flood the accounting server.
    for (let index = 0; index < windows.length; index += 2) {
      await Promise.all(
        windows.slice(index, index + 2).map(async (window) => {
          const cachedMonth = monthlyCache.get(window.key);
          if (cachedMonth && cachedMonth.expiresAt > Date.now()) return;
          try {
            // Monthly trend cards only need report totals. The selected month
            // requests its account rows separately when opened.
            const snapshot = await fetchProfitability(
              window.from,
              window.to,
              company,
              fxRate,
              false,
            );
            monthlyCache.set(window.key, { value: snapshot, expiresAt: Date.now() + TTL });
            monthlyErrors.delete(window.key);
          } catch (error) {
            monthlyErrors.set(window.key, error instanceof Error ? error.message : String(error));
          }
        }),
      );
    }
  })().finally(() => monthlyRunning.delete(key));
  monthlyRunning.set(key, job);
  return job;
}

function monthlyState(
  from: string,
  to: string,
  company?: string,
  fxRate: number = DEFAULT_FX_RATES.SAR,
): Pick<ProfitabilityResult, "monthly" | "monthlyStatus"> {
  const monthly = monthWindows(from, to, company, fxRate).map((window): ProfitabilityMonth => {
    const cached = monthlyCache.get(window.key);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        month: window.month,
        from: window.from,
        to: window.to,
        status: "ready",
        snapshot: cached.value,
      };
    }
    const error = monthlyErrors.get(window.key);
    return {
      month: window.month,
      from: window.from,
      to: window.to,
      status: error ? "error" : "loading",
      snapshot: null,
      ...(error ? { error } : {}),
    };
  });
  const monthlyStatus = monthly.every((item) => item.status !== "loading")
    ? monthly.some((item) => item.status === "error")
      ? "error"
      : "ready"
    : "loading";
  return { monthly, monthlyStatus };
}

async function fetchProfitability(
  from: string,
  to: string,
  company?: string,
  _sarPerUsd: number = DEFAULT_FX_RATES.SAR,
  includeDetails = true,
): Promise<ProfitabilitySnapshot> {
  if (!odooConfigured()) throw new Error("Odoo credentials are not configured.");
  const accessibleCompanies = await odooAccessibleCompanies();
  // Odoo renders a multi-company P&L in the first company's currency. The
  // configured companies used to start with EGP, while the dashboard divided
  // that EGP figure by a SAR/USD rate. Put Odoo's USD company first instead;
  // Odoo then performs its own dated conversion, matching the exported report.
  const usdCompany = accessibleCompanies.find((item) => item.currency.toUpperCase() === "USD");
  if (!usdCompany) throw new Error("Odoo Profit and Loss needs an accessible USD company.");
  const accessibleCompanyIds = [
    usdCompany.id,
    ...accessibleCompanies.filter((item) => item.id !== usdCompany.id).map((item) => item.id),
  ];
  const baseContext = companyContext({
    lang: "en_US",
    tz: "Africa/Cairo",
    report_id: REPORT_ID,
    allowed_company_ids: accessibleCompanyIds,
  });

  const initialOptions = await odooCallWithPolicy<OdooReportOptions>(
    "account.report",
    "get_options",
    [REPORT_ID, {}],
    { context: baseContext },
    { attempts: 1, timeoutMs: 45_000 },
  );
  const availableCompanies =
    initialOptions.companies ?? accessibleCompanies.map(({ id, name }) => ({ id, name }));
  const configuredReportIds = odooConfig().pnlCompanyIds;
  const filteredCompanies = company
    ? availableCompanies.filter((item) => clean(item.name) === clean(company))
    : availableCompanies.filter((item) => configuredReportIds.includes(Number(item.id)));
  if (company && !filteredCompanies.length) {
    throw new Error(`Odoo Profit and Loss company was not found: ${company}`);
  }
  if (!company && filteredCompanies.length !== configuredReportIds.length) {
    const availableIds = new Set(availableCompanies.map((item) => Number(item.id)));
    const missingIds = configuredReportIds.filter((id) => !availableIds.has(id));
    throw new Error(
      `Odoo Profit and Loss is missing configured companies: ${missingIds.join(", ") || "unknown"}. The report was stopped to avoid showing partial totals.`,
    );
  }
  const selectedCompanies = [
    ...filteredCompanies.filter((item) => Number(item.id) === usdCompany.id),
    ...filteredCompanies.filter((item) => Number(item.id) !== usdCompany.id),
  ];
  if (!company && !selectedCompanies.some((item) => Number(item.id) === usdCompany.id)) {
    throw new Error("The configured Profit and Loss companies must include the USD company.");
  }
  // `get_options()` builds the report's column groups. Mutating only
  // `options.date` afterwards leaves each column's `forced_options.date` on
  // Odoo's default fiscal year, so the UI says "custom range" while the
  // figures are actually year-to-date. Feed the desired range back through
  // Odoo once so it rebuilds the columns and computes the exact P&L itself.
  const getReport = async (companies: { id: number; name: string }[]) => {
    const reportContext = companyContext({
      lang: "en_US",
      tz: "Africa/Cairo",
      report_id: REPORT_ID,
      allowed_company_ids: companies.map((item) => Number(item.id)),
    });
    const previousOptions: OdooReportOptions = {
      ...initialOptions,
      companies,
      date: {
        ...(initialOptions.date ?? {}),
        string: `${from} - ${to}`,
        period_type: "custom",
        mode: "range",
        date_from: from,
        date_to: to,
        filter: "custom",
      },
      comparison: {
        ...(initialOptions.comparison ?? {}),
        filter: "no_comparison",
        date_from: from,
        date_to: to,
        periods: [],
      },
      all_entries: false,
      unfold_all: includeDetails,
      unfolded_lines: [],
    };
    const options = await odooCallWithPolicy<OdooReportOptions>(
      "account.report",
      "get_options",
      [REPORT_ID, previousOptions],
      { context: reportContext },
      { attempts: 1, timeoutMs: 45_000 },
    );
    // get_options may rebuild its own fold state. Expand the final options too.
    const expandedOptions = { ...options, unfold_all: includeDetails, unfolded_lines: [] };
    return odooCallWithPolicy<OdooReportInformation>(
      "account.report",
      "get_report_information",
      [REPORT_ID, expandedOptions],
      { context: reportContext },
      { attempts: 1, timeoutMs: 240_000 },
    );
  };

  // A company filter still needs USD output. Odoo insists on all context
  // companies being selected, so compute that company's exact contribution as
  // (USD + company) minus (USD alone), both converted by Odoo itself.
  const needsCompanyDifference = company && Number(selectedCompanies[0].id) !== usdCompany.id;
  const usdSelection = availableCompanies.filter((item) => Number(item.id) === usdCompany.id);
  const reportSelection = needsCompanyDifference
    ? [...usdSelection, ...selectedCompanies]
    : selectedCompanies;
  const [report, usdOnlyReport] = await Promise.all([
    getReport(reportSelection),
    needsCompanyDifference ? getReport(usdSelection) : Promise.resolve(null),
  ]);
  const usdBase = new Map(
    (usdOnlyReport?.lines ?? []).map((line) => [String(line.id || line.name || ""), valueOf(line) ?? 0]),
  );
  const lines = (report.lines ?? [])
    .map((line): ProfitabilityLine | null => {
      const value = valueOf(line);
      if (value === null) return null;
      const symbol = line.columns?.find((column) => column.no_format != null)?.currency_symbol;
      if (symbol && symbol !== "$") {
        throw new Error(`Odoo Profit and Loss returned ${symbol} instead of USD; report stopped to prevent incorrect figures.`);
      }
      const id = String(line.id || line.name || "");
      return {
        id,
        label: String(line.name || "—"),
        value: value - (usdOnlyReport ? (usdBase.get(id) ?? 0) : 0),
        level: Number(line.level || 0),
      };
    })
    .filter((line): line is ProfitabilityLine => line !== null);

  return {
    from,
    to,
    currency: "USD",
    sourceCurrency: "USD",
    fxRate: 1,
    reportId: REPORT_ID,
    postedOnly: true,
    companies: selectedCompanies.map((company) => ({
      id: Number(company.id),
      name: String(company.name),
    })),
    netProfit: findLine(lines, "Net Profit"),
    income: findLine(lines, "Income"),
    grossProfit: findLine(lines, "Gross Profit"),
    operatingIncome: findLine(lines, "Operating Income"),
    otherIncome: findLine(lines, "Other Income"),
    costOfRevenue: findLine(lines, "Cost of Revenue"),
    expenses: findLine(lines, "Expenses"),
    depreciation: findLine(lines, "Depreciation"),
    lines,
    fetchedAt: new Date().toISOString(),
  };
}

function startRefresh(
  key: string,
  from: string,
  to: string,
  company?: string,
  fxSar: number = DEFAULT_FX_RATES.SAR,
): Promise<ProfitabilitySnapshot> {
  let job = running.get(key);
  if (job) return job;
  job = fetchProfitability(from, to, company, fxSar)
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + TTL });
      return value;
    })
    .finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

/** One expanded month, without launching the full-range monthly background job. */
export async function getProfitabilitySnapshot(
  from: string,
  to: string,
  company?: string,
  fxSar: number = DEFAULT_FX_RATES.SAR,
): Promise<ProfitabilitySnapshotResult> {
  const key = `${from}|${to}|${company || "all-configured-companies"}|${fxSar}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { status: "ready", snapshot: cached.value };
  const refresh = startRefresh(key, from, to, company, fxSar);
  if (cached) return { status: "refreshing", snapshot: cached.value };
  try {
    const snapshot = await Promise.race([
      refresh,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
    ]);
    return snapshot ? { status: "ready", snapshot } : { status: "loading", snapshot: null };
  } catch (error) {
    return {
      status: "error",
      snapshot: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getProfitability(
  from: string,
  to: string,
  company?: string,
  fxSar: number = DEFAULT_FX_RATES.SAR,
): Promise<ProfitabilityResult> {
  const key = `${from}|${to}|${company || "all-configured-companies"}|${fxSar}`;
  void startMonthlyRefresh(key, from, to, company, fxSar);
  const months = monthlyState(from, to, company, fxSar);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now())
    return {
      status: "ready",
      snapshot: cached.value,
      ...monthlyState(from, to, company, fxSar),
    };

  const refresh = startRefresh(key, from, to, company, fxSar);
  if (cached) return { status: "refreshing", snapshot: cached.value, ...months };

  try {
    // Do not freeze the whole Accounting page while Odoo builds a heavy report.
    // The request continues in the background and the UI retries on demand.
    const snapshot = await Promise.race([
      refresh,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
    ]);
    if (snapshot) return { status: "ready", snapshot, ...monthlyState(from, to, company, fxSar) };
    return {
      status: "loading",
      snapshot: null,
      ...monthlyState(from, to, company, fxSar),
    };
  } catch (error) {
    return {
      status: "error",
      snapshot: null,
      ...monthlyState(from, to, company, fxSar),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
