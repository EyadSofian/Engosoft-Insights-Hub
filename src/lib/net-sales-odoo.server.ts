import {
  companyContext,
  m2oId,
  odooAccessibleCompanies,
  odooCallWithPolicy,
  odooConfig,
  searchRead,
  type M2O,
} from "./odoo.server";
import type { NetSalesKind, NetSalesLedgerGroup } from "./net-sales";

interface OdooAccount {
  id: number;
  code: string;
  name: string;
  account_type: string;
}

interface OdooGroupedLine {
  balance: number;
  __count?: number;
  account_id_count?: number;
  account_id: M2O;
  company_id: M2O;
  "date:month"?: string;
  __range?: Record<string, { from?: string; to?: string }>;
}

const GATEWAY_ACCOUNT = "5121807";
const VAT_ACCOUNTS = new Set(["2131006", "2131007"]);
const ROUNDING_ACCOUNTS = new Set(["40000016", "40000017"]);
const EXCLUDED_CERTIFICATE_PRODUCT_ID = 246;

function kindFor(account: OdooAccount): NetSalesKind | null {
  if (account.code === GATEWAY_ACCOUNT) return "gatewayFees";
  if (VAT_ACCOUNTS.has(account.code)) return "outputVat";
  if (ROUNDING_ACCOUNTS.has(account.code)) return "rounding";
  if (account.account_type === "income") return "sales";
  if (account.account_type === "income_other") return "otherIncome";
  return null;
}

function monthFromGroup(row: OdooGroupedLine): string {
  const start = row.__range?.["date:month"]?.from ?? row.__range?.date?.from;
  if (start && /^\d{4}-\d{2}/.test(start)) return start.slice(0, 7);
  const label = row["date:month"];
  if (label && /^\d{4}-\d{2}/.test(label)) return label.slice(0, 7);
  throw new Error(`Odoo did not return the grouped accounting month (${label ?? "missing"}).`);
}

export async function loadNetSalesLedger(
  from: string,
  to: string,
  companyName?: string,
  scope: "report" | "all" = "report",
): Promise<{
  rows: NetSalesLedgerGroup[];
  companies: string[];
  accountCodes: { sales: string[]; gateway: string[]; vat: string[]; rounding: string[] };
}> {
  const allowed = new Set(odooConfig().companyIds);
  const accessible = (await odooAccessibleCompanies()).filter((company) => allowed.has(company.id));
  const companies = companyName
    ? accessible.filter(
        (company) => company.name.trim().toLowerCase() === companyName.trim().toLowerCase(),
      )
    : scope === "report"
      ? accessible.filter((company) =>
          ["Egypt - Engoaad", "Engosoft - KSA"].includes(company.name.trim()),
        )
      : accessible;
  if (!companies.length) {
    throw new Error(
      companyName
        ? `Odoo company not found in the accounting scope: ${companyName}`
        : "No accessible accounting companies in Odoo.",
    );
  }
  const companyIds = companies.map((company) => company.id);
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const currencies = await searchRead<{ id: number; name: string }>(
    "res.currency",
    [["id", "in", companies.map((company) => company.currencyId)]],
    ["id", "name"],
    { context: companyContext({ allowed_company_ids: companyIds }) },
  );
  const currencyById = new Map(currencies.map((currency) => [currency.id, currency.name]));
  const accounts = await searchRead<OdooAccount>(
    "account.account",
    [
      "|",
      ["account_type", "in", ["income", "income_other"]],
      ["code", "in", [GATEWAY_ACCOUNT, ...VAT_ACCOUNTS, ...ROUNDING_ACCOUNTS]],
    ],
    ["id", "code", "name", "account_type"],
    { context: companyContext({ allowed_company_ids: companyIds }) },
  );
  const selected = accounts.filter((account) => kindFor(account));
  if (!selected.some((account) => kindFor(account) === "sales")) {
    throw new Error("No operating sales accounts were found in the selected Odoo companies.");
  }
  if (!selected.some((account) => kindFor(account) === "gatewayFees")) {
    throw new Error(
      `Collection-fee account ${GATEWAY_ACCOUNT} was not found in the selected Odoo companies; net sales cannot be verified.`,
    );
  }
  const byId = new Map(selected.map((account) => [account.id, account]));
  const idsByKind = (kind: NetSalesKind) =>
    selected.filter((account) => kindFor(account) === kind).map((account) => account.id);
  const baseDomain: unknown[] = [
    ["parent_state", "=", "posted"],
    ["company_id", "in", companyIds],
    ["date", ">=", from],
    ["date", "<=", to],
  ];

  async function grouped(kind: NetSalesKind, productFilter?: [string, string, number]) {
    const accountIds = idsByKind(kind === "certificate" ? "sales" : kind);
    if (!accountIds.length) return [];
    const domain = [
      ...baseDomain,
      ["account_id", "in", accountIds],
      ...(kind === "outputVat" ? [["move_id.move_type", "in", ["out_invoice", "out_refund"]]] : []),
      ...(productFilter ? [productFilter] : []),
    ];
    const values = await odooCallWithPolicy<OdooGroupedLine[]>(
      "account.move.line",
      "read_group",
      [domain, ["balance:sum"], ["date:month", "company_id", "account_id"]],
      { lazy: false, limit: 10000, context: companyContext({ allowed_company_ids: companyIds }) },
      { attempts: 2, timeoutMs: 45_000 },
    );
    if (values.length >= 10000)
      throw new Error(
        "Odoo accounting aggregation reached its safety limit; narrow the reporting period.",
      );
    return values.map((value) => {
      const account = byId.get(m2oId(value.account_id));
      const company = companyById.get(m2oId(value.company_id));
      if (!account || !company)
        throw new Error("Odoo returned a ledger group outside the selected accounting scope.");
      return {
        month: monthFromGroup(value),
        company: company.name,
        currency: currencyById.get(company.currencyId) || company.currency,
        accountCode: account.code,
        accountName: account.name,
        kind,
        balance: Number(value.balance) || 0,
        count: Number(value.__count ?? value.account_id_count) || 0,
      } satisfies NetSalesLedgerGroup;
    });
  }

  const [sales, certificate, otherIncome, gatewayFees, outputVat, rounding] = await Promise.all([
    grouped("sales", ["product_id", "!=", EXCLUDED_CERTIFICATE_PRODUCT_ID]),
    grouped("certificate", ["product_id", "=", EXCLUDED_CERTIFICATE_PRODUCT_ID]),
    grouped("otherIncome"),
    grouped("gatewayFees"),
    grouped("outputVat"),
    grouped("rounding"),
  ]);

  return {
    rows: [...sales, ...certificate, ...otherIncome, ...gatewayFees, ...outputVat, ...rounding],
    companies: companies.map((company) => company.name),
    accountCodes: {
      sales: selected
        .filter((account) => kindFor(account) === "sales")
        .map((account) => account.code),
      gateway: selected
        .filter((account) => kindFor(account) === "gatewayFees")
        .map((account) => account.code),
      vat: selected
        .filter((account) => kindFor(account) === "outputVat")
        .map((account) => account.code),
      rounding: selected
        .filter((account) => kindFor(account) === "rounding")
        .map((account) => account.code),
    },
  };
}
