import { createFileRoute } from "@tanstack/react-router";

/**
 * One read-only door onto every analytical surface the dashboard shows.
 *
 * WHY THIS EXISTS. ENGO Nexus could reach seven of the sixteen visible
 * surfaces. Asked "الويبسايت باع بكام؟" it said it did not have the data, while
 * /website was displaying the figure. An unwired capability and a genuine data
 * gap look identical to a user, and only one of them is honest.
 *
 * WHAT IT IS NOT. Not a generic HTTP proxy: the agent names a SURFACE and an
 * OPERATION from a closed vocabulary, and this file maps that to the
 * dashboard's own endpoint. The model never sees or constructs a URL, and it
 * cannot reach anything the registry does not list — mutations included.
 *
 * WHAT IT DOES NOT DO. It does not compute. Every figure comes from the same
 * handler the page calls, so the agent and the screen cannot disagree.
 */
export const Route = createFileRoute("/api/agent-insights")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { surfaceById, AGENT_FORBIDDEN_ENDPOINTS } =
          await import("@/lib/agent-insights-registry");
        const { json } = await import("@/lib/api.server");

        const url = new URL(request.url);
        const surfaceId = (url.searchParams.get("surface") ?? "").trim();
        const operation = (url.searchParams.get("operation") ?? "summary").trim();

        const surface = surfaceById(surfaceId);
        if (!surface) {
          return Response.json(
            {
              status: "UNKNOWN_ENTITY",
              error: `Unknown surface "${surfaceId}".`,
              // The vocabulary, so a wrong guess is self-correcting.
              surfaces: (await import("@/lib/agent-insights-registry")).AGENT_READABLE_SURFACES.map(
                (s) => ({
                  id: s.id,
                  operations: s.operations,
                  views: s.views,
                }),
              ),
            },
            { status: 400 },
          );
        }
        if (surface.status === "NOT_APPLICABLE") {
          return json({
            status: "NOT_APPLICABLE",
            surface: surface.id,
            reason: surface.note ?? "This surface carries no analytics.",
          });
        }
        if (!surface.operations.includes(operation as never)) {
          return json({
            status: "INVALID_FILTER",
            surface: surface.id,
            reason: `"${operation}" is not available here. Supported: ${surface.operations.join(", ")}.`,
          });
        }

        /**
         * The endpoint is chosen HERE, from the registry — never by the caller.
         * Anything on the forbidden list is unreachable by construction.
         */
        const endpoint = surface.endpoints[0]!;
        if (AGENT_FORBIDDEN_ENDPOINTS.includes(endpoint)) {
          return json({
            status: "PERMISSION_DENIED",
            surface: surface.id,
            reason: "This surface is not readable by the agent.",
          });
        }

        // Forward the dashboard's own global filters, unchanged.
        const forward = new URLSearchParams();
        for (const key of [
          "from",
          "to",
          "company",
          "platform",
          "account",
          "campaign",
          "campaignKey",
          "course",
          "source",
          "salesTeam",
          "salesperson",
          "channel",
          "mainCategory",
          "range",
          "month",
        ]) {
          const value = url.searchParams.get(key);
          if (value) forward.set(key, value);
        }

        const target = new URL(endpoint, url.origin);
        target.search = forward.toString();

        const started = Date.now();
        let upstream: Response;
        try {
          upstream = await fetch(target, { headers: { accept: "application/json" } });
        } catch (error) {
          return json({
            status: "UPSTREAM_ERROR",
            surface: surface.id,
            operation,
            reason: `The dashboard source for ${surface.id} could not be reached: ${
              error instanceof Error ? error.message : String(error)
            }. This is a source failure, not an absence of data.`,
          });
        }
        if (!upstream.ok) {
          return json({
            status: "UPSTREAM_ERROR",
            surface: surface.id,
            operation,
            reason: `The dashboard source for ${surface.id} returned HTTP ${upstream.status}.`,
          });
        }

        const data = (await upstream.json()) as Record<string, unknown>;

        /**
         * Aggregates only.
         *
         * Several of these surfaces carry customer phone numbers, emails and
         * named employees in their row payloads. The dashboard shows them to a
         * signed-in operator; an agent answering a question does not need them,
         * so the row arrays are dropped for sensitive surfaces and the totals
         * kept.
         */
        const body = surface.sensitive ? stripRows(data) : data;

        /**
         * The headline figures, hoisted flat.
         *
         * Live: /website showed "مبيعات الموقع $1,926.57" while Nexus answered
         * with the company-wide $8,210.94 and said the website filter returned
         * zero rows. The figure was in the payload the whole time, at
         * `totals.sales` — two levels down, beside forty other keys. A model
         * handed a nested object goes looking somewhere else, so the scalars
         * that answer "how did this surface do" are lifted to the top.
         */
        const summary = flatSummary(body, surface.summaryPaths ?? []);

        return json({
          status: "OK",
          surface: surface.id,
          operation,
          summary,
          view: url.searchParams.get("view") ?? null,
          appliedFilters: Object.fromEntries(forward),
          source: "insights_hub",
          durationMs: Date.now() - started,
          data: body,
        });
      },
    },
  },
});

/**
 * The scalar figures a surface leads with.
 *
 * `totals` is the dashboard's own convention for them; `summary` is the other.
 * Anything else scalar at the top level is included too. Nested objects and
 * row arrays stay in `data` for a caller that needs them.
 */
