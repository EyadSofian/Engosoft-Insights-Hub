import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { I18nProvider } from "@/lib/i18n";
import { FloatingChat } from "@/components/FloatingChat";

/**
 * Applies the stored language and theme before first paint. Without this the
 * page renders light-and-RTL for a frame before React hydrates.
 */
const BOOT_SCRIPT = `(function(){try{
var l=localStorage.getItem('engo_lang')||'ar';
document.documentElement.lang=l;
document.documentElement.dir=l==='ar'?'rtl':'ltr';
var t=localStorage.getItem('engo_theme');
if(!t)t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
if(t==='dark')document.documentElement.classList.add('dark');
}catch(e){}})();`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-text num">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-text">Page not found</h2>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex px-4 py-2.5 rounded-xl text-white text-sm font-medium"
            style={{ background: "var(--brand)" }}
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-text">This page didn't load</h1>
        <p className="mt-2 text-sm text-text-muted break-words">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="px-4 py-2.5 rounded-xl text-white text-sm font-medium"
            style={{ background: "var(--brand)" }}
          >
            Try again
          </button>
          <a href="/" className="px-4 py-2.5 rounded-xl border border-border text-sm">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Engosoft — Marketing & Sales Intelligence" },
      {
        name: "description",
        content: "Full-funnel marketing and sales intelligence dashboard for Engosoft.",
      },
      { name: "theme-color", content: "#001E3C" },
      { property: "og:title", content: "Engosoft — Marketing & Sales Intelligence" },
      {
        property: "og:description",
        content: "Full-funnel marketing and sales intelligence dashboard for Engosoft.",
      },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // BOOT_SCRIPT rewrites lang/dir/class before hydration, so the server markup
    // intentionally differs from the client's first paint.
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <Outlet />
        {/* Mounted once, so the conversation survives navigation. */}
        <FloatingChat />
      </I18nProvider>
    </QueryClientProvider>
  );
}
