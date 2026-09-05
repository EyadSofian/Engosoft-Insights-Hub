import { Fragment } from "react";

/**
 * Arabic prose containing Latin identifiers, each run isolated.
 *
 * The recommendation summary is a sentence with a campaign name inside it —
 * "ركز على PMP-1/7/26-sayed". Rendered as one text node, the bidi algorithm
 * reorders the name's digits and slashes against the Arabic paragraph and it
 * comes out scrambled, which is precisely the mixed-direction breakage this
 * sprint exists to fix. Wrapping the whole sentence in `dir="ltr"` would be
 * worse — it would flip the Arabic.
 *
 * So the Latin runs are split out and isolated individually, and the Arabic
 * flows around them untouched.
 */
const LATIN_RUN = /([A-Za-z][A-Za-z0-9._/+()-]*(?:\s[A-Za-z0-9._/+()-]+)*)/g;

export function IsolatedText({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(LATIN_RUN);
  return (
    <>
      {parts.map((part, index) =>
        // Odd indices are the captured Latin runs.
        index % 2 === 1 ? (
          <bdi key={index} dir="ltr" className="nexus-ltr">
            {part}
          </bdi>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
