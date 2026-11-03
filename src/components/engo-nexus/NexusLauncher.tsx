import { useI18n } from "@/lib/i18n";
import { Mascot } from "./Mascot";
import { nexusStore } from "./state/nexus-store";

/**
 * The collapsed launcher — the mascot itself, not a generic bot glyph.
 *
 * Placement follows the dashboard's own direction: `end-*` resolves to the
 * right in LTR and the left in RTL, so it always lands on the corner opposite
 * the sidebar without any manual RTL branching.
 *
 * It used to be a glossy orb pinned to the bottom corner of every page: a
 * navy-to-blue gradient ball with a cyan glow ring, drifting up and down for
 * the whole shift. It now sits in the navigation rail, where the rest of the
 * places you can go already live, as a row like the others.
 */
export function NexusLauncher({ hidden }: { hidden?: boolean }) {
  const { lang } = useI18n();
  const label = lang === "ar" ? "افتح ENGO Nexus" : "Open ENGO Nexus";

  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={() => nexusStore.open()}
      aria-label={label}
      title={label}
      data-testid="nexus-launcher"
      className={[
        "group relative flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5",
        "text-start text-[13px] font-normal text-nav-text-muted",
        "transition-colors hover:bg-nav-hover hover:text-nav-text",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "nexus-float motion-reduce:animate-none",
      ].join(" ")}
    >
      <span className="relative grid size-5 shrink-0 place-items-center">
        <Mascot variant="avatar" className="size-5 rounded-full" />
        {/* Online dot: the assistant is reachable. Not a notification count. */}
        <span
          className="absolute -bottom-px -end-px size-1.5 rounded-full bg-emerald-500"
          aria-hidden
        />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
