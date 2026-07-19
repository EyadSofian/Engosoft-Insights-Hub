import type { ReactNode } from "react";
import { Sidebar, MobileNav } from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * FloatingChat deliberately lives in __root, not here: this shell remounts on
 * every navigation, which would wipe an in-progress conversation.
 */
export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh flex bg-bg">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar title={title} />
        {/* Bottom padding clears the mobile nav bar and its safe area. */}
        <main className="flex-1 px-4 sm:px-6 py-5 pb-28 lg:pb-8 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
