import {
  companyContext,
  m2oId,
  m2oName,
  odooAccessibleCompanies,
  odooCallWithPolicy,
  odooConfigured,
  type M2O,
} from "./odoo.server";

interface OdooMoveLine {
  id: number;
  date: string;
  name: string;
  ref: string | false;
  debit: number;
  credit: number;
  balance: number;
  company_id: M2O;
  partner_id: M2O;
  move_id: M2O;
}

export interface ProfitabilityLedger {
  accountCode: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  total: number;
  accounts: { id: number; code: string; name: string }[];
  rows: {
    id: number;
    date: string;
    description: string;
    reference: string;
    debit: number;
    credit: number;
    balance: number;
    company: string;
    companyCurrency: string;
    partner: string;
    moveName: string;
    moveId: number;
  }[];
}

const PAGE_SIZE = 40;
const cache = new Map<string, { value: ProfitabilityLedger; expiresAt: number }>();

export async function getProfitabilityLedger(
  accountCode: string,
  from: string,
  to: string,
  companyName?: string,
  page = 1,
): Promise<ProfitabilityLedger> {
  if (!odooConfigured()) throw new Error("Odoo credentials are not configured.");
  if (!/^\d{4,12}$/u.test(accountCode)) throw new Error("Invalid account code.");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(from) || !/^\d{4}-\d{2}-\d{2}$/u.test(to) || from > to)
    throw new Error("Invalid accounting period.");
  const safePage = Math.max(1, Math.min(1000, Math.trunc(page) || 1));
  const key = `${accountCode}|${from}|${to}|${companyName || "all"}|${safePage}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const accessible = await odooAccessibleCompanies();
  const selected = companyName
    ? accessible.filter(
        (item) => item.name.trim().toLowerCase() === companyName.trim().toLowerCase(),
      )
    : accessible;
  if (!selected.length) throw new Error("Odoo accounting company was not found.");
  const companyIds = selected.map((item) => item.id);
  const byCompanyId = new Map(selected.map((item) => [item.id, item]));
  const context = companyContext({ allowed_company_ids: companyIds, lang: "en_US" });
  const accounts = await odooCallWithPolicy<Array<{ id: number; code: string; name: string }>>(
    "account.account",
    "search_read",
    [[["code", "=", accountCode]], ["id", "code", "name"]],
    { context, limit: 100 },
    { attempts: 1, timeoutMs: 45_000 },
  );
  if (!accounts.length) throw new Error(`Account ${accountCode} is not available in Odoo.`);
  const domain = [
    ["parent_state", "=", "posted"],
    ["account_id", "in", accounts.map((account) => account.id)],
    ["company_id", "in", companyIds],
    ["date", ">=", from],
    ["date", "<=", to],
  ];
  const [total, entries] = await Promise.all([
    odooCallWithPolicy<number>(
      "account.move.line",
      "search_count",
      [domain],
      { context },
      { attempts: 1, timeoutMs: 45_000 },
    ),
    odooCallWithPolicy<OdooMoveLine[]>(
      "account.move.line",
      "search_read",
      [
        domain,
        [
          "id",
          "date",
          "name",
          "ref",
          "debit",
          "credit",
          "balance",
          "company_id",
          "partner_id",
          "move_id",
        ],
      ],
      {
        context,
        order: "date desc, id desc",
        limit: PAGE_SIZE,
        offset: (safePage - 1) * PAGE_SIZE,
      },
      { attempts: 1, timeoutMs: 60_000 },
    ),
  ]);
  const result: ProfitabilityLedger = {
    accountCode,
    from,
    to,
    page: safePage,
    pageSize: PAGE_SIZE,
    total,
    accounts,
    rows: entries.map((entry) => {
      const company = byCompanyId.get(m2oId(entry.company_id));
      return {
        id: entry.id,
        date: entry.date,
        description: entry.name || "—",
        reference: typeof entry.ref === "string" ? entry.ref : "",
        debit: Number(entry.debit) || 0,
        credit: Number(entry.credit) || 0,
        balance: Number(entry.balance) || 0,
        company: company?.name || m2oName(entry.company_id),
        companyCurrency: company?.currency || "",
        partner: m2oName(entry.partner_id),
        moveName: m2oName(entry.move_id),
        moveId: m2oId(entry.move_id),
      };
    }),
  };
  cache.set(key, { value: result, expiresAt: Date.now() + 5 * 60_000 });
  return result;
}
