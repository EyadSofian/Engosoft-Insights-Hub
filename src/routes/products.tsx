import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Boxes, Layers, ShoppingCart, Wallet, X } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { fmtDate, fmtNum, fmtUSD, fmtUSDFull, useI18n } from "@/lib/i18n";
import {
  BarList,
  Card,
  ErrorState,
  KpiCard,
  KpiSkeletonGrid,
  Notice,
  PageHeader,
  Pill,
  SectionTitle,
  Segmented,
  Skeleton,
} from "@/components/ui-bits";
import { DataTable, type Col } from "@/components/DataTable";
import { MultiLineChart } from "@/components/charts";
import { familyLabel, sourceLabel, variantLabel } from "@/lib/product-taxonomy";

export const Route = createFileRoute("/products")({ component: Products });

/* --- payload shapes (mirror src/lib/products.server.ts) ------------------- */

interface CurrencyAmount {
  currency: string;
  amount: number;
  units: number;
}
interface Breakdown {
  key: string;
  label: string;
  units: number;
  orders: number;
  revenueUsd: number;
}
interface ProductRow {
  productId: number;
  name: string;
  code: string;
  category: string;
  familyKey: string;
  family: string;
  variantKey: string;
  units: number;
  orders: number;
  revenueUsd: number;
  avgPriceUsd: number | null;
  native: CurrencyAmount[];
  companies: Breakdown[];
  sources: Breakdown[];
  firstSale: string;
  lastSale: string;
  isDiscount: boolean;
}
interface FamilyRow {
  familyKey: string;
  family: string;
  category: string;
  units: number;
  orders: number;
  revenueUsd: number;
  avgPriceUsd: number | null;
  productCount: number;
  native: CurrencyAmount[];
  variants: Breakdown[];
  sources: Breakdown[];
  products: ProductRow[];
}
interface Health {
  fetchedAt: string;
  ordersScanned: number;
  ordersWithoutSource: number;
  companies: { id: number; name: string; currency: string }[];
  currencies: string[];
  startDate: string;
  stale: boolean;
  warnings: string[];
}
interface Detail {
  productId: number;
  name: string;
  sources: Breakdown[];
  campaigns: Breakdown[];
  salespeople: Breakdown[];
  teams: Breakdown[];
  companies: Breakdown[];
  monthly: { month: string; units: number; revenueUsd: number }[];
  orders: {
    orderName: string;
    date: string;
    company: string;
    currency: string;
    qty: number;
    total: number;
    usd: number | null;
    source: string;
    sourceKey: string;
    campaign: string;
    salesperson: string;
    invoiced: boolean;
  }[];
}
interface Resp {
  families: FamilyRow[];
  products: ProductRow[];
  sources: Breakdown[];
  variants: Breakdown[];
  companies: Breakdown[];
  monthly: { month: string; units: number; revenueUsd: number }[];
  totals: {
    units: number;
    orders: number;
    revenueUsd: number;
    products: number;
    families: number;
    native: CurrencyAmount[];
    invoicedUnits: number;
    invoicedRevenueUsd: number;
  };
  health: Health;
  detail: Detail | null;
}

const EM = "—";

/**
 * Native money keeps its own currency code. Never mixed into a shared total —
 * SAR 2.4M and EGP 1.0M added together would be a meaningless 3.4M.
 */
const fmtNative = (n: number, currency: string) =>
  `${n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })} ${currency}`;

/**
 * Each currency gets its own boxed chip. Rendering them as plain adjacent text
 * read as one running number ("1,753 AED 494,788 SAR"), which is precisely the
 * confusion this page exists to prevent.
 */
function NativeChips({ native }: { native: CurrencyAmount[] }) {
  if (!native.length) return <span className="text-text-subtle">{EM}</span>;
  return (
    <div className="flex flex-wrap gap-1 justify-end">
      {native.map((n) => (
        <span
          key={n.currency}
          className="num text-[11px] px-1.5 py-0.5 rounded-md whitespace-nowrap border border-border text-text-muted"
        >
          {fmtNative(n.amount, n.currency)}
        </span>
      ))}
    </div>
  );
}

/** Bars are drawn from `units`, so the list must be ordered by units too. */
const byUnits = (rows: Breakdown[]) =>
  [...rows].sort((a, b) => b.units - a.units || b.revenueUsd - a.revenueUsd);

