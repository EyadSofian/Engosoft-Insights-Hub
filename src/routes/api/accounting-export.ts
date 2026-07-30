import { createFileRoute } from "@tanstack/react-router";

type CsvCell = string | number | null | undefined;
type ExportView = "summary" | "invoices" | "lines" | "courses";

function safeText(value: string): string {
  // Keep names opened by Excel from being interpreted as formulas.
  return /^[=+@]/.test(value) || /^-\D/.test(value) ? `'${value}` : value;
}

function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = safeText(String(value));
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: CsvCell[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

function filename(view: ExportView, from?: string, to?: string): string {
  const range = [from, to].filter(Boolean).join("-to-") || "all-dates";
  return `engosoft-accounting-${view}-${range}.csv`;
}

function download(csv: string, name: string): Response {
  return new Response(csv, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "x-accounting-authority": "paid-invoices-only",
    },
  });
}

export const Route = createFileRoute("/api/accounting-export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered } = await import("@/lib/metrics.server");
        const { parseFilters } = await import("@/lib/api.server");
        const { buildAccountingCourses } = await import("@/lib/accounting-courses");
        const { fxRatesFromFilters } = await import("@/lib/fx-rates");

        const url = new URL(request.url);
        const requested = url.searchParams.get("view");
        const view: ExportView =
          requested === "summary" || requested === "invoices" || requested === "courses"
            ? requested
            : "lines";
        const ar = url.searchParams.get("lang") !== "en";
        const filters = await parseFilters(request);
        const fxRates = fxRatesFromFilters(filters);
        const data = await getFiltered(filters);
        const rows = data.accounting;
        const dateBasis = filters.dateBasis === "invoice" ? "invoice" : "payment";
        const accountingDate = (row: { invoiceDate: string; paymentDate: string }) =>
          dateBasis === "invoice" ? row.invoiceDate : row.paymentDate;
        const dateBasisLabel = dateBasis === "invoice" ? "Invoice Date" : "Payment Date";
        const name = filename(view, filters.from, filters.to);

        if (view === "summary") {
          const revenue = rows.reduce((sum, row) => sum + row.usdPaid, 0);
          const invoices = new Set(rows.map((row) => row.movement).filter(Boolean)).size;
          const negativeRows = rows.filter((row) => row.usdPaid < 0);
          const withoutSource = rows
            .filter((row) => !row.source)
            .reduce((sum, row) => sum + row.usdPaid, 0);
          const header = ar
            ? ["المؤشر", "القيمة", "طريقة الحساب", "المصدر المعتمد"]
            : ["Metric", "Value", "Calculation", "Accounting authority"];
          const source = ar ? "الفواتير المدفوعة فقط" : "Paid invoices only";
          const output: CsvCell[][] = [
            header,
            [
              ar ? "الإيراد المحصل بالدولار" : "Collected revenue USD",
              revenue,
              ar ? "مجموع USD Paid" : "Sum of USD Paid",
              source,
            ],
            [
              ar ? "عدد الفواتير" : "Distinct invoices",
              invoices,
              ar ? "عدد Move المميز" : "Distinct Move count",
              source,
            ],
            [
              ar ? "بنود المنتجات" : "Product lines",
              rows.length,
              ar ? "عدد صفوف الفواتير" : "Paid invoice row count",
              source,
            ],
            [
              ar ? "متوسط الفاتورة بالدولار" : "Average invoice USD",
              invoices ? revenue / invoices : 0,
              ar ? "الإيراد ÷ عدد الفواتير" : "Revenue / distinct invoices",
              source,
            ],
            [
              ar ? "بنود سالبة" : "Negative lines",
              negativeRows.length,
              ar ? "عدد البنود التي USD Paid فيها أقل من صفر" : "Rows where USD Paid is below zero",
              source,
            ],
            [
              ar ? "قيمة البنود السالبة" : "Negative line value USD",
              negativeRows.reduce((sum, row) => sum + row.usdPaid, 0),
              ar ? "مجموع USD Paid للبنود السالبة" : "Sum of negative USD Paid rows",
              source,
            ],
            [
              ar ? "إيراد بدون مصدر تسويقي" : "Revenue without marketing source",
              withoutSource,
              ar ? "مجموع USD Paid عندما يكون Source فارغًا" : "USD Paid where Source is blank",
              source,
            ],
            [
              ar ? "أساس التاريخ" : "Date basis",
              dateBasisLabel,
              ar
                ? dateBasis === "invoice"
                  ? "الفترة تُطبّق على تاريخ الفاتورة"
                  : "الفترة تُطبّق على تاريخ الدفع"
                : `Filters apply to ${dateBasisLabel}`,
              source,
            ],
            [
              ar ? "أساس القيمة" : "Value basis",
              "Total in Currency → USD Paid",
              ar ? "التحويل للدولار من الإجمالي بالعملة" : "USD conversion from Total in Currency",
              source,
            ],
            [
              ar ? "سعر الدولار بالجنيه" : "USD rate in EGP",
              fxRates.EGP,
              ar ? "Total in Currency ÷ سعر الجنيه" : "Total in Currency / EGP rate",
              source,
            ],
            [
              ar ? "سعر الدولار بالريال" : "USD rate in SAR",
              fxRates.SAR,
              ar ? "Total in Currency ÷ سعر الريال" : "Total in Currency / SAR rate",
              source,
            ],
            [
              ar ? "أوامر البيع داخل الحساب" : "Sales orders in calculations",
              ar ? "لا" : "No",
              ar ? "لا تدخل في أي إجمالي أو متوسط" : "Excluded from every total and average",
              source,
            ],
          ];
          return download(toCsv(output), name);
        }

        if (view === "invoices") {
          type Invoice = {
            movement: string;
            paymentDate: string;
            invoiceDate: string;
            partner: string;
            company: string;
            currency: string;
            companyCurrency: string;
            untaxedTotal: number;
            totalInCurrency: number;
            usdPaid: number;
            lines: number;
            products: Set<string>;
            salespeople: Set<string>;
            teams: Set<string>;
            events: Set<string>;
            eventStages: Set<string>;
            sources: Set<string>;
          };
          const invoices = new Map<string, Invoice>();
          for (const row of rows) {
            const key = row.movement || `__line__:${row.id}`;
            const invoice = invoices.get(key) ?? {
              movement: row.movement,
              paymentDate: row.paymentDate,
              invoiceDate: row.invoiceDate,
              partner: row.partner,
              company: row.company,
              currency: row.currency,
              companyCurrency: row.companyCurrency,
              untaxedTotal: 0,
              totalInCurrency: 0,
              usdPaid: 0,
              lines: 0,
              products: new Set<string>(),
              salespeople: new Set<string>(),
              teams: new Set<string>(),
              events: new Set<string>(),
              eventStages: new Set<string>(),
              sources: new Set<string>(),
            };
            invoice.untaxedTotal += row.untaxedTotal;
            invoice.totalInCurrency += row.totalInCurrency;
            invoice.usdPaid += row.usdPaid;
            invoice.lines += 1;
            if (row.product) invoice.products.add(row.product);
            if (row.salesperson) invoice.salespeople.add(row.salesperson);
            if (row.salesTeam) invoice.teams.add(row.salesTeam);
            if (row.event) invoice.events.add(row.event);
            if (row.eventStage) invoice.eventStages.add(row.eventStage);
            if (row.source) invoice.sources.add(row.source);
            invoices.set(key, invoice);
          }
          const header = ar
            ? [
                "الحركة",
                "تاريخ الدفع",
                "تاريخ الفاتورة",
                "الشريك",
                "الشركة",
                "العملة",
                "الإجمالي دون الضريبة",
                "عملة الشركة",
                "الإجمالي بالعملة",
                "المحصل بالدولار",
                "عدد البنود",
                "المنتجات",
                "مندوب المبيعات",
                "فريق المبيعات",
                "الفعاليات",
                "مراحل الفعالية",
                "المصدر",
                "قاعدة الحساب",
              ]
            : [
                "Move",
                "Payment Date",
                "Invoice Date",
                "Partner",
                "Company",
                "Currency",
                "Untaxed Total",
                "Company Currency",
                "Total in Currency",
                "USD Paid",
                "Product Lines",
                "Products",
                "Salesperson",
                "Sales Team",
                "Events",
                "Event Stages",
                "Source",
                "Accounting Rule",
              ];
          const output: CsvCell[][] = [
            header,
            ...[...invoices.values()]
              .sort(
                (a, b) =>
                  accountingDate(b).localeCompare(accountingDate(a)) ||
                  a.movement.localeCompare(b.movement),
              )
              .map((row) => [
                row.movement,
                row.paymentDate,
                row.invoiceDate,
                row.partner,
                row.company,
                row.currency,
                row.untaxedTotal,
                row.companyCurrency,
                row.totalInCurrency,
                row.usdPaid,
                row.lines,
                [...row.products].join(" | "),
                [...row.salespeople].join(" | "),
                [...row.teams].join(" | "),
                [...row.events].join(" | "),
                [...row.eventStages].join(" | "),
                [...row.sources].join(" | "),
                ar ? "فاتورة مدفوعة فقط" : "Paid invoice only",
              ]),
          ];
          return download(toCsv(output), name);
        }

        if (view === "courses") {
          const courses = buildAccountingCourses(rows);
          const header = ar
            ? [
                "الكورس",
                "المنتج",
                "كود المنتج",
                "النوع",
                "الفئة",
                "عدد الفواتير",
                "عدد البنود",
                "الكمية",
                "الإيراد بالدولار",
                "نسبة المنتج من إجمالي الحسابات",
                "نسبة المنتج داخل الكورس",
                "متوسط الوحدة بالدولار",
                "المصادر",
                "الفعاليات",
                "مراحل الفعالية",
                "قاعدة الحساب",
              ]
            : [
                "Course",
                "Product",
                "Product Code",
                "Type",
                "Category",
                "Distinct Invoices",
                "Product Lines",
                "Quantity",
                "Revenue USD",
                "Share of Accounting Revenue %",
                "Share within Course %",
                "Average Unit USD",
                "Sources",
                "Events",
                "Event Stages",
                "Accounting Rule",
              ];
          const output: CsvCell[][] = [header];
          for (const family of courses.families) {
            for (const product of family.products) {
              output.push([
                family.family,
                product.name,
                product.code,
                product.variantKey,
                product.category,
                product.invoices,
                product.lines,
                courses.summary.quantityAvailable ? product.quantity : "",
                product.revenueUsd,
                courses.summary.revenueUsd
                  ? (product.revenueUsd / courses.summary.revenueUsd) * 100
                  : 0,
                family.revenueUsd ? (product.revenueUsd / family.revenueUsd) * 100 : 0,
                product.averageUnitUsd,
                product.sources.map((source) => source.label).join(" | "),
                product.events.map((event) => event.label).join(" | "),
                product.eventStages.map((stage) => stage.label).join(" | "),
                ar ? "فاتورة مدفوعة فقط" : "Paid invoice only",
              ]);
            }
          }
          return download(toCsv(output), name);
        }

        const header = ar
          ? [
              "الحركة",
              "تاريخ الدفع",
              "تاريخ الفاتورة",
              "الشريك",
              "الدولة",
              "الشركة",
              "مندوب المبيعات",
              "فريق المبيعات",
              "رقم الموظف",
              "كود المنتج",
              "المنتج",
              "فئة المنتج",
              "الفئة الرئيسية",
              "الكمية",
              "الإجمالي دون الضريبة",
              "عملة الشركة",
              "الإجمالي بالعملة",
              "العملة",
              "المحصل بالدولار",
              "الموقع",
              "الفعالية",
              "مرحلة الفعالية",
              "المصدر",
              "قاعدة الحساب",
            ]
          : [
              "Move",
              "Payment Date",
              "Invoice Date",
              "Partner",
              "Country",
              "Company",
              "Salesperson",
              "Sales Team",
              "Employee Code",
              "Product Code",
              "Product",
              "Product Category",
              "Main Category",
              "Quantity",
              "Untaxed Total",
              "Company Currency",
              "Total in Currency",
              "Currency",
              "USD Paid",
              "Website",
              "Event",
              "Event Stage",
              "Source",
              "Accounting Rule",
            ];
        const output: CsvCell[][] = [
          header,
          ...rows
            .slice()
            .sort(
              (a, b) =>
                accountingDate(b).localeCompare(accountingDate(a)) ||
                a.movement.localeCompare(b.movement),
            )
            .map((row) => [
              row.movement,
              row.paymentDate,
              row.invoiceDate,
              row.partner,
              row.country,
              row.company,
              row.salesperson,
              row.salesTeam,
              row.code,
              row.productCode,
              row.product,
              row.productCategory,
              row.mainCategory,
              row.quantity,
              row.untaxedTotal,
              row.companyCurrency,
              row.totalInCurrency,
              row.currency,
              row.usdPaid,
              row.website,
              row.event,
              row.eventStage,
              row.source,
              ar ? "فاتورة مدفوعة فقط" : "Paid invoice only",
            ]),
        ];
        return download(toCsv(output), name);
      },
    },
  },
});
