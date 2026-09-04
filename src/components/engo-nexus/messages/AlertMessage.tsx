import { AlertTriangle, Info, OctagonAlert, RotateCcw } from "lucide-react";
import type { AlertMessage as AlertMessageType, ErrorMessage } from "../lib/nexus-message-schema";
import { SourceBadges } from "./SourceBadges";

const LEVEL = {
  info: { Icon: Info, box: "border-brand/30 bg-brand-soft/40", text: "text-brand" },
  warning: {
    Icon: AlertTriangle,
    box: "border-amber-500/30 bg-amber-500/10",
    text: "text-amber-700 dark:text-amber-400",
  },
  critical: {
    Icon: OctagonAlert,
    box: "border-rose-500/30 bg-rose-500/10",
    text: "text-rose-700 dark:text-rose-400",
  },
} as const;

export function AlertMessage({ message, lang }: { message: AlertMessageType; lang: "ar" | "en" }) {
  const { Icon, box, text } = LEVEL[message.level];
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${box}`} data-testid="nexus-alert">
      <p className={`flex items-center gap-1.5 text-xs font-semibold ${text}`}>
        <Icon className="size-3.5" aria-hidden />
        {message.title}
      </p>
      {message.body && (
        <p className="mt-1 text-[11px] leading-snug text-text-muted">{message.body}</p>
      )}
      <SourceBadges sources={message.sources} lang={lang} />
    </div>
  );
}

/**
 * A failure the user can act on. Always offers the retry when the failure is
 * retryable — a chat that fails silently is indistinguishable from one that is
 * thinking, and the difference matters after 30 seconds.
 */
export function ErrorBubble({
  message,
  lang,
  onRetry,
}: {
  message: ErrorMessage;
  lang: "ar" | "en";
  onRetry?: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5"
      role="alert"
      data-testid="nexus-error"
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 dark:text-rose-400">
        <OctagonAlert className="size-3.5" aria-hidden />
        {message.title}
      </p>
      {message.body && (
        <p className="mt-1 text-[11px] leading-snug text-text-muted">{message.body}</p>
      )}
      {message.retryable !== false && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          data-testid="nexus-retry"
          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border bg-bg px-2.5 py-1 text-[11px] font-medium text-text transition hover:bg-bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <RotateCcw className="size-3" aria-hidden />
          {lang === "ar" ? "حاول تاني" : "Try again"}
        </button>
      )}
    </div>
  );
}
