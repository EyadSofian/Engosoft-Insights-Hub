// Turns a price workbook into draft price rules.
//
// The workbook is written by people, for people: three different column
// layouts, section titles typed into the code column, prices written as
// "1750 Taby / 1500 Cash", and an offer deadline of "9/10/2026" that two
// readers will read as two different days. The parser's job is to carry all of
// that across without inventing anything.
//
// Three rules it never breaks:
//
//   * An empty cell, `____`, `Not Available` and `Hold` are not the number 0.
//     They become `null`, and `Hold` additionally suspends the product.
//   * A duplicated product code is kept, not collapsed. The same course really
//     does appear in several packages, sometimes at different floors, and
//     last-write-wins would silently delete one of them.
//   * A package price is never filed as a course price, and free text is never
//     published as a price without a person approving it.
import {
  bareAmount,
  isCompositeCode,
  isHoldToken,
  isNullToken,
  normalizeCourseName,
  normalizeDeliveryType,
  normalizeProductCode,
  parsePricePhrases,
  priceCell,
  readAmbiguousDate,
  text,
  type AmbiguousDate,
} from "./pricing-normalize.ts";
import type { DeliveryType, PriceBookItem, PriceMethodScope } from "./pricing-types.ts";

export interface ParsedSheet {
  name: string;
  rows: (string | number | null)[][];
}

export interface ParseOptions {
  /**
   * Which reading of an ambiguous slash date to apply to offer windows.
   * `unresolved` — the default — leaves offers inactive until a person picks.
   */
  offerDateReading?: "day_first" | "month_first" | "unresolved";
  /** Currency of the unlabelled price columns. */
  baseCurrency?: string;
  /** Currency of the Egyptian-pound column. */
  localCurrency?: string;
}

export interface ParseIssue {
  sheet: string;
  row: number;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  detail: string;
}

export interface DuplicateCode {
  code: string;
  count: number;
  occurrences: { sheet: string; row: number; course: string; deliveryType: DeliveryType }[];
  /** True when the duplicated rows do not agree on their allowed band. */
  conflicting: boolean;
}

export type PriceItemDraft = Omit<PriceBookItem, "id" | "priceBookId">;

export interface ParseResult {
  items: PriceItemDraft[];
  /** Course rows found before any de-duplication — the workbook's own count. */
  sourceRowCount: number;
  /** Rows the parser refused, with a reason each. */
  rejectedRowCount: number;
  duplicateCodes: DuplicateCode[];
  issues: ParseIssue[];
  sheetsSeen: string[];
  offerWindows: { sheet: string; raw: string; dayFirst: string; monthFirst: string }[];
  counts: {
    individual: number;
    bundle: number;
    level: number;
    offer: number;
    incentive: number;
    requiresReview: number;
    onHold: number;
    compositeCodes: number;
  };
}

/* --- column roles ---------------------------------------------------------- */

type GroupRole =
  | "official" // the website price: Tabby + Tamara
  | "cash" // the counter price: Cash + Kasher
  | "level_bundle" // a level/package price sold as one line
  | "bundle_text" // a free-text package price
  | "offer" // a promotional price
  | "local" // the Egyptian-pound column
  | "incentive"; // the staff bonus column

interface ColumnGroup {
  role: GroupRole;
  header: string;
  /** Column indexes belonging to this header, left to right. */
  columns: number[];
  /** Sub-header of each column, when the sheet uses a two-row header. */
  subHeaders: string[];
}

interface SheetLayout {
  headerRow: number;
  subHeaderRow: number;
  firstDataRow: number;
  codeColumn: number;
  courseColumn: number;
  typeColumn: number;
  levelColumn: number;
  groups: ColumnGroup[];
  /** Columns after the last header, used for status notes such as `Hold`. */
  trailingColumns: number[];
}

const cell = (rows: (string | number | null)[][], row: number, column: number): unknown =>
  rows[row]?.[column] ?? null;

const cellText = (rows: (string | number | null)[][], row: number, column: number): string =>
  text(cell(rows, row, column));

function groupRole(header: string): GroupRole | null {
  const raw = header.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  // Order matters: the level-package header also contains the package word.
  if (/للمستوى/.test(raw)) return "level_bundle";
  if (/العروض|offer|promo/i.test(raw)) return "offer";
  if (/بالمصري|المصري|egp|egypt/i.test(raw)) return "local";
  if (/الحافز|المكاف|incentive|bonus/i.test(raw)) return "incentive";
  if (/مجمع|bundle|package/i.test(raw)) return "bundle_text";
  if (/كاش|كاشير|cash|kasher/i.test(raw)) return "cash";
  if (/الرسمي|تابي|تمار|tabby|tamara|official|list/i.test(raw)) return "official";
  return null;
}

