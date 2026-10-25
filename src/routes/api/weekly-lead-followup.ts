import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/weekly-lead-followup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { json } = await import("@/lib/api.server");
        const { getFiltered } = await import("@/lib/metrics.server");
        const { getCallsHubLeadCalls } = await import("@/lib/calls-hub.server");
        const { leadQaConfigured, readLeadQaVerifications } = await import("@/lib/lead-qa.server");
        const { weeklyWindow, weeklyCallEvidence, indexCallsByPhone } = await import("@/lib/weekly-lead-followup");

        const url = new URL(request.url);
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date());
        const window = weeklyWindow(url.searchParams.get("week") || today);
        if (!window || window.from > today) return json({ error: "Invalid reporting week" }, 400);
        const through = window.to > today ? today : window.to;
        const page = Math.max(1, Math.min(10000, Math.trunc(Number(url.searchParams.get("page")) || 1)));
        const pageSize = 50;

        // getFiltered applies the dashboard-wide Recommendation/Broadcast exclusion.
        // We select the weekly cohort by the original Odoo creation date, not the
        // later Lost movement date, and keep active and archived records disjoint.
        const data = await getFiltered({});
        const byId = new Map<string, (typeof data.crm)[number] | (typeof data.lost)[number]>();
        for (const lead of [...data.crm, ...data.lost]) {
          const day = lead.createdAt.slice(0, 10);
          if (day >= window.from && day <= through) byId.set(lead.id, lead);
        }
        const cohort = [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

        let callsAvailable = true;
        let callsError: string | null = null;
        const calls = await getCallsHubLeadCalls(window.from, through).catch((error) => {
          callsAvailable = false;
          callsError = error instanceof Error ? error.message : "Calls Hub unavailable";
          return [];
        });
        let qualityAvailable = leadQaConfigured();
        const quality = qualityAvailable
          ? await readLeadQaVerifications(cohort.map((lead) => lead.id)).catch(() => {
              qualityAvailable = false;
              return new Map();
            })
          : new Map();
        const callsByPhone = indexCallsByPhone(calls);
        const rows = cohort.map((lead) => {
          const call = weeklyCallEvidence(lead, callsByPhone, callsAvailable);
          const verdict = quality.get(lead.id)?.leadQualityVerdict;
          return {
            id: lead.id,
            createdAt: lead.createdAt,
            contact: lead.contact,
            course: lead.course,
            salesperson: lead.salesperson,
            type: lead.recordType,
            stage: lead.stage,
            status: lead.businessStatus,
            callStatus: call.status,
            attempts: call.attempts,
            answeredCalls: call.answeredCalls,
            retriedNoAnswer: call.retriedNoAnswer,
            quality: qualityAvailable && (verdict === "valid" || verdict === "invalid") ? verdict : "unverified",
            odooUrl: `https://engosoft.com/web#id=${encodeURIComponent(lead.id)}&model=crm.lead&view_type=form`,
          };
        });
        const byCourse = new Map<string, { course: string; total: number; answered: number; attemptedNoAnswer: number; noPbxRecord: number; retriedNoAnswer: number; valid: number; invalid: number }>();
        for (const row of rows) {
          const course = row.course || "Unspecified";
          const item = byCourse.get(course) ?? { course, total: 0, answered: 0, attemptedNoAnswer: 0, noPbxRecord: 0, retriedNoAnswer: 0, valid: 0, invalid: 0 };
          item.total++;
          if (row.callStatus === "answered") item.answered++;
          if (row.callStatus === "attempted_no_answer") item.attemptedNoAnswer++;
          if (row.callStatus === "no_pbx_record") item.noPbxRecord++;
          if (row.retriedNoAnswer) item.retriedNoAnswer++;
          if (row.quality === "valid") item.valid++;
          if (row.quality === "invalid") item.invalid++;
          byCourse.set(course, item);
        }
        const count = (predicate: (row: (typeof rows)[number]) => boolean) => rows.filter(predicate).length;
        return json({
          period: { from: window.from, to: through, fullWeekEnd: window.to },
          source: { crm: "Odoo lead creation date", calls: "Calls Hub / Yeastar PBX", quality: "Manual lead QA" },
          availability: { calls: callsAvailable, quality: qualityAvailable, callsError },
          summary: {
            total: rows.length,
            answered: count((row) => row.callStatus === "answered"),
            attemptedNoAnswer: count((row) => row.callStatus === "attempted_no_answer"),
            noPbxRecord: count((row) => row.callStatus === "no_pbx_record"),
            unknownCallStatus: count((row) => row.callStatus === "unknown"),
            retriedNoAnswer: count((row) => row.retriedNoAnswer),
            oneAttemptNoAnswer: count((row) => row.callStatus === "attempted_no_answer" && !row.retriedNoAnswer),
            valid: count((row) => row.quality === "valid"),
            invalid: count((row) => row.quality === "invalid"),
            unverified: count((row) => row.quality === "unverified"),
          },
          courses: [...byCourse.values()].sort((a, b) => b.total - a.total || a.course.localeCompare(b.course)),
          pagination: { page, pageSize, total: rows.length, pages: Math.max(1, Math.ceil(rows.length / pageSize)) },
          rows: rows.slice((page - 1) * pageSize, page * pageSize),
        });
      },
    },
  },
});
