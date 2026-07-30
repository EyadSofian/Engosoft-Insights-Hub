import {
  companyContext,
  odooCallWithPolicy,
  odooConfig,
  odooConfigured,
} from "./odoo.server";

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

async function fetchProfitability(
  from: string,
  to: string,
  company?: string,
): Promise<ProfitabilitySnapshot> {
  if (!odooConfigured()) throw new Error("Odoo credentials are not configured.");
  const cfg = odooConfig();
  const baseContext = companyContext({
    lang: "en_US",
    tz: "Africa/Cairo",
    report_id: REPORT_ID,
  });

  const options = await odooCallWithPolicy<OdooReportOptions>(
    "account.report",
    "get_options",
    [REPORT_ID, {}],
    { context: baseContext },
    { attempts: 1, timeoutMs: 45_000 },
  );
  const availableCompanies =
    options.companies ?? cfg.companyIds.map((id) => ({ id, name: String(id) }));
  const selectedCompanies = company
    ? availableCompanies.filter((item) => clean(item.name) === clean(company))
    : availableCompanies;
  if (company && !selectedCompanies.length) {
    throw new Error(`Odoo Profit and Loss company was not found: ${company}`);
  }
  const selectedCompanyIds = selectedCompanies.map((item) => Number(item.id));
  options.companies = selectedCompanies;
  const reportContext = companyContext({
    lang: "en_US",
    tz: "Africa/Cairo",
    report_id: REPORT_ID,
    allowed_company_ids: selectedCompanyIds,
  });
  options.date = {
    ...(options.date ?? {}),
    string: `${from} - ${to}`,
    period_type: "custom",
    mode: "range",
    date_from: from,
    date_to: to,
    filter: "custom",
  };
  options.comparison = {
    ...(options.comparison ?? {}),
    filter: "no_comparison",
    date_from: from,
    date_to: to,
    periods: [],
  };
  options.all_entries = false;
  options.unfold_all = false;
  options.unfolded_lines = [];

  const report = await odooCallWithPolicy<OdooReportInformation>(
    "account.report",
    "get_report_information",
    [REPORT_ID, options],
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
        value,
        level: Number(line.level || 0),
      };
    })
    .filter((line): line is ProfitabilityLine => line !== null);

  return {
    from,
    to,
    currency: "LE",
    reportId: REPORT_ID,
    postedOnly: true,
    companies: selectedCompanies.map(
      (company) => ({ id: Number(company.id), name: String(company.name) }),
    ),
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
): Promise<ProfitabilitySnapshot> {
  let job = running.get(key);
  if (job) return job;
  job = fetchProfitability(from, to, company)
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
): Promise<ProfitabilityResult> {
  const key = `${from}|${to}|${company || odooConfig().companyIds.join(",")}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { status: "ready", snapshot: cached.value };

  const refresh = startRefresh(key, from, to, company);
  if (cached) return { status: "refreshing", snapshot: cached.value };

  try {
    // Do not freeze the whole Accounting page while Odoo builds a heavy report.
    // The request continues in the background and the UI retries on demand.
    const snapshot = await Promise.race([
      refresh,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
    ]);
    if (snapshot) return { status: "ready", snapshot };
    return { status: "loading", snapshot: null };
  } catch (error) {
    return {
      status: "error",
      snapshot: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
