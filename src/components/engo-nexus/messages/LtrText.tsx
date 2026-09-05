/**
 * A Latin identifier inside Arabic copy, kept on its own run.
 *
 * WHY THIS EXISTS AS A COMPONENT. "PMP-1/7/26-sayed" in an Arabic paragraph is
 * a bidirectional nightmare: the browser reorders the slashes and digits by the
 * surrounding paragraph direction, so the name renders as "sayed-26/7/1-PMP" or
 * worse, and a reader cannot match it against the dashboard. Wrapping every
 * such string in `<bdi dir="ltr">` isolates it from the paragraph's direction.
 *
 * Used for campaign names, product names, product codes and platform names —
 * anything Latin that a person will read back to someone else.
 */
export function LtrText({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <bdi dir="ltr" className={`nexus-ltr ${className}`}>
      {children}
    </bdi>
  );
}
