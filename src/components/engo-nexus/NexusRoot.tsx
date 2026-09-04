import { Suspense, useEffect, useState, type ComponentType } from "react";
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
 * Deferred: everything Botpress. `NexusSession` carries the SDK, Recharts and
 * react-markdown; importing it here would add ~950 kB (273 kB gzip) to the
 * initial bundle of a dashboard whose whole point is loading fast. It is
 * fetched the first time someone actually opens the assistant, and then stays
 * mounted for the session so the socket and history survive close/reopen.
 *
 * WHY AN IMPERATIVE IMPORT AND NOT `React.lazy`
 *
 * `React.lazy(() => import("./NexusSession"))` broke the production server.
 * The Botpress SDK touches `document` at module scope, and Vite's SSR build
 * pulled the lazy chunk into the server graph and evaluated it on the first
 * request: `ReferenceError: document is not defined`, thrown from
 * `.output/server/_libs/@botpress/webchat+[...].mjs`. Rendering `null` during
 * SSR was not enough, because the failure happened at module evaluation rather
 * than at render.
 *
 * Importing inside an effect makes the browser-only guarantee absolute: an
 * effect never runs on the server, so the import expression is never evaluated
 * there, whatever the bundler decides to do with the module graph.
 *
 * FAIL CLOSED: with no client id, nothing renders at all. A visible assistant
 * that cannot connect is worse than an absent one.
 */
export function NexusRoot() {
  const { open } = useNexusUi();
  const anyModalOpen = useAnyModalOpen();
  const [mounted, setMounted] = useState(false);
  const [Session, setSession] = useState<ComponentType | null>(null);

  useEffect(() => setMounted(true), []);

  // Load the Botpress session once, on first open, and keep it thereafter.
  //
  // The `import.meta.env.SSR` guard is load-bearing, not defensive. Vite
  // substitutes it with a literal `true` in the SSR build, which makes the
  // dynamic import below statically unreachable and lets Rollup drop
  // `NexusSession` — and the whole Botpress SDK — from the server graph. Without
  // it, Vite emitted an SSR chunk and merged the SDK into the shared `_libs`
  // vendor chunk that React, lucide and clsx also live in; loading that chunk
  // for any ordinary component evaluated the SDK, which touches `document` at
  // module scope, and the production server answered every request with a 500.
  useEffect(() => {
    if (import.meta.env.SSR) return;
    if (!open || Session) return;
    let cancelled = false;
    void import("./NexusSession").then((module) => {
      if (!cancelled) setSession(() => module.NexusSession);
    });
    return () => {
      cancelled = true;
    };
  }, [open, Session]);

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
      {Session ? (
        <Suspense fallback={open ? <PanelSkeleton /> : null}>
          <Session />
        </Suspense>
      ) : (
        open && <PanelSkeleton />
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
