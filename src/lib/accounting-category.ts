export interface AccountingBusinessCategory {
  key: string;
  label: string;
}

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ");

const RULES: Array<AccountingBusinessCategory & { test: RegExp }> = [
  { key: "cfm", label: "CFM", test: /\bfacility\s+management\b/i },
  { key: "cmrp", label: "CMRP", test: /\bmaintenance\b/i },
  { key: "automotive", label: "Automotive Mechanical & Electrical", test: /\bautomotive\b/i },
  { key: "digital-marketing", label: "Digital Marketing", test: /\bmarketing\b/i },
  { key: "company-platform-renewal", label: "Company - Platform Renewal", test: /\bwebsite\b/i },
  { key: "interior", label: "Interior", test: /\binterior\b/i },
  { key: "management", label: "Management", test: /\bmanagement\b|\bsafety\b/i },
  { key: "architecture", label: "Architecture", test: /\barchitecture\b/i },
  { key: "electrical", label: "Electrical", test: /\belectrical\b/i },
  { key: "mechanical", label: "Mechanical", test: /\bmechanical\b/i },
  { key: "civil", label: "Civil", test: /\bcivil\b|\bstructure\b|\binfrastructure\b/i },
  { key: "certificate", label: "Certificate", test: /\bcertificate\b/i },
  { key: "technology", label: "Technology", test: /\btechnology\b/i },
  { key: "english", label: "English", test: /\benglish\b/i },
  { key: "bim", label: "BIM", test: /\bbim\b/i },
  {
    key: "payment-method",
    label: "revenue / Miscellaneous / payment method",
    test: /\bpayment\s+method\b/i,
  },
  { key: "deliveries", label: "All / Deliveries", test: /\bdeliver(?:y|ies)\b/i },
  {
    key: "other-revenue",
    label: "Other Revenue",
    test: /\bprivate\b|\bother\s+revenue\b|\bdiscount\b/i,
  },
];

/**
 * Converts Odoo's full Product Category path to the business category names
 * used in the finance workbook. The grouping is deliberately category-led:
 * product wording and marketing source never decide the category.
 */
export function accountingBusinessCategory(raw: string): AccountingBusinessCategory {
  const value = normalize(raw);
  if (!value) return { key: "unclassified", label: "Unclassified" };
  for (const rule of RULES) {
    if (rule.test.test(value)) return { key: rule.key, label: rule.label };
  }

  const leaf = raw
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  const label = leaf || raw.trim() || "Unclassified";
  return { key: `raw:${normalize(label)}`, label };
}
