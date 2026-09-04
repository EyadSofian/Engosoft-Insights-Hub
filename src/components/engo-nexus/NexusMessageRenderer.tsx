import type { BlockMessage } from "@botpress/webchat";
import { parseNexusMessage } from "./lib/nexus-message-schema";
import { TextMessage, ComparisonCard } from "./messages/TextMessage";
import { KpiCard, KpiGroup } from "./messages/KpiCard";
import { PriceCard } from "./messages/PriceCard";
import { CourseSelector } from "./messages/CourseSelector";
import { DecisionCard } from "./messages/DecisionCard";
import { ChartMessage } from "./messages/ChartMessage";
import { TableMessage } from "./messages/TableMessage";
import { AlertMessage, ErrorBubble } from "./messages/AlertMessage";
import { QuickReplies } from "./messages/QuickReplies";
import { ProgressMessage } from "./messages/ProgressMessage";

/**
 * One deterministic switch from a Botpress block to a component.
 *
 * The routing rule, in order:
 *   1. `custom` blocks carry ENGO Nexus's typed payloads. `parseNexusMessage`
 *      validates them; anything it does not recognise returns null and falls
 *      through to text, so a bot that starts sending a new type degrades to
 *      readable prose rather than to a blank bubble.
 *   2. Native Botpress blocks (`text`, `choice`, `bloc`, …) render through
 *      their own components — `choice` becomes real quick-reply buttons rather
 *      than a markdown list, which on a phone is the difference between one tap
 *      and typing out a course variant.
 *   3. Anything else renders as text if it has any, and is skipped otherwise.
 *      A silently dropped message is worse than an ugly one.
 *
 * Nothing in this file reads a colour, a class name or a size from a payload.
 */
export interface RenderOptions {
  lang: "ar" | "en";
  onSend: (text: string) => void;
  disabled?: boolean;
  /** True while this message is still being streamed into. */
  streaming?: boolean;
  onRetry?: () => void;
}

export function NexusMessageRenderer({
  message,
  options,
}: {
  message: BlockMessage;
  options: RenderOptions;
}) {
  const { lang, onSend, disabled, streaming, onRetry } = options;
  const block = message.block;

  if (block.type === "custom") {
    const parsed = parseNexusMessage(block.name, block.data);
    if (parsed) {
      switch (parsed.type) {
        case "text":
          return (
            <TextMessage
              text={parsed.text}
              sources={parsed.sources}
              lang={lang}
              streaming={streaming}
            />
          );
        case "quick_replies":
          return (
            <QuickReplies
              label={parsed.text}
              options={parsed.options}
              onSelect={onSend}
              disabled={disabled}
            />
          );
        case "kpi_card":
          return <KpiCard message={parsed} lang={lang} />;
        case "kpi_group":
          return <KpiGroup message={parsed} lang={lang} />;
        case "comparison_card":
          return <ComparisonCard message={parsed} lang={lang} />;
        case "price_card":
          return <PriceCard message={parsed} lang={lang} />;
        case "course_selector":
          return (
            <CourseSelector message={parsed} lang={lang} onSelect={onSend} disabled={disabled} />
          );
        case "decision_card":
          return <DecisionCard message={parsed} lang={lang} onSend={onSend} disabled={disabled} />;
        case "chart":
          return <ChartMessage message={parsed} lang={lang} />;
        case "table":
          return <TableMessage message={parsed} lang={lang} />;
        case "alert":
          return <AlertMessage message={parsed} lang={lang} />;
        case "progress":
          return (
            <ProgressMessage
              label={parsed.label}
              step={parsed.step}
              totalSteps={parsed.totalSteps}
            />
          );
        case "error":
          return <ErrorBubble message={parsed} lang={lang} onRetry={onRetry} />;
      }
    }
    // Unrecognised custom payload — show whatever text it carried, never a
    // blank bubble and never a JSON dump.
    const fallback =
      typeof block.data === "object" && block.data !== null && "text" in block.data
        ? String((block.data as { text: unknown }).text)
        : null;
    return fallback ? <TextMessage text={fallback} lang={lang} /> : null;
  }

  if (block.type === "text") {
    return <TextMessage text={block.text} lang={lang} streaming={streaming} />;
  }

  if (block.type === "choice") {
    return (
      <div>
        {block.text && <TextMessage text={block.text} lang={lang} />}
        <QuickReplies options={block.options} onSelect={onSend} disabled={disabled} />
      </div>
    );
  }

  if (block.type === "dropdown") {
    return (
      <div>
        {block.text && <TextMessage text={block.text} lang={lang} />}
        <QuickReplies options={block.options} onSelect={onSend} disabled={disabled} />
      </div>
    );
  }

  if (block.type === "bloc") {
    return (
      <div className="space-y-2">
        {block.items.map((item, index) => {
          if (item.type === "text") {
            return <TextMessage key={index} text={item.text} lang={lang} />;
          }
          if (item.type === "image") {
            return (
              <img
                key={index}
                src={item.url}
                alt=""
                className="max-h-56 w-auto rounded-lg border border-border"
              />
            );
          }
          return null;
        })}
      </div>
    );
  }

  if (block.type === "image") {
    return (
      <img src={block.url} alt="" className="max-h-56 w-auto rounded-lg border border-border" />
    );
  }

  return null;
}
