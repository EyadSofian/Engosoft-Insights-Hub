import { createFileRoute } from "@tanstack/react-router";

async function signOut(): Promise<Response> {
  const { clearReadSessionCookie } = await import("@/lib/dashboard-auth.server");
  return new Response(null, {
    status: 303,
    headers: { location: "/", "set-cookie": clearReadSessionCookie(), "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: signOut,
      GET: signOut,
    },
  },
});
