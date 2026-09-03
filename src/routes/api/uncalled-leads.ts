import { createFileRoute } from "@tanstack/react-router";
import type { MonthlyLeadFact, UncalledLeadSort, UncalledLeadStatus } from "@/lib/uncalled-leads";

/**
 * The named leads behind the two un-contacted counters on the employee tab.
 *
 * The counters are produced by `mergeLeadCallCoverage` in
 * `agent-analytics.server.ts`, which joins Odoo leads to Yeastar calls through
 * the Calls Hub. This route repeats that join at lead grain instead of employee
 * grain so the pop-up can name the rows, and it deliberately uses the same
 * phone key, the same de-duplication key and the same owner test — a pop-up
 * whose list did not add up to the tile above it would be worse than no pop-up.
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
        const {
          chatwootPhoneKey,
          getChatwootPhoneConversationEvidence,
        } = await import("@/lib/chatwoot.server");
        const {
          closeRateOf,
          callCanCoverLead,
          leadAgeDays,
          leadCallAggregateKey,
          leadStageBucket,
          sortUncalledLeads,
          summarizeUncalledMonths,
          uncalledLeadSeverity,
        } = await import("@/lib/uncalled-leads");
        const { hasReportableLost } = await import("@/lib/lost-authority");

        const url = new URL(request.url);
        /**
         * `none`  — nobody in the company called the lead.
         * `owner` — the assigned salesperson never called it, which also covers
         *           every lead a colleague rescued. The two are different
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

        // The employee filter is applied here, by owner, rather than through the
        // global `salesperson` filter — that one also narrows invoices and ads,
        // which would silently change the denominator the pop-up reports.
        const sharedFilters = { ...filters };
        delete sharedFilters.salesperson;
        const data = await getFiltered(sharedFilters);
        /**
         * With no Lost population every lead reads as won-or-open, and the close
         * rate computes to a confident 100%. The dashboard already flags that
         * state globally; the pop-up refuses the ratio rather than repeating it.
         */
        const lostAvailable = hasReportableLost(data.snapshot.health.lostAuthority);

        let callsAvailable = true;
        let callsError: string | null = null;
        const leadCalls = await getCallsHubLeadCalls(filters.from, filters.to).catch((error) => {
          callsAvailable = false;
          callsError = error instanceof Error ? error.message : "Calls Hub is unavailable";
          return [];
        });

        /**
         * Yeastar may hold `+9665…`, Odoo may hold `05…`, and Egyptian records
         * carry their own prefix. The subscriber's final nine digits are stable
         * across all three; anything shorter is an internal extension and is
         * never matched. Identical to the aggregate path by design.
         */
        const phoneKey = chatwootPhoneKey;
        const callsByPhone = new Map<string, typeof leadCalls>();
        for (const call of leadCalls) {
          const key = phoneKey(call.phone);
          if (!key) continue;
          callsByPhone.set(key, [...(callsByPhone.get(key) ?? []), call]);
        }

        /**
         * Owner extension lookup.
         *
         * A PBX row names the agent twice — by display name and by extension —
         * and the display name is often shorter than the Odoo legal name. The
         * aggregate path resolves that with `integrationPersonMatchScore` and
         * accepts a fuzzy match only when exactly one Odoo person wins, because
         * crediting a call to the wrong colleague is worse than not crediting
         * it. The same rule is repeated here.
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

        /**
         * This is an action queue, not a historical funnel. Closed Won and every
         * archived Lost row are deliberately excluded before severity is
         * calculated; a closed record can still belong in reports, but it can
         * never be an employee's current "critical follow-up".
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
        const matchesByLead = new Map<string, (typeof leadCalls)[number][]>();
        const chatCandidatePhones: string[] = [];
        for (const lead of leads.values()) {
          const ownerKey = normalizePersonName(lead.salesperson);
          if (!ownerKey || (employeeKey && ownerKey !== employeeKey)) continue;
          const ownerExtension = extensionByOwner.get(ownerKey) || "";
          const matches = new Map<string, (typeof leadCalls)[number]>();
          for (const key of new Set([lead.phone, lead.mobile].map(phoneKey).filter(Boolean))) {
            for (const call of callsByPhone.get(key) ?? []) {
              if (!callCanCoverLead(call, lead.createdAt)) continue;
              matches.set(leadCallAggregateKey(call), call);
            }
          }
          const matched = [...matches.values()];
          matchesByLead.set(lead.id, matched);
          const ownerCalled = matched.some(
            (call) =>
              normalizePersonName(call.agentName) === ownerKey ||
              (!!ownerExtension && call.agentExtension === ownerExtension),
          );
          if (scope === "none" ? matched.length === 0 : !ownerCalled) {
            chatCandidatePhones.push(lead.phone, lead.mobile);
          }
        }

        let chatwootAvailable = true;
        let chatwootComplete = true;
        let chatwootError: string | null = null;
        const chatBatch = await getChatwootPhoneConversationEvidence(chatCandidatePhones).catch(
          (error) => {
            chatwootAvailable = false;
            chatwootComplete = false;
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
        const chatsByPhone = chatBatch.evidence;
        if (!chatBatch.complete) {
          chatwootComplete = false;
          chatwootError = `Chatwoot sync is warming ${chatBatch.missing} phone records`;
        } else if (chatBatch.error) {
          chatwootAvailable = false;
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
          status: UncalledLeadStatus;
          reasons: string[];
          url: string | null;
          latestCallUrl: string | null;
        }> = [];

        /** Per owner, the `(phone, extension, agent)` pairs already counted. */
        const callKeysByOwner = new Map<string, Set<string>>();
        const ownerCallKeysByOwner = new Map<string, Set<string>>();
        let assignedLeads = 0;
        let calledByAnyTotal = 0;
        let calledByOwnerTotal = 0;
        let matchedCallTotal = 0;
        let matchedOwnerCallTotal = 0;
        let chatContactedTotal = 0;
        let chatContactedByOwnerTotal = 0;
        let chatAwaitingReplyTotal = 0;
        let chatEvidenceIncompleteTotal = 0;
        let wonTotal = 0;
        let lostTotal = 0;

        for (const lead of leads.values()) {
          const ownerKey = normalizePersonName(lead.salesperson);
          if (!ownerKey) continue;
          if (employeeKey && ownerKey !== employeeKey) continue;
          assignedLeads += 1;

          const ownerExtension = extensionByOwner.get(ownerKey) || "";
          const matched = matchesByLead.get(lead.id) ?? [];
          const matches = new Map(matched.map((call) => [leadCallAggregateKey(call), call]));
          const ownerMatches = matched.filter(
            (call) =>
              normalizePersonName(call.agentName) === ownerKey ||
              (!!ownerExtension && call.agentExtension === ownerExtension),
          );
          const calledByAny = matched.length > 0;
          const calledByOwner = ownerMatches.length > 0;
          const createdAt = Date.parse(`${lead.createdAt.slice(0, 10)}T00:00:00Z`) / 1000;
          const periodStart = Date.parse(`${filters.from}T00:00:00Z`) / 1000;
          const periodEnd = Date.parse(`${filters.to}T23:59:59Z`) / 1000;
          const chatPhoneKeys = [
            ...new Set([lead.phone, lead.mobile].map(phoneKey).filter(Boolean)),
          ];
          const chatMatches = chatPhoneKeys
            .flatMap((key) => chatsByPhone.get(key) ?? [])
            .filter(
              (chat) =>
                chat.lastActivityAt >= periodStart &&
                (!Number.isFinite(createdAt) || chat.lastActivityAt >= createdAt) &&
                chat.lastActivityAt <= periodEnd,
            )
            .sort((left, right) => right.lastActivityAt - left.lastActivityAt);
          const agentChatMatches = chatMatches.filter(
            (chat) =>
              chat.agentContactedAt > 0 &&
              chat.agentContactedAt >= periodStart &&
              (!Number.isFinite(createdAt) || chat.agentContactedAt >= createdAt) &&
              chat.agentContactedAt <= periodEnd,
          );
          const ownerChatMatches = agentChatMatches.filter(
            (chat) =>
              [...(chat.agentNames ?? []), chat.assigneeName]
                .filter(Boolean)
                .some(
                  (name) => integrationPersonMatchScore(lead.salesperson, name) > 0,
                ),
          );
          const contactedViaChat = agentChatMatches.length > 0;
          const chatByOwner = ownerChatMatches.length > 0;
          const chatAwaitingReply = chatMatches.some(
            (chat) => chat.awaitingReply && chat.customerMessagedAt >= (createdAt || 0),
          );
          const latestChat = chatMatches[0] ?? null;
          const latestChatStatus = String(latestChat?.status || "").trim().toLowerCase();
          const chatOpen = Boolean(
            latestChat && !["resolved", "closed"].includes(latestChatStatus),
          );
          const contactedByAny = calledByAny || contactedViaChat;
          const contactedByOwner = calledByOwner || chatByOwner;
          const chatEvidenceComplete = chatPhoneKeys.every((key) => chatsByPhone.has(key));
          const stillNeedsChatProof = scope === "none" ? !contactedByAny : !contactedByOwner;
          if (stillNeedsChatProof && !chatEvidenceComplete) chatEvidenceIncompleteTotal += 1;
          /** Every call on this lead's phone — what the lead's own row shows. */
          const totalCalls = matched.reduce((sum, call) => sum + call.totalCalls, 0);

          /**
           * Coverage is lead-grain but call totals are not.
           *
           * Two Odoo opportunities can carry the same customer phone, and each
           * has genuinely been reached by its owner — so both count as covered.
           * The PBX call behind them is still one call, so the aggregate adds a
           * `(phone, agent)` pair to an employee's total only once, and this
           * total is de-duplicated the same way. Summing per lead instead
           * inflated the period figure by 14 calls on the August window.
           */
          const ownerCallKeys = callKeysByOwner.get(ownerKey) ?? new Set<string>();
          callKeysByOwner.set(ownerKey, ownerCallKeys);
          const employeeCallKeys = ownerCallKeysByOwner.get(ownerKey) ?? new Set<string>();
          ownerCallKeysByOwner.set(ownerKey, employeeCallKeys);
          let dedupedCalls = 0;
          let dedupedOwnerCalls = 0;
          for (const [key, call] of matches) {
            if (ownerCallKeys.has(key)) continue;
            ownerCallKeys.add(key);
            dedupedCalls += call.totalCalls;
            const sameOwner =
              normalizePersonName(call.agentName) === ownerKey ||
              (!!ownerExtension && call.agentExtension === ownerExtension);
            if (sameOwner && !employeeCallKeys.has(key)) {
              employeeCallKeys.add(key);
              dedupedOwnerCalls += call.totalCalls;
            }
          }

          if (contactedByAny) calledByAnyTotal += 1;
          if (contactedByOwner) calledByOwnerTotal += 1;
          if (contactedViaChat) chatContactedTotal += 1;
          if (chatByOwner) chatContactedByOwnerTotal += 1;
          if (chatAwaitingReply) chatAwaitingReplyTotal += 1;
          matchedCallTotal += dedupedCalls;
          matchedOwnerCallTotal += dedupedOwnerCalls;
          if (lead.outcome === "won") wonTotal += 1;
          if (lead.outcome === "lost") lostTotal += 1;

          monthFacts.push({
            month: lead.createdAt.slice(0, 7),
            calledByAny: contactedByAny,
            calledByOwner: contactedByOwner,
            // De-duplicated, so the months still add up to the period total. A
            // phone shared across months lands in the first month that used it.
            calls: dedupedCalls,
            ownerCalls: dedupedOwnerCalls,
            outcome: lead.outcome,
          });

          // `none` is a strict subset of `owner`: a lead nobody called is also a
          // lead its owner did not call.
          if (scope === "none" ? contactedByAny : contactedByOwner) continue;

          /**
           * Age is measured to the END of the selected window, not to today.
           * Read in September, a lead created on 30 July was one day old when
           * the July report closed — dating it 60 days would make every archived
           * month look uniformly neglected and hide the months that really were.
           */
          const ageDays = leadAgeDays(lead.createdAt, filters.to);
          const severity = uncalledLeadSeverity({
            stage: lead.stage,
            priority: lead.priority,
            callingReply: lead.callingReply,
            ageDays,
            calledByAny: contactedByAny,
            chatAwaitingReply,
          });

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
            calledByAny: contactedByAny,
            calledByOwner: contactedByOwner,
            totalCalls,
            calledBy: [...new Set(matched.map((call) => call.agentName).filter(Boolean))].slice(
              0,
              4,
            ),
            latestCallAt:
              matched
                .map((call) => call.latestCallAt)
                .filter(Boolean)
                .sort()
                .at(-1) ?? null,
            contactedViaChat,
            chatByOwner,
            chatAwaitingReply,
            chatConversationCount: chatMatches.length,
            chatEmployeeReplied: agentChatMatches.length > 0,
            chatOwnerReplied: ownerChatMatches.length > 0,
            latestChatStatus: latestChatStatus || null,
            latestChatOpen: latestChat ? chatOpen : null,
            chatEvidenceComplete,
            chatAssignees: [
              ...new Set(
                chatMatches
                  .flatMap((chat) => [...(chat.agentNames ?? []), chat.assigneeName])
                  .filter(Boolean),
              ),
            ].slice(0, 4),
            latestChatAt: latestChat?.lastActivityAt ?? null,
            latestChatUrl: latestChat?.url ?? null,
            status: severity.status,
            reasons: severity.reasons,
            url: leadUrl(lead.id),
            latestCallUrl:
              matched
                .filter((call) => call.latestCallId)
                .sort((left, right) => right.latestCallAt.localeCompare(left.latestCallAt))
                .map(
                  (call) =>
                    `${callsHubBaseUrl}/?call=${encodeURIComponent(call.latestCallId)}#archive`,
                )
                .at(0) ?? null,
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
        // Owner and caller are colleagues, and this list is read beside the
        // employee cards — so they are written the same way there: Odoo HR's
        // name, three parts. Only the page in hand is rewritten; the filtering
        // above ran on the raw spelling the lead itself carries.
        const { getEmployeeDirectory } = await import("@/lib/employee-directory.server");
        const directory = await getEmployeeDirectory();
        const named = pageRows.map((row) => ({
          ...row,
          salesperson: directory.displayNameFor(row.salesperson),
          calledBy: row.calledBy.map((agent) => directory.displayNameFor(agent)),
        }));
        // A missing alternate number on a lead already proven contacted cannot
        // change the action list. Only incomplete evidence on a still-uncontacted
        // lead keeps the sync in a warming state.
        chatwootComplete = chatwootAvailable && chatEvidenceIncompleteTotal === 0;

        return json({
          ok: true,
          scope,
          employee: employee || null,
          sort,
          status: statusFilter,
          range: { from: filters.from, to: filters.to },
          callsAvailable,
          callsError,
          chatwootAvailable,
          chatwootComplete,
          chatwootError,
          lostAvailable,
          summary: {
            assignedLeads,
            calledByAny: callsAvailable ? calledByAnyTotal : null,
            uncalled: callsAvailable ? assignedLeads - calledByAnyTotal : null,
            calledByOwner: callsAvailable ? calledByOwnerTotal : null,
            ownerUncalled: callsAvailable ? assignedLeads - calledByOwnerTotal : null,
            /** Leads the owner ignored but a colleague picked up. */
            rescuedByColleague: callsAvailable
              ? Math.max(0, calledByAnyTotal - calledByOwnerTotal)
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
              callsAvailable && assignedLeads > 0 ? (calledByAnyTotal / assignedLeads) * 100 : null,
            ownerContactRate:
              callsAvailable && assignedLeads > 0
                ? (calledByOwnerTotal / assignedLeads) * 100
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
            /** Before the status filter — the number the tile itself shows. */
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
