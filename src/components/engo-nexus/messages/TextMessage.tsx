import { Children, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { ComparisonCardMessage } from "../lib/nexus-message-schema";
import { Metric } from "./KpiCard";
import { SourceBadges } from "./SourceBadges";
import { normalizeFloatNoise } from "../lib/nexus-format";
import type { NexusSource } from "../lib/nexus-message-schema";

const ARABIC = /[\u0600-\u06ff]/;
const LATIN_OR_NUMBER = /[A-Za-z0-9]/;

function directText(children: ReactNode): string {
  return Children.toArray(children)
    .filter(
      (child): child is string | number => typeof child === "string" || typeof child === "number",
    )
    .join("");
}

function needsLtrIsolation(children: ReactNode): boolean {
  const value = directText(children);
  return LATIN_OR_NUMBER.test(value) && !ARABIC.test(value);
}

/**
 * Prose from ENGO Nexus.
 *
 * Markdown is kept for narrative answers — the agent writes structured
 * diagnostic prose (summary, evidence, diagnosis, recommendation) and stripping
 * its formatting would make it harder to read, not safer. What markdown must
 * NOT be is the transport for a figure that deserves a card; that is what the
 * typed messages are for.
 *
 * The renderer overrides are deliberate: links open in a new tab with
 * `rel="noreferrer"`, and images are dropped entirely. A chat bubble is not a
 * place to load a remote image on a model's say-so.
 *
 * Prose passes through `normalizeFloatNoise` first. Verified live: the agent
 * writes figures like `7009.358714766733` into its own sentences, and markdown
 * would render that verbatim. See that function for why the rule is narrow.
 */
export function TextMessage({
  text,
  sources,
  lang,
  streaming,
}: {
  text: string;
  sources?: NexusSource[];
  lang: "ar" | "en";
  streaming?: boolean;
}) {
  const body = useMemo(() => normalizeFloatNoise(text), [text]);

  return (
    <div data-testid="nexus-text">
      <div className="nexus-prose text-sm leading-relaxed text-text">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p dir={lang === "ar" ? "rtl" : "ltr"}>{children}</p>,
            li: ({ children }) => <li dir={lang === "ar" ? "rtl" : "ltr"}>{children}</li>,
            strong: ({ children }) => (
              <strong>
                {needsLtrIsolation(children) ? (
                  <bdi dir="ltr" className="nexus-ltr">
                    {children}
                  </bdi>
                ) : (
                  children
                )}
              </strong>
            ),
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-brand underline underline-offset-2"
              >
                {children}
              </a>
            ),
            img: () => null,
            table: ({ children }) => (
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-max text-[11px]">{children}</table>
              </div>
            ),
            code: ({ children }) => (
              <code
                dir={ARABIC.test(directText(children)) ? "rtl" : "ltr"}
                className="rounded bg-bg-subtle px-1 py-0.5 text-[11px]"
              >
                {children}
              </code>
            ),
          }}
        >
          {body}
        </ReactMarkdown>
        {streaming && (
          <span
            className="ms-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-brand align-middle motion-reduce:animate-none"
            aria-hidden
          />
        )}
      </div>
      <SourceBadges sources={sources} lang={lang} />
    </div>
  );
}

/** Two periods, two markets, or two courses — measured side by side. */
export function ComparisonCard({
  message,
  lang,
}: {
  message: ComparisonCardMessage;
  lang: "ar" | "en";
}) {
  return (
    <div
      className="rounded-xl border border-border bg-bg-subtle p-3"
      data-testid="nexus-comparison"
    >
      {message.title && <h4 className="mb-2 text-xs font-semibold text-text">{message.title}</h4>}
      <div className="grid grid-cols-2 gap-3">
        {[message.left, message.right].map((side, index) => (
          <div key={index} className="min-w-0 space-y-2">
            <p className="truncate text-[11px] font-semibold text-text-muted">{side.label}</p>
            {side.metrics.map((metric) => (
              <Metric key={`${index}:${metric.key}`} metric={metric} lang={lang} />
            ))}
          </div>
        ))}
      </div>
      <SourceBadges sources={message.sources} lang={lang} />
    </div>
  );
}
