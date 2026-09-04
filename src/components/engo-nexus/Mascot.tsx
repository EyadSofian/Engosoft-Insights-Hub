/**
 * The ENGO Nexus mascot.
 *
 * One component so the asset path, the sizes and the alt text are decided once.
 * Two files exist by design: a head-only crop for the launcher and avatars,
 * where a full-body render would be an unreadable smudge at 32px, and the full
 * character for the welcome state where it has room.
 *
 * `alt=""` with `aria-hidden` wherever the mascot sits beside its own name —
 * a screen reader announcing "ENGO Nexus" twice is worse than not announcing
 * the picture at all.
 */
export type MascotVariant = "avatar" | "full";

export interface MascotProps {
  variant?: MascotVariant;
  className?: string;
  /** Provide only when the mascot is the sole label for a control. */
  label?: string;
}

const SRC: Record<MascotVariant, string> = {
  avatar: "/engo-nexus/mascot-avatar.png",
  full: "/engo-nexus/mascot.png",
};

export function Mascot({ variant = "avatar", className, label }: MascotProps) {
  return (
    <img
      src={SRC[variant]}
      srcSet={
        variant === "avatar"
          ? "/engo-nexus/mascot-avatar-128.png 128w, /engo-nexus/mascot-avatar.png 256w"
          : undefined
      }
      sizes={variant === "avatar" ? "64px" : undefined}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
      className={className}
      // The launcher must appear immediately; the welcome art can wait.
      loading={variant === "avatar" ? "eager" : "lazy"}
      decoding="async"
      width={variant === "avatar" ? 256 : 520}
      height={variant === "avatar" ? 256 : 513}
    />
  );
}
