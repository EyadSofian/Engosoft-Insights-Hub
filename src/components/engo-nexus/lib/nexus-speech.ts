/**
 * Web Speech API access, isolated so the composer can be tested without a
 * browser speech engine and so the capability check has one home.
 */
export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Returns the browser's speech-recognition constructor, or null.
 *
 * Null is a supported outcome, not a failure: the microphone button simply does
 * not render. A control that asks for permission and then cannot do anything
 * is worse than an absent one.
 */
export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** BCP-47 tag for the dashboard's two languages. */
export function speechLocale(lang: "ar" | "en"): string {
  return lang === "ar" ? "ar-EG" : "en-US";
}