const isCodeHeader = (value: string): boolean =>
  /^(code|كود|الكود|رقم المنتج)$/i.test(value.trim());
const isCourseHeader = (value: string): boolean =>
  /^(course|course name|الدورة|اسم الدورة)$/i.test(value.trim());
const isTypeHeader = (value: string): boolean => /^(type|النوع|نوع الدورة)$/i.test(value.trim());
const isLevelHeader = (value: string): boolean => /^(level|المستوى|الباقة)$/i.test(value.trim());

/**
 * Work out where the columns are, rather than hard-coding one sheet's shape.
 *
 * The six course sheets use three different layouts and next month's workbook
 * will use a fourth. Reading the headers means a renamed sheet or an inserted
 * column shows up in the import preview as a changed layout instead of as
 * silently shifted prices.
 */
export function detectLayout(rows: (string | number | null)[][]): SheetLayout | null {
  let headerRow = -1;
  for (let row = 0; row < Math.min(rows.length, 12); row++) {
    if (isCodeHeader(cellText(rows, row, 0))) {
      headerRow = row;
      break;
    }
  }
  if (headerRow < 0) return null;

  const width = Math.max(0, ...rows.slice(headerRow, headerRow + 6).map((row) => row?.length ?? 0));

  // A second header row exists only when it does not start a data row. In the
  // Civil sheet the row below the header is already a section title.
  const nextRowStartsData = cellText(rows, headerRow + 1, 0) !== "";
  const subHeaderRow = nextRowStartsData ? -1 : headerRow + 1;

  let codeColumn = 0;
  let courseColumn = -1;
  let typeColumn = -1;
  let levelColumn = -1;
  // Anchors come from the top header row only. The second row describes columns
  // *inside* a group ("floor", "Cash + Kasher"); treating one of those as a new
  // header splits a ceiling/floor pair into two one-column groups, and then the
  // floor is never read at all.
  const headerAt = (column: number): string => cellText(rows, headerRow, column);

  const anchors: { column: number; header: string }[] = [];
  for (let column = 0; column < width; column++) {
    const header = headerAt(column);
    if (!header) continue;
    if (isCodeHeader(header)) {
      codeColumn = column;
      continue;
    }
    if (isCourseHeader(header)) {
      courseColumn = column;
      continue;
    }
    if (isTypeHeader(header)) {
      typeColumn = column;
      continue;
    }
    if (isLevelHeader(header)) {
      levelColumn = column;
      continue;
    }
    anchors.push({ column, header });
  }
  if (courseColumn < 0) courseColumn = codeColumn + 1;
  if (typeColumn < 0) typeColumn = courseColumn + 1;

  // One exception: a column past the last top-row header whose only label sits
  // in the second row is a group of its own, not part of anything to its left.
  // That is how the staff-incentive column is written.
  const lastAnchor = anchors.length ? anchors[anchors.length - 1].column : typeColumn;
  if (subHeaderRow >= 0) {
    for (let column = lastAnchor + 1; column < width; column++) {
      const label = cellText(rows, subHeaderRow, column);
      if (!label || !groupRole(label)) continue;
      anchors.push({ column, header: label });
    }
  }

  const groups: ColumnGroup[] = [];
  anchors.forEach((anchor, index) => {
    const role = groupRole(anchor.header);
    if (!role) return;
    // A header with nothing to its right would otherwise claim every unused
    // column to the sheet's edge. Four is enough for a ceiling/floor pair or a
    // Tabby/Cash pair, and keeps stray text out of a package cell.
    const end = Math.min(anchors[index + 1]?.column ?? width, anchor.column + 4);
    const columns: number[] = [];
    for (let column = anchor.column; column < end; column++) columns.push(column);
    groups.push({
      role,
      header: anchor.header,
      columns,
      subHeaders: columns.map((column) =>
        subHeaderRow >= 0 ? cellText(rows, subHeaderRow, column) : "",
      ),
    });
  });

  const lastHeaderColumn = anchors.length ? anchors[anchors.length - 1].column + 1 : typeColumn + 1;
  const trailingColumns: number[] = [];
  const covered = new Set(groups.flatMap((group) => group.columns));
  for (let column = lastHeaderColumn; column < width; column++) {
    if (!covered.has(column)) trailingColumns.push(column);
  }

  return {
    headerRow,
    subHeaderRow,
    firstDataRow: (subHeaderRow >= 0 ? subHeaderRow : headerRow) + 1,
    codeColumn,
    courseColumn,
    typeColumn,
    levelColumn,
    groups,
    trailingColumns,
  };
}

