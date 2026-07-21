import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/website")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getFiltered } = await import("@/lib/metrics.server");
        const { normalizeName } = await import("@/lib/sheet-cache.server");
        const { parseFilters, json, capped } = await import("@/lib/api.server");
        const filters = await parseFilters(request);

        // Website leads come from Odoo CRM Source=Website. Website revenue comes
        // only from the dedicated Odoo sale.order dataset (Website=Engosoft,
        // state=sale). Meta/Snap filters never participate in this endpoint.
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

        const equals = (left: string, right?: string) =>
          !right || normalizeName(left) === normalizeName(right);
        const inDateRange = (date: string) => {
          if (!filters.from && !filters.to) return true;
          if (!date) return false;
          if (filters.from && date < filters.from) return false;
          if (filters.to && date > filters.to) return false;
          return true;
        };

        const websiteSales = uniqueById(data.snapshot.websiteSales).filter((row) => {
          if (normalizeName(row.website) !== "engosoft") return false;
          if (!["sale", "sales order"].includes(normalizeName(row.status))) return false;
          if (!inDateRange(row.orderDate)) return false;
          if (!equals(row.course, filters.course)) return false;
          if (!equals(row.mainCategory, filters.mainCategory)) return false;
          if (!equals(row.salesTeam, filters.salesTeam)) return false;
          if (!equals(row.salesperson, filters.salesperson)) return false;
          return true;
        });

        type Specialty = {
          specialty: string;
          total: number;
          won: number;
          lost: number;
          open: number;
          notContacted: number;
          sales: number;
          quantity: number;
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
              quantity: 0,
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
          const row = touch(sale.course || sale.product);
          row.sales += sale.usdSales;
          row.quantity += sale.quantity;
          if (sale.orderRef) row.salesOrders.add(normalizeName(sale.orderRef));
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
            quantity: row.quantity,
            salesOrders: row.salesOrders.size,
          }))
          .sort((a, b) => b.total - a.total || b.sales - a.sales);

        const soldCourses = specialtyRows
          .filter((row) => row.salesOrders > 0)
          .sort((a, b) => b.sales - a.sales)
          .map((row) => ({
            label: row.specialty,
            value: row.sales,
            orders: row.salesOrders,
            quantity: row.quantity,
          }));
        const unsoldCourses = specialtyRows
          .filter((row) => row.specialty !== "—" && row.total > 0 && row.salesOrders === 0)
          .sort((a, b) => b.total - a.total || b.open - a.open)
          .map((row) => ({
            label: row.specialty,
            leads: row.total,
            open: row.open,
            lost: row.lost,
            notContacted: row.notContacted,
          }));

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
            (candidate) => lead.daysWaiting >= candidate.min && lead.daysWaiting <= candidate.max,
          );
          if (bucket) bucket.count++;
        }

        const salesTotal = websiteSales.reduce((sum, row) => sum + row.usdSales, 0);
        const orderCount = new Set(
          websiteSales.map((row) => normalizeName(row.orderRef)).filter(Boolean),
        ).size;
        const conversionRate =
          crm.length + lost.length ? (won.length / (crm.length + lost.length)) * 100 : null;

        return json({
          totals: {
            leads: crm.length + lost.length,
            won: won.length,
            lost: lost.length,
            open: open.length,
            notContacted: notContacted.length,
            sales: salesTotal,
            salesOrders: orderCount,
            soldCourses: soldCourses.length,
            unsoldCourses: unsoldCourses.length,
            averageOrder: orderCount ? salesTotal / orderCount : null,
          },
          specialties: specialtyRows,
          waitingBuckets: buckets.map(({ label, count }) => ({ label, count })),
          soldCourses,
          unsoldCourses,
          insights: {
            bestSellingCourse: soldCourses[0] || null,
            highestDemandUnsoldCourse: unsoldCourses[0] || null,
            conversionRate,
            averageOrder: orderCount ? salesTotal / orderCount : null,
          },
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
          salesSource: "odoo_sale_order.website_id=Engosoft,state=sale",
          salesDateBasis: "order_date",
          contactAgeBasis: "last_stage_update_fallback_created_at",
          appliedFilters: websiteFilters,
        });
      },
    },
  },
});