/** The variant mix, inline — this is the "CMRP has four types" answer. */
function VariantChips({ variants, lang }: { variants: Breakdown[]; lang: "ar" | "en" }) {
  if (!variants.length) return <span className="text-text-subtle">{EM}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {variants.slice(0, 5).map((v) => (
        <span
          key={v.key}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] whitespace-nowrap"
          style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
          title={variantLabel(v.key, lang)}
        >
          <span className="truncate max-w-[110px]">{variantLabel(v.key, lang)}</span>
          <span className="num font-semibold text-text">{fmtNum(v.units)}</span>
        </span>
      ))}
      {variants.length > 5 && (
        <span className="text-[11px] text-text-subtle">+{variants.length - 5}</span>
      )}
    </div>
  );
}

function TopSource({
  sources,
  total,
  lang,
}: {
  sources: Breakdown[];
  total: number;
  lang: "ar" | "en";
}) {
  const top = sources[0];
  if (!top || !total) return <span className="text-text-subtle">{EM}</span>;
  const share = (top.units / total) * 100;
  return (
    <div className="min-w-0">
      <div className="truncate text-[13px] text-text">{sourceLabel(top.key, top.label, lang)}</div>
      <div className="num text-[11px] text-text-muted">
        {isFinite(share) ? `${share.toFixed(0)}%` : EM} · {sources.length}
      </div>
    </div>
  );
}

/* --- page ---------------------------------------------------------------- */

type Grouping = "family" | "product";
type Basis = "all" | "invoiced";

