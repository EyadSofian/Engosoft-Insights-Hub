// Server-only authoritative Accounting reader for Odoo 17.
//
// The invoice analysis (`account.invoice.report`) is the right product-line
// grain for the dashboard, but installations frequently add Payment Date,
// Sales Team and USD fields under different technical names.  This reader
// resolves those fields from `fields_get` (technical candidates first, exact
// translated labels second), and enriches the report from `account.move` when
// a dimension is not exposed by the SQL view itself.
//
// Credentials are consumed only by odoo.server.  Nothing in this module logs
// or returns the Odoo URL, database, login or API key.
import {
  companyContext,
  m2oId,
  m2oName,
  odooCall,
  odooConfig,
  searchRead,
  type Domain,
  type M2O,
} from "./odoo.server";

export type AccountingRawRow = Record<string, string>;

interface OdooField {
  string?: string;
  type?: string;
  relation?: string;
  store?: boolean;
}

interface InvoiceReportRow {
  id: number;
  move_id?: M2O;
  move_type?: string | false;
  state?: string | false;
  invoice_date?: string | false;
  product_id?: M2O;
  product_categ_id?: M2O;
  company_id?: M2O;
  company_currency_id?: M2O;
  partner_id?: M2O;
  country_id?: M2O;
  invoice_user_id?: M2O;
  currency_id?: M2O;
  quantity?: number;
  price_subtotal?: number;
  price_total?: number;
  [key: string]: unknown;
}

interface OdooMove {
  id: number;
  name?: string | false;
  move_type?: string | false;
  state?: string | false;
  invoice_date?: string | false;
  date?: string | false;
  invoice_payments_widget?: unknown;
  currency_id?: M2O;
  company_id?: M2O;
  partner_id?: M2O;
  invoice_user_id?: M2O;
  team_id?: M2O;
  invoice_origin?: string | false;
  write_date?: string | false;
  [key: string]: unknown;
}

interface OdooProduct {
  id: number;
  display_name?: string | false;
  name?: string | false;
  default_code?: string | false;
  categ_id?: M2O;
}

interface OdooTeam {
  id: number;
  name?: string | false;
  user_id?: M2O;
}

interface OdooEmployee {
  id: number;
  user_id?: M2O;
  [key: string]: unknown;
}

export interface DirectAccountingDiagnostics {
  startDate: string;
  reportCandidates: number;
  acceptedRows: number;
  acceptedMoves: number;
  missingPaymentDate: number;
  missingCurrencyRate: number;
  revenue: number;
  /** Non-sensitive field map useful when auditing a custom Odoo schema. */
  resolvedFields: Record<string, string>;
  unresolvedFields: string[];
}

export interface DirectAccountingSnapshot {
  rows: AccountingRawRow[];
  diagnostics: DirectAccountingDiagnostics;
}

const FX_TO_USD: Record<string, number> = {
  EGP: 0.02054,
  SAR: 0.267,
  AED: 0.27,
  USD: 1,
};

const normalize = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-–—/\\().?:$]+/g, "");

function resolveField(
  metadata: Record<string, OdooField>,
  candidates: string[],
  labels: string[],
  allowedTypes?: string[],
): string {
  const typeAllowed = (field: OdooField | undefined) =>
    !!field && (!allowedTypes?.length || allowedTypes.includes(String(field.type ?? "")));

  for (const candidate of candidates) {
    if (typeAllowed(metadata[candidate])) return candidate;
  }

  const wanted = new Set(labels.map(normalize));
  const matches = Object.entries(metadata).filter(
    ([, field]) => typeAllowed(field) && wanted.has(normalize(field.string)),
  );
  // A translated label can be shared by several custom fields.  Ambiguity is
  // treated as unresolved rather than silently selecting the wrong amount.
  return matches.length === 1 ? matches[0][0] : "";
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== false && String(value).trim() !== "";
}

