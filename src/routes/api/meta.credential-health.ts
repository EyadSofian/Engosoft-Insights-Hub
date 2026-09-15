import { createFileRoute } from "@tanstack/react-router";
import { json } from "@/lib/api.server";

/**
 * Meta credential capabilities (connected / not connected per capability) and
 * the automatic bootstrap log. Never returns token text or fingerprints.
 * POST (admin) re-probes now and bootstraps a valid Attribution credential.
 */
export const Route = createFileRoute("/api/meta/credential-health")({
  server: {
    handlers: {
      GET: async () => {
        const { metaCredentialHealthView } = await import("@/lib/meta-credential-health.server");
        return json(await metaCredentialHealthView());
      },
      POST: async ({ request }) => {
        const { authorizeWrite } = await import("@/lib/admin-auth.server");
        const guard = authorizeWrite(request);
        if (!guard.ok) return json({ error: guard.error }, guard.status);
        const server = await import("@/lib/meta-credential-health.server");
        const health = await server.checkMetaCredentials({ force: true });
        return json({
          checked: health.credentials.map((row) => ({ variable: row.variable, valid: row.valid })),
          view: await server.metaCredentialHealthView(),
        });
      },
    },
  },
});
