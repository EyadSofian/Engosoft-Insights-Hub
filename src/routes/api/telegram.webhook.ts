import { createFileRoute } from "@tanstack/react-router";

interface Update {
  message?: {
    chat?: { id?: number | string; type?: string; title?: string; first_name?: string; username?: string };
    from?: { first_name?: string; username?: string };
    text?: string;
  };
}

/**
 * Anyone who sends /start to the bot is subscribed to the daily report; /stop
 * removes them. /report and /week answer on demand.
 *
 * Register with:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<APP_URL>/api/telegram/webhook
 *
 * Telegram retries any non-2xx response, so this always answers 200 — a retry
 * loop would re-run whichever command failed, over and over.
 */
export const Route = createFileRoute("/api/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { buildReport, sendMessage, esc } = await import("@/lib/telegram.server");
        const { subscribe, unsubscribe, isSubscribed, subscriberCount } = await import(
          "@/lib/subscribers.server"
        );
        const { json } = await import("@/lib/api.server");

        let update: Update;
        try {
          update = (await request.json()) as Update;
        } catch {
          return json({ ok: true });
        }

        const msg = update.message;
        const text = msg?.text?.trim() ?? "";
        const chat = msg?.chat?.id;
        if (chat === undefined || chat === null || !text.startsWith("/")) return json({ ok: true });

        const chatId = String(chat);
        // Telegram appends @botname to commands in group chats.
        const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();
        const displayName =
          msg?.chat?.title || msg?.from?.first_name || msg?.chat?.first_name || msg?.from?.username || undefined;

        try {
          switch (command) {
            case "/start": {
              const isNew = await subscribe(chatId, displayName);
              const greeting = displayName ? `أهلاً ${displayName}` : "أهلاً بك";
              await sendMessage(
                [
                  `👋 *${esc(greeting)}*`,
                  esc(
                    isNew
                      ? "تم تسجيلك. ستصلك نشرة أداء التسويق والمبيعات يومياً في التاسعة صباحاً بتوقيت القاهرة."
                      : "أنت مسجَّل بالفعل، وستصلك النشرة اليومية في موعدها.",
                  ),
                  "",
                  `*${esc("الأوامر المتاحة")}*`,
                  esc("/report — تقرير أمس"),
                  esc("/week — ملخص آخر ٧ أيام"),
                  esc("/stop — إيقاف الاشتراك"),
                ].join("\n"),
                chatId,
              );
              // Send the current report straight away, so /start produces
              // something useful instead of a wait until tomorrow morning.
              if (isNew) {
                const report = await buildReport({ days: 1 });
                await sendMessage(report, chatId);
              }
              break;
            }

            case "/stop": {
              const wasSubscribed = await unsubscribe(chatId);
              await sendMessage(
                esc(
                  wasSubscribed
                    ? "تم إيقاف الاشتراك. أرسل /start في أي وقت للعودة."
                    : "أنت غير مشترك أصلاً. أرسل /start للاشتراك.",
                ),
                chatId,
              );
              break;
            }

            case "/report":
            case "/week": {
              const report = await buildReport({ days: command === "/week" ? 7 : 1 });
              await sendMessage(report, chatId);
              break;
            }

            case "/status": {
              const [subscribed, count] = await Promise.all([isSubscribed(chatId), subscriberCount()]);
              await sendMessage(
                [
                  esc(subscribed ? "أنت مشترك في النشرة اليومية." : "أنت غير مشترك. أرسل /start للاشتراك."),
                  esc(`عدد المشتركين حالياً: ${count}`),
                ].join("\n"),
                chatId,
              );
              break;
            }

            case "/help": {
              await sendMessage(
                [
                  `*${esc("الأوامر المتاحة")}*`,
                  esc("/start — الاشتراك في النشرة اليومية"),
                  esc("/report — تقرير أمس"),
                  esc("/week — ملخص آخر ٧ أيام"),
                  esc("/status — حالة اشتراكك"),
                  esc("/stop — إيقاف الاشتراك"),
                ].join("\n"),
                chatId,
              );
              break;
            }
          }
        } catch (e) {
          console.error("[telegram] webhook handler failed:", e instanceof Error ? e.message : e);
        }

        return json({ ok: true });
      },
    },
  },
});