function number(value: unknown): number {
  if (!present(value)) return 0;
  const parsed = Number(String(value).replace(/[,$\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value: unknown): string {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function display(value: unknown): string {
  if (!present(value)) return "";
  if (Array.isArray(value)) {
    if (value.length >= 2 && typeof value[1] === "string") return String(value[1]).trim();
    return value.map(String).join(", ");
  }
  return String(value).trim();
}

function parsePaymentWidget(value: unknown): Record<string, unknown> | null {
  if (!present(value)) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const encoded = String(value);
  try {
    return JSON.parse(encoded) as Record<string, unknown>;
  } catch {
    // Some older Odoo builds return computed binary widgets as base64 JSON.
    try {
      return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function widgetPaymentDate(value: unknown): string {
  const widget = parsePaymentWidget(value);
  const content = Array.isArray(widget?.content) ? widget.content : [];
  const dates = content
    .map((entry) =>
      entry && typeof entry === "object" ? date((entry as Record<string, unknown>).date) : "",
    )
    .filter(Boolean)
    .sort();
  // Finance reports Engosoft revenue on the invoice's final/latest payment.
  return dates.at(-1) ?? "";
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

async function readIds<T extends { id: number }>(
  model: string,
  ids: number[],
  fields: string[],
  context: Record<string, unknown> = {},
): Promise<T[]> {
  const out: T[] = [];
  for (const batch of chunks([...new Set(ids)].filter(Boolean), 1000)) {
    out.push(
      ...(await searchRead<T>(model, [["id", "in", batch]], fields, {
        context: { active_test: false, ...context },
      })),
    );
  }
  return out;
}

function available(metadata: Record<string, OdooField>, fields: string[]): string[] {
  return fields.filter((field) => !!metadata[field]);
}

/**
 * Load paid customer-invoice product lines from Odoo's invoice analysis view.
 * The caller must apply the sheet completeness gate; this function throws on
 * access/network/schema errors and never turns a failed Odoo read into `[]`.
 */
export async function loadDirectAccounting(): Promise<DirectAccountingSnapshot> {
  const cfg = odooConfig();
  const [reportMeta, moveMeta] = await Promise.all([
    odooCall<Record<string, OdooField>>("account.invoice.report", "fields_get", [], {
      attributes: ["string", "type", "relation", "store"],
      context: companyContext({ active_test: false }),
    }),
    odooCall<Record<string, OdooField>>("account.move", "fields_get", [], {
      attributes: ["string", "type", "relation", "store"],
      context: companyContext({ active_test: false }),
    }),
  ]);
  const optionalMetadata = async (model: string): Promise<Record<string, OdooField>> => {
    try {
      return await odooCall<Record<string, OdooField>>(model, "fields_get", [], {
        attributes: ["string", "type", "relation", "store"],
        context: companyContext({ active_test: false }),
      });
    } catch {
      // Product codes, team leaders and employee registration numbers are
      // enrichment only. Lack of access must not hide otherwise valid invoice
      // facts; the strict sheet gate will still protect totals.
      return {};
    }
  };
  const [productMeta, teamMeta, employeeMeta] = await Promise.all([
    optionalMetadata("product.product"),
    optionalMetadata("crm.team"),
    optionalMetadata("hr.employee"),
  ]);

  const paymentDateReport = resolveField(
    reportMeta,
    [
      "payment_date",
      "last_payment_date",
      "invoice_payment_date",
      "x_studio_payment_date",
      "x_payment_date",
    ],
    ["Payment Date", "Last Payment Date", "تاريخ الدفع"],
    ["date", "datetime"],
  );
  const paymentDateMove = resolveField(
    moveMeta,
    [
      "payment_date",
      "last_payment_date",
      "invoice_payment_date",
      "x_studio_payment_date",
      "x_payment_date",
    ],
    ["Payment Date", "Last Payment Date", "تاريخ الدفع"],
    ["date", "datetime"],
  );
  const usdPaidReport = resolveField(
    reportMeta,
    [
      "usd_paid",
      "price_total_usd",
      "amount_total_usd",
      "x_studio_usd_paid",
      "x_usd_paid",
      "x_studio_dollar_sales",
    ],
    ["USD Paid", "$ Paid", "$ Sales", "Paid USD", "Total USD", "المبيعات بالدولار"],
    ["float", "monetary", "integer"],
  );
  const reportTeam = resolveField(
    reportMeta,
    ["team_id", "sales_team_id", "x_studio_team_id", "x_team_id"],
    ["Sales Team", "Team", "فريق المبيعات"],
    ["many2one", "char", "selection"],
  );
  const reportOrder = resolveField(
    reportMeta,
    ["invoice_origin", "sale_order_name", "order_ref", "x_studio_sales_order"],
    ["Invoice Origin", "Sales Order #", "Sales Order", "Source Document", "مرجع الطلب"],
    ["char", "text", "many2one"],
  );
  const reportWebsite = resolveField(
    reportMeta,
    ["website_id", "website", "x_studio_website_id", "x_website_id"],
    ["Website", "الموقع"],
    ["many2one", "char", "selection"],
  );
  const reportEvent = resolveField(
    reportMeta,
    ["event_id", "event", "x_studio_event", "x_event_id"],
    ["Event", "الفعالية"],
    ["many2one", "char", "selection"],
  );
  const reportEventStage = resolveField(
    reportMeta,
    ["event_stage_id", "event_stage", "x_studio_event_stage", "x_event_stage_id"],
    ["Event Stage", "مرحلة الفعالية"],
    ["many2one", "char", "selection"],
  );
  const moveTeam = resolveField(
    moveMeta,
    ["team_id", "sales_team_id", "x_studio_team_id", "x_team_id"],
    ["Sales Team", "Team", "فريق المبيعات"],
    ["many2one", "char", "selection"],
  );
  const moveOrder = resolveField(
    moveMeta,
    ["invoice_origin", "sale_order_name", "order_ref", "x_studio_sales_order"],
    ["Invoice Origin", "Sales Order #", "Sales Order", "Source Document", "مرجع الطلب"],
    ["char", "text", "many2one"],
  );
  const moveWebsite = resolveField(
    moveMeta,
    ["website_id", "website", "x_studio_website_id", "x_website_id"],
    ["Website", "الموقع"],
    ["many2one", "char", "selection"],
  );
  const employeeCode = resolveField(
    employeeMeta,
    [
      "registration_number",
      "employee_registration_number",
      "x_studio_employee_reg_no",
      "x_employee_reg_no",
      "x_studio_registration_number",
      "barcode",
    ],
    ["Employee Reg. No", "Employee Registration Number", "Registration Number"],
    ["char", "integer"],
  );

  const resolvedFields = Object.fromEntries(
    Object.entries({
      paymentDateReport,
      paymentDateMove,
      usdPaidReport,
      reportTeam,
      reportOrder,
      reportWebsite,
      reportEvent,
      reportEventStage,
      moveTeam,
      moveOrder,
      moveWebsite,
      employeeCode,
    }).filter(([, field]) => !!field),
  );
  const unresolvedFields = [
    !paymentDateReport && !paymentDateMove ? "Payment Date (using payments widget)" : "",
    !usdPaidReport ? "USD Paid (using approved reference FX rates)" : "",
    !reportTeam && !moveTeam ? "Sales Team" : "",
    !reportOrder && !moveOrder ? "Sales Order #" : "",
    !employeeCode ? "Employee Reg. No" : "",
  ].filter(Boolean);

  const requiredReport = [
    "id",
    "move_id",
    "move_type",
    "state",
    "invoice_date",
    "product_id",
    "product_categ_id",
    "company_id",
    "company_currency_id",
    "partner_id",
    "country_id",
    "invoice_user_id",
    "currency_id",
    "quantity",
    "price_subtotal",
    "price_total",
  ];
  const missingCritical = ["id", "move_id", "invoice_date", "product_id", "price_total"].filter(
    (field) => !reportMeta[field],
  );
  if (missingCritical.length) {
    throw new Error(
      `account.invoice.report is missing required fields: ${missingCritical.join(", ")}`,
    );
  }
  const reportFields = [
    ...new Set(
      [
        ...available(reportMeta, requiredReport),
        paymentDateReport,
        usdPaidReport,
        reportTeam,
        reportOrder,
        reportWebsite,
        reportEvent,
        reportEventStage,
      ].filter(Boolean),
    ),
  ];

  const domain: Domain = [
    ["move_type", "=", "out_invoice"],
    ["state", "=", "posted"],
    ["invoice_date", ">=", cfg.startDate],
    ["company_id", "in", cfg.companyIds],
  ];
  const reportRows = await searchRead<InvoiceReportRow>(
    "account.invoice.report",
    domain,
    reportFields,
    { context: { active_test: false } },
  );

  const moveFields = [
    ...new Set(
      [
        "id",
        "name",
        "move_type",
        "state",
        "invoice_date",
        "date",
        "invoice_payments_widget",
        "currency_id",
        "company_id",
        "partner_id",
        "invoice_user_id",
        "write_date",
        paymentDateMove,
        moveTeam,
        moveOrder,
        moveWebsite,
      ].filter((field) => !!field && !!moveMeta[field]),
    ),
  ];
  const moves = await readIds<OdooMove>(
    "account.move",
    reportRows.map((row) => m2oId(row.move_id)),
    moveFields,
    { bin_size: false },
  );
  const moveById = new Map(moves.map((move) => [move.id, move]));

  const productIds = reportRows.map((row) => m2oId(row.product_id)).filter(Boolean);
  const products = productMeta.id
    ? await readIds<OdooProduct>(
        "product.product",
        productIds,
        available(productMeta, ["id", "display_name", "name", "default_code", "categ_id"]),
      )
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));

  const teamIds = moves
    .map((move) => m2oId(moveTeam ? (move[moveTeam] as M2O) : move.team_id))
    .concat(reportRows.map((row) => m2oId(reportTeam ? (row[reportTeam] as M2O) : undefined)))
    .filter(Boolean);
  const teams = teamMeta.id
    ? await readIds<OdooTeam>("crm.team", teamIds, available(teamMeta, ["id", "name", "user_id"]))
    : [];
  const teamById = new Map(teams.map((team) => [team.id, team]));

  const salespersonIds = reportRows
    .map((row) => m2oId(row.invoice_user_id))
    .concat(moves.map((move) => m2oId(move.invoice_user_id)))
    .filter(Boolean);
  const employeeFields = available(employeeMeta, ["id", "user_id", employeeCode]);
  const employees =
    employeeMeta.id && employeeMeta.user_id && salespersonIds.length
      ? await searchRead<OdooEmployee>(
          "hr.employee",
          [["user_id", "in", [...new Set(salespersonIds)]]],
          employeeFields,
          { context: { active_test: false } },
        )
      : [];
  const employeeByUser = new Map(employees.map((employee) => [m2oId(employee.user_id), employee]));

  let missingPaymentDate = 0;
  let missingCurrencyRate = 0;
  const rows: AccountingRawRow[] = [];

  for (const report of reportRows) {
    const move = moveById.get(m2oId(report.move_id));
    if (!move || move.move_type === "out_refund" || /^RINV/i.test(String(move.name ?? ""))) {
      continue;
    }
    const paidOn =
      date(paymentDateReport ? report[paymentDateReport] : "") ||
      date(paymentDateMove ? move[paymentDateMove] : "") ||
      widgetPaymentDate(move.invoice_payments_widget);
    if (!paidOn || paidOn < cfg.startDate) {
      missingPaymentDate++;
      continue;
    }

    const product = productById.get(m2oId(report.product_id));
    const currency = m2oName(report.currency_id) || m2oName(move.currency_id);
    const totalInCurrency = Math.abs(number(report.price_total));
    const hasExplicitUsd = !!usdPaidReport && present(report[usdPaidReport]);
    const fx = FX_TO_USD[currency.toUpperCase()];
    if (!hasExplicitUsd && fx === undefined) missingCurrencyRate++;
    const usdPaid = hasExplicitUsd ? number(report[usdPaidReport]) : totalInCurrency * (fx ?? 0);
    const teamValue = reportTeam ? report[reportTeam] : moveTeam ? move[moveTeam] : move.team_id;
    const teamId = m2oId(teamValue as M2O);
    const team = teamById.get(teamId);
    const salesperson = report.invoice_user_id || move.invoice_user_id;
    const employee = employeeByUser.get(m2oId(salesperson));
    const orderRef = display(reportOrder ? report[reportOrder] : moveOrder ? move[moveOrder] : "");

    rows.push({
      __odoo_id: String(report.id),
      __odoo_line_id: String(report.id),
      __odoo_move_type: "out_invoice",
      __odoo_write_date: display(move.write_date),
      Move: m2oName(report.move_id) || display(move.name),
      "Invoice Date": date(report.invoice_date) || date(move.invoice_date) || date(move.date),
      "Payment Date": paidOn,
      Product: display(product?.display_name || product?.name || m2oName(report.product_id)),
      "Product Code": display(product?.default_code),
      "Product Category": m2oName(report.product_categ_id) || m2oName(product?.categ_id),
      Quantity: String(number(report.quantity)),
      Company: m2oName(report.company_id) || m2oName(move.company_id),
      "Company Currency": m2oName(report.company_currency_id),
      Partner: m2oName(report.partner_id) || m2oName(move.partner_id),
      Country: m2oName(report.country_id),
      "Untaxed Total": String(number(report.price_subtotal)),
      "Total in Currency": String(totalInCurrency),
      Currency: currency,
      "USD Paid": String(usdPaid),
      "Sales Order #": orderRef || display(move.invoice_origin),
      Salesperson: m2oName(salesperson),
      "Employee Reg. No": employeeCode ? display(employee?.[employeeCode]) : "",
      "Team Leader": m2oName(team?.user_id),
      "Sales Team": display(teamValue) || display(team?.name),
      Website: display(
        reportWebsite ? report[reportWebsite] : moveWebsite ? move[moveWebsite] : "",
      ),
      Event: display(reportEvent ? report[reportEvent] : ""),
      "Event Stage": display(reportEventStage ? report[reportEventStage] : ""),
    });
  }

  const acceptedMoves = new Set(rows.map((row) => row.Move).filter(Boolean)).size;
  const revenue = rows.reduce((sum, row) => sum + number(row["USD Paid"]), 0);
  return {
    rows,
    diagnostics: {
      startDate: cfg.startDate,
      reportCandidates: reportRows.length,
      acceptedRows: rows.length,
      acceptedMoves,
      missingPaymentDate,
      missingCurrencyRate,
      revenue,
      resolvedFields,
      unresolvedFields,
    },
  };
}
