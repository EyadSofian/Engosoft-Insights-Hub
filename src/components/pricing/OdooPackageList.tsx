import { BookOpenCheck, Building2, Database, Radio, TrendingUp } from "lucide-react";
import { Pill } from "@/components/ui-bits";
import { fmtDate, fmtNum, useI18n } from "@/lib/i18n";
import { fmtMoney, type TrainingPackageEntry } from "./pricing-ui";

export function OdooPackageList({ packages }: { packages: TrainingPackageEntry[] }) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const orders = packages.reduce((sum, item) => sum + item.demand.orders, 0);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Database size={14} className="shrink-0 text-brand" aria-hidden="true" />
          <h2 className="truncate text-[12.5px] font-bold text-text">
            {ar ? "الباقات المعتمدة من Odoo" : "Odoo packages"}
          </h2>
          <Pill tone="brand">Odoo</Pill>
        </div>
        <span className="num text-[10.5px] text-text-subtle">
          {fmtNum(packages.length)} {ar ? "باقة" : "packages"} · {fmtNum(orders)}{" "}
          {ar ? "عملية بيع" : "sales"}
        </span>
      </div>

      <div className="hidden xl:grid xl:grid-cols-[minmax(260px,1.5fr)_minmax(120px,0.65fr)_minmax(150px,0.8fr)_minmax(170px,0.9fr)_minmax(150px,0.75fr)] xl:gap-x-4 xl:border-b xl:border-border xl:px-4 xl:py-1.5">
        {[
          ar ? "الباقة" : "Package",
          ar ? "الإقبال" : "Demand",
          ar ? "سعر Odoo" : "Odoo price",
          ar ? "المحتوى" : "Contents",
          ar ? "المصدر" : "Source",
        ].map((heading) => (
          <span
            key={heading}
            className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle"
          >
            {heading}
          </span>
        ))}
      </div>

      {packages.map((item, index) => {
        const price = item.finalPrice ?? item.listPrice;
        const discounted =
          item.finalPrice !== null &&
          item.listPrice !== null &&
          item.finalPrice > 0 &&
          item.listPrice > item.finalPrice;
        return (
          <div
            key={item.id}
            className="grid gap-3 border-b border-border px-3 py-3 last:border-b-0 hover:bg-surface-2/60 sm:px-4 xl:grid-cols-[minmax(260px,1.5fr)_minmax(120px,0.65fr)_minmax(150px,0.8fr)_minmax(170px,0.9fr)_minmax(150px,0.75fr)] xl:items-center xl:gap-x-4"
          >
            <div className="min-w-0">
              <div className="flex items-start gap-2">
                <span className="num mt-0.5 grid h-6 min-w-6 shrink-0 place-items-center rounded-md bg-brand-soft px-1 text-[10px] font-bold text-brand">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[13px] font-bold leading-snug text-text">
                    <bdi>{item.name}</bdi>
                  </h3>
                  <p className="mt-0.5 truncate text-[10.5px] text-text-subtle">
                    {item.companyName || (ar ? "كل الشركات" : "All companies")}
                  </p>
                </div>
              </div>
            </div>

            <div className="min-w-0">
              <span className="xl:hidden text-[10px] font-semibold text-text-subtle">
                {ar ? "الإقبال · " : "Demand · "}
              </span>
              {item.demand.orders > 0 ? (
                <span className="num inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-1 text-[11.5px] font-bold text-brand">
                  <TrendingUp size={12} aria-hidden="true" />
                  {fmtNum(item.demand.orders)} {ar ? "مبيعات" : "sales"}
                </span>
              ) : (
                <span className="text-[10.5px] text-text-subtle">
                  {ar ? "لا مبيعات في الفترة" : "No sales in period"}
                </span>
              )}
            </div>

            <div className="min-w-0">
              <div className="xl:hidden text-[10px] font-semibold text-text-subtle">
                {ar ? "سعر Odoo" : "Odoo price"}
              </div>
              <div className="num text-[13px] font-bold text-text">
                {price !== null ? fmtMoney(price, item.currency || "EGP", lang) : "—"}
              </div>
              {discounted && (
                <div className="num text-[10px] text-text-subtle line-through">
                  {fmtMoney(item.listPrice, item.currency || "EGP", lang)}
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-text-muted">
                <BookOpenCheck size={12} aria-hidden="true" />
                {fmtNum(item.courseCount)} {ar ? "دورات" : "courses"}
              </span>
              {item.recordedCourseCount > 0 && (
                <Pill tone="neutral">
                  {fmtNum(item.recordedCourseCount)} {ar ? "مسجل" : "recorded"}
                </Pill>
              )}
              {item.attendanceCourseCount > 0 && (
                <Pill tone="neutral">
                  <Radio size={10} aria-hidden="true" /> {fmtNum(item.attendanceCourseCount)}{" "}
                  {ar ? "مباشر" : "live"}
                </Pill>
              )}
            </div>

            <div className="min-w-0 text-[10.5px] text-text-subtle">
              <div className="flex items-center gap-1 font-semibold text-text-muted">
                <Building2 size={12} aria-hidden="true" />
                <span>training.package</span>
              </div>
              {item.updatedAt && (
                <p className="mt-0.5">
                  {ar ? "محدّثة" : "Updated"} {fmtDate(item.updatedAt, lang)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
