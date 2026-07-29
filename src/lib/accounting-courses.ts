import type { AccountingRow } from "./types";
import {
  UNATTRIBUTED,
  buildDepartmentMatcher,
  buildFamilyAliases,
  deriveFamily,
  detectVariant,
  normalizeSource,
} from "./product-taxonomy";

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

const UNCLASSIFIED = "__unclassified__";

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
  if (row.movement) current.invoiceIds.add(row.movement);
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
 * Builds the paid-invoice course explorer.
 *
 * Course and modality come only from the product/category/event dimensions.
 * Marketing source is a separate breakdown, so a missing source can never turn
 * a Recorded or Event product into an unclassified course.
 */
export function buildAccountingCourses(rows: AccountingRow[]) {
  const department = buildDepartmentMatcher(rows.map((row) => row.productCategory).filter(Boolean));
  const descriptors = rows.map((row) => {
    const variantKey = detectVariant(
      [row.product, row.event, row.eventStage].filter(Boolean).join(" "),
      row.productCategory,
    );
    const derived = row.product
      ? deriveFamily(row.product, department, variantKey)
      : { key: UNCLASSIFIED, label: "Unclassified" };
    return { row, variantKey, derived };
  });

  const aliases = buildFamilyAliases(descriptors.map(({ derived }) => derived));
  const familyLabels = new Map(descriptors.map(({ derived }) => [derived.key, derived.label]));
  const families = new Map<string, FamilyBucket>();
  const allVariants = new Map<string, Bucket>();
  const allSources = new Map<string, Bucket>();

  for (const { row, variantKey, derived } of descriptors) {
    const familyKey = aliases.get(derived.key) ?? derived.key;
    const family = familyLabels.get(familyKey) ?? derived.label;
    const qty = quantity(row);
    const invoiceId = row.movement;
    const source = normalizeSource(row.source);
    const sourceKey = source.key || UNATTRIBUTED;
    const sourceName = source.label;
    const category = row.productCategory || row.mainCategory || "";
    const productKey = `${row.productCode}\u001f${row.product}\u001f${category}`;

    const familyBucket = families.get(familyKey) ?? {
      key: familyKey,
      label: family,
      familyKey,
      family,
      category,
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
    if (invoiceId) familyBucket.invoiceIds.add(invoiceId);
    if (!familyBucket.category && category) familyBucket.category = category;

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
    if (invoiceId) product.invoiceIds.add(invoiceId);
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
      invoices: new Set(rows.map((row) => row.movement).filter(Boolean)).size,
      revenueUsd: familyRows.reduce((sum, family) => sum + family.revenueUsd, 0),
      withoutSourceRevenue:
        breakdown(allSources).find((source) => source.key === UNATTRIBUTED)?.revenueUsd ?? 0,
    },
  };
}
