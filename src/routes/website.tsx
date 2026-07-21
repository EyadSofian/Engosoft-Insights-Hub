import { createFileRoute } from "@tanstack/react-router";
import { Banknote, CircleCheckBig, CircleDot, CircleX, Clock3, Globe2 } from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import {
  BarList,
  Card,
  ErrorState,
  KpiCard,
  PageHeader,
  Pill,
  SectionTitle,
  Skeleton,
} from "@/components/ui-bits";
import { fmtDate, fmtNum, fmtPct, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";

export const Route = createFileRoute("/website")({ component: Website });

interface SpecialtyRow {
  specialty: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  notContacted: number;
  conversionRate: number | null;
  lostRate: number | null;
  sales: number;
  salesOrders: number;
}

interface ContactRow {
  createdAt: string;
  contact: string;
  course: string;
  stage: string;
  salesperson: string;
  callingReply: string;
  lastStageUpdate: string;
  waitingSince: string;
  daysWaiting: number;
}

interface Resp {
  totals: {
    leads: number;
    won: number;
    lost: number;
    open: number;
    notContacted: number;
    sales: number;
    salesOrders: number;
  };
  specialties: SpecialtyRow[];
  waitingBuckets: { label: string; count: number }[];
  salesByCourse: { label: string; value: number; orders: number }[];
  detail: { rows: ContactRow[]; total: number; truncated: boolean };
  asOf: string;
}

function Website() {
  const { t, lang } = useI18n();
  const { data, isLoading, error, refetch } = useApi<Resp>("/api/website");

  if (error) return <ErrorState message={(error as Error).message} onRetry={() => refetch()} />;

  const specialtyCols: Col<SpecialtyRow>[] = [
    {
      key: "specialty",
      header: t("course"),
      sticky: true,
      sortValue: (r) => r.specialty,
      render: (r) => r.specialty,
    },
    {
      key: "total",
      header: t("leads_count"),
      align: "right",
      sortValue: (r) => r.total,
      render: (r) => fmtNum(r.total),
    },
    {
      key: "won",
      header: t("won"),
      align: "right",
      sortValue: (r) => r.won,
      render: (r) => fmtNum(r.won),
    },
    {
      key: "lost",
      header: t("lost_count"),
      align: "right",
      sortValue: (r) => r.lost,
      render: (r) => fmtNum(r.lost),
    },
    {
      key: "open",
      header: t("open_leads"),
      align: "right",
      sortValue: (r) => r.open,
      render: (r) => fmtNum(r.open),
    },
    {
      key: "notContacted",
      header: t("not_contacted"),
      align: "right",
      sortValue: (r) => r.notContacted,
      render: (r) => fmtNum(r.notContacted),
    },
    {
      key: "conversionRate",
      header: t("conversion_rate"),
      align: "right",
      sortValue: (r) => r.conversionRate ?? -1,
      render: (r) => fmtPct(r.conversionRate, 1),
    },
    {
      key: "sales",
      header: t("website_sales"),
      align: "right",
      sortValue: (r) => r.sales,
      render: (r) => fmtUSD(r.sales),
    },
  ];

  const contactCols: Col<ContactRow>[] = [
    {
      key: "waitingSince",
      header: t("waiting_since"),
      sticky: true,
      width: "120px",
      sortValue: (r) => r.waitingSince,
      render: (r) => fmtDate(r.waitingSince, lang),
    },
    {
      key: "daysWaiting",
      header: t("waiting_days"),
      align: "right",
      sortValue: (r) => r.daysWaiting,
      render: (r) => `${fmtNum(r.daysWaiting)} ${t("days")}`,
    },
    {
      key: "contact",
      header: t("contact"),
      sortValue: (r) => r.contact,
      render: (r) => r.contact || "—",
    },
    {
      key: "course",
      header: t("course"),
      sortValue: (r) => r.course,
      render: (r) => r.course || "—",
    },
    {
      key: "stage",
      header: t("stage"),
      sortValue: (r) => r.stage,
      render: (r) => <Pill tone="warning">{r.stage || "—"}</Pill>,
    },
    {
      key: "salesperson",
      header: t("salesperson"),
      sortValue: (r) => r.salesperson,
      render: (r) => r.salesperson || "—",
    },
    {
      key: "callingReply",
      header: t("calling_reply"),
      sortValue: (r) => r.callingReply,
      render: (r) => r.callingReply || "—",
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("website")} subtitle={t("website_subtitle")} />

      {isLoading || !data ? (
        <>
          <Skeleton className="h-28" />
          <Skeleton className="h-80" />
        </>
      ) : (
        <>
          <div className="rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-xs text-text-muted leading-relaxed">
            {t("website_filter_note")}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard
              index={0}
              label={t("website_leads")}
              value={fmtNum(data.totals.leads)}
              icon={<Globe2 size={18} />}
            />
            <KpiCard
              index={1}
              label={t("won")}
              value={fmtNum(data.totals.won)}
              sub={fmtPct(
                data.totals.leads ? (data.totals.won / data.totals.leads) * 100 : null,
                1,
              )}
              icon={<CircleCheckBig size={18} />}
            />
            <KpiCard
              index={2}
              label={t("lost_count")}
              value={fmtNum(data.totals.lost)}
              sub={fmtPct(
                data.totals.leads ? (data.totals.lost / data.totals.leads) * 100 : null,
                1,
              )}
              icon={<CircleX size={18} />}
            />
            <KpiCard
              index={3}
              label={t("open_leads")}
              value={fmtNum(data.totals.open)}
              icon={<CircleDot size={18} />}
            />
            <KpiCard
              index={4}
              label={t("not_contacted")}
              value={fmtNum(data.totals.notContacted)}
              icon={<Clock3 size={18} />}
            />
            <KpiCard
              index={5}
              hero
              label={t("website_sales")}
              value={fmtUSD(data.totals.sales)}
              sub={`${fmtNum(data.totals.salesOrders)} ${t("orders")}`}
              icon={<Banknote size={18} />}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle>{t("website_pipeline")}</SectionTitle>
              <BarList
                max={data.totals.leads}
                items={[
                  { label: t("won"), value: data.totals.won },
                  { label: t("lost_count"), value: data.totals.lost },
                  { label: t("open_leads"), value: data.totals.open },
                  { label: t("not_contacted"), value: data.totals.notContacted },
                ]}
                format={fmtNum}
              />
            </Card>
            <Card>
              <SectionTitle hint={`${t("as_of")} ${fmtDate(data.asOf, lang)}`}>
                {t("waiting_age")}
              </SectionTitle>
              <BarList
                items={data.waitingBuckets.map((row) => ({
                  label: row.label === "0" ? t("today") : `${row.label} ${t("days")}`,
                  value: row.count,
                }))}
                format={fmtNum}
                color="var(--warning)"
              />
            </Card>
          </div>

          <Card>
            <SectionTitle hint={t("website_sales_payment_note")}>
              {t("website_sales_by_specialty")}
            </SectionTitle>
            <BarList
              items={data.salesByCourse.slice(0, 12).map((row) => ({
                label: row.label,
                value: row.value,
                meta: (
                  <span>
                    {fmtUSD(row.value)} · {fmtNum(row.orders)} {t("orders")}
                  </span>
                ),
              }))}
              format={fmtUSD}
              color="var(--success)"
            />
          </Card>

          <div>
            <SectionTitle hint={t("website_specialty_note")}>
              {t("website_by_specialty")}
            </SectionTitle>
            <DataTable
              rows={data.specialties}
              cols={specialtyCols}
              searchable={(r) => r.specialty}
              initialSort={{ key: "total", dir: -1 }}
              csvFilename="engosoft-website-specialties"
              csvRow={(r) => ({
                specialty: r.specialty,
                leads: r.total,
                won: r.won,
                lost: r.lost,
                open: r.open,
                not_contacted: r.notContacted,
                conversion_rate: r.conversionRate ?? "",
                sales_usd: r.sales,
                sales_orders: r.salesOrders,
              })}
            />
          </div>

          <div>
            <SectionTitle hint={t("contact_age_note")}>{t("not_contacted_detail")}</SectionTitle>
            <DataTable
              rows={data.detail.rows}
              cols={contactCols}
              searchable={(r) =>
                `${r.contact} ${r.course} ${r.stage} ${r.salesperson} ${r.callingReply}`
              }
              initialSort={{ key: "daysWaiting", dir: -1 }}
              csvFilename="engosoft-website-not-contacted"
              maxHeight={620}
              truncatedNote={
                data.detail.truncated
                  ? `${t("showing")} ${fmtNum(data.detail.rows.length)} ${t("of")} ${fmtNum(data.detail.total)}`
                  : undefined
              }
              csvRow={(r) => ({
                created_at: r.createdAt,
                contact: r.contact,
                course: r.course,
                stage: r.stage,
                salesperson: r.salesperson,
                calling_reply: r.callingReply,
                last_stage_update: r.lastStageUpdate,
                waiting_since: r.waitingSince,
                waiting_days: r.daysWaiting,
              })}
            />
          </div>
        </>
      )}
    </div>
  );
}
