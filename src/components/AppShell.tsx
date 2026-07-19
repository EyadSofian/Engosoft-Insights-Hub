import type { ReactNode } from "react";
import { Sidebar, MobileNav } from "./Sidebar";
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
    <div className="min-h-dvh flex bg-bg">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        {/* Bottom padding clears the mobile nav bar and its safe area. */}
        <main className="flex-1 px-4 sm:px-6 py-5 pb-28 lg:pb-8 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
