/** A report row exactly as the Odoo Profit and Loss API returns it. */
export interface PnlLine {
  id: string;
  label: string;
  value: number;
  level: number;
}

export interface PnlAccountGroup {
  name: string;
  value: number;
  accounts: Array<PnlLine & { code: string }>;
}

const ARABIC_LABELS: Record<string, string> = {
  "Net Profit": "صافي الربح",
  Income: "إجمالي الإيرادات",
  "Gross Profit": "مجمل الربح",
  "Operating Income": "إيرادات النشاط",
  "Other Income": "إيرادات أخرى",
  "Cost of Revenue": "تكلفة الإيرادات",
  Expenses: "المصروفات",
  "Operating Expenses": "مصروفات التشغيل",
  "Other Expenses": "مصروفات أخرى",
  Depreciation: "الإهلاك",
  "Financial Expenses": "مصروفات التمويل",
  "Income Tax": "ضريبة الدخل",
  "Gain On Difference Of Exchange": "أرباح فروق العملة",
  "Loss on Difference on Exchange": "خسائر فروق العملة",
};

export function pnlAccountCode(label: string): string | null {
  return /^\s*(\d{4,12})(?=\s|$)/u.exec(label)?.[1] ?? null;
}

export function pnlDisplayLabel(label: string, lang: "ar" | "en"): string {
  if (lang === "en") return label;
  const code = pnlAccountCode(label);
  const name = code ? label.replace(/^\s*\d{4,12}\s*/u, "").trim() : label.trim();
  const translated = ARABIC_LABELS[name] ?? name;
  const cleanName = translated.replace(/^م\s*[.،]\s*/u, "").replace(/ايجار/gu, "إيجار");
  return code ? `${code} · ${cleanName}` : cleanName;
}

export function pnlAccountName(label: string, lang: "ar" | "en"): string {
  const name = label.replace(/^\s*\d{4,12}\s*/u, "").trim();
  return pnlDisplayLabel(name, lang);
}

/** Use report position, not sign: Odoo shows most expense balances as positive. */
export function pnlAccounts(lines: PnlLine[], section: "income" | "expenses") {
  let activeSection: "income" | "expenses" | null = null;
  return lines.flatMap((line) => {
    const label = line.label.trim();
    if (label === "Income" || label === "Other Income") activeSection = "income";
    if (label === "Cost of Revenue" || label === "Expenses") activeSection = "expenses";
    const code = pnlAccountCode(line.label);
    return code && activeSection === section ? [{ ...line, code }] : [];
  });
}

export function pnlAccountGroups(
  lines: PnlLine[],
  section: "income" | "expenses",
  lang: "ar" | "en",
): PnlAccountGroup[] {
  const groups = new Map<string, PnlAccountGroup>();
  for (const account of pnlAccounts(lines, section)) {
    const name = pnlAccountName(account.label, lang);
    const key = name.normalize("NFKC").toLocaleLowerCase("ar").replace(/\s+/gu, " ").trim();
    const current = groups.get(key) ?? { name, value: 0, accounts: [] };
    current.value += account.value;
    current.accounts.push(account);
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}
