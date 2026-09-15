import { createFileRoute } from "@tanstack/react-router";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One employee's records behind their cards: leads with contact evidence,
 * orders, invoices and Chatwoot conversations.
 *
 * Lead contact is resolved by the shared resolver (`lead-contact-evidence.ts`),
 * the same one the uncalled-leads queue and the employee coverage counters use:
 * phone and mobile, normalised numbers, Yeastar calls after creation and
 * Chatwoot replies in the window. A Calls Hub outage is reported as
 * unavailable, never as "no calls".
 */
export const Route = createFileRoute("/api/employee-evidence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json, capped } = await import("@/lib/api.server");
        const { authoritativeLostLeads, getFiltered } = await import("@/lib/metrics.server");
        const { normalizePersonName } = await import("@/lib/person-name");
        const { integrationPersonMatchScore } = await import("@/lib/integration-person");
        const { odooConfig } = await import("@/lib/odoo.server");
        const { getCallsHubLeadCalls } = await import("@/lib/calls-hub.server");
        const {
          chatwootConfigured,
          getChatwootAgentConversationEvidence,
          getChatwootPhoneConversationEvidence,
        } = await import("@/lib/chatwoot.server");
        const {
          LEAD_CONTACT_EVIDENCE_VERSION,
          indexCallsByPhone,
          publicContactEvidence,
          resolveLeadContactEvidence,
        } = await import("@/lib/lead-contact-evidence");

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
        const window = { from: filters.from, to: filters.to };

        const employeeKey = normalizePersonName(employee);
        const sharedFilters = { ...filters };
        delete sharedFilters.salesperson;
        const data = await getFiltered(sharedFilters);
        let callsAvailable = true;
        let callsError: string | null = null;
        const leadCalls = await getCallsHubLeadCalls(filters.from, filters.to).catch((error) => {
          callsAvailable = false;
          callsError = error instanceof Error ? error.message : "Calls Hub is unavailable";
          return [];
        });
        const callsByPhone = indexCallsByPhone(leadCalls);
        const odooBaseUrl = odooConfig().url;
        const callsHubBaseUrl = (
          process.env.CALLS_HUB_URL || "https://web-production-c7b78.up.railway.app"
        ).replace(/\/+$/, "");
        const leadUrl = (rawId: string) => {
          const id = Number(rawId);
          return Number.isInteger(id) && id > 0
            ? `${odooBaseUrl}/web#id=${id}&model=crm.lead&view_type=form`
            : null;
        };

        type SourceLead = {
          id: string;
          contact: string;
          phone: string;
          mobile: string;
          stage: string;
          course: string;
          createdAt: string;
          outcome: "won" | "open" | "lost";
        };
        const sourceLeads: SourceLead[] = [
          ...data.crm
            .filter((row) => normalizePersonName(row.salesperson) === employeeKey)
            .map((row) => ({
              id: row.id,
              contact: row.contact,
              phone: row.phone,
              mobile: row.mobile,
              stage: row.stage,
              course: row.course,
              createdAt: row.createdAt,
              outcome: (row.isWon ? "won" : "open") as SourceLead["outcome"],
            })),
          ...authoritativeLostLeads(data)
            .filter((row) => normalizePersonName(row.salesperson) === employeeKey)
            .map((row) => ({
              id: row.id,
              contact: row.contact,
              phone: row.phone,
              mobile: row.mobile,
              stage: row.stage,
              course: row.course,
              createdAt: row.createdAt,
              outcome: "lost" as const,
            })),
        ];
        const leadMap = new Map<string, SourceLead>();
        for (const lead of sourceLeads) {
          const key = lead.id || `${lead.phone || lead.mobile}:${lead.createdAt}`;
          if (!leadMap.has(key)) leadMap.set(key, lead);
        }
        const page = capped(
          [...leadMap.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
          100,
        );

        // Chatwoot is read only for the numbers on the page in hand.
        let chatwootPhoneAvailable = false;
        let chatwootPhoneError: string | null = null;
        let chatsByPhone = new Map();
        if (chatwootConfigured()) {
          try {
            const batch = await getChatwootPhoneConversationEvidence(
              page.rows.flatMap((lead) => [lead.phone, lead.mobile]),
            );
            chatsByPhone = batch.evidence;
            chatwootPhoneAvailable = true;
            if (!batch.complete) chatwootPhoneError = `Chatwoot sync is warming ${batch.missing} phone records`;
            else if (batch.error) chatwootPhoneError = batch.error;
          } catch (error) {
            chatwootPhoneError = error instanceof Error ? error.message : "Chatwoot matching is unavailable";
          }
        }

        const rows = page.rows.map((lead) => {
          const evidence = resolveLeadContactEvidence(lead, {
            window,
            callsByPhone,
            callsAvailable,
            chatsByPhone,
            chatwootAvailable: chatwootPhoneAvailable,
            isOwnerCall: (call) =>
              normalizePersonName(call.agentName) === employeeKey ||
              (!!extension && call.agentExtension === extension),
            isOwnerChatName: (name) => integrationPersonMatchScore(employee, name) > 0,
            callUrl: (callId) =>
              callId ? `${callsHubBaseUrl}/?call=${encodeURIComponent(callId)}#archive` : null,
          });
          return {
            id: lead.id,
            contact: lead.contact,
            phone: lead.phone || lead.mobile,
            phoneNumbers: [...new Set([lead.phone, lead.mobile].filter(Boolean))],
            stage: lead.stage,
            course: lead.course,
            createdAt: lead.createdAt,
            outcome: lead.outcome,
            url: leadUrl(lead.id),
            calledByAny: evidence.calledByAny,
            calledByOwner: evidence.calledByOwner,
            totalCalls: evidence.totalCalls,
            ownerCalls: evidence.ownerCalls,
            firstCallAt: evidence.firstCallAt,
            latestCallAt: evidence.latestCallAt,
            latestCallUrl: evidence.latestOwnerCallUrl,
            evidence: publicContactEvidence(evidence),
          };
        });
        const leads = { rows, total: page.total, truncated: page.truncated };

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
          range: window,
          evidenceVersion: LEAD_CONTACT_EVIDENCE_VERSION,
          callsAvailable,
          callsError,
          chatwootPhoneAvailable,
          chatwootPhoneError,
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
