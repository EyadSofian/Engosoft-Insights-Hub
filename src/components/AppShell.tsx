import { type ReactNode } from "react";
import { useAutoHideChrome } from "@/lib/chrome-store";
import { AppFooter } from "./AppFooter";
import { Sidebar } from "./Sidebar";
import { SectionTabs } from "./SectionTabs";
import { TopBar } from "./TopBar";

/**
 * The application frame: fixed, reader-controlled navigation rail, an auto-hiding
 * control bar (with the navigation drawer below `lg`), scrolling content and an
 * in-flow footer. Mounted ONCE in __root around
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
        <main
          id="main-content"
          // Nothing fixed sits at the bottom any more — the phone navigation
          // moved into the header drawer — so the content only needs its own
          // breathing room before the footer, which follows it in the flow.
          className="pad-safe-x [--pad-x:0.875rem] sm:[--pad-x:1.5rem] flex-1 py-4 sm:py-5 pb-8 sm:pb-10 max-w-[1600px] w-full mx-auto overflow-x-clip"
        >
          {children}
        </main>
        <AppFooter />
      </div>
    </div>
  );
}
