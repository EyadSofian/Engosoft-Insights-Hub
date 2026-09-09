import { BellRing, CalendarRange, X } from "lucide-react";
import {
  notificationQuickActions,
  type NexusNotificationContext,
} from "./lib/nexus-notification";

export function NexusNotificationCard({
  notice,
  lang,
  disabled,
  onSend,
  onDismiss,
}: {
  notice: NexusNotificationContext;
  lang: "ar" | "en";
  disabled: boolean;
  onSend: (prompt: string) => void;
  onDismiss: () => void;
}) {
  const ar = lang === "ar";
  return (
    <article
      data-testid="nexus-notification-context"
      className="overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-b from-sky-50 to-bg shadow-sm dark:border-sky-900/70 dark:from-sky-950/30"
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300">
          <BellRing className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                {ar ? "إشعار من Qodo" : "Notification from Qodo"}
              </p>
              <h2 className="mt-0.5 text-sm font-bold text-text">{notice.title}</h2>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label={ar ? "إخفاء ملخص الإشعار" : "Hide notification summary"}
              className="rounded-lg p-1.5 text-text-subtle transition hover:bg-bg-subtle hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
          <p className="mt-2 text-[13px] leading-6 text-text" dir="auto">
            {notice.body}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-subtle" dir="ltr">
            <CalendarRange className="size-3.5" aria-hidden />
            <span>{notice.from} → {notice.to}</span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-sky-100 px-3 py-2.5 dark:border-sky-900/60">
        {notificationQuickActions(notice, lang).map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={disabled}
            onClick={() => onSend(action.prompt)}
            className="rounded-full border border-border bg-bg px-2.5 py-1.5 text-[11px] font-semibold text-text transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
      </div>
    </article>
  );
}