function Products() {
  const { t, lang } = useI18n();
  const [grouping, setGrouping] = useState<Grouping>("family");
  const [basis, setBasis] = useState<Basis>("all");
  const [company, setCompany] = useState<string>("");
  const [openFamily, setOpenFamily] = useState<FamilyRow | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const params = new URLSearchParams({ basis });
  if (company) params.set("company", company);
  if (detailId) params.set("detail", String(detailId));

  const { data, isLoading, error, refetch } = useApi<Resp>(`/api/products?${params.toString()}`);

  if (error) {
    // A deploy without Odoo credentials is a setup step, not a fault — say so in
    // the reader's language instead of echoing the server's English sentence.
    const raw = (error as Error).message;
    const unconfigured = /not configured/i.test(raw);
    return (
      <div className="space-y-5">
        <PageHeader title={t("products")} subtitle={t("products_sub")} />
        <ErrorState
          message={unconfigured ? t("odoo_unconfigured") : raw}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const totals = data?.totals;
  const health = data?.health;
  const notInvoiced = totals ? totals.units - totals.invoicedUnits : 0;

  const companyOptions = [
    { value: "", label: t("all_companies") },
    ...(health?.companies ?? []).map((c) => ({
      value: String(c.id),
      label: `${c.name} · ${c.currency}`,
    })),
  ];

  const familyCols: Col<FamilyRow>[] = [
    {
      key: "family",
      header: t("product_family"),
      sticky: true,
      width: "220px",
      sortValue: (r) => r.family,
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate text-text font-medium">
            {familyLabel(r.familyKey, r.family, lang)}
          </div>
          <div className="truncate text-[11px] text-text-subtle">{r.category || EM}</div>
        </div>
      ),
    },
    {
      key: "types",
      header: t("types"),
      width: "260px",
      sortValue: (r) => r.variants.length,
      render: (r) => <VariantChips variants={r.variants} lang={lang} />,
    },
    {
      key: "productCount",
      header: t("variants_count"),
      align: "right",
      sortValue: (r) => r.productCount,
      render: (r) => fmtNum(r.productCount),
    },
    {
      key: "units",
      header: t("units_sold"),
      align: "right",
      sortValue: (r) => r.units,
      render: (r) => fmtNum(r.units),
    },
    {
      key: "orders",
      header: t("orders_count"),
      align: "right",
      sortValue: (r) => r.orders,
      render: (r) => fmtNum(r.orders),
    },
    {
      key: "revenueUsd",
      header: t("revenue"),
      align: "right",
      sortValue: (r) => r.revenueUsd,
      render: (r) => fmtUSD(r.revenueUsd),
    },
    {
      key: "native",
      header: t("native_totals"),
      align: "right",
      width: "180px",
      sortValue: (r) => r.native[0]?.amount ?? 0,
      render: (r) => <NativeChips native={r.native} />,
    },
    {
      key: "avg",
      header: t("avg_price"),
      align: "right",
      sortValue: (r) => r.avgPriceUsd ?? -1,
      render: (r) =>
        r.avgPriceUsd === null ? (
          <span className="text-text-subtle">{EM}</span>
        ) : (
          fmtUSD(r.avgPriceUsd)
        ),
    },
    {
      key: "source",
      header: t("sale_source"),
      width: "150px",
      sortValue: (r) => r.sources[0]?.label ?? "",
      render: (r) => <TopSource sources={r.sources} total={r.units} lang={lang} />,
    },
  ];

  const productCols: Col<ProductRow>[] = [
    {
      key: "name",
      header: t("product"),
      sticky: true,
      width: "280px",
      sortValue: (r) => r.name,
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate text-text">{r.name.trim()}</div>
          <div className="truncate text-[11px] text-text-subtle">{r.category || EM}</div>
        </div>
      ),
    },
    {
      key: "variant",
      header: t("product_type"),
      width: "140px",
      sortValue: (r) => r.variantKey,
      render: (r) => (
        <Pill tone={r.isDiscount ? "warning" : "neutral"}>{variantLabel(r.variantKey, lang)}</Pill>
      ),
    },
    {
      key: "units",
      header: t("units_sold"),
      align: "right",
      sortValue: (r) => r.units,
      render: (r) => fmtNum(r.units),
    },
    {
      key: "orders",
      header: t("orders_count"),
      align: "right",
      sortValue: (r) => r.orders,
      render: (r) => fmtNum(r.orders),
    },
    {
      key: "revenueUsd",
      header: t("revenue"),
      align: "right",
      sortValue: (r) => r.revenueUsd,
      render: (r) => fmtUSD(r.revenueUsd),
    },
    {
      key: "native",
      header: t("native_totals"),
      align: "right",
      width: "180px",
      sortValue: (r) => r.native[0]?.amount ?? 0,
      render: (r) => <NativeChips native={r.native} />,
    },
    {
      key: "avg",
      header: t("avg_price"),
      align: "right",
      sortValue: (r) => r.avgPriceUsd ?? -1,
      render: (r) =>
        r.avgPriceUsd === null ? (
          <span className="text-text-subtle">{EM}</span>
        ) : (
          fmtUSD(r.avgPriceUsd)
        ),
    },
    {
      key: "source",
      header: t("sale_source"),
      width: "150px",
      sortValue: (r) => r.sources[0]?.label ?? "",
      render: (r) => <TopSource sources={r.sources} total={r.units} lang={lang} />,
    },
    {
      key: "last",
      header: t("last_sale"),
      align: "right",
      sortValue: (r) => r.lastSale,
      render: (r) => (
        <span className="num text-[12px]">{r.lastSale ? fmtDate(r.lastSale, lang) : EM}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("products")} subtitle={t("products_sub")} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{t("group_by")}</span>
          <Segmented
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: "family", label: t("grouped") },
              { value: "product", label: t("ungrouped") },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{t("basis")}</span>
          <Segmented
            value={basis}
            onChange={setBasis}
            options={[
              { value: "all", label: t("basis_confirmed") },
              { value: "invoiced", label: t("basis_invoiced") },
            ]}
          />
        </div>
        {companyOptions.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">{t("company")}</span>
            <Segmented value={company} onChange={setCompany} options={companyOptions} />
          </div>
        )}
        {health && (
          // Deliberately no count here. `ordersScanned` is how many orders were
          // fetched — including the extra timezone day and orders with no
          // product line — so showing it next to the Orders KPI read as two
          // contradictory order counts.
          <Pill tone={health.stale ? "warning" : "success"}>
            {health.stale ? t("stale") : t("odoo_live")}
          </Pill>
        )}
      </div>

      {isLoading || !data || !totals ? (
        <>
          <KpiSkeletonGrid count={4} />
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              index={0}
              hero
              label={t("units_sold")}
              value={fmtNum(totals.units)}
              icon={<Boxes size={16} />}
              sub={`${fmtNum(totals.products)} ${lang === "ar" ? "منتج" : "products"}`}
            />
            <KpiCard
              index={1}
              label={t("revenue")}
              value={fmtUSD(totals.revenueUsd)}
              icon={<Wallet size={16} />}
              sub={fmtUSDFull(totals.revenueUsd)}
            />
            <KpiCard
              index={2}
              label={t("orders_count")}
              value={fmtNum(totals.orders)}
              icon={<ShoppingCart size={16} />}
              // `notInvoiced` is a unit count, not an order count — say so, or it
              // reads as "236 of these 1,893 orders".
              sub={
                basis === "all" && notInvoiced > 0
                  ? `${fmtNum(notInvoiced)} ${lang === "ar" ? "وحدة" : "units"} · ${t("awaiting_invoice")}`
                  : undefined
              }
            />
            <KpiCard
              index={3}
              label={t("courses_grouped")}
              value={fmtNum(totals.families)}
              icon={<Layers size={16} />}
              sub={`${fmtNum(data.variants.length)} ${lang === "ar" ? "نوع" : "types"}`}
            />
          </div>

          <Card>
            <SectionTitle hint={t("currency_note")}>{t("native_totals")}</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {totals.native.map((n) => (
                <div
                  key={n.currency}
                  className="px-3 py-2 rounded-xl border border-border bg-surface-2 min-w-[140px]"
                >
                  <div className="text-[11px] text-text-muted">{n.currency}</div>
                  <div className="num text-[15px] font-semibold text-text">
                    {n.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </div>
                  <div className="num text-[11px] text-text-subtle">
                    {fmtNum(n.units)} {lang === "ar" ? "وحدة" : "units"}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {health && health.ordersWithoutSource > 0 && (
            <Notice tone="warning">
              {lang === "ar"
                ? `${fmtNum(health.ordersWithoutSource)} أمر بيع بدون مصدر مسجَّل في أودو — لا على الأمر ولا على الفرصة المرتبطة به. تظهر تحت «بدون مصدر مسجَّل» ولم تُوزَّع على أي قناة.`
                : `${fmtNum(health.ordersWithoutSource)} orders carry no source in Odoo — neither on the order nor on its opportunity. They sit under "No source recorded" and were not spread across the other channels.`}
            </Notice>
          )}

          {health?.warnings.map((w) => (
            <Notice key={w} tone="warning">
              {w}
            </Notice>
          ))}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <SectionTitle
                hint={lang === "ar" ? "مصدر أمر البيع في أودو" : "The sale order's source in Odoo"}
              >
                {t("by_source")}
              </SectionTitle>
              <BarList
                items={byUnits(data.sources)
                  .slice(0, 10)
                  .map((s) => ({
                    label: sourceLabel(s.key, s.label, lang),
                    value: s.units,
                    meta: `${fmtNum(s.units)} · ${fmtUSD(s.revenueUsd)}`,
                  }))}
                format={fmtNum}
              />
            </Card>
            <Card>
              <SectionTitle
                hint={
                  lang === "ar" ? "مسجَّل، حضوري، محاكي اختبار…" : "Recorded, live, exam simulator…"
                }
              >
                {t("by_type")}
              </SectionTitle>
              <BarList
                items={byUnits(data.variants)
                  .slice(0, 10)
                  .map((v) => ({
                    label: variantLabel(v.key, lang),
                    value: v.units,
                    meta: `${fmtNum(v.units)} · ${fmtUSD(v.revenueUsd)}`,
                  }))}
                format={fmtNum}
                color="var(--chart-3)"
              />
            </Card>
          </div>

          {data.monthly.length > 1 && (
            <Card>
              <SectionTitle>{t("by_month")}</SectionTitle>
              <MultiLineChart
                data={data.monthly.map((m) => ({
                  date: m.month,
                  units: m.units,
                  revenue: m.revenueUsd,
                }))}
                series={[
                  {
                    key: "units",
                    name: t("units_sold"),
                    color: "var(--chart-1)",
                    axis: "right" as const,
                  },
                  { key: "revenue", name: t("revenue"), color: "var(--chart-2)" },
                ]}
                height={220}
              />
            </Card>
          )}

          {grouping === "family" ? (
            <DataTable
              rows={data.families}
              cols={familyCols}
              searchable={(r) =>
                `${r.family} ${r.category} ${r.products.map((p) => p.name).join(" ")}`
              }
              initialSort={{ key: "revenueUsd", dir: -1 }}
              onRowClick={(r) => setOpenFamily(r)}
              csvFilename="engosoft-products-by-course"
              maxHeight={640}
              truncatedNote={t("basis_note")}
              csvRow={(r) => ({
                course: familyLabel(r.familyKey, r.family, "en"),
                category: r.category,
                products: r.productCount,
                types: r.variants.map((v) => `${variantLabel(v.key, "en")}=${v.units}`).join(" | "),
                units: r.units,
                orders: r.orders,
                revenue_usd: r.revenueUsd.toFixed(2),
                native: r.native.map((n) => `${n.amount.toFixed(2)} ${n.currency}`).join(" | "),
                avg_price_usd: r.avgPriceUsd?.toFixed(2) ?? "",
                sources: r.sources
                  .map((s) => `${sourceLabel(s.key, s.label, "en")}=${s.units}`)
                  .join(" | "),
              })}
            />
          ) : (
            <DataTable
              rows={data.products}
              cols={productCols}
              searchable={(r) => `${r.name} ${r.code} ${r.category}`}
              initialSort={{ key: "revenueUsd", dir: -1 }}
              onRowClick={(r) => setDetailId(r.productId)}
              csvFilename="engosoft-products"
              maxHeight={640}
              truncatedNote={t("basis_note")}
              csvRow={(r) => ({
                product: r.name.trim(),
                code: r.code,
                category: r.category,
                type: variantLabel(r.variantKey, "en"),
                course: r.family,
                units: r.units,
                orders: r.orders,
                revenue_usd: r.revenueUsd.toFixed(2),
                native: r.native.map((n) => `${n.amount.toFixed(2)} ${n.currency}`).join(" | "),
                avg_price_usd: r.avgPriceUsd?.toFixed(2) ?? "",
                sources: r.sources
                  .map((s) => `${sourceLabel(s.key, s.label, "en")}=${s.units}`)
                  .join(" | "),
                first_sale: r.firstSale,
                last_sale: r.lastSale,
              })}
            />
          )}

          {openFamily && (
            <FamilyDrawer
              family={openFamily}
              onClose={() => setOpenFamily(null)}
              onProduct={(id) => {
                setOpenFamily(null);
                setGrouping("product");
                setDetailId(id);
              }}
            />
          )}
          {detailId !== null && data.detail && (
            <ProductDrawer detail={data.detail} onClose={() => setDetailId(null)} />
          )}
        </>
      )}
    </div>
  );
}

/* --- drawers ------------------------------------------------------------- */

function DrawerShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center animate-fade-in"
      style={{ background: "rgba(4, 12, 24, 0.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full sm:max-w-3xl glass rounded-t-3xl sm:rounded-3xl p-5 max-h-[88vh] overflow-y-auto animate-slide-up sm:animate-scale-in"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="min-w-0">
            <h2 className="font-semibold text-text text-lg leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-text-muted mt-1">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="w-10 h-10 shrink-0 grid place-items-center rounded-full hover:bg-surface-2 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-5">{children}</div>
      </div>
    </div>
  );
}

function FamilyDrawer({
  family,
  onClose,
  onProduct,
}: {
  family: FamilyRow;
  onClose: () => void;
  onProduct: (id: number) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <DrawerShell
      title={familyLabel(family.familyKey, family.family, lang)}
      subtitle={`${family.category || ""} · ${fmtNum(family.units)} ${t("units_sold")} · ${fmtUSD(family.revenueUsd)}`}
      onClose={onClose}
    >
      <div>
        <SectionTitle
          hint={
            lang === "ar"
              ? "الأرقام محسوبة لكل منتج على حدة في أودو"
              : "Each row is a separate Odoo product"
          }
        >
          {t("types")}
        </SectionTitle>
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="text-start font-medium py-2">{t("product")}</th>
                <th className="text-end font-medium py-2">{t("units_sold")}</th>
                <th className="text-end font-medium py-2">{t("revenue")}</th>
                <th className="text-end font-medium py-2">{t("native_totals")}</th>
              </tr>
            </thead>
            <tbody>
              {family.products.map((p) => (
                <tr
                  key={p.productId}
                  className="border-t border-border cursor-pointer hover:bg-surface-2"
                  onClick={() => onProduct(p.productId)}
                >
                  <td className="py-2.5 pe-3">
                    <div className="text-text">{p.name.trim()}</div>
                    <div className="mt-1">
                      <Pill tone={p.isDiscount ? "warning" : "brand"}>
                        {variantLabel(p.variantKey, lang)}
                      </Pill>
                    </div>
                  </td>
                  <td className="py-2.5 text-end num">{fmtNum(p.units)}</td>
                  <td className="py-2.5 text-end num">{fmtUSD(p.revenueUsd)}</td>
                  <td className="py-2.5 text-end">
                    <NativeChips native={p.native} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <SectionTitle>{t("by_source")}</SectionTitle>
          <BarList
            items={byUnits(family.sources)
              .slice(0, 8)
              .map((s) => ({
                label: sourceLabel(s.key, s.label, lang),
                value: s.units,
                meta: `${fmtNum(s.units)} · ${fmtUSD(s.revenueUsd)}`,
              }))}
            format={fmtNum}
          />
        </div>
        <div>
          <SectionTitle>{t("by_type")}</SectionTitle>
          <BarList
            items={byUnits(family.variants).map((v) => ({
              label: variantLabel(v.key, lang),
              value: v.units,
              meta: `${fmtNum(v.units)} · ${fmtUSD(v.revenueUsd)}`,
            }))}
            format={fmtNum}
            color="var(--chart-3)"
          />
        </div>
      </div>
    </DrawerShell>
  );
}

function ProductDrawer({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const { t, lang } = useI18n();
  return (
    <DrawerShell title={detail.name.trim()} onClose={onClose}>
      {detail.monthly.length > 1 && (
        <div>
          <SectionTitle>{t("by_month")}</SectionTitle>
          <MultiLineChart
            data={detail.monthly.map((m) => ({
              date: m.month,
              units: m.units,
              revenue: m.revenueUsd,
            }))}
            series={[
              {
                key: "units",
                name: t("units_sold"),
                color: "var(--chart-1)",
                axis: "right" as const,
              },
              { key: "revenue", name: t("revenue"), color: "var(--chart-2)" },
            ]}
            height={200}
          />
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <SectionTitle>{t("by_source")}</SectionTitle>
          <BarList
            items={byUnits(detail.sources)
              .slice(0, 8)
              .map((s) => ({
                label: sourceLabel(s.key, s.label, lang),
                value: s.units,
                meta: `${fmtNum(s.units)} · ${fmtUSD(s.revenueUsd)}`,
              }))}
            format={fmtNum}
          />
        </div>
        <div>
          <SectionTitle>{t("by_campaign")}</SectionTitle>
          <BarList
            items={byUnits(detail.campaigns)
              .slice(0, 8)
              .map((c) => ({
                label: c.label,
                value: c.units,
                meta: `${fmtNum(c.units)} · ${fmtUSD(c.revenueUsd)}`,
              }))}
            format={fmtNum}
            color="var(--chart-4)"
            emptyLabel={lang === "ar" ? "لا توجد حملة على أي أمر بيع" : "No campaign on any order"}
          />
        </div>
        <div>
          <SectionTitle>{t("by_salesperson")}</SectionTitle>
          <BarList
            items={byUnits(detail.salespeople)
              .slice(0, 8)
              .map((s) => ({
                label: s.label,
                value: s.units,
                meta: fmtNum(s.units),
              }))}
            format={fmtNum}
            color="var(--chart-3)"
          />
        </div>
        <div>
          <SectionTitle>{t("by_company")}</SectionTitle>
          <BarList
            items={byUnits(detail.companies).map((c) => ({
              label: c.label,
              value: c.units,
              meta: `${fmtNum(c.units)} · ${fmtUSD(c.revenueUsd)}`,
            }))}
            format={fmtNum}
            color="var(--chart-5)"
          />
        </div>
      </div>

      <div>
        <SectionTitle hint={`${detail.orders.length} ${lang === "ar" ? "سطر" : "lines"}`}>
          {t("recent_orders")}
        </SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="text-start font-medium py-2">#</th>
                <th className="text-start font-medium py-2">{t("date_range")}</th>
                <th className="text-start font-medium py-2">{t("sale_source")}</th>
                <th className="text-end font-medium py-2">{t("units_sold")}</th>
                <th className="text-end font-medium py-2">{t("native_totals")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.orders.slice(0, 40).map((o, i) => (
                <tr key={`${o.orderName}-${i}`} className="border-t border-border">
                  <td className="py-2 num text-[12px] whitespace-nowrap">{o.orderName || EM}</td>
                  <td className="py-2 num text-[12px] whitespace-nowrap">
                    {fmtDate(o.date, lang)}
                  </td>
                  <td className="py-2 text-[12px] truncate max-w-[160px]">
                    {sourceLabel(o.sourceKey, o.source, lang)}
                  </td>
                  <td className="py-2 text-end num text-[12px]">{fmtNum(o.qty)}</td>
                  <td className="py-2 text-end num text-[12px] whitespace-nowrap">
                    {fmtNative(o.total, o.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DrawerShell>
  );
}