/* --- band reading ---------------------------------------------------------- */

interface Band {
  /** Highest published price. `null` when the sheet publishes a single price. */
  maximum: number | null;
  /** Lowest price a seller may agree to. */
  minimum: number | null;
  /** The one published price, when the sheet does not publish a band. */
  exact: number | null;
  onHold: boolean;
  /** True when the columns existed but held a "not sold" marker. */
  suppressed: boolean;
}

const emptyBand = (): Band => ({
  maximum: null,
  minimum: null,
  exact: null,
  onHold: false,
  suppressed: false,
});

const isMaximumLabel = (label: string): boolean => /حد\s*أقصى|max/i.test(label);
const isMinimumLabel = (label: string): boolean => /حد\s*أدنى|min/i.test(label);
const isTabbyLabel = (label: string): boolean => /tabby|taby|tamara|تابي|تمار/i.test(label);
const isCashLabel = (label: string): boolean => /cash|kasher|cashier|كاش|كاشير/i.test(label);

/**
 * Read one price group into a band.
 *
 * Two shapes exist. A ceiling/floor pair publishes both bounds. Every other
 * shape publishes a single price, which is then both the list price and the
 * floor: a course with one published number has no published discount
 * authority, so selling under it is a discount nobody approved.
 */
function readBand(
  rows: (string | number | null)[][],
  row: number,
  group: ColumnGroup,
  wanted: "tabby" | "cash" | "single",
): Band {
  const band = emptyBand();
  const columns = group.columns;

  const values = columns.map((column) => cell(rows, row, column));
  band.onHold = values.some((value) => isHoldToken(value));
  band.suppressed = values.some((value) => text(value) !== "" && isNullToken(value));

  const labelled = columns.map((column, index) => ({
    column,
    label: group.subHeaders[index] ?? "",
    value: values[index],
  }));

  const maxColumn = labelled.find((entry) => isMaximumLabel(entry.label));
  const minColumn = labelled.find((entry) => isMinimumLabel(entry.label));
  if (maxColumn || minColumn) {
    band.maximum = priceCell(maxColumn?.value);
    band.minimum = priceCell(minColumn?.value);
    if (band.maximum !== null && band.minimum === null) band.exact = band.maximum;
    return band;
  }

  const tabbyColumn = labelled.find((entry) => isTabbyLabel(entry.label));
  const cashColumn = labelled.find((entry) => isCashLabel(entry.label));
  if (tabbyColumn || cashColumn) {
    const picked = wanted === "cash" ? cashColumn : tabbyColumn;
    band.exact = priceCell(picked?.value);
    return band;
  }

  // Single unlabelled column: the header itself already said which band it is.
  band.exact = priceCell(labelled[0]?.value);
  return band;
}

/** Methods a published band applies to. */
const METHODS_FOR: Record<"tabby" | "cash", PriceMethodScope[]> = {
  tabby: ["tabby", "tamara"],
  cash: ["cash", "cashier"],
};

const expandMethods = (method: PriceMethodScope): PriceMethodScope[] => {
  if (method === "tabby" || method === "tamara") return METHODS_FOR.tabby;
  if (method === "cash" || method === "cashier") return METHODS_FOR.cash;
  return [method];
};

/* --- parser ---------------------------------------------------------------- */

interface RowContext {
  sheet: string;
  rowNumber: number;
  specialization: string;
  subcategory: string;
  rawCode: string;
  code: string;
  course: string;
  deliveryType: DeliveryType;
  rawDeliveryType: string;
  level: string;
  note: string;
  onHold: boolean;
}

function draft(context: RowContext, patch: Partial<PriceItemDraft>): PriceItemDraft {
  return {
    sourceSheet: context.sheet,
    sourceRow: context.rowNumber,
    specialization: context.specialization,
    subcategory: context.subcategory,
    rawProductCode: context.rawCode,
    normalizedProductCode: context.code,
    odooProductId: null,
    courseName: context.course,
    normalizedCourseName: normalizeCourseName(context.course),
    deliveryType: context.deliveryType,
    rawDeliveryType: context.rawDeliveryType,
    level: context.level,
    pricingScope: "individual",
    bundleName: "",
    paymentMethod: "any",
    currency: "SAR",
    exactPrice: null,
    minimumPrice: null,
    maximumPrice: null,
    validFrom: "",
    validTo: "",
    country: "",
    company: "",
    active: true,
    requiresReview: false,
    onHold: context.onHold,
    note: context.note,
    rawSourceData: {},
    ...patch,
  };
}

