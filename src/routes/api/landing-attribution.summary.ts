import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

function filters(request: Request) {
  const params = new URL(request.url).searchParams;
  return {
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    landingPageId: params.get("landingPageId") || undefined,
    source: params.get("source") || undefined,
    medium: params.get("medium") || undefined,
    campaign: params.get("campaign") || undefined,
    content: params.get("content") || undefined,
    touch: params.get("touch") === "latest" ? "latest" : "first",
  } as const;
}

export const Route = createFileRoute("/api/landing-attribution/summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getLandingAttributionSummary } = await import("@/lib/landing-attribution.server");
        return json(await getLandingAttributionSummary(filters(request)));
      },
    },
  },
});
