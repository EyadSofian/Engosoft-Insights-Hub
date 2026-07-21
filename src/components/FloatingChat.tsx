import { useEffect, useMemo, useRef, useState } from "react";
import { X, Send, Sparkles, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useI18n } from "@/lib/i18n";
import { useFilters } from "@/lib/filter-store";
import { useAnyModalOpen } from "@/lib/ui-store";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const STORAGE = "engo_chat_v2";

export function FloatingChat() {
  const { t, lang, dir } = useI18n();
  const filters = useFilters();
  const anyModalOpen = useAnyModalOpen();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE);
    if (raw) {
      try {
        setMessages(JSON.parse(raw));
      } catch {
        /* corrupt entry — start fresh */
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE, JSON.stringify(messages.slice(-40)));
  }, [messages]);

  // Always land on the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  // Lock the page behind the full-screen mobile sheet, and focus the input.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 220);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open]);

  const suggestions = useMemo(
    () =>
      lang === "ar"
        ? ["أفضل حملة؟", "أعلى ROAS؟", "أين أهدر الميزانية؟", "أرخص تكلفة عميل؟"]
        : ["Best campaign?", "Highest ROAS?", "Where am I wasting budget?", "Cheapest CPL?"],
    [lang],
  );

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || loading) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, filters, history: next.slice(-8), lang }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: data.answer ?? "—" }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: lang === "ar" ? "تعذّر الاتصال بالخادم." : "Couldn't reach the server.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* FAB — sits on the end side so it never covers the mobile nav labels. */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("ai_assistant")}
        aria-expanded={open}
        className={`fixed z-40 bottom-24 lg:bottom-6 ${
          dir === "rtl" ? "start-5" : "end-5"
        } w-14 h-14 rounded-full grid place-items-center text-white cursor-pointer transition-all duration-300 ${
          open || anyModalOpen ? "scale-0 opacity-0 pointer-events-none" : "scale-100 opacity-100"
        }`}
        style={{
          background: "linear-gradient(140deg, var(--brand), var(--electric))",
          boxShadow: "0 12px 32px -8px rgba(22, 86, 160, 0.55), 0 0 0 1px rgba(255,255,255,0.12) inset",
        }}
      >
        <Sparkles size={22} />
      </button>

      {open && (
        <>
          {/* Mobile scrim only — desktop keeps the dashboard readable alongside. */}
          <div
            className="lg:hidden fixed inset-0 z-50 animate-fade-in"
            style={{ background: "rgba(4, 12, 24, 0.45)" }}
            onClick={() => setOpen(false)}
          />

          <div
            role="dialog"
            aria-modal="false"
            aria-label={t("ai_assistant")}
            className={`fixed z-50 flex flex-col overflow-hidden glass
              inset-0 rounded-none animate-fade-in
              lg:inset-auto lg:bottom-6 lg:${dir === "rtl" ? "start-6" : "end-6"}
              lg:w-[400px] lg:h-[min(640px,calc(100dvh-96px))] lg:rounded-3xl lg:animate-scale-in`}
          >
            {/* header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0">
              <div
                className="w-9 h-9 rounded-full grid place-items-center text-white shrink-0"
                style={{ background: "linear-gradient(140deg, var(--brand), var(--electric))" }}
              >
                <Sparkles size={17} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text truncate">{t("ai_assistant")}</div>
                <div className="text-[11px] text-text-muted truncate">
                  {filters.from && filters.to ? `${filters.from} → ${filters.to}` : "Engosoft"}
                </div>
              </div>
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  aria-label={t("new_chat")}
                  title={t("new_chat")}
                  className="w-9 h-9 grid place-items-center rounded-full hover:bg-surface-2 transition-colors cursor-pointer text-text-muted"
                >
                  <RotateCcw size={16} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label={t("close")}
                className="w-9 h-9 grid place-items-center rounded-full hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <X size={19} />
              </button>
            </div>

            {/* messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center pt-8 pb-4 px-2">
                  <div
                    className="w-12 h-12 rounded-2xl grid place-items-center mx-auto mb-3"
                    style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
                  >
                    <Sparkles size={22} />
                  </div>
                  <p className="text-sm text-text-muted leading-relaxed">{t("ai_empty")}</p>
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex animate-fade-up ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "text-white rounded-ee-md"
                        : "bg-surface border border-border text-text rounded-es-md"
                    }`}
                    style={m.role === "user" ? { background: "var(--brand)" } : undefined}
                  >
                    {m.role === "assistant" ? (
                      <div
                        className="[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0
                          [&_ul]:my-1.5 [&_ul]:ps-4 [&_ul]:list-disc [&_ol]:my-1.5 [&_ol]:ps-4 [&_ol]:list-decimal
                          [&_li]:my-0.5 [&_strong]:font-semibold [&_strong]:text-text
                          [&_code]:text-[12px] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-surface-2"
                      >
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start animate-fade-in">
                  <div className="bg-surface border border-border rounded-2xl rounded-es-md px-4 py-3 flex gap-1.5 items-center">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-text-subtle animate-bounce"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* composer */}
            <div
              className="p-3 border-t border-border shrink-0 bg-surface"
              style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            >
              {messages.length === 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-[11px] px-2.5 py-1.5 rounded-full border border-border text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="flex gap-2 items-center"
              >
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t("ask_anything")}
                  aria-label={t("ask_anything")}
                  className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-surface-2 border border-border text-sm outline-none focus:border-brand transition-colors"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label={t("send")}
                  className="w-11 h-11 shrink-0 grid place-items-center rounded-xl text-white disabled:opacity-40 transition-opacity cursor-pointer disabled:cursor-default"
                  style={{ background: "var(--brand)" }}
                >
                  <Send size={16} className="rtl:-scale-x-100" />
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
}
