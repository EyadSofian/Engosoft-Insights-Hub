import {
  companyContext,
  odooAccessibleCompanies,
  odooCallWithPolicy,
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
  columns?: { name?: string; no_format?: number | string | null }[];
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
  sarPerUsd: number = DEFAULT_FX_RATES.SAR,
  includeDetails = true,
): Promise<ProfitabilitySnapshot> {
  if (!odooConfigured()) throw new Error("Odoo credentials are not configured.");
  const accessibleCompanies = await odooAccessibleCompanies();
  const accessibleCompanyIds = accessibleCompanies.map((company) => company.id);
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
  const selectedCompanies = company
    ? availableCompanies.filter((item) => clean(item.name) === clean(company))
    : availableCompanies;
  if (company && !selectedCompanies.length) {
    throw new Error(`Odoo Profit and Loss company was not found: ${company}`);
  }
  const selectedCompanyIds = selectedCompanies.map((item) => Number(item.id));
  const reportContext = companyContext({
    lang: "en_US",
    tz: "Africa/Cairo",
    report_id: REPORT_ID,
    allowed_company_ids: selectedCompanyIds,
  });
  // `get_options()` builds the report's column groups. Mutating only
  // `options.date` afterwards leaves each column's `forced_options.date` on
  // Odoo's default fiscal year, so the UI says "custom range" while the
  // figures are actually year-to-date. Feed the desired range back through
  // Odoo once so it rebuilds the columns and computes the exact P&L itself.
  const previousOptions: OdooReportOptions = {
    ...initialOptions,
    companies: selectedCompanies,
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

  // get_options may rebuild its own fold state. Expand the final options too,
  // otherwise account rows such as office rent disappear below Expenses.
  const expandedOptions = { ...options, unfold_all: includeDetails, unfolded_lines: [] };
  const report = await odooCallWithPolicy<OdooReportInformation>(
    "account.report",
    "get_report_information",
    [REPORT_ID, expandedOptions],
    { context: reportContext },
    // The P&L engine can be slow on this database. It runs in the background;
    // callers time out quickly and then receive the cached result.
    { attempts: 1, timeoutMs: 240_000 },
  );

  const lines = (report.lines ?? [])
    .map((line): ProfitabilityLine | null => {
      const value = valueOf(line);
      if (value === null) return null;
      return {
        id: String(line.id || line.name || ""),
        label: String(line.name || "—"),
        // Odoo's consolidated report is shown in SR; management asked for USD.
        value: value / sarPerUsd,
        level: Number(line.level || 0),
      };
    })
    .filter((line): line is ProfitabilityLine => line !== null);

  return {
    from,
    to,
    currency: "USD",
    sourceCurrency: "SR",
    fxRate: sarPerUsd,
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

export async function getProfitability(
  from: string,
  to: string,
  company?: string,
  fxSar: number = DEFAULT_FX_RATES.SAR,
): Promise<ProfitabilityResult> {
  const key = `${from}|${to}|${company || "all-accessible-odoo-companies"}|${fxSar}`;
  void startMonthlyRefresh(key, from, to, company, fxSar);
  const months = monthlyState(from, to, company, fxSar);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now())
    return { status: "ready", snapshot: cached.value, ...monthlyState(from, to, company, fxSar) };

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
    return { status: "loading", snapshot: null, ...monthlyState(from, to, company, fxSar) };
  } catch (error) {
    return {
      status: "error",
      snapshot: null,
      ...monthlyState(from, to, company, fxSar),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
