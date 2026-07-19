import { createFileRoute } from "@tanstack/react-router";

interface Update {
  message?: { chat?: { id?: number | string }; text?: string };
}

/**
 * Handles /report and /week so the manager can pull a report on demand.
 * Register with:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<APP_URL>/api/telegram/webhook
 */
export const Route = createFileRoute("/api/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { buildReport, sendMessage, esc } = await import("@/lib/telegram.server");
        const { json } = await import("@/lib/api.server");

        let update: Update;
        try {
          update = (await request.json()) as Update;
        } catch {
          return json({ ok: false });
        }

        const text = update.message?.text?.trim() ?? "";
        const from = update.message?.chat?.id;
        if (!from || !text.startsWith("/")) return json({ ok: true });

        // Strip the @botname suffix Telegram appends in group chats.
        const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();

        if (command === "/report" || command === "/week") {
          const days = command === "/week" ? 7 : 1;
          const body = await buildReport({ days });
          await sendMessage(body, String(from));
          return json({ ok: true });
        }

        if (command === "/start" || command === "/help") {
          await sendMessage(
            [
              `*${esc("أوامر متاحة")}*`,
              esc("/report — تقرير أمس"),
              esc("/week — ملخص آخر ٧ أيام"),
            ].join("\n"),
            String(from),
          );
        }

        return json({ ok: true });
      },
    },
  },
});
