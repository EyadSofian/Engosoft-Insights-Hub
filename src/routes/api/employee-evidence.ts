import { createFileRoute } from "@tanstack/react-router";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/api/employee-evidence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json, capped } = await import("@/lib/api.server");
        const { getFiltered } = await import("@/lib/metrics.server");
        const { normalizePersonName } = await import("@/lib/person-name");
        const { odooConfig } = await import("@/lib/odoo.server");
        const { isArchivedWonStage } = await import("@/lib/archived-won");
        const { getCallsHubLeadCalls } = await import("@/lib/calls-hub.server");
        const { chatwootConfigured, getChatwootAgentConversationEvidence } =
          await import("@/lib/chatwoot.server");

        const url = new URL(request.url);
        const employee = (url.searchParams.get("employee") || "").trim();
        const extension = (url.searchParams.get("extension") || "").trim();
        const chatwootAgentId = Number(url.searchParams.get("chatwoot_agent_id") || 0);
        if (!employee || employee.length > 160) {
          return Response.json({ error: "A valid employee name is required" }, { status: 400 });
        }
        const filters = await parseFilters(request);
        if (
          !filters.from ||
          !filters.to ||
          !datePattern.test(filters.from) ||
          !datePattern.test(filters.to)
        ) {
          return Response.json({ error: "A valid date range is required" }, { status: 400 });
        }

        const employeeKey = normalizePersonName(employee);
        const sharedFilters = { ...filters };
        delete sharedFilters.salesperson;
        const data = await getFiltered(sharedFilters);
        const leadCalls = await getCallsHubLeadCalls(filters.from, filters.to).catch(() => []);
        const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
        const phoneKey = (value: string) => {
          const digits = value
            .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
            .replace(/\D/g, "");
          return digits.length >= 9 ? digits.slice(-9) : "";
        };
        const callsByPhone = new Map<string, typeof leadCalls>();
        for (const call of leadCalls) {
          const key = phoneKey(call.phone);
          if (!key) continue;
          callsByPhone.set(key, [...(callsByPhone.get(key) ?? []), call]);
        }
        const odooBaseUrl = odooConfig().url;
        const leadUrl = (rawId: string) => {
          const id = Number(rawId);
          return Number.isInteger(id) && id > 0
            ? `${odooBaseUrl}/web#id=${id}&model=crm.lead&view_type=form`
            : null;
        };
        const withCallEvidence = <T extends { phone: string }>(lead: T) => {
          const calls = callsByPhone.get(phoneKey(lead.phone)) ?? [];
          const ownerCalls = calls.filter(
            (call) =>
              normalizePersonName(call.agentName) === employeeKey ||
              (!!extension && call.agentExtension === extension),
          );
          return {
            ...lead,
            calledByAny: calls.length > 0,
            calledByOwner: ownerCalls.length > 0,
            totalCalls: calls.reduce((sum, call) => sum + call.totalCalls, 0),
            ownerCalls: ownerCalls.reduce((sum, call) => sum + call.totalCalls, 0),
            firstCallAt:
              calls
                .map((call) => call.firstCallAt)
                .filter(Boolean)
                .sort()
                .at(0) ?? null,
            latestCallAt:
              calls
                .map((call) => call.latestCallAt)
                .filter(Boolean)
                .sort()
                .at(-1) ?? null,
          };
        };
        const activeLeads = data.crm
          .filter((row) => normalizePersonName(row.salesperson) === employeeKey)
          .map((row) =>
            withCallEvidence({
              id: row.id,
              contact: row.contact,
              phone: row.phone || row.mobile,
              stage: row.stage,
              course: row.course,
              createdAt: row.createdAt,
              outcome: row.isWon ? "won" : "open",
              url: leadUrl(row.id),
            }),
          );
        const archivedLeads = data.lost
          .filter((row) => normalizePersonName(row.salesperson) === employeeKey)
          .map((row) =>
            withCallEvidence({
              id: row.id,
              contact: row.contact,
              phone: row.phone || row.mobile,
              stage: row.stage,
              course: row.course,
              createdAt: row.createdAt,
              outcome: isArchivedWonStage(row.stage) ? ("won" as const) : ("lost" as const),
              url: leadUrl(row.id),
            }),
          );
        const leadMap = new Map<
          string,
          (typeof activeLeads)[number] | (typeof archivedLeads)[number]
        >();
        for (const lead of [...activeLeads, ...archivedLeads]) {
          const key = lead.id || `${phoneKey(lead.phone)}:${lead.createdAt}`;
          if (!leadMap.has(key)) leadMap.set(key, lead);
        }
        const leads = capped(
          [...leadMap.values()].sort((left, right) =>
            right.createdAt.localeCompare(left.createdAt),
          ),
          100,
        );

        const orderMap = new Map<
          string,
          {
            orderRef: string;
            customer: string;
            course: string;
            revenueDate: string;
            usdSales: number;
          }
        >();
        for (const row of data.invoiced) {
          if (normalizePersonName(row.salesperson) !== employeeKey || !row.orderRef) continue;
          const current = orderMap.get(row.orderRef) ?? {
            orderRef: row.orderRef,
            customer: row.customer,
            course: row.course,
            revenueDate: row.revenueDate,
            usdSales: 0,
          };
          current.usdSales += row.usdSales;
          if (row.revenueDate > current.revenueDate) current.revenueDate = row.revenueDate;
          orderMap.set(row.orderRef, current);
        }
        const employeeOrderRows = data.invoiced.filter(
          (row) => normalizePersonName(row.salesperson) === employeeKey,
        );
        const orders = {
          ...capped(
            [...orderMap.values()].sort((left, right) =>
              right.revenueDate.localeCompare(left.revenueDate),
            ),
            100,
          ),
          amount: employeeOrderRows.reduce((sum, row) => sum + row.usdSales, 0),
        };

        const invoiceMap = new Map<
          string,
          {
            movement: string;
            partner: string;
            paymentDate: string;
            usdPaid: number;
            isCreditNote: boolean;
          }
        >();
        for (const row of data.accounting) {
          if (normalizePersonName(row.salesperson) !== employeeKey || !row.movement) continue;
          const current = invoiceMap.get(row.movement) ?? {
            movement: row.movement,
            partner: row.partner,
            paymentDate: row.paymentDate,
            usdPaid: 0,
            isCreditNote: row.isCreditNote,
          };
          current.usdPaid += row.usdPaid;
          current.isCreditNote = current.isCreditNote || row.isCreditNote;
          if (row.paymentDate > current.paymentDate) current.paymentDate = row.paymentDate;
          invoiceMap.set(row.movement, current);
        }
        const invoiceRows = [...invoiceMap.values()].sort((left, right) =>
          right.paymentDate.localeCompare(left.paymentDate),
        );
        const invoices = {
          ...capped(invoiceRows, 100),
          paidTotal: invoiceRows.filter((row) => !row.isCreditNote).length,
          creditNoteTotal: invoiceRows.filter((row) => row.isCreditNote).length,
          amount: invoiceRows.reduce((sum, row) => sum + row.usdPaid, 0),
        };

        let chatwoot: Awaited<ReturnType<typeof getChatwootAgentConversationEvidence>> | null =
          null;
        let chatwootError: string | null = null;
        if (chatwootConfigured() && Number.isInteger(chatwootAgentId) && chatwootAgentId > 0) {
          try {
            chatwoot = await getChatwootAgentConversationEvidence({
              agentId: chatwootAgentId,
              from: filters.from,
              to: filters.to,
              limit: 60,
            });
          } catch (error) {
            chatwootError =
              error instanceof Error ? error.message : "Chatwoot evidence is unavailable";
          }
        }

        return json({
          ok: true,
          employee,
          range: { from: filters.from, to: filters.to },
          leads,
          orders,
          invoices,
          chatwoot,
          chatwootError,
        });
      },
    },
  },
});
