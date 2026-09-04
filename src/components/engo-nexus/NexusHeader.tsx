import { Maximize2, Minimize2, PenSquare, X } from "lucide-react";
import { Mascot } from "./Mascot";

/**
 * The panel header.
 *
 * The status line says whether the assistant is reachable and whether it is
 * working — in plain language. It deliberately never names a model or a tier:
 * "Claude Sonnet 5" tells a sales manager nothing and invites questions the
 * dashboard cannot answer, while "جاري التحليل" tells them exactly what to
 * expect.
 */
export type NexusStatus = "connecting" | "connected" | "working" | "error" | "disconnected";

export function NexusHeader({
  lang,
  status,
  expanded,
  onNewConversation,
  onToggleExpand,
  onClose,
}: {
  lang: "ar" | "en";
  status: NexusStatus;
  expanded: boolean;
  onNewConversation: () => void;
  onToggleExpand: () => void;
  onClose: () => void;
}) {
  const ar = lang === "ar";
  const label: Record<NexusStatus, string> = ar
    ? {
        connecting: "جاري الاتصال…",
        connected: "متصل",
        working: "جاري التحليل…",
        error: "الاتصال متقطع",
        disconnected: "غير متصل",
      }
    : {
        connecting: "Connecting…",
        connected: "Online",
        working: "Analysing…",
        error: "Connection lost",
        disconnected: "Offline",
      };

  const dot =
    status === "connected"
      ? "bg-emerald-500"
      : status === "working"
        ? "bg-brand animate-pulse motion-reduce:animate-none"
        : status === "connecting"
          ? "bg-amber-500"
          : "bg-rose-500";

  return (
    <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-bg px-3 py-2.5">
      <Mascot variant="avatar" className="size-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text">ENGO Nexus</p>
        <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
          <span data-testid="nexus-status">{label[status]}</span>
        </p>
      </div>

      <button
        type="button"
        onClick={onNewConversation}
        aria-label={ar ? "محادثة جديدة" : "New conversation"}
        title={ar ? "محادثة جديدة" : "New conversation"}
        data-testid="nexus-new-conversation"
        className="rounded-lg p-2 text-text-muted transition hover:bg-bg-subtle hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <PenSquare className="size-4" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onToggleExpand}
        aria-label={ar ? (expanded ? "تصغير" : "توسيع") : expanded ? "Collapse" : "Expand"}
        aria-pressed={expanded}
        data-testid="nexus-expand"
        className="hidden rounded-lg p-2 text-text-muted transition hover:bg-bg-subtle hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand lg:block"
      >
        {expanded ? (
          <Minimize2 className="size-4" aria-hidden />
        ) : (
          <Maximize2 className="size-4" aria-hidden />
        )}
      </button>

      <button
        type="button"
        onClick={onClose}
        aria-label={ar ? "إغلاق" : "Close"}
        data-testid="nexus-close"
        className="rounded-lg p-2 text-text-muted transition hover:bg-bg-subtle hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <X className="size-4" aria-hidden />
      </button>
    </header>
  );
}
