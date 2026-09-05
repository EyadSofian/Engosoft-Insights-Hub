import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "@tanstack/react-router";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useActiveConversation, useConversations, useUser } from "@botpress/webchat";
import { useI18n } from "@/lib/i18n";
import { useFilters } from "@/lib/filter-store";
import { Mascot } from "./Mascot";
import { NexusHeader, type NexusStatus } from "./NexusHeader";
import { NexusWelcome } from "./NexusWelcome";
import { NexusComposer } from "./NexusComposer";
import { NexusMessageRenderer, hasRenderableContent } from "./NexusMessageRenderer";
import { ProgressMessage } from "./messages/ProgressMessage";
import { progressLabels } from "./lib/nexus-progress";
import { ErrorBubble } from "./messages/AlertMessage";
import { buildPageContext, contextPreamble, pageTypeFor, stripContext } from "./lib/nexus-context";
import { nexusStore, useNexusUi, rememberPanelOpened } from "./state/nexus-store";
import { getNexusView, subscribeNexusView } from "./state/nexus-view-context";

/**
 * The chat panel. Everything above this file is presentation; this is where the
 * Botpress conversation is actually driven.
 *
 * WHICH BOTPRESS API, AND WHY
 *
 * `@botpress/webchat@5.5.1` marks `useWebchat()` **@deprecated** in its own
 * typings, with a migration note pointing at `WebchatProvider` +
 * `useActiveConversation` + `useConversations`. Those are the hooks used here.
 * The `<Webchat>` batteries-included component is deliberately NOT used
 * anywhere in this integration — Botpress documents the two approaches as
 * incompatible, and a custom UI is the whole point: the rich cards, the mascot,
 * the page context and the Insights Hub theming are not expressible through the
 * packaged component's configuration.
 *
 * STREAMING
 *
 * The SDK exposes `upsertMessageStream` / `completeMessageStream` /
 * `abortMessageStream`, so token-level streaming is supported by the transport
 * when the bot emits stream deltas. This panel renders whatever arrives into
 * the SAME assistant bubble — `messages` is keyed by message id, so a delta
 * updates a bubble rather than appending a new one. When the bot does not
 * stream (the current ENGO Nexus deployment answers in one message), the panel
 * shows real progress states driven by `isAwaitingResponse` instead of faking
 * a typewriter. See docs in the repo for exactly what is achieved today.
 */
const PROGRESS_ROTATE_MS = 6000;

