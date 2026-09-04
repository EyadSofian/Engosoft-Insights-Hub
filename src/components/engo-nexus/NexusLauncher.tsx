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
 * MOTION: a slow, low-amplitude float, and nothing else. A launcher that
 * bounces continuously in a manager's peripheral vision for an eight-hour shift
 * is an irritation, not an invitation. `motion-reduce:` disables it entirely
 * for anyone who has asked the OS for less motion — the ring and the badge stay,
 * so no information is carried by movement alone.
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
        "group fixed z-50 grid size-14 place-items-center rounded-full",
        "bg-gradient-to-br from-[#0B2545] to-[#1656a0] shadow-lg shadow-brand/25",
        "transition duration-200 hover:scale-105 active:scale-95",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "nexus-float motion-reduce:animate-none",
        // Clears the mobile bottom nav and the iOS home bar; tighter on desktop.
        "bottom-[calc(env(safe-area-inset-bottom,0px)+5.25rem)] end-4",
        "sm:bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:end-6",
      ].join(" ")}
    >
      <span
        className="absolute inset-0 rounded-full ring-2 ring-[#38bdf8]/30 transition group-hover:ring-[#38bdf8]/60"
        aria-hidden
      />
      <Mascot variant="avatar" className="size-11 rounded-full" />
      {/* Online dot: the assistant is reachable. Not a notification count. */}
      <span
        className="absolute bottom-0.5 end-0.5 size-3 rounded-full border-2 border-white bg-emerald-500 dark:border-[#0B2545]"
        aria-hidden
      />
    </button>
  );
}
