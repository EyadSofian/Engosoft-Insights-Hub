import type { ReactNode } from "react";
import { Sidebar, MobileNav } from "./Sidebar";
import { SectionTabs } from "./SectionTabs";
import { TopBar } from "./TopBar";

/**
 * The application frame: fixed sidebar, sticky control bar, scrolling content,
 * mobile bottom nav. Mounted ONCE in __root around the router Outlet, so the
 * sidebar and top bar (and their filter state) persist across navigation and
 * only the page content swaps. Each page supplies its own PageHeader, so the
 * top bar carries controls only — no title is passed here.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh flex bg-bg overflow-x-clip">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        <SectionTabs />
        {/* Bottom padding clears the mobile nav bar and its safe area; the
            inline padding also clears the notch when the phone is on its side. */}
        <main className="pad-safe-x [--pad-x:0.875rem] sm:[--pad-x:1.5rem] flex-1 py-4 sm:py-5 pb-[calc(var(--mobile-nav-h)+1.5rem)] lg:pb-8 max-w-[1600px] w-full mx-auto overflow-x-clip">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
