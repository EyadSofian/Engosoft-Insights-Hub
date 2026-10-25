import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/** Aggregate, Meta-reported delivery by destination type. Not conversation attribution. */
export const Route = createFileRoute("/api/meta-destination-mix")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const { getMetaDestinationMix } = await import("@/lib/meta-destination-mix.server");
        return json(
          await getMetaDestinationMix({
            from: params.get("from") || undefined,
            to: params.get("to") || undefined,
          }),
        );
      },
    },
  },
});
