import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import {
  getSpeechRecognition,
  speechLocale,
  type SpeechRecognitionLike,
} from "../lib/nexus-speech";

/**
 * Speech-to-text for the composer.
 *
 * Implemented on the browser's own Web Speech API rather than by uploading
 * audio: it needs no server, no storage, and no new place for a recording of a
 * manager discussing revenue to live. Where the API is absent the button simply
 * does not render — a microphone that silently does nothing is worse than none.
 *
 * PERMISSION: nothing is requested until the user clicks. Browsers prompt on
 * `start()`, so no permission dialog appears from merely opening the panel.
 *
 * The five states are real and distinguishable: idle, requesting (clicked, not
 * yet granted), listening, processing (final transcript being assembled), and
 * error (denied, unsupported, or a recognition failure). A denied permission is
 * reported once and the control returns to idle rather than retrying, which is
 * what turns a permission prompt into a permission nag.
 */
export type VoiceState = "idle" | "requesting" | "listening" | "processing" | "error";

export function NexusVoiceInput({
  lang,
  disabled,
  onTranscript,
  onStateChange,
}: {
  lang: "ar" | "en";
  disabled?: boolean;
  onTranscript: (text: string, isFinal: boolean) => void;
  onStateChange?: (state: VoiceState) => void;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = getSpeechRecognition() !== null;

  const update = useCallback(
    (next: VoiceState) => {
      setState(next);
      onStateChange?.(next);
    },
    [onStateChange],
  );

  useEffect(() => () => recognitionRef.current?.abort(), []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    update("idle");
  }, [update]);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    setError(null);
    update("requesting");

    const recognition = new Ctor();
    recognition.lang = speechLocale(lang);
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => update("listening");

    recognition.onresult = (event) => {
      let transcript = "";
      let isFinal = false;
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i]!;
        transcript += result[0]?.transcript ?? "";
        if (result.isFinal) isFinal = true;
      }
      if (isFinal) update("processing");
      onTranscript(transcript.trim(), isFinal);
    };

    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are ordinary outcomes, not failures worth
      // shouting about; anything else is reported to the user.
      if (event.error === "aborted" || event.error === "no-speech") {
        update("idle");
        return;
      }
      setError(event.error);
      update("error");
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      // An error state must survive `onend`, which always fires after it.
      setState((current) => (current === "error" ? current : "idle"));
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setError("start-failed");
      update("error");
    }
  }, [lang, onTranscript, update]);

  if (!supported) return null;

  const listening = state === "listening" || state === "requesting";
  const label =
    state === "error"
      ? lang === "ar"
        ? "الميكروفون مش متاح"
        : "Microphone unavailable"
      : listening
        ? lang === "ar"
          ? "إيقاف التسجيل"
          : "Stop recording"
        : lang === "ar"
          ? "تسجيل صوتي"
          : "Voice input";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={listening ? stop : start}
      aria-label={label}
      title={error ? `${label} (${error})` : label}
      data-testid="nexus-voice"
      data-state={state}
      className={[
        "grid size-8 shrink-0 place-items-center rounded-lg transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "disabled:cursor-not-allowed disabled:opacity-40",
        listening
          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
          : state === "error"
            ? "text-rose-500"
            : "text-text-muted hover:bg-bg-subtle hover:text-text",
      ].join(" ")}
    >
      {state === "processing" ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : state === "error" ? (
        <MicOff className="size-4" aria-hidden />
      ) : (
        <Mic
          className={`size-4 ${listening ? "animate-pulse motion-reduce:animate-none" : ""}`}
          aria-hidden
        />
      )}
    </button>
  );
}