export function NexusPanel() {
  const { lang } = useI18n();
  const filters = useFilters();
  const location = useLocation();
  const { open, expanded } = useNexusUi();
  const ar = lang === "ar";

  const {
    messages,
    sendMessage,
    saveMessageFeedback,
    status,
    error,
    isTyping,
    isAwaitingResponse,
    conversationId,
  } = useActiveConversation();
  const { openConversation } = useConversations();
  const { userCredentials } = useUser();

  /**
   * `BlockMessage` carries `authorId`, not a direction flag, so the panel
   * decides which side a bubble belongs on by comparing it with this browser's
   * own Botpress user id. Anything not authored by us is the assistant — which
   * is also the safe default while credentials are still loading, since an
   * assistant bubble renders correctly either way and a user bubble would
   * render the raw context frame.
   */
  const myUserId = userCredentials?.userId;

  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [progressIndex, setProgressIndex] = useState(0);
  const [feedback, setFeedback] = useState<Record<string, "positive" | "negative">>({});
  const [sendError, setSendError] = useState<string | null>(null);
  /**
   * Set when the user presses Stop.
   *
   * HONEST SCOPE: the SDK folds `message_stream_delta` signals into `messages`
   * internally and exposes no `streamId` to a consumer, so `abortMessageStream`
   * cannot be called from here — there is nothing to pass it. Stop therefore
   * stops the panel WAITING: the progress indicator clears and the composer
   * becomes usable again. It does not cancel work already running on the agent,
   * and the answer still renders when it arrives. Pretending otherwise would be
   * a lie the user discovers 30 seconds later.
   */
  const [waitingSuppressed, setWaitingSuppressed] = useState(false);

  const generating = isAwaitingResponse || isTyping;
  const busy = generating && !waitingSuppressed;
  const connected = status === "connected";

  /**
   * The page's own declaration of what is on screen.
   *
   * Subscribed rather than read once: switching a tab or clicking a KPI must
   * change what "التاب دي" and "الرقم ده" refer to on the very next message.
   */
  const view = useSyncExternalStore(subscribeNexusView, getNexusView, getNexusView);

  const pageContext = useMemo(
    () =>
      buildPageContext({
        path: location.pathname,
        language: ar ? "ar" : "en",
        filters,
        view,
      }),
    [location.pathname, ar, filters, view],
  );

  /**
   * Send a message with the current dashboard context attached.
   *
   * The context line is prepended to the text rather than sent as a separate
   * message: a two-message turn would show an odd empty bubble, and the agent
   * would have to correlate them. It is bracketed and labelled so it reads as a
   * frame rather than as part of the question.
   */
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !connected) return;
      setSendError(null);
      setWaitingSuppressed(false);
      try {
        await sendMessage({
          type: "text",
          text: `${contextPreamble(pageContext)}\n${trimmed}`,
        });
      } catch (cause) {
        setSendError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [connected, pageContext, sendMessage],
  );

  // A quick action taken from the launcher or the popup arrives as a pending
  // prompt; it is sent once the socket is actually up.
  useEffect(() => {
    if (!open || !connected) return;
    const pending = nexusStore.consumePendingPrompt();
    if (pending) void send(pending);
  }, [open, connected, send]);

  useEffect(() => {
    if (open) rememberPanelOpened();
  }, [open]);

  // Escape closes, and focus moves into the panel when it opens.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") nexusStore.close();
    };
    document.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLTextAreaElement>("[data-testid='nexus-input']")?.focus();
    }, 180);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open]);

  // A newly-arrived message ends any suppressed wait: the turn is over, and the
  // next one must show its progress normally.
  useEffect(() => {
    setWaitingSuppressed(false);
  }, [messages.length]);

  // Always land on the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy, open]);

  // Rotate the progress label while a long turn runs.
  useEffect(() => {
    if (!busy) {
      setProgressIndex(0);
      return;
    }
    const timer = window.setInterval(
      () => setProgressIndex((index) => index + 1),
      PROGRESS_ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  const headerStatus: NexusStatus = busy
    ? "working"
    : status === "connected"
      ? "connected"
      : status === "connecting"
        ? "connecting"
        : status === "error"
          ? "error"
          : "disconnected";

  if (!open) return null;

  const labels = progressLabels(ar ? "ar" : "en");
  const progressLabel = labels[Math.min(progressIndex, labels.length - 1)]!;

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="ENGO Nexus"
      dir={ar ? "rtl" : "ltr"}
      data-testid="nexus-panel"
    >
      <button
        type="button"
        aria-label={ar ? "إغلاق" : "Close"}
        onClick={() => nexusStore.close()}
        className="absolute inset-0 hidden bg-black/40 backdrop-blur-[1px] sm:block"
      />

      <section
        ref={panelRef}
        className={[
          "relative flex h-dvh w-full flex-col bg-bg shadow-2xl",
          "sm:border-s sm:border-border",
          expanded ? "sm:w-[min(46rem,90vw)]" : "sm:w-[30rem] lg:w-[32rem]",
        ].join(" ")}
      >
        <NexusHeader
          lang={ar ? "ar" : "en"}
          status={headerStatus}
          expanded={expanded}
          onNewConversation={() => {
            setFeedback({});
            setSendError(null);
            openConversation(undefined);
          }}
          onToggleExpand={() => nexusStore.toggleExpanded()}
          onClose={() => nexusStore.close()}
        />

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4"
          data-testid="nexus-messages"
        >
          {messages.length === 0 && !busy && (
            <NexusWelcome
              lang={ar ? "ar" : "en"}
              pageType={pageTypeFor(location.pathname)}
              onPick={(prompt) => void send(prompt)}
            />
          )}

          {messages.map((message) => {
            const outgoing = !!myUserId && message.authorId === myUserId;
            /**
             * Decided before the row is drawn.
             *
             * The mascot used to render beside a null renderer result, which is
             * the "assistant replied with nothing" users reported. A message
             * still streaming keeps its row so the reader sees it arriving.
             */
            if (!outgoing && message.status !== "processing" && !hasRenderableContent(message)) {
              return null;
            }
            return (
              <div
                key={message.id}
                className={`flex gap-2 ${outgoing ? "justify-end" : "justify-start"}`}
                data-testid={outgoing ? "nexus-message-user" : "nexus-message-bot"}
              >
                {!outgoing && (
                  <Mascot variant="avatar" className="mt-0.5 size-7 shrink-0 rounded-full" />
                )}
                <div className={`min-w-0 ${outgoing ? "max-w-[85%]" : "max-w-[92%] flex-1"}`}>
                  <div
                    className={
                      outgoing
                        ? "rounded-2xl rounded-ee-sm bg-brand px-3 py-2 text-sm text-white"
                        : ""
                    }
                  >
                    {outgoing ? (
                      <p className="whitespace-pre-wrap break-words">
                        {stripContext(textOf(message))}
                      </p>
                    ) : (
                      <NexusMessageRenderer
                        message={message}
                        options={{
                          lang: ar ? "ar" : "en",
                          onSend: (text) => void send(text),
                          disabled: !connected || busy,
                          streaming: message.status === "processing",
                        }}
                      />
                    )}
                  </div>

                  {!outgoing && message.block.type !== "custom" && (
                    <Feedback
                      lang={ar ? "ar" : "en"}
                      value={feedback[message.id] ?? message.feedback}
                      onVote={(vote) => {
                        setFeedback((current) => ({ ...current, [message.id]: vote }));
                        void saveMessageFeedback(message.id, { value: vote }).catch(() => {
                          /* feedback is advisory; a failure must not break the chat */
                        });
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {busy && (
            <div className="flex gap-2">
              <ProgressMessage label={progressLabel} />
            </div>
          )}

          {(error || sendError) && (
            <ErrorBubble
              lang={ar ? "ar" : "en"}
              message={{
                type: "error",
                title: ar ? "في مشكلة في الاتصال" : "Connection problem",
                body: sendError ?? error?.message,
                retryable: true,
              }}
              onRetry={() => {
                setSendError(null);
                openConversation(conversationId);
              }}
            />
          )}
        </div>

        <NexusComposer
          lang={ar ? "ar" : "en"}
          busy={busy}
          disabled={!connected}
          placeholder={
            ar
              ? "اسأل عن الأرقام، الحملات، المبيعات، أو السعر…"
              : "Ask about figures, campaigns, sales, or a price…"
          }
          onSend={(text) => void send(text)}
          onStop={() => setWaitingSuppressed(true)}
        />
      </section>
    </div>
  );
}

function textOf(message: { block: { type: string; text?: string } }): string {
  return message.block.type === "text" ? (message.block.text ?? "") : "";
}

function Feedback({
  lang,
  value,
  onVote,
}: {
  lang: "ar" | "en";
  value?: "positive" | "negative";
  onVote: (vote: "positive" | "negative") => void;
}) {
  const ar = lang === "ar";
  return (
    <div className="mt-1.5 flex items-center gap-1" data-testid="nexus-feedback">
      <button
        type="button"
        onClick={() => onVote("positive")}
        aria-label={ar ? "إجابة مفيدة" : "Helpful"}
        aria-pressed={value === "positive"}
        className={`rounded-md p-1 transition hover:bg-bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
          value === "positive" ? "text-emerald-600 dark:text-emerald-400" : "text-text-subtle"
        }`}
      >
        <ThumbsUp className="size-3" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onVote("negative")}
        aria-label={ar ? "إجابة غير مفيدة" : "Not helpful"}
        aria-pressed={value === "negative"}
        className={`rounded-md p-1 transition hover:bg-bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
          value === "negative" ? "text-rose-600 dark:text-rose-400" : "text-text-subtle"
        }`}
      >
        <ThumbsDown className="size-3" aria-hidden />
      </button>
    </div>
  );
}
