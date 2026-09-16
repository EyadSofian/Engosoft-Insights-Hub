import { createFileRoute } from "@tanstack/react-router";
import type { MonthlyLeadFact, UncalledLeadSort, UncalledLeadStatus } from "@/lib/uncalled-leads";

/**
 * The named leads behind the two un-contacted counters on the employee tab.
 *
 * The counters are produced by `mergeLeadCallCoverage` in
 * `agent-analytics.server.ts`. Both this route and that aggregate resolve a
 * lead's contact through the one shared resolver (`lead-contact-evidence.ts`):
 * same phone + mobile matching, same number normalisation, same owner test and
 * same evidence-completeness rule — a pop-up whose list did not add up to the
 * tile above it would be worse than no pop-up.
 *
 * A lead with no contact found but incomplete evidence (Calls Hub unread, or a
 * number Chatwoot has not been checked for) is listed with
 * `contactStatus: "unknown"` and counted separately; it is never reported as
 * confirmed "not contacted".
 */
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const Route = createFileRoute("/api/uncalled-leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseFilters, json } = await import("@/lib/api.server");
        const { getFiltered } = await import("@/lib/metrics.server");
        const { normalizePersonName } = await import("@/lib/person-name");
        const { integrationPersonMatchScore } = await import("@/lib/integration-person");
        const { odooConfig } = await import("@/lib/odoo.server");
        const { getCallsHubLeadCalls } = await import("@/lib/calls-hub.server");
        const { chatwootPhoneKey, getChatwootPhoneConversationEvidence } =
          await import("@/lib/chatwoot.server");
        const {
          closeRateOf,
          leadAgeDays,
          leadCallAggregateKey,
          leadStageBucket,
          sortUncalledLeads,
          summarizeUncalledMonths,
          uncalledLeadSeverity,
        } = await import("@/lib/uncalled-leads");
        const {
          LEAD_CONTACT_EVIDENCE_VERSION,
          indexCallsByPhone,
          publicContactEvidence,
          resolveLeadContactEvidence,
        } = await import("@/lib/lead-contact-evidence");
        const { hasReportableLost } = await import("@/lib/lost-authority");

        const url = new URL(request.url);
        /**
         * `none`  — nobody in the company contacted the lead.
         * `owner` — the assigned salesperson never contacted it, which also
         *           covers every lead a colleague rescued. The two are different
         *           populations and the caller picks one explicitly.
         */
        const scope = url.searchParams.get("scope") === "owner" ? "owner" : "none";
        const employee = (url.searchParams.get("employee") || "").trim();
        if (employee.length > 160) {
          return Response.json({ error: "Invalid employee name" }, { status: 400 });
        }
        const rawSort = url.searchParams.get("sort");
        const sort: UncalledLeadSort =
          rawSort === "urgent" || rawSort === "oldest" ? rawSort : "newest";
        const rawStatus = url.searchParams.get("status");
        const statusFilter: UncalledLeadStatus | "actionable" | "all" =
          rawStatus === "actionable" ||
          rawStatus === "fresh" ||
          rawStatus === "critical" ||
          rawStatus === "warning" ||
          rawStatus === "stable" ||
          rawStatus === "all"
            ? rawStatus
            : "actionable";
        const page = Math.max(
          1,
          Math.min(10_000, Math.trunc(Number(url.searchParams.get("page")) || 1)),
        );
        const pageSize = Math.max(
          10,
          Math.min(200, Math.trunc(Number(url.searchParams.get("pageSize")) || 50)),
        );

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

        // The employee filter is applied here, by owner, rather than through the
        // global `salesperson` filter — that one also narrows invoices and ads,
        // which would silently change the denominator the pop-up reports.
        const sharedFilters = { ...filters };
        delete sharedFilters.salesperson;
        const data = await getFiltered(sharedFilters);
        const lostAvailable = hasReportableLost(data.snapshot.health.lostAuthority);

        let callsAvailable = true;
        let callsError: string | null = null;
        const leadCalls = await getCallsHubLeadCalls(filters.from, filters.to).catch((error) => {
          callsAvailable = false;
          callsError = error instanceof Error ? error.message : "Calls Hub is unavailable";
          return [];
        });
        const callsByPhone = indexCallsByPhone(leadCalls);

        /**
         * Owner extension lookup. A PBX row names the agent by display name and
         * extension, and the display name is often shorter than the Odoo legal
         * name; a fuzzy match is accepted only when exactly one Odoo person wins.
         */
        const ownerNames = new Map<string, string>();
        for (const row of data.crm) {
          const key = normalizePersonName(row.salesperson);
          if (key && !ownerNames.has(key)) ownerNames.set(key, row.salesperson);
        }
        const extensionByOwner = new Map<string, string>();
        const pbxAgents = new Map<string, { name: string; extension: string }>();
        for (const call of leadCalls) {
          const key = `${normalizePersonName(call.agentName)}\u0000${call.agentExtension}`;
          if (!pbxAgents.has(key)) {
            pbxAgents.set(key, { name: call.agentName, extension: call.agentExtension });
          }
        }
        for (const agent of pbxAgents.values()) {
          const exactKey = normalizePersonName(agent.name);
          if (!exactKey) continue;
          if (ownerNames.has(exactKey)) {
            if (!extensionByOwner.has(exactKey)) extensionByOwner.set(exactKey, agent.extension);
            continue;
          }
          const scored = [...ownerNames.entries()]
            .map(([key, name]) => ({ key, score: integrationPersonMatchScore(name, agent.name) }))
            .filter((candidate) => candidate.score > 0);
          const best = Math.max(0, ...scored.map((candidate) => candidate.score));
          const winners = scored.filter((candidate) => candidate.score === best);
          if (winners.length === 1 && !extensionByOwner.has(winners[0].key)) {
            extensionByOwner.set(winners[0].key, agent.extension);
          }
        }

        const odooBaseUrl = odooConfig().url;
        const callsHubBaseUrl = (
          process.env.CALLS_HUB_URL || "https://web-production-c7b78.up.railway.app"
        ).replace(/\/+$/, "");
        const leadUrl = (rawId: string): string | null => {
          const id = Number(rawId);
          return Number.isInteger(id) && id > 0
            ? `${odooBaseUrl}/web#id=${id}&model=crm.lead&view_type=form`
            : null;
        };
        const callUrl = (callId: string) =>
          callId ? `${callsHubBaseUrl}/?call=${encodeURIComponent(callId)}#archive` : null;

        /**
         * This is an action queue, not a historical funnel. Closed Won and every
         * canonical Lost row are excluded before severity is calculated.
         */
        type SourceLead = {
          id: string;
          contact: string;
          phone: string;
          mobile: string;
          salesperson: string;
          stage: string;
          course: string;
          priority: string;
          callingReply: string;
          createdAt: string;
          lastStageUpdate: string;
          outcome: "won" | "lost" | "open";
        };
        const leads = new Map<string, SourceLead>();
        for (const row of data.crm) {
          if (!row.id || !row.salesperson) continue;
          if (row.isWon || leadStageBucket(row.stage) === "lost") continue;
          leads.set(row.id, {
            id: row.id,
            contact: row.contact,
            phone: row.phone,
            mobile: row.mobile,
            salesperson: row.salesperson,
            stage: row.stage,
            course: row.course,
            priority: row.priority,
            callingReply: row.callingReply,
            createdAt: row.createdAt,
            lastStageUpdate: row.lastStageUpdate,
            outcome: row.isWon ? "won" : "open",
          });
        }

        const employeeKey = employee ? normalizePersonName(employee) : "";
        const ownerMatchers = (lead: SourceLead) => {
          const ownerKey = normalizePersonName(lead.salesperson);
          const ownerExtension = extensionByOwner.get(ownerKey) || "";
          return {
            ownerKey,
            isOwnerCall: (call: (typeof leadCalls)[number]) =>
              normalizePersonName(call.agentName) === ownerKey ||
              (!!ownerExtension && call.agentExtension === ownerExtension),
            isOwnerChatName: (name: string) =>
              integrationPersonMatchScore(lead.salesperson, name) > 0,
          };
        };

        // Pass 1 — calls only — decides which numbers still need Chatwoot proof.
        const noChats = new Map();
        const chatCandidatePhones: string[] = [];
        for (const lead of leads.values()) {
          const owner = ownerMatchers(lead);
          if (!owner.ownerKey || (employeeKey && owner.ownerKey !== employeeKey)) continue;
          const callsOnly = resolveLeadContactEvidence(lead, {
            window,
            callsByPhone,
            callsAvailable,
            chatsByPhone: noChats,
            chatwootAvailable: false,
            isOwnerCall: owner.isOwnerCall,
            isOwnerChatName: owner.isOwnerChatName,
          });
          if (scope === "none" ? !callsOnly.calledByAny : !callsOnly.calledByOwner) {
            chatCandidatePhones.push(lead.phone, lead.mobile);
          }
        }

        let chatwootAvailable = true;
        let chatwootError: string | null = null;
        const chatBatch = await getChatwootPhoneConversationEvidence(chatCandidatePhones).catch(
          (error) => {
            chatwootAvailable = false;
            chatwootError =
              error instanceof Error ? error.message : "Chatwoot matching is unavailable";
            return {
              evidence: new Map(),
              complete: false,
              missing: new Set(chatCandidatePhones.map(chatwootPhoneKey).filter(Boolean)).size,
              refreshed: 0,
              error: chatwootError,
            };
          },
        );
        if (chatwootAvailable && !chatBatch.complete) {
          chatwootError = `Chatwoot sync is warming ${chatBatch.missing} phone records`;
        } else if (chatwootAvailable && chatBatch.error) {
          chatwootError = chatBatch.error;
        }

        const monthFacts: MonthlyLeadFact[] = [];
        const rows: Array<{
          id: string;
          contact: string;
          phone: string;
          phoneNumbers: string[];
          salesperson: string;
          stage: string;
          course: string;
          priority: string;
          callingReply: string;
          createdAt: string;
          lastStageUpdate: string;
          ageDays: number | null;
          outcome: "won" | "lost" | "open";
          calledByAny: boolean;
          calledByOwner: boolean;
          totalCalls: number;
          /** Colleagues who called a lead its own owner never did. */
          calledBy: string[];
          latestCallAt: string | null;
          contactedViaChat: boolean;
          chatByOwner: boolean;
          chatAwaitingReply: boolean;
          chatConversationCount: number;
          chatEmployeeReplied: boolean;
          chatOwnerReplied: boolean;
          latestChatStatus: string | null;
          latestChatOpen: boolean | null;
          chatEvidenceComplete: boolean;
          chatAssignees: string[];
          latestChatAt: number | null;
          latestChatUrl: string | null;
          /** `unknown` when evidence is incomplete: never a confident "not contacted". */
          contactStatus: "not_contacted" | "unknown";
          evidence: ReturnType<typeof publicContactEvidence>;
          status: UncalledLeadStatus;
          reasons: string[];
          url: string | null;
          latestCallUrl: string | null;
        }> = [];

        /** Per owner, the `(phone, extension, agent, day)` call aggregates already counted. */
        const callKeysByOwner = new Map<string, Set<string>>();
        const ownerCallKeysByOwner = new Map<string, Set<string>>();
        let assignedLeads = 0;
        let contactedByAnyTotal = 0;
        let contactedByOwnerTotal = 0;
        let confirmedNotContacted = 0;
        let confirmedOwnerNotContacted = 0;
        let unknownContact = 0;
        let unknownOwnerContact = 0;
        let matchedCallTotal = 0;
        let matchedOwnerCallTotal = 0;
        let chatContactedTotal = 0;
        let chatContactedByOwnerTotal = 0;
        let chatAwaitingReplyTotal = 0;
        let chatEvidenceIncompleteTotal = 0;
        let wonTotal = 0;
        let lostTotal = 0;

        for (const lead of leads.values()) {
          const owner = ownerMatchers(lead);
          if (!owner.ownerKey) continue;
          if (employeeKey && owner.ownerKey !== employeeKey) continue;
          assignedLeads += 1;

          const evidence = resolveLeadContactEvidence(lead, {
            window,
            callsByPhone,
            callsAvailable,
            chatsByPhone: chatBatch.evidence,
            chatwootAvailable,
            isOwnerCall: owner.isOwnerCall,
            isOwnerChatName: owner.isOwnerChatName,
            callUrl,
          });
          const chatEvidenceComplete = !evidence.missingSources.includes("chatwoot");
          const scopedStatus =
            scope === "none" ? evidence.contactStatus : evidence.ownerContactStatus;
          if (scopedStatus !== "contacted" && !chatEvidenceComplete)
            chatEvidenceIncompleteTotal += 1;

          /**
           * Coverage is lead-grain but call totals are not: two opportunities on
           * one customer phone share one PBX call, so an owner's call total adds
           * each aggregate once.
           */
          const ownerCallKeys = callKeysByOwner.get(owner.ownerKey) ?? new Set<string>();
          callKeysByOwner.set(owner.ownerKey, ownerCallKeys);
          const employeeCallKeys = ownerCallKeysByOwner.get(owner.ownerKey) ?? new Set<string>();
          ownerCallKeysByOwner.set(owner.ownerKey, employeeCallKeys);
          let dedupedCalls = 0;
          let dedupedOwnerCalls = 0;
          for (const call of evidence.matchedCalls) {
            const key = leadCallAggregateKey(call);
            if (ownerCallKeys.has(key)) continue;
            ownerCallKeys.add(key);
            dedupedCalls += call.totalCalls;
            if (owner.isOwnerCall(call) && !employeeCallKeys.has(key)) {
              employeeCallKeys.add(key);
              dedupedOwnerCalls += call.totalCalls;
            }
          }

          if (evidence.contactedByAny) contactedByAnyTotal += 1;
          if (evidence.contactedByOwner) contactedByOwnerTotal += 1;
          if (evidence.contactStatus === "not_contacted") confirmedNotContacted += 1;
          if (evidence.ownerContactStatus === "not_contacted") confirmedOwnerNotContacted += 1;
          if (evidence.contactStatus === "unknown") unknownContact += 1;
          if (evidence.ownerContactStatus === "unknown") unknownOwnerContact += 1;
          if (evidence.contactedViaChat) chatContactedTotal += 1;
          if (evidence.chatByOwner) chatContactedByOwnerTotal += 1;
          if (evidence.chatAwaitingReply) chatAwaitingReplyTotal += 1;
          matchedCallTotal += dedupedCalls;
          matchedOwnerCallTotal += dedupedOwnerCalls;
          if (lead.outcome === "won") wonTotal += 1;
          if (lead.outcome === "lost") lostTotal += 1;

          monthFacts.push({
            month: lead.createdAt.slice(0, 7),
            calledByAny: evidence.contactedByAny,
            calledByOwner: evidence.contactedByOwner,
            // De-duplicated, so the months still add up to the period total.
            calls: dedupedCalls,
            ownerCalls: dedupedOwnerCalls,
            outcome: lead.outcome,
          });

          // `none` is a strict subset of `owner`.
          if (scopedStatus === "contacted") continue;

          /** Age is measured to the END of the selected window, not to today. */
          const ageDays = leadAgeDays(lead.createdAt, filters.to);
          const severity = uncalledLeadSeverity({
            stage: lead.stage,
            priority: lead.priority,
            callingReply: lead.callingReply,
            ageDays,
            calledByAny: evidence.contactedByAny,
            chatAwaitingReply: evidence.chatAwaitingReply,
          });
          const latestChatStatus = evidence.latestChatStatus;

          rows.push({
            id: lead.id,
            contact: lead.contact,
            phone: lead.phone || lead.mobile,
            phoneNumbers: [...new Set([lead.phone, lead.mobile].filter(Boolean))],
            salesperson: lead.salesperson,
            stage: lead.stage,
            course: lead.course,
            priority: lead.priority,
            callingReply: lead.callingReply,
            createdAt: lead.createdAt,
            lastStageUpdate: lead.lastStageUpdate,
            ageDays,
            outcome: lead.outcome,
            calledByAny: evidence.contactedByAny,
            calledByOwner: evidence.contactedByOwner,
            totalCalls: evidence.totalCalls,
            calledBy: evidence.callers.slice(0, 4),
            latestCallAt: evidence.latestCallAt,
            contactedViaChat: evidence.contactedViaChat,
            chatByOwner: evidence.chatByOwner,
            chatAwaitingReply: evidence.chatAwaitingReply,
            chatConversationCount: evidence.chatConversationCount,
            chatEmployeeReplied: evidence.contactedViaChat,
            chatOwnerReplied: evidence.chatByOwner,
            latestChatStatus,
            latestChatOpen:
              latestChatStatus === null ? null : !["resolved", "closed"].includes(latestChatStatus),
            chatEvidenceComplete,
            chatAssignees: evidence.chatAssignees.slice(0, 4),
            latestChatAt: evidence.latestChatAt,
            latestChatUrl: evidence.latestChatUrl,
            contactStatus: scopedStatus,
            evidence: publicContactEvidence(evidence),
            status: severity.status,
            reasons: severity.reasons,
            url: leadUrl(lead.id),
            latestCallUrl: evidence.latestCallUrl,
          });
        }

        const severityCounts = {
          fresh: rows.filter((row) => row.status === "fresh").length,
          critical: rows.filter((row) => row.status === "critical").length,
          warning: rows.filter((row) => row.status === "warning").length,
          stable: rows.filter((row) => row.status === "stable").length,
        };
        const filtered =
          statusFilter === "all"
            ? rows
            : statusFilter === "actionable"
              ? rows.filter((row) => row.status !== "stable")
              : rows.filter((row) => row.status === statusFilter);
        const ordered = sortUncalledLeads(filtered, sort);
        const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
        const safePage = Math.min(page, totalPages);
        const pageRows = ordered.slice((safePage - 1) * pageSize, safePage * pageSize);
        const { getEmployeeDirectory } = await import("@/lib/employee-directory.server");
        const directory = await getEmployeeDirectory();
        const named = pageRows.map((row) => ({
          ...row,
          salesperson: directory.displayNameFor(row.salesperson),
          calledBy: row.calledBy.map((agent) => directory.displayNameFor(agent)),
        }));
        const chatwootComplete = chatwootAvailable && chatEvidenceIncompleteTotal === 0;

        return json({
          ok: true,
          scope,
          employee: employee || null,
          sort,
          status: statusFilter,
          range: window,
          evidenceVersion: LEAD_CONTACT_EVIDENCE_VERSION,
          callsAvailable,
          callsError,
          chatwootAvailable,
          chatwootComplete,
          chatwootError,
          lostAvailable,
          summary: {
            assignedLeads,
            calledByAny: callsAvailable ? contactedByAnyTotal : null,
            /** Confirmed: complete evidence and no contact found. */
            uncalled: callsAvailable ? confirmedNotContacted : null,
            /** No contact found, but evidence incomplete — not a confirmed omission. */
            uncalledUnconfirmed: unknownContact,
            calledByOwner: callsAvailable ? contactedByOwnerTotal : null,
            ownerUncalled: callsAvailable ? confirmedOwnerNotContacted : null,
            ownerUncalledUnconfirmed: unknownOwnerContact,
            /** Leads the owner ignored but a colleague picked up. */
            rescuedByColleague: callsAvailable
              ? Math.max(0, contactedByAnyTotal - contactedByOwnerTotal)
              : null,
            calls: callsAvailable ? matchedCallTotal : null,
            callsPerLead:
              callsAvailable && assignedLeads > 0 ? matchedCallTotal / assignedLeads : null,
            ownerCalls: callsAvailable ? matchedOwnerCallTotal : null,
            ownerCallsPerLead:
              callsAvailable && assignedLeads > 0 ? matchedOwnerCallTotal / assignedLeads : null,
            won: wonTotal,
            lost: lostTotal,
            closeRate: closeRateOf(wonTotal, lostTotal, lostAvailable),
            conversionRate: assignedLeads > 0 ? (wonTotal / assignedLeads) * 100 : null,
            contactRate:
              callsAvailable && assignedLeads > 0
                ? (contactedByAnyTotal / assignedLeads) * 100
                : null,
            ownerContactRate:
              callsAvailable && assignedLeads > 0
                ? (contactedByOwnerTotal / assignedLeads) * 100
                : null,
            chatContacted: chatwootAvailable ? chatContactedTotal : null,
            chatContactedByOwner: chatwootAvailable ? chatContactedByOwnerTotal : null,
            chatAwaitingReply: chatwootAvailable ? chatAwaitingReplyTotal : null,
            severity: severityCounts,
          },
          months: summarizeUncalledMonths(monthFacts, { lostAvailable }),
          leads: {
            rows: named,
            total: ordered.length,
            /** Before the status filter — confirmed plus unconfirmed rows. */
            unfilteredTotal: rows.length,
            page: safePage,
            pageSize,
            totalPages,
            hasNext: safePage < totalPages,
          },
        });
      },
    },
  },
});
