import type { FxRates } from "./fx-rates";

export type NetSalesKind =
  "sales" | "certificate" | "otherIncome" | "gatewayFees" | "outputVat" | "rounding";

export interface NetSalesLedgerGroup {
  month: string;
  company: string;
  currency: string;
  accountCode: string;
  accountName: string;
  kind: NetSalesKind;
  /** Odoo account.move.line.balance: debit minus credit in company currency. */
  balance: number;
  count: number;
}

export interface NetSalesAccountBreakdown {
  code: string;
  name: string;
  amountUsd: number;
  entries: number;
}

export interface NetSalesMonth {
  month: string;
  salesUsd: number;
  certificateUsd: number;
  otherIncomeUsd: number;
  gatewayFeesUsd: number;
  outputVatUsd: number;
  roundingUsd: number;
  netSalesUsd: number;
  accounts: NetSalesAccountBreakdown[];
  companies: { name: string; salesUsd: number; gatewayFeesUsd: number }[];
}

export function companyAmountUsd(balance: number, currency: string, rates: FxRates): number {
  const key = currency.trim().toUpperCase();
  if (key === "USD" || key === "$") return balance;
  if (key === "SAR" || key === "SR") return balance / rates.SAR;
  if (key === "EGP" || key === "LE") return balance / rates.EGP;
  // The UAE dirham is pegged to USD; the central bank's published USD/AED
  // reference is 3.6725. Keep this explicit rather than silently dropping UAE.
  if (key === "AED") return balance / 3.6725;
  throw new Error(`Unsupported Odoo company currency: ${currency || "(blank)"}`);
}

/** Displayed accounting totals reconcile to the cent, including negative refunds. */
export function usdCents(amount: number): number {
  return (Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 100)) / 100;
}

/** A posted income credit is positive revenue; expense and VAT balances retain their signs. */
export function ledgerAmountUsd(group: NetSalesLedgerGroup, rates: FxRates): number {
  const amount = companyAmountUsd(group.balance, group.currency, rates);
  return group.kind === "sales" ||
    group.kind === "certificate" ||
    group.kind === "otherIncome" ||
    group.kind === "outputVat"
    ? -amount
    : amount;
}

export function buildNetSalesMonths(
  groups: NetSalesLedgerGroup[],
  rates: FxRates,
): NetSalesMonth[] {
  const months = new Map<string, NetSalesMonth>();
  const accounts = new Map<string, NetSalesAccountBreakdown>();
  const companies = new Map<string, { name: string; salesUsd: number; gatewayFeesUsd: number }>();

  for (const group of groups) {
    if (!/^\d{4}-\d{2}$/.test(group.month)) continue;
    let month = months.get(group.month);
    if (!month) {
      month = {
        month: group.month,
        salesUsd: 0,
        certificateUsd: 0,
        otherIncomeUsd: 0,
        gatewayFeesUsd: 0,
        outputVatUsd: 0,
        roundingUsd: 0,
        netSalesUsd: 0,
        accounts: [],
        companies: [],
      };
      months.set(group.month, month);
    }
    // Round each account/company/month ledger bucket once. Every drill-down
    // and headline is then summed from the same displayed cents.
    const amount = usdCents(ledgerAmountUsd(group, rates));
    if (group.kind === "sales") month.salesUsd += amount;
    if (group.kind === "certificate") month.certificateUsd += amount;
    if (group.kind === "otherIncome") month.otherIncomeUsd += amount;
    if (group.kind === "gatewayFees") month.gatewayFeesUsd += amount;
    if (group.kind === "outputVat") month.outputVatUsd += amount;
    if (group.kind === "rounding") month.roundingUsd += amount;

    if (group.kind === "sales" || group.kind === "gatewayFees") {
      const accountKey = `${group.month}|${group.company}|${group.kind}|${group.accountCode}`;
      let account = accounts.get(accountKey);
      if (!account) {
        account = { code: group.accountCode, name: group.accountName, amountUsd: 0, entries: 0 };
        accounts.set(accountKey, account);
        month.accounts.push(account);
      }
      account.amountUsd += amount;
      account.entries += group.count;

      const companyKey = `${group.month}|${group.company}`;
      let company = companies.get(companyKey);
      if (!company) {
        company = { name: group.company, salesUsd: 0, gatewayFeesUsd: 0 };
        companies.set(companyKey, company);
        month.companies.push(company);
      }
      if (group.kind === "sales") company.salesUsd += amount;
      else company.gatewayFeesUsd += amount;
    }
  }

  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((month) => {
      const salesUsd = usdCents(month.salesUsd);
      const gatewayFeesUsd = usdCents(month.gatewayFeesUsd);
      return {
        ...month,
        salesUsd,
        certificateUsd: usdCents(month.certificateUsd),
        otherIncomeUsd: usdCents(month.otherIncomeUsd),
        gatewayFeesUsd,
        outputVatUsd: usdCents(month.outputVatUsd),
        roundingUsd: usdCents(month.roundingUsd),
        netSalesUsd: usdCents(salesUsd - gatewayFeesUsd),
        accounts: month.accounts
          .map((account) => ({ ...account, amountUsd: usdCents(account.amountUsd) }))
          .sort((a, b) => Math.abs(b.amountUsd) - Math.abs(a.amountUsd)),
        companies: month.companies
          .map((company) => ({
            ...company,
            salesUsd: usdCents(company.salesUsd),
            gatewayFeesUsd: usdCents(company.gatewayFeesUsd),
          }))
          .sort((a, b) => b.salesUsd - a.salesUsd),
      };
    });
}