function flatSummary(
  data: Record<string, unknown>,
  paths: readonly string[],
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  /**
   * `prefix` disambiguates keys two groups both use.
   *
   * health.crmExclusions and health.lostExclusions both carry `accepted`,
   * `candidates` and `unassigned`. Flattened bare, the second silently
   * overwrote the first and the agent read lost-lead counts as CRM counts — a
   * wrong number, not a missing one, which is the worse failure. A bare key is
   * still used when it is free, so every path that already worked keeps the
   * name it had.
   */
  const take = (source: unknown, prefix = "") => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      const name = key in out && prefix ? `${prefix}.${key}` : key;
      if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
      else if (typeof value === "string" && value.length < 120) out[name] = value;
    }
  };
  take(data.totals);
  take(data.summary);
  // Surfaces that keep their headline figures elsewhere say where in the
  // registry — Weekend under portfolio.weekend, Media Plan under plan.
  for (const path of paths) {
    let node: unknown = data;
    for (const segment of path.split(".")) {
      node =
        node && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined;
    }
    // The leaf segment names the group when the bare key is already taken.
    take(node, path.split(".").at(-1) ?? path);
  }
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "number" && Number.isFinite(value) && !(key in out)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Drop row-level collections, keep every aggregate.
 *
 * Deliberately blunt: an allow-list of "safe" columns rots the moment a source
 * adds one, and the cost of being wrong here is a customer's phone number in a
 * chat transcript.
 */
function stripRows(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      out[`${key}Count`] = value.length;
      const projected = performanceRows(key, value);
      if (projected.length > 0) out[key] = projected;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Performance figures per person or team, and nothing else about them.
 *
 * "Who is behind quota?" and "who should sell PMP?" cannot be answered from
 * totals, and dropping every row meant the agent had to say it could not tell —
 * with a target board on screen in front of the person asking.
 *
 * This is an ALLOW-list, which is the safe direction: a field the source adds
 * tomorrow is absent until someone decides it belongs. A deny-list is what rots
 * dangerously, because a new phone-number column would ship by default.
 * Contact details, call recordings, transcripts and identifiers are not here
 * and must not be added — a manager needs the numbers, not the person's phone.
 */
const PERFORMANCE_FIELDS = [
  "name",
  "team",
  "teamLeader",
  "unit",
  "target",
  "paidRevenue",
  "revenue",
  "achievementPaid",
  "achievement",
  "remaining",
  "cleanLeads",
  "leads",
  "won",
  "lost",
  "invoices",
  "salesOrders",
  "conversionRate",
  "outboundCalls",
  "answeredCalls",
  "answerRate",
  "topCourse",
  "topCourseRevenue",
] as const;

/** How many rows a ranking answer can possibly need. */
const MAX_PERFORMANCE_ROWS = 60;
/** Enough to say what someone sells; not their whole history. */
const MAX_COURSES_PER_PERSON = 8;

function performanceRows(key: string, rows: unknown[]): Array<Record<string, unknown>> {
  if (!["agents", "teams", "leaderboard", "needsAttention"].includes(key)) return [];
  return rows.slice(0, MAX_PERFORMANCE_ROWS).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const put = (name: string, value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
      else if (typeof value === "string" && value.length > 0 && value.length < 120) {
        out[name] = value;
      }
    };
    for (const field of PERFORMANCE_FIELDS) put(field, row[field]);

    /**
     * The quota, the score and the course mix live one level down.
     *
     * A flat scan skipped all three because each is an object, so the agent saw
     * a person's revenue and had no idea what they were supposed to hit. These
     * are the fields a manager asks about by name — "مين بعيد عن تارجته",
     * "مين أنسب واحد يبيع PMP" — so they are lifted explicitly.
     */
    const quota = row.target;
    if (quota && typeof quota === "object" && !Array.isArray(quota)) {
      const q = quota as Record<string, unknown>;
      put("target", q.target);
      put("achievementPaid", q.achievementPaid);
      put("teamLeader", q.teamLeader);
      put("branch", q.branch);
    }
    const score = row.performanceScore;
    if (score && typeof score === "object" && !Array.isArray(score)) {
      const sc = score as Record<string, unknown>;
      put("performanceScore", sc.overall);
      put("targetAttainment", sc.targetAttainment);
      put("salesExecution", sc.salesExecution);
    }
    /**
     * Which courses this person actually sells, ranked by collected revenue.
     *
     * This is what answers "who should sell PMP" with evidence rather than a
     * guess. Capped, and carrying no lead-level detail.
     */
    const profile = row.courseProfile;
    const courses =
      profile && typeof profile === "object" && !Array.isArray(profile)
        ? (profile as Record<string, unknown>).courses
        : null;
    if (Array.isArray(courses) && courses.length > 0) {
      out.courses = courses.slice(0, MAX_COURSES_PER_PERSON).flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const c = entry as Record<string, unknown>;
        const label = typeof c.label === "string" ? c.label : null;
        if (!label) return [];
        return [
          {
            label,
            leads: typeof c.leads === "number" ? c.leads : null,
            won: typeof c.won === "number" ? c.won : null,
            paidRevenue: typeof c.paidRevenue === "number" ? c.paidRevenue : null,
            conversionRate: typeof c.conversionRate === "number" ? c.conversionRate : null,
            /** "insufficient" means too few deals to rank on. Say so. */
            sampleStatus: typeof c.sampleStatus === "string" ? c.sampleStatus : null,
          },
        ];
      });
    }
    return Object.keys(out).length > 1 ? [out] : [];
  });
}
