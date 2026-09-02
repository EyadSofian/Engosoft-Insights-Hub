import { useEffect, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { PanelRightOpen } from "lucide-react";
import { chromeStore, useAutoHideChrome } from "@/lib/chrome-store";
import { useI18n } from "@/lib/i18n";
import { Sidebar, MobileNav } from "./Sidebar";
import { SectionTabs } from "./SectionTabs";
import { TopBar } from "./TopBar";

/**
 * The application frame: fixed navigation rail, auto-hiding control bar, scrolling
 * content, mobile bottom nav. Mounted ONCE in __root around the router Outlet,
 * so the rail and top bar (and their filter state) persist across navigation
 * and only the page content swaps. Each page supplies its own PageHeader, so
 * the top bar carries controls only — no title is passed here.
 *
 * The rail is `fixed` rather than a flex sibling. As a sibling it could only be
 * hidden by leaving the flow, which reflows the whole content column in one
 * frame — a visible jump, and on a page carrying a 200-row table a dropped
 * frame with it. Fixed, it leaves on a composited `transform` while the column
 * reclaims the space through one animated padding value.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const chrome = useAutoHideChrome();
  const { pathname } = useLocation();

  // A new page is a new context: what the reader scrolled away on the last one
  // should not decide how much chrome the next one opens with.
  useEffect(() => {
    chromeStore.reveal();
  }, [pathname]);

  return (
    <div className="min-h-dvh bg-bg overflow-x-clip">
      <Sidebar />
      <NavEdgeTrigger />

      <div className="chrome-inset flex min-h-dvh min-w-0 flex-col">
        <TopBar />
        <SectionTabs />
        {/* Bottom padding clears the mobile nav bar and its safe area; the
            inline padding also clears the notch when the phone is on its side. */}
        <main
          id="main-content"
          className="pad-safe-x [--pad-x:0.875rem] sm:[--pad-x:1.5rem] flex-1 py-4 sm:py-5 pb-[calc(var(--mobile-nav-h)+1.5rem)] lg:pb-8 max-w-[1600px] w-full mx-auto overflow-x-clip"
        >
          {children}
        </main>
      </div>

      <MobileNav />
      {chrome.navHidden && !chrome.pinned && <ShowNavButton />}
    </div>
  );
}

/**
 * A hit strip on the edge the rail retreated to. Hovering it — or reaching it
 * with Tab — brings the rail back for as long as the pointer stays; clicking
 * pins it open for good. It is a real button, not a bare div, so the affordance
 * exists for a keyboard too.
 */
function NavEdgeTrigger() {
  const { lang } = useI18n();
  return (
    <button
      type="button"
      data-app-chrome=""
      aria-label={lang === "ar" ? "إظهار قائمة التنقل" : "Show navigation"}
      className="chrome-edge-trigger hidden lg:block"
      onPointerEnter={() => chromeStore.setPeeking(true)}
      onPointerLeave={() => chromeStore.setPeeking(false)}
      onFocus={() => chromeStore.setPeeking(true)}
      onBlur={() => chromeStore.setPeeking(false)}
      onClick={() => chromeStore.setPinned(true)}
    />
  );
}

/**
 * The visible way back while the rail is away. The edge strip is a shortcut for
 * people who already know it is there; this is the one that can be seen.
 */
function ShowNavButton() {
  const { lang } = useI18n();
  return (
    <button
      type="button"
      data-app-chrome=""
      onClick={() => chromeStore.reveal()}
      className="animate-fade-in fixed bottom-6 z-40 hidden min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-[12px] font-semibold text-text shadow-md transition-colors hover:bg-surface-2 lg:inline-flex"
      style={{ insetInlineStart: "1rem" }}
    >
      <PanelRightOpen size={16} aria-hidden="true" className="rtl:-scale-x-100" />
      {lang === "ar" ? "التنقل" : "Navigation"}
    </button>
  );
}
