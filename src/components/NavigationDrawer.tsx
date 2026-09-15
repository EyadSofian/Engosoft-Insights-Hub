import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useLocation, useRouterState } from "@tanstack/react-router";
import { BookOpen, Menu, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useModalGuard } from "@/lib/ui-store";
import { navigationDrawerTree, type DrawerLink } from "@/lib/navigation";
import logoImg from "@/assets/engosoft-logo.png";

const DRAWER_ID = "app-navigation-drawer";

/**
 * The navigation below `lg`, where the rail does not fit.
 *
 * A menu button in the header opens a slide-in panel from the inline start
 * edge (the right in Arabic). Radix Dialog supplies the parts that are easy to
 * get subtly wrong: focus is trapped and returned to the button, Escape and a
 * tap on the backdrop close it, the page behind cannot scroll, and the trigger
 * carries `aria-expanded` / `aria-controls`. The panel also closes on every
 * route change and when the window grows into the rail's breakpoint.
 */
export function NavigationDrawer() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const href = useRouterState({ select: (state) => state.location.href });
  const acquisitionSection = useRouterState({
    select: (state) => (state.location.search as { section?: string }).section,
  });
  const [open, setOpen] = useState(false);
  useModalGuard(open);

  useEffect(() => {
    setOpen(false);
  }, [href]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onChange = () => desktop.matches && setOpen(false);
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  const tree = navigationDrawerTree(
    pathname,
    acquisitionSection,
    lang,
    (item) => item.tabLabel?.[lang] ?? t(item.key),
  );
  const A = lang === "ar";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-controls={DRAWER_ID}
          aria-label={A ? "فتح قائمة التنقل" : "Open navigation menu"}
          className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border bg-surface transition-colors hover:bg-surface-2 active:scale-[0.97] sm:h-10 sm:w-10 lg:hidden"
        >
          <Menu size={19} aria-hidden="true" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="nav-drawer-backdrop fixed inset-0 z-(--z-drawer) lg:hidden" />
        <Dialog.Content
          id={DRAWER_ID}
          aria-describedby={undefined}
          className="nav-drawer fixed inset-y-0 start-0 z-(--z-drawer) flex h-dvh w-[min(20rem,86vw)] flex-col border-e border-border bg-surface shadow-2xl outline-none lg:hidden"
        >
          <div
            className="flex items-center gap-2.5 border-b border-border px-3 py-3"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-border bg-white">
                <img src={logoImg} alt="" className="h-7 w-7 object-contain" />
              </span>
              <div className="min-w-0 leading-tight">
                <Dialog.Title className="truncate text-[15px] font-bold tracking-tight text-text">
                  ENGOSOFT
                </Dialog.Title>
                <span className="block truncate text-[11px] text-text-muted">{t("app_sub")}</span>
              </div>
            </div>
            <Dialog.Close
              aria-label={A ? "إغلاق القائمة" : "Close menu"}
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-border text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <X size={19} aria-hidden="true" />
            </Dialog.Close>
          </div>

          <nav
            aria-label={A ? "أقسام لوحة المعلومات" : "Dashboard sections"}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-3"
          >
            <ul className="flex flex-col gap-1">
              {tree.map((section) => (
                <li key={section.key}>
                  <DrawerRow link={section} level={0} />
                  {section.children.length > 0 && (
                    <ul className="mt-1 mb-2 flex flex-col gap-0.5 border-s border-border ms-6 ps-2">
                      {section.children.map((report) => (
                        <li key={report.key}>
                          <DrawerRow link={report} level={1} />
                          {report.children.length > 0 && (
                            <ul className="my-0.5 flex flex-col gap-0.5 border-s border-border ms-4 ps-2">
                              {report.children.map((view) => (
                                <li key={view.key}>
                                  <DrawerRow link={view} level={2} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>

          <div
            className="flex flex-col gap-2 border-t border-border px-3 pt-3"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new Event("engosoft:open-chat"));
              }}
              className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold text-white"
              style={{ background: "var(--ink)" }}
            >
              <Sparkles size={17} aria-hidden="true" />
              {A ? "اسأل المساعد عن الأرقام" : "Ask the assistant about the numbers"}
            </button>
            <Dialog.Close asChild>
              <Link
                to="/guide"
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border text-[13px] font-semibold text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <BookOpen size={16} aria-hidden="true" />
                {A ? "دليل استخدام الداشبورد" : "Dashboard user guide"}
              </Link>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DrawerRow({ link, level }: { link: DrawerLink; level: 0 | 1 | 2 }) {
  const Icon = link.icon;
  // An expanded row is a group label, not a link: its first child goes to the
  // same place, and two identical links would both claim to be this page.
  const group = link.children.length > 0;
  const current = link.active && !group;
  const base =
    "flex items-center gap-2.5 rounded-xl px-2.5 font-semibold transition-colors duration-150";
  const size =
    level === 0
      ? "min-h-11 text-[14px]"
      : level === 1
        ? "min-h-10 text-[13px]"
        : "min-h-10 text-[12.5px]";
  const tone = current
    ? "bg-brand text-white"
    : link.active
      ? "bg-brand-soft text-brand"
      : "text-text hover:bg-surface-2";

  const content = (
    <>
      {Icon && level < 2 && (
        <Icon
          size={level === 0 ? 18 : 16}
          strokeWidth={link.active ? 2.2 : 1.8}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 truncate">{link.label}</span>
    </>
  );

  if (group) return <div className={`${base} ${size} ${tone}`}>{content}</div>;

  // Wrapped in Close so a tap on the page already open still dismisses the
  // panel; a real navigation closes it through the route-change effect too.
  // `exact` stops the router from also marking Overview (no search) as the
  // current page while another acquisition section is open.
  return (
    <Dialog.Close asChild>
      {link.section ? (
        <Link
          to="/acquisition"
          search={{ section: link.section === "overview" ? undefined : link.section }}
          activeOptions={{ exact: true }}
          aria-current={current ? "page" : undefined}
          className={`${base} ${size} ${tone}`}
        >
          {content}
        </Link>
      ) : (
        <Link
          to={link.to}
          activeOptions={{ exact: true }}
          aria-current={current ? "page" : undefined}
          className={`${base} ${size} ${tone}`}
        >
          {content}
        </Link>
      )}
    </Dialog.Close>
  );
}
