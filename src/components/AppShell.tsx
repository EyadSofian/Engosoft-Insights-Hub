import { type ReactNode } from "react";
import { useAutoHideChrome } from "@/lib/chrome-store";
import { Sidebar, MobileNav } from "./Sidebar";
import { SectionTabs } from "./SectionTabs";
import { TopBar } from "./TopBar";

/**
 * The application frame: fixed, reader-controlled navigation rail, fixed control
 * bar, scrolling content and mobile bottom nav. Mounted ONCE in __root around
 * the router Outlet, so the rail and top bar (and their filter state) persist
 * across navigation and only the page content swaps. Each page supplies its own
 * DashboardPageHeader; the top bar carries controls only.
 *
 * The rail is `fixed` rather than a flex sibling. As a sibling it could only be
 * collapsed by leaving the flow, which would reflow the whole content column
 * in one frame — a visible jump on a long table. Fixed, it moves on a
 * composited `transform` while the column reclaims the space through one
 * deliberate transition.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useAutoHideChrome();

  return (
    <div className="min-h-dvh bg-bg overflow-x-clip">
      <Sidebar />

      <div className="chrome-inset flex min-h-dvh min-w-0 flex-col">
        <TopBar />
        <SectionTabs />
        {/* Bottom padding clears the mobile nav bar and its safe area; the
            inline padding also clears the notch when the phone is on its side. */}
        <main
          id="main-content"
          // The bottom reserve clears two fixed elements: the mobile nav bar
          // with its safe area, and — from `lg`, where there is no nav bar —
          // the assistant launcher parked in the opposite corner. Without the
          // second, the last card on every page sat under a 56px button.
          className="pad-safe-x [--pad-x:0.875rem] sm:[--pad-x:1.5rem] flex-1 py-4 sm:py-5 pb-[calc(var(--mobile-nav-h)+1.5rem)] lg:pb-[calc(var(--nexus-launcher-clearance)+1rem)] max-w-[1600px] w-full mx-auto overflow-x-clip"
        >
          {children}
        </main>
      </div>

      <MobileNav />
    </div>
  );
}