/**
 * Section titles as the workbook spells them, mapped to how they read.
 *
 * The titles are typed by hand and two of them are misspelled. Correcting the
 * display while `rawSourceData` keeps the original means the catalogue groups
 * correctly without editing anyone's file.
 */
const SUBCATEGORY_SPELLING: Record<string, string> = {
  "bim stracuture": "BIM Structure",
  "bim structure": "BIM Structure",
  "bim architure": "BIM Architecture",
  "bim architecture": "BIM Architecture",
  "bim mep": "BIM MEP",
};

function normalizeSubcategory(value: string): string {
  return SUBCATEGORY_SPELLING[value.trim().toLowerCase()] ?? value.trim();
}

/** Section titles typed into the code column, such as a discipline name. */
function isSectionTitle(code: string, course: string, type: string): boolean {
  if (!code) return false;
  if (course || type) return false;
  return !/^\d/.test(code);
}

/**
 * A grouping for a row that has no section title above it.
 *
 * The Mechanical and Electrical blocks are not titled — the course names carry
 * the discipline instead. Reading it off the name is safe here because it only
 * groups the catalogue for browsing; nothing about a price depends on it.
 */
function impliedSubcategory(course: string, sheet: string): string {
  const raw = course.toLowerCase();
  if (/^mechanical|^mech\b/.test(raw)) return "Mechanical";
  if (/^electrical|^elec\b/.test(raw)) return "Electrical";
  if (/^architecture\b/.test(raw)) return "Architecture";
  if (/interior design|sketchup|3ds max|3d max/.test(raw)) return "Interior Design";
  if (/^civil\b/.test(raw)) return "Civil";
  if (/^bim\b|revit|navisworks/.test(raw)) return "BIM";
  if (/automotive/.test(raw)) return "Automotive";
  if (/^english\b/.test(raw)) return "English";
  return sheet;
}

