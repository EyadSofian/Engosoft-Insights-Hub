import type { AccountingRow } from "./types";
import { UNATTRIBUTED, detectVariant, normalizeSource } from "./product-taxonomy.ts";
import { accountingBusinessCategory } from "./accounting-category.ts";

export interface AccountingBreakdown {
  key: string;
  label: string;
  quantity: number;
  invoices: number;
  revenueUsd: number;
}

export interface AccountingCourseProduct {
  key: string;
  name: string;
  code: string;
  category: string;
  variantKey: string;
  quantity: number;
  invoices: number;
  lines: number;
  revenueUsd: number;
  averageUnitUsd: number | null;
  sources: AccountingBreakdown[];
  events: AccountingBreakdown[];
  eventStages: AccountingBreakdown[];
}

export interface AccountingCourseFamily {
  familyKey: string;
  family: string;
  category: string;
  quantity: number;
  invoices: number;
  lines: number;
  revenueUsd: number;
  averageUnitUsd: number | null;
  variants: AccountingBreakdown[];
  sources: AccountingBreakdown[];
  events: AccountingBreakdown[];
  eventStages: AccountingBreakdown[];
  products: AccountingCourseProduct[];
}

interface Bucket {
  key: string;
  label: string;
  quantity: number;
  revenueUsd: number;
  invoiceIds: Set<string>;
}

interface ProductBucket extends Bucket {
  name: string;
  code: string;
  category: string;
  variantKey: string;
  lines: number;
  sources: Map<string, Bucket>;
  events: Map<string, Bucket>;
  eventStages: Map<string, Bucket>;
}

interface FamilyBucket extends Bucket {
  familyKey: string;
  family: string;
  category: string;
  lines: number;
  variants: Map<string, Bucket>;
  sources: Map<string, Bucket>;
  events: Map<string, Bucket>;
  eventStages: Map<string, Bucket>;
  products: Map<string, ProductBucket>;
}

function quantity(row: AccountingRow): number {
  const value = Math.abs(Number(row.quantity));
  return Number.isFinite(value) ? value : 0;
}

function addBucket(
  map: Map<string, Bucket>,
  key: string,
  label: string,
  row: AccountingRow,
  qty: number,
) {
  const current = map.get(key) ?? {
    key,
    label,
    quantity: 0,
    revenueUsd: 0,
    invoiceIds: new Set<string>(),
  };
  current.quantity += qty;
  current.revenueUsd += row.usdPaid;
  if (row.movement && !row.isCreditNote) current.invoiceIds.add(row.movement);
  map.set(key, current);
}

