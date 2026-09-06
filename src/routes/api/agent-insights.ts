import { createFileRoute } from "@tanstack/react-router";

/**
 * One read-only door onto every analytical surface the dashboard shows.
 *
 * WHY THIS EXISTS. ENGO Nexus could reach seven of the sixteen visible
 * surfaces. Asked "الويبسايت باع بكام؟" it said it did not have the data, while
 * /website was displaying the figure. An unwired capability and a genuine data
 * gap look identical to a user, and only one of them is honest.
 *
 * WHAT IT IS NOT. Not a generic HTTP proxy: the agent names a SURFACE, a VIEW
 * and an OPERATION from a closed vocabulary, and the contract maps that to the
 * dashboard's own endpoints. The model never sees or constructs a URL, and it
 * cannot reach anything the contract does not list — mutations included.
 *
 * THE HANDLER IS A SHELL. All of the resolution, merging, projection and
 * redaction lives in `agent-surface-gateway.server.ts`, which is a pure module
 * with an injectable fetch — so the behaviour this route promises is tested
 * directly rather than by grepping this file for a constant.
 */
export const Route = createFileRoute("/api/agent-insights")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readSurface } = await import("@/lib/agent-surface-gateway.server");
        const { json } = await import("@/lib/api.server");

        const url = new URL(request.url);
        const result = await readSurface({
          surfaceId: (url.searchParams.get("surface") ?? "").trim(),
          operation: (url.searchParams.get("operation") ?? "summary").trim(),
          view: url.searchParams.get("view"),
          params: url.searchParams,
          origin: url.origin,
          lang: url.searchParams.get("lang") === "en" ? "en" : "ar",
        });

        /**
         * An unknown surface answers 400 WITH the vocabulary, so a wrong guess
         * is self-correcting rather than a dead end.
         */
        if (result.status === "UNKNOWN_ENTITY") {
          const { AGENT_READABLE_SURFACES } = await import("@/lib/agent-insights-registry");
          return Response.json(
            {
              ...result,
              surfaces: AGENT_READABLE_SURFACES.map((surface) => ({
                id: surface.id,
                operations: surface.operations,
                views: surface.views,
              })),
            },
            { status: 400 },
          );
        }

        return json(result);
      },
    },
  },
});
