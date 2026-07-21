import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/website")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered } = await import("@/lib/metrics.server");
        const { normalizeName } = await import("@/lib/sheet-cache.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");
        const filters = await parseFilters(request);

        // This page is deliberately a Website cohort. Ad-platform, account and
        // creative filters must not silently turn it into a Meta/Snap cohort.
        const websiteFilters = {
          from: filters.from,
          to: filters.to,
          source: "Website",
          course: filters.course,
          mainCategory: filters.mainCategory,
          salesTeam: filters.salesTeam,
          salesperson: filters.salesperson,
        };
        const data = await getFiltered(websiteFilters);
        const identityData = await getFiltered({
          ...websiteFilters,
          from: undefined,
          to: undefined,
          range: "all",
        });

        const uniqueById = <T extends { id: string }>(rows: T[]): T[] => {
          const seen = new Set<string>();
          return rows.filter((row, index) => {
            const key = row.id || `blank:${index}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        };

        const crm = uniqueById(data.crm);
        const lost = uniqueById(data.lost);
        const won = crm.filter((lead) => lead.isWon);
        const open = crm.filter((lead) => !lead.isWon);

        const isNotContacted = (reply: string): boolean => {
          const value = normalizeName(reply);
          if (!value) return true;
          if (
            /not\s*(answer|answered|reply)|no\s*(answer|reply)|لم\s*(يرد|يتم الرد)/i.test(value)
          ) {
            return true;
          }
          return !/(^|\s)(answered|connected|replied)(\s|$)|تم\s*الرد|رد\s*العميل/i.test(value);
        };

        const asOf =
          filters.to || data.snapshot.crmDateMax || new Date().toISOString().slice(0, 10);
        const dateMs = (value: string) => Date.parse(`${value}T12:00:00Z`);
        const waitDays = (value: string) => {
          const start = dateMs(value);
          const end = dateMs(asOf);
          return Number.isFinite(start) && Number.isFinite(end)
            ? Math.max(0, Math.floor((end - start) / 86_400_000))
            : 0;
        };

        const notContacted = open
          .filter((lead) => isNotContacted(lead.callingReply))
          .map((lead) => {
            const waitingSince = lead.lastStageUpdate || lead.createdAt;
            return { ...lead, waitingSince, daysWaiting: waitDays(waitingSince) };
          })
          .sort((a, b) => b.daysWaiting - a.daysWaiting);

        const orderTokens = (value: string): string[] =>
          value
            .split(/[,;|\n]+/)
            .map((part) => normalizeName(part))
            .filter(Boolean);
        const websiteOrders = new Set(
          identityData.invoiced.flatMap((row) => orderTokens(row.orderRef)),
        );
        const websiteSales = data.sales.filter((row) =>
          orderTokens(row.orderRef).some((ref) => websiteOrders.has(ref)),
        );

        type Specialty = {
          specialty: string;
          total: number;
          won: number;
          lost: number;
          open: number;
          notContacted: number;
          sales: number;
          salesOrders: Set<string>;
        };
        const specialties = new Map<string, Specialty>();
        const touch = (label: string) => {
          const specialty = label || "—";
          const key = normalizeName(specialty) || "—";
          let row = specialties.get(key);
          if (!row) {
            row = {
              specialty,
              total: 0,
              won: 0,
              lost: 0,
              open: 0,
              notContacted: 0,
              sales: 0,
              salesOrders: new Set(),
            };
            specialties.set(key, row);
          }
          return row;
        };

        for (const lead of crm) {
          const row = touch(lead.course);
          row.total++;
          if (lead.isWon) row.won++;
          else row.open++;
        }
        for (const lead of lost) {
          const row = touch(lead.course);
          row.total++;
          row.lost++;
        }
        for (const lead of notContacted) touch(lead.course).notContacted++;
        for (const sale of websiteSales) {
          const row = touch(sale.course);
          row.sales += sale.usdSales;
          for (const ref of orderTokens(sale.orderRef)) row.salesOrders.add(ref);
        }

        const specialtyRows = [...specialties.values()]
          .map((row) => ({
            specialty: row.specialty,
            total: row.total,
            won: row.won,
            lost: row.lost,
            open: row.open,
            notContacted: row.notContacted,
            conversionRate: row.total ? (row.won / row.total) * 100 : null,
            lostRate: row.total ? (row.lost / row.total) * 100 : null,
            sales: row.sales,
            salesOrders: row.salesOrders.size,
          }))
          .sort((a, b) => b.total - a.total || b.sales - a.sales);

        const buckets = [
          { label: "0", min: 0, max: 0, count: 0 },
          { label: "1–3", min: 1, max: 3, count: 0 },
          { label: "4–7", min: 4, max: 7, count: 0 },
          { label: "8–14", min: 8, max: 14, count: 0 },
          { label: "15–30", min: 15, max: 30, count: 0 },
          { label: "31+", min: 31, max: Number.POSITIVE_INFINITY, count: 0 },
        ];
        for (const lead of notContacted) {
          const bucket = buckets.find(
            (b) => lead.daysWaiting >= b.min && lead.daysWaiting <= b.max,
          );
          if (bucket) bucket.count++;
        }

        const salesTotal = websiteSales.reduce((sum, row) => sum + row.usdSales, 0);
        return json({
          totals: {
            leads: crm.length + lost.length,
            won: won.length,
            lost: lost.length,
            open: open.length,
            notContacted: notContacted.length,
            sales: salesTotal,
            salesOrders: new Set(websiteSales.flatMap((row) => orderTokens(row.orderRef))).size,
          },
          specialties: specialtyRows,
          waitingBuckets: buckets.map(({ label, count }) => ({ label, count })),
          salesByCourse: specialtyRows
            .filter((row) => row.sales !== 0)
            .sort((a, b) => b.sales - a.sales)
            .map((row) => ({ label: row.specialty, value: row.sales, orders: row.salesOrders })),
          detail: capped(
            notContacted.map((lead) => ({
              createdAt: lead.createdAt,
              contact: lead.contact,
              course: lead.course,
              stage: lead.cleanedStage || lead.stage,
              salesperson: lead.salesperson,
              callingReply: lead.callingReply,
              lastStageUpdate: lead.lastStageUpdate,
              waitingSince: lead.waitingSince,
              daysWaiting: lead.daysWaiting,
            })),
          ),
          asOf,
          salesDateBasis: "payment_date",
          contactAgeBasis: "last_stage_update_fallback_created_at",
          appliedFilters: websiteFilters,
        });
      },
    },
  },
});
