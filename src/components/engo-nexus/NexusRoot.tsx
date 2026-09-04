import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAnyModalOpen } from "@/lib/ui-store";
import { NEXUS_CLIENT_ID } from "./lib/nexus-config";
import { NexusLauncher } from "./NexusLauncher";
import { NexusProactivePopup } from "./NexusProactivePopup";
import { nexusStore, useNexusUi } from "./state/nexus-store";

/**
 * The single mount point for ENGO Nexus, mounted once in `__root.tsx` so the
 * conversation survives every route change.
 *
 * WHAT IS EAGER AND WHAT IS NOT
 *
 * Eager: the launcher and the proactive popup — a button and a card, a few kB,
 * and they must be on screen immediately.
 *
 * Lazy: everything Botpress. `NexusSession` carries the SDK, Recharts and
 * react-markdown, and importing it here would have added ~950 kB (273 kB gzip)
 * to the initial bundle of a dashboard whose whole point is loading fast. It is
 * fetched the first time someone actually opens the assistant, and then stays
 * mounted for the session.
 *
 * SSR: this is a TanStack Start app and the Botpress client is browser-only, so
 * nothing here renders until after hydration.
 *
 * FAIL CLOSED: with no client id, nothing renders at all. A visible assistant
 * that cannot connect is worse than an absent one.
 */
const NexusSession = lazy(() =>
  import("./NexusSession").then((module) => ({ default: module.NexusSession })),
);

export function NexusRoot() {
  const [mounted, setMounted] = useState(false);
  const { open } = useNexusUi();
  const anyModalOpen = useAnyModalOpen();
  // Latches on first open: the session is never torn down afterwards, so the
  // socket and the message history survive closing and reopening the panel.
  const started = useRef(false);
  if (open) started.current = true;

  useEffect(() => setMounted(true), []);

  // Any part of the app can open the assistant without prop-drilling. The
  // legacy `engosoft:open-chat` event is kept so the sidebar button and the
  // mobile nav — which the old FloatingChat listened to — still work.
  useEffect(() => {
    const openFromEvent = () => nexusStore.open();
    window.addEventListener("engosoft:open-nexus", openFromEvent);
    window.addEventListener("engosoft:open-chat", openFromEvent);
    return () => {
      window.removeEventListener("engosoft:open-nexus", openFromEvent);
      window.removeEventListener("engosoft:open-chat", openFromEvent);
    };
  }, []);

  if (!mounted || !NEXUS_CLIENT_ID) return null;

  return (
    <>
      <NexusLauncher hidden={open || anyModalOpen} />
      <NexusProactivePopup suppressed={open || anyModalOpen} />
      {started.current && (
        <Suspense fallback={open ? <PanelSkeleton /> : null}>
          <NexusSession />
        </Suspense>
      )}
    </>
  );
}

/** Shown for the few hundred milliseconds the session chunk takes to arrive. */
function PanelSkeleton() {
  return (
    <div className="fixed inset-0 z-[70] flex justify-end" aria-hidden>
      <div className="absolute inset-0 hidden bg-black/40 sm:block" />
      <div className="relative flex h-dvh w-full items-center justify-center bg-bg sm:w-[30rem] sm:border-s sm:border-border lg:w-[32rem]">
        <span
          className="size-6 animate-spin rounded-full border-2 border-border border-t-transparent motion-reduce:animate-none"
          role="status"
          aria-label="Loading"
        />
      </div>
    </div>
  );
}
