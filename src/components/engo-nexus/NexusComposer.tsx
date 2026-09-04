import { useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import { NexusVoiceInput } from "./voice/NexusVoiceInput";

/**
 * The composer.
 *
 * Enter sends, Shift+Enter breaks a line — the convention every chat the user
 * already uses follows, and getting it backwards is instantly annoying. The
 * textarea grows with its content up to a cap, so a long question is visible
 * while typing without the composer eating the transcript.
 *
 * While a reply is generating the send button becomes a stop button. That is
 * not decoration: a DEEP turn runs for tens of seconds and a user who realises
 * mid-flight that they asked the wrong thing needs a way out. Its label says
 * "stop waiting" rather than "stop" because that is what it honestly does —
 * see the note on `waitingSuppressed` in NexusPanel.
 */
const MAX_ROWS_PX = 140;

export function NexusComposer({
  lang,
  busy,
  disabled,
  placeholder,
  onSend,
  onStop,
  onAttach,
}: {
  lang: "ar" | "en";
  busy?: boolean;
  disabled?: boolean;
  placeholder: string;
  onSend: (text: string) => void;
  onStop?: () => void;
  onAttach?: (file: File) => void;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ar = lang === "ar";

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    onSend(text);
  };

  return (
    <div className="shrink-0 border-t border-border bg-bg px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3">
      <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-bg-subtle px-2 py-1.5 focus-within:border-brand">
        {onAttach && (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              aria-label={ar ? "إرفاق ملف" : "Attach a file"}
              data-testid="nexus-attach"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-bg hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Paperclip className="size-4" aria-hidden />
            </button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onAttach(file);
                event.target.value = "";
              }}
            />
          </>
        )}

        <NexusVoiceInput
          lang={lang}
          disabled={disabled}
          onTranscript={(text, isFinal) => {
            setValue(text);
            if (isFinal && text) textareaRef.current?.focus();
          }}
        />

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={placeholder}
          data-testid="nexus-input"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          className="max-h-[140px] min-h-[2rem] flex-1 resize-none bg-transparent py-1.5 text-sm text-text outline-none placeholder:text-text-subtle disabled:cursor-not-allowed"
        />

        {busy && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={ar ? "إيقاف الانتظار" : "Stop waiting"}
            title={
              ar
                ? "بطّل الانتظار — الرد ممكن يوصل بعدين"
                : "Stop waiting — the answer may still arrive"
            }
            data-testid="nexus-stop"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-text text-bg transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <Square className="size-3.5 fill-current" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || value.trim().length === 0}
            aria-label={ar ? "إرسال" : "Send"}
            data-testid="nexus-send"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
