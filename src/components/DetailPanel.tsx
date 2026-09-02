import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useIsMobile } from "@/hooks/use-mobile";
import { useModalGuard } from "@/lib/ui-store";
import { Drawer, DrawerContent, DrawerTitle } from "./ui/drawer";

/**
 * One detail surface, two shapes.
 *
 * A drill-down must not navigate: the reader is forty rows into a filtered
 * table and going to another route loses the filters, the scroll position and
 * the place in the list. So detail opens over the page — as a side panel on a
 * desktop, where there is room to keep the list visible beside it, and as a
 * bottom sheet on a phone, where a side panel would just be a worse dialog.
 *
 * The side it enters from is the inline end (the left in Arabic), so it opens
 * away from the navigation rail rather than on top of it.
 */
export function DetailPanel({
  open,
  onClose,
  title,
  subtitle,
  eyebrow,
  footer,
  children,
  width = "min(560px, 100vw)",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  const { lang } = useI18n();
  const isMobile = useIsMobile();
  useModalGuard(open);

  const header = (
    <div className="border-b border-border px-4 py-3.5 sm:px-5">
      {eyebrow && <div className="mb-1.5 flex flex-wrap items-center gap-1.5">{eyebrow}</div>}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold leading-snug text-text">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-[11.5px] leading-relaxed text-text-muted">{subtitle}</p>
          )}
        </div>
        {!isMobile && (
          <Dialog.Close
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-border text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            aria-label={lang === "ar" ? "إغلاق" : "Close"}
          >
            <X size={17} aria-hidden="true" />
          </Dialog.Close>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
        <DrawerContent className="max-h-[92dvh] border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            {eyebrow && <div className="mb-1.5 flex flex-wrap items-center gap-1.5">{eyebrow}</div>}
            <DrawerTitle className="text-start text-[16px] font-bold leading-snug text-text">
              {title}
            </DrawerTitle>
            {subtitle && (
              <p className="mt-1 text-start text-[11.5px] leading-relaxed text-text-muted">
                {subtitle}
              </p>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            {children}
          </div>
          {footer && (
            <div className="border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 animate-fade-in"
          style={{ background: "color-mix(in oklab, var(--ink) 45%, transparent)" }}
        />
        <Dialog.Content
          className="fixed inset-y-0 z-50 flex flex-col border-s border-border bg-surface shadow-xl"
          style={{
            width,
            // Enters from the inline end so it never lands over the rail.
            insetInlineEnd: 0,
            animation: "engo-fade var(--dur-base) var(--ease-out) both",
          }}
        >
          <Dialog.Title asChild>
            <div>{header}</div>
          </Dialog.Title>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
            {children}
          </div>
          {footer && <div className="border-t border-border px-4 py-3 sm:px-5">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A labelled figure inside a detail panel. */
export function DetailStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "danger" | "success" | "muted";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
        {label}
      </div>
      <div
        className="num mt-0.5 text-[14px] font-bold"
        style={{
          color:
            tone === "danger"
              ? "var(--danger)"
              : tone === "success"
                ? "var(--success)"
                : tone === "muted"
                  ? "var(--text-muted)"
                  : "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** A titled block inside a detail panel. */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
        {title}
      </h3>
      {children}
    </section>
  );
}