function breakdown(map: Map<string, Bucket>): AccountingBreakdown[] {
  return [...map.values()]
    .map((item) => ({
      key: item.key,
      label: item.label,
      quantity: item.quantity,
      invoices: item.invoiceIds.size,
      revenueUsd: item.revenueUsd,
    }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.quantity - a.quantity);
}

/**
 * Builds the paid-invoice Product Category explorer.
 *
 * The top level follows the finance workbook's category names while every raw
 * Odoo product remains visible inside its category. Marketing source stays a
 * separate breakdown and never changes category or modality.
 */
export function buildAccountingCourses(rows: AccountingRow[]) {
  const descriptors = rows.map((row) => {
    const variantKey = detectVariant(
      [row.product, row.event, row.eventStage].filter(Boolean).join(" "),
      row.productCategory,
    );
    const rawCategory = row.productCategory || row.category || row.mainCategory;
    return {
      row,
      variantKey,
      rawCategory,
      businessCategory: accountingBusinessCategory(rawCategory),
    };
  });

  const families = new Map<string, FamilyBucket>();
  const allVariants = new Map<string, Bucket>();
  const allSources = new Map<string, Bucket>();

  for (const { row, variantKey, rawCategory, businessCategory } of descriptors) {
    const familyKey = businessCategory.key;
    const family = businessCategory.label;
    const qty = quantity(row);
    const invoiceId = row.movement;
    const source = normalizeSource(row.source);
    const sourceKey = source.key || UNATTRIBUTED;
    const sourceName = source.label;
    const category = rawCategory;
    const productKey = `${row.productCode}\u001f${row.product}\u001f${category}`;

    const familyBucket = families.get(familyKey) ?? {
      key: familyKey,
      label: family,
      familyKey,
      family,
      category: family,
      quantity: 0,
      revenueUsd: 0,
      invoiceIds: new Set<string>(),
      lines: 0,
      variants: new Map<string, Bucket>(),
      sources: new Map<string, Bucket>(),
      events: new Map<string, Bucket>(),
      eventStages: new Map<string, Bucket>(),
      products: new Map<string, ProductBucket>(),
    };
    familyBucket.quantity += qty;
    familyBucket.revenueUsd += row.usdPaid;
    familyBucket.lines += 1;
    if (invoiceId && !row.isCreditNote) familyBucket.invoiceIds.add(invoiceId);
    if (!familyBucket.category) familyBucket.category = family;

    addBucket(familyBucket.variants, variantKey, variantKey, row, qty);
    addBucket(familyBucket.sources, sourceKey, sourceName, row, qty);
    addBucket(allVariants, variantKey, variantKey, row, qty);
    addBucket(allSources, sourceKey, sourceName, row, qty);
    if (row.event) addBucket(familyBucket.events, row.event, row.event, row, qty);
    if (row.eventStage)
      addBucket(familyBucket.eventStages, row.eventStage, row.eventStage, row, qty);

    const product = familyBucket.products.get(productKey) ?? {
      key: productKey,
      label: row.product || "Unclassified",
      name: row.product || "Unclassified",
      code: row.productCode,
      category,
      variantKey,
      quantity: 0,
      revenueUsd: 0,
      invoiceIds: new Set<string>(),
      lines: 0,
      sources: new Map<string, Bucket>(),
      events: new Map<string, Bucket>(),
      eventStages: new Map<string, Bucket>(),
    };
    product.quantity += qty;
    product.revenueUsd += row.usdPaid;
    product.lines += 1;
    if (invoiceId && !row.isCreditNote) product.invoiceIds.add(invoiceId);
    addBucket(product.sources, sourceKey, sourceName, row, qty);
    if (row.event) addBucket(product.events, row.event, row.event, row, qty);
    if (row.eventStage) addBucket(product.eventStages, row.eventStage, row.eventStage, row, qty);
    familyBucket.products.set(productKey, product);
    families.set(familyKey, familyBucket);
  }

  const familyRows: AccountingCourseFamily[] = [...families.values()]
    .map((family) => ({
      familyKey: family.familyKey,
      family: family.family,
      category: family.category,
      quantity: family.quantity,
      invoices: family.invoiceIds.size,
      lines: family.lines,
      revenueUsd: family.revenueUsd,
      averageUnitUsd: family.quantity > 0 ? family.revenueUsd / family.quantity : null,
      variants: breakdown(family.variants),
      sources: breakdown(family.sources),
      events: breakdown(family.events),
      eventStages: breakdown(family.eventStages),
      products: [...family.products.values()]
        .map((product) => ({
          key: product.key,
          name: product.name,
          code: product.code,
          category: product.category,
          variantKey: product.variantKey,
          quantity: product.quantity,
          invoices: product.invoiceIds.size,
          lines: product.lines,
          revenueUsd: product.revenueUsd,
          averageUnitUsd: product.quantity > 0 ? product.revenueUsd / product.quantity : null,
          sources: breakdown(product.sources),
          events: breakdown(product.events),
          eventStages: breakdown(product.eventStages),
        }))
        .sort((a, b) => b.revenueUsd - a.revenueUsd || b.quantity - a.quantity),
    }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd || b.quantity - a.quantity);

  return {
    families: familyRows,
    variants: breakdown(allVariants),
    sources: breakdown(allSources),
    summary: {
      families: familyRows.length,
      products: familyRows.reduce((sum, family) => sum + family.products.length, 0),
      quantity: familyRows.reduce((sum, family) => sum + family.quantity, 0),
      quantityAvailable: rows.some((row) => Math.abs(row.quantity) > 0),
      invoices: new Set(
        rows
          .filter((row) => !row.isCreditNote)
          .map((row) => row.movement)
          .filter(Boolean),
      ).size,
      revenueUsd: familyRows.reduce((sum, family) => sum + family.revenueUsd, 0),
      withoutSourceRevenue:
        breakdown(allSources).find((source) => source.key === UNATTRIBUTED)?.revenueUsd ?? 0,
    },
  };
}