export function parsePriceWorkbook(sheets: ParsedSheet[], options: ParseOptions = {}): ParseResult {
  const baseCurrency = options.baseCurrency ?? "SAR";
  const localCurrency = options.localCurrency ?? "EGP";
  const reading = options.offerDateReading ?? "unresolved";

  const items: PriceItemDraft[] = [];
  const issues: ParseIssue[] = [];
  const offerWindows: ParseResult["offerWindows"] = [];
  const codeIndex = new Map<string, DuplicateCode["occurrences"]>();
  const bandsByCode = new Map<string, Set<string>>();
  let sourceRowCount = 0;
  let rejectedRowCount = 0;

  for (const sheet of sheets) {
    const layout = detectLayout(sheet.rows);
    if (!layout) {
      // A sheet with no code column is not a course price list: it is the
      // free-text offers page or the staff incentive page.
      parseNarrativeSheet(sheet, items, issues, offerWindows, baseCurrency);
      continue;
    }

    // The offer deadline is written once, in the header area, and applies to
    // every offer cell below it.
    let sheetOfferWindow: AmbiguousDate | null = null;
    for (let row = 0; row <= layout.firstDataRow && row < sheet.rows.length; row++) {
      for (const value of sheet.rows[row] ?? []) {
        const raw = text(value);
        if (!/ينتهي|until|expires|صالح حتى/i.test(raw)) continue;
        const parsed = readAmbiguousDate(raw);
        if (!parsed) continue;
        sheetOfferWindow = parsed;
        offerWindows.push({
          sheet: sheet.name,
          raw,
          dayFirst: parsed.dayFirst,
          monthFirst: parsed.monthFirst,
        });
      }
    }
    const offerValidTo =
      sheetOfferWindow === null
        ? ""
        : reading === "day_first"
          ? sheetOfferWindow.dayFirst
          : reading === "month_first"
            ? sheetOfferWindow.monthFirst
            : "";
    const offerWindowAmbiguous = !!sheetOfferWindow?.ambiguous && reading === "unresolved";

    let subcategory = "";
    const sectionRows = new Map<string, string[]>();
    const sheetItemStart = items.length;

    for (let row = layout.firstDataRow; row < sheet.rows.length; row++) {
      const rowNumber = row + 1;
      const rawCode = cellText(sheet.rows, row, layout.codeColumn);
      const course = cellText(sheet.rows, row, layout.courseColumn);
      const rawType = cellText(sheet.rows, row, layout.typeColumn);

      if (!rawCode && !course) continue;

      if (isSectionTitle(rawCode, course, rawType)) {
        subcategory = normalizeSubcategory(rawCode);
        continue;
      }
      if (!rawCode) {
        rejectedRowCount++;
        issues.push({
          sheet: sheet.name,
          row: rowNumber,
          severity: "warning",
          code: "missing_code",
          message: "Course row has no product code and cannot be matched to Odoo.",
          detail: course,
        });
        continue;
      }

      sourceRowCount++;
      const code = normalizeProductCode(rawCode);
      const deliveryType = normalizeDeliveryType(rawType);
      const level = layout.levelColumn >= 0 ? cellText(sheet.rows, row, layout.levelColumn) : "";
      const trailing = layout.trailingColumns
        .map((column) => cellText(sheet.rows, row, column))
        .filter(Boolean);
      const onHoldFlag = trailing.some((value) => isHoldToken(value));

      const context: RowContext = {
        sheet: sheet.name,
        rowNumber,
        specialization: sheet.name.trim(),
        subcategory: subcategory || impliedSubcategory(course, sheet.name.trim()),
        rawCode,
        code,
        course,
        deliveryType,
        rawDeliveryType: rawType,
        level,
        note: trailing.filter((value) => !isHoldToken(value)).join(" | "),
        onHold: onHoldFlag,
      };

      const occurrences = codeIndex.get(code) ?? [];
      occurrences.push({ sheet: sheet.name, row: rowNumber, course, deliveryType });
      codeIndex.set(code, occurrences);

      if (deliveryType === "unknown" && rawType) {
        issues.push({
          sheet: sheet.name,
          row: rowNumber,
          severity: "warning",
          code: "unknown_delivery_type",
          message: "Delivery type was not recognised and is kept as written.",
          detail: rawType,
        });
      }
      if (isCompositeCode(rawCode)) {
        issues.push({
          sheet: sheet.name,
          row: rowNumber,
          severity: "info",
          code: "composite_code",
          message: "Composite product code kept whole; map it to a product or package by hand.",
          detail: rawCode,
        });
      }

      const sectionKey = `${context.subcategory}${deliveryType}`;
      sectionRows.set(sectionKey, [...(sectionRows.get(sectionKey) ?? []), code]);

      const rawSource: Record<string, string> = { code: rawCode, course, type: rawType };
      if (level) rawSource.level = level;
      if (trailing.length) rawSource.trailing = trailing.join(" | ");

      let producedPrice = false;
      const rowItemStart = items.length;

      for (const group of layout.groups) {
        if (group.role === "official" || group.role === "cash") {
          const wanted = group.role === "cash" ? "cash" : "tabby";
          const band = readBand(sheet.rows, row, group, wanted);
          rawSource[group.role] = group.columns
            .map((column) => cellText(sheet.rows, row, column))
            .join(" | ");
          const hasPrice = band.exact !== null || band.minimum !== null || band.maximum !== null;
          if (!hasPrice) continue;
          producedPrice = true;
          const floor = band.minimum ?? band.exact;
          const signature = `${group.role}:${band.minimum ?? "-"}:${band.maximum ?? "-"}:${band.exact ?? "-"}`;
          bandsByCode.set(code, (bandsByCode.get(code) ?? new Set<string>()).add(signature));
          for (const method of METHODS_FOR[wanted]) {
            items.push(
              draft(context, {
                pricingScope: "individual",
                paymentMethod: method,
                currency: baseCurrency,
                exactPrice: band.exact ?? band.maximum,
                minimumPrice: floor,
                maximumPrice: band.maximum,
                onHold: context.onHold || band.onHold,
                active: !(context.onHold || band.onHold),
                requiresReview: band.onHold || context.onHold,
                rawSourceData: { ...rawSource },
              }),
            );
          }
          continue;
        }

        if (group.role === "level_bundle") {
          const tabby = readBand(sheet.rows, row, group, "tabby");
          const cash = readBand(sheet.rows, row, group, "cash");
          const raw = group.columns.map((column) => cellText(sheet.rows, row, column)).join(" | ");
          if (raw.replace(/[|\s]/g, "")) rawSource.level_bundle = raw;
          const pairs: [PriceMethodScope[], number | null][] = [
            [METHODS_FOR.tabby, tabby.exact],
            [METHODS_FOR.cash, cash.exact],
          ];
          for (const [methods, amount] of pairs) {
            if (amount === null) continue;
            for (const method of methods) {
              items.push(
                draft(context, {
                  pricingScope: "level",
                  bundleName: [context.subcategory, level, context.rawDeliveryType]
                    .filter(Boolean)
                    .join(" | "),
                  paymentMethod: method,
                  currency: baseCurrency,
                  exactPrice: amount,
                  minimumPrice: amount,
                  maximumPrice: null,
                  requiresReview: true,
                  note: "Level package price. Link its component courses before judging a sale.",
                  rawSourceData: { ...rawSource },
                }),
              );
            }
          }
          continue;
        }

        if (group.role === "bundle_text") {
          const raw = group.columns.map((column) => cellText(sheet.rows, row, column)).join(" ");
          if (!raw.trim() || isNullToken(raw)) continue;
          rawSource.bundle = raw;
          const bundleName = [context.subcategory, context.rawDeliveryType]
            .filter(Boolean)
            .join(" | ");
          const phrases = parsePricePhrases(raw);
          if (!phrases.length) {
            issues.push({
              sheet: sheet.name,
              row: rowNumber,
              severity: "info",
              code: "bundle_free_text",
              message: "Package cell is free text; imported as a draft for review.",
              detail: raw,
            });
            items.push(
              draft(context, {
                pricingScope: "bundle",
                bundleName,
                paymentMethod: "any",
                currency: baseCurrency,
                active: false,
                requiresReview: true,
                note: raw,
                rawSourceData: { ...rawSource },
              }),
            );
            continue;
          }
          for (const phrase of phrases) {
            for (const method of expandMethods(phrase.method)) {
              items.push(
                draft(context, {
                  pricingScope: "bundle",
                  bundleName,
                  paymentMethod: method,
                  currency: baseCurrency,
                  exactPrice: phrase.amount,
                  minimumPrice: phrase.amount,
                  maximumPrice: null,
                  requiresReview: true,
                  note: `Package price (${raw.trim()}). Its component courses are not published; link them before judging a sale.`,
                  rawSourceData: { ...rawSource, bundle_phrase: phrase.raw },
                }),
              );
            }
          }
          continue;
        }

        if (group.role === "offer") {
          const raw = group.columns.map((column) => cellText(sheet.rows, row, column)).join(" ");
          if (!raw.trim() || isNullToken(raw)) continue;
          rawSource.offer = raw;
          const phrases = parsePricePhrases(raw);
          const bare = bareAmount(raw);
          const dated = readAmbiguousDate(raw);
          if (dated) {
            offerWindows.push({
              sheet: sheet.name,
              raw,
              dayFirst: dated.dayFirst,
              monthFirst: dated.monthFirst,
            });
          }

          if (!phrases.length && bare === null) {
            issues.push({
              sheet: sheet.name,
              row: rowNumber,
              severity: "info",
              code: "offer_free_text",
              message: "Offer cell is free text; imported as an unpublished draft.",
              detail: raw,
            });
            items.push(
              draft(context, {
                pricingScope: "offer",
                paymentMethod: "any",
                currency: baseCurrency,
                validTo: offerValidTo,
                active: false,
                requiresReview: true,
                note: raw,
                rawSourceData: { ...rawSource },
              }),
            );
            continue;
          }

          // The offer column header says these prices are for cash only, so a
          // bare number inherits that rather than applying to every method.
          const resolved = phrases.length
            ? phrases
            : [{ method: "cash" as PriceMethodScope, amount: bare as number, raw }];
          for (const phrase of resolved) {
            for (const method of expandMethods(phrase.method)) {
              items.push(
                draft(context, {
                  pricingScope: "offer",
                  paymentMethod: method,
                  currency: baseCurrency,
                  exactPrice: phrase.amount,
                  minimumPrice: phrase.amount,
                  maximumPrice: null,
                  validTo: offerValidTo,
                  // An offer can only ever excuse a low price, never create a
                  // breach — but an unread deadline still has to be approved
                  // before it starts excusing anything.
                  active: !offerWindowAmbiguous,
                  requiresReview: offerWindowAmbiguous || !offerValidTo,
                  note: offerWindowAmbiguous
                    ? `Offer deadline "${sheetOfferWindow?.raw}" reads as ${sheetOfferWindow?.dayFirst} or ${sheetOfferWindow?.monthFirst}. Choose one before publishing.`
                    : raw.trim(),
                  rawSourceData: { ...rawSource, offer_phrase: phrase.raw },
                }),
              );
            }
          }
          continue;
        }

        if (group.role === "local") {
          const value = cell(sheet.rows, row, group.columns[0]);
          const raw = text(value);
          if (raw) rawSource.local = raw;
          const amount = priceCell(value);
          if (amount === null) {
            if (raw && isNullToken(raw)) {
              issues.push({
                sheet: sheet.name,
                row: rowNumber,
                severity: "info",
                code: "local_price_absent",
                message: "No Egyptian price published; stored as absent, not as zero.",
                detail: raw,
              });
            }
            continue;
          }
          producedPrice = true;
          items.push(
            draft(context, {
              pricingScope: "individual",
              paymentMethod: "any",
              currency: localCurrency,
              exactPrice: amount,
              minimumPrice: amount,
              maximumPrice: null,
              country: "Egypt",
              onHold: context.onHold,
              active: !context.onHold,
              requiresReview: context.onHold,
              rawSourceData: { ...rawSource },
            }),
          );
          continue;
        }

        if (group.role === "incentive") {
          const raw = group.columns.map((column) => cellText(sheet.rows, row, column)).join(" ");
          if (!raw.trim() || isNullToken(raw)) continue;
          rawSource.incentive = raw;
          for (const phrase of parsePricePhrases(raw)) {
            items.push(
              draft(context, {
                pricingScope: "incentive",
                paymentMethod: phrase.method,
                currency: baseCurrency,
                exactPrice: phrase.amount,
                minimumPrice: null,
                maximumPrice: null,
                // A staff bonus is not permission to sell at that price.
                active: false,
                requiresReview: true,
                note: `Staff incentive band (${raw.trim()}). Not a selling price until published as one.`,
                rawSourceData: { ...rawSource },
              }),
            );
          }
        }
      }

      // `Hold` is typed beside whichever price column had room for it, but it
      // suspends the product, not that one payment method. Propagate it across
      // every rule this row produced.
      if (items.slice(rowItemStart).some((item) => item.onHold)) {
        for (let index = rowItemStart; index < items.length; index++) {
          items[index].onHold = true;
          items[index].active = false;
          items[index].requiresReview = true;
        }
      }

      if (!producedPrice) {
        issues.push({
          sheet: sheet.name,
          row: rowNumber,
          severity: "warning",
          code: "no_price",
          message: "Course row carries no published price in any currency.",
          detail: `${rawCode} - ${course}`,
        });
      }
    }

    // Record which courses sit inside each package block, so the mapping screen
    // can offer them as candidates. They are candidates, not an assertion.
    for (let index = sheetItemStart; index < items.length; index++) {
      const item = items[index];
      if (item.pricingScope !== "bundle" && item.pricingScope !== "level") continue;
      const candidates = sectionRows.get(`${item.subcategory}${item.deliveryType}`) ?? [];
      if (!candidates.length) continue;
      item.rawSourceData = {
        ...item.rawSourceData,
        bundle_component_candidates: [...new Set(candidates)].join(","),
      };
    }
  }

  const duplicateCodes: DuplicateCode[] = [...codeIndex.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([code, occurrences]) => ({
      code,
      count: occurrences.length,
      occurrences,
      // More than one distinct band signature means the copies disagree about
      // what a seller is allowed to charge.
      conflicting: (bandsByCode.get(code)?.size ?? 0) > 1,
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  for (const duplicate of duplicateCodes) {
    issues.push({
      sheet: duplicate.occurrences[0].sheet,
      row: duplicate.occurrences[0].row,
      severity: "warning",
      code: "duplicate_code",
      message:
        "Product code appears more than once. All rows are kept; a sale is judged against the widest published band.",
      detail: `${duplicate.code} x${duplicate.count} - ${duplicate.occurrences
        .map((occurrence) => `${occurrence.sheet}:${occurrence.row}`)
        .join(", ")}`,
    });
  }

  return {
    items,
    sourceRowCount,
    rejectedRowCount,
    duplicateCodes,
    issues,
    sheetsSeen: sheets.map((sheet) => sheet.name),
    offerWindows,
    counts: {
      individual: items.filter((item) => item.pricingScope === "individual").length,
      bundle: items.filter((item) => item.pricingScope === "bundle").length,
      level: items.filter((item) => item.pricingScope === "level").length,
      offer: items.filter((item) => item.pricingScope === "offer").length,
      incentive: items.filter((item) => item.pricingScope === "incentive").length,
      requiresReview: items.filter((item) => item.requiresReview).length,
      onHold: items.filter((item) => item.onHold).length,
      compositeCodes: new Set(
        items
          .filter((item) => isCompositeCode(item.rawProductCode))
          .map((item) => item.rawProductCode),
      ).size,
    },
  };
}

/* --- narrative sheets ------------------------------------------------------ */

/**
 * The offers page and the staff incentive page.
 *
 * Neither is a price list. The offers page is a broadcast message pasted into a
 * grid; the incentive page is what a seller earns, not what a buyer pays. Both
 * are imported so nothing is lost, both arrive inactive, and both are flagged
 * for a person to read.
 */
function parseNarrativeSheet(
  sheet: ParsedSheet,
  items: PriceItemDraft[],
  issues: ParseIssue[],
  offerWindows: ParseResult["offerWindows"],
  baseCurrency: string,
): void {
  const header = (sheet.rows[0] ?? []).map((value) => text(value).toLowerCase());
  const isIncentiveSheet =
    /حافز|incentive|bonus/i.test(sheet.name) ||
    header.some((value) => /الحافز|incentive|bonus/i.test(value));

  if (isIncentiveSheet) {
    const nameColumn = header.findIndex((value) => /course|الدورة/i.test(value));
    const tabbyColumn = header.findIndex((value) => /tabby|taby|تابي/i.test(value));
    const cashColumn = header.findIndex((value) => /cash|كاش/i.test(value));
    const bonusColumn = header.findIndex((value) => /الحافز|incentive|bonus/i.test(value));

    for (let row = 1; row < sheet.rows.length; row++) {
      const name = cellText(sheet.rows, row, nameColumn < 0 ? 0 : nameColumn);
      if (!name) continue;
      const bonus = bonusColumn >= 0 ? cellText(sheet.rows, row, bonusColumn) : "";
      const pairs: [PriceMethodScope[], number | null][] = [
        [
          METHODS_FOR.tabby,
          tabbyColumn >= 0 ? priceCell(cell(sheet.rows, row, tabbyColumn)) : null,
        ],
        [METHODS_FOR.cash, cashColumn >= 0 ? priceCell(cell(sheet.rows, row, cashColumn)) : null],
      ];
      for (const [methods, amount] of pairs) {
        if (amount === null) continue;
        for (const method of methods) {
          items.push({
            sourceSheet: sheet.name,
            sourceRow: row + 1,
            specialization: sheet.name.trim(),
            subcategory: "Staff incentive",
            rawProductCode: "",
            normalizedProductCode: "",
            odooProductId: null,
            courseName: name,
            normalizedCourseName: normalizeCourseName(name),
            deliveryType: normalizeDeliveryType(name),
            rawDeliveryType: "",
            level: "",
            pricingScope: "incentive",
            bundleName: "",
            paymentMethod: method,
            currency: baseCurrency,
            exactPrice: amount,
            minimumPrice: null,
            maximumPrice: null,
            validFrom: "",
            validTo: "",
            country: "",
            company: "",
            active: false,
            requiresReview: true,
            onHold: false,
            note: bonus
              ? `Immediate staff bonus ${bonus} when sold at this price. Not a selling price on its own.`
              : "Staff incentive band. Not a selling price on its own.",
            rawSourceData: { course: name, bonus },
          });
        }
      }
    }
    issues.push({
      sheet: sheet.name,
      row: 1,
      severity: "info",
      code: "incentive_sheet",
      message:
        "Staff incentive sheet imported as badges only. These prices do not authorise a sale until published as price rules.",
      detail: sheet.name,
    });
    return;
  }

  // Free-text offers page.
  let imported = 0;
  for (let row = 0; row < sheet.rows.length; row++) {
    const cells = sheet.rows[row] ?? [];
    for (let column = 0; column < cells.length; column++) {
      const raw = text(cells[column]);
      if (raw.length < 12) continue;
      const dated = readAmbiguousDate(raw);
      if (dated) {
        offerWindows.push({
          sheet: sheet.name,
          raw,
          dayFirst: dated.dayFirst,
          monthFirst: dated.monthFirst,
        });
      }
      const title = raw.split(/[\n/]/)[0].trim().slice(0, 120);
      items.push({
        sourceSheet: sheet.name,
        sourceRow: row + 1,
        specialization: sheet.name.trim(),
        subcategory: "Announced offers",
        rawProductCode: "",
        normalizedProductCode: "",
        odooProductId: null,
        courseName: title,
        normalizedCourseName: normalizeCourseName(title),
        deliveryType: "unknown",
        rawDeliveryType: "",
        level: "",
        pricingScope: "offer",
        bundleName: "",
        paymentMethod: "any",
        currency: baseCurrency,
        exactPrice: null,
        minimumPrice: null,
        maximumPrice: null,
        validFrom: "",
        validTo: "",
        country: "",
        company: "",
        active: false,
        requiresReview: true,
        onHold: false,
        note: raw,
        rawSourceData: { column: String(column + 1), text: raw },
      });
      imported++;
    }
  }
  issues.push({
    sheet: sheet.name,
    row: 1,
    severity: "warning",
    code: "free_text_offers",
    message:
      "Offers sheet is free text. Every entry is imported unpublished and must be rewritten as a price rule by hand.",
    detail: `${imported} entries`,
  });
}
