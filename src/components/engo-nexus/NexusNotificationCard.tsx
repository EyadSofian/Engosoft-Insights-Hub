import {
  CalendarRange,
  Globe2,
  Megaphone,
  TrendingDown,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { notificationQuickActions, type NexusNotificationContext } from "./lib/nexus-notification";

const PRESENTATION: Record<
  NexusNotificationContext["key"],
  {
    icon: LucideIcon;
    ar: string;
    en: string;
    border: string;
    iconBox: string;
    eyebrow: string;
    footer: string;
  }
> = {
  leads: {
    icon: UsersRound,
    ar: "العملاء والمتابعة",
    en: "Leads and follow-up",
    border: "border-blue-200 dark:border-blue-900/70",
    iconBox: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    eyebrow: "text-blue-700 dark:text-blue-300",
    footer: "border-blue-100 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/20",
  },
  website: {
    icon: Globe2,
    ar: "الموقع والمبيعات",
    en: "Website and sales",
    border: "border-emerald-200 dark:border-emerald-900/70",
    iconBox: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    eyebrow: "text-emerald-700 dark:text-emerald-300",
    footer: "border-emerald-100 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20",
  },
  campaigns: {
    icon: Megaphone,
    ar: "الحملات",
    en: "Campaigns",
    border: "border-amber-200 dark:border-amber-900/70",
    iconBox: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    eyebrow: "text-amber-700 dark:text-amber-300",
    footer: "border-amber-100 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20",
  },
  employees: {
    icon: TrendingDown,
    ar: "أداء الفريق",
    en: "Team performance",
    border: "border-rose-200 dark:border-rose-900/70",
    iconBox: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
    eyebrow: "text-rose-700 dark:text-rose-300",
    footer: "border-rose-100 bg-rose-50/60 dark:border-rose-900/60 dark:bg-rose-950/20",
  },
};

function rangeLabel(from: string, to: string, lang: "ar" | "en") {
  const formatter = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const start = formatter.format(new Date(`${from}T12:00:00Z`));
  const end = formatter.format(new Date(`${to}T12:00:00Z`));
  return lang === "ar" ? `من ${start} إلى ${end}` : `${start} to ${end}`;
}

export function NexusNotificationCard({
  notice,
  lang,
  disabled,
  onSend,
  onDismiss,
}: {
  notice: NexusNotificationContext;
  lang: "ar" | "en";
  disabled: boolean;
  onSend: (prompt: string) => void;
  onDismiss: () => void;
}) {
  const ar = lang === "ar";
  const presentation = PRESENTATION[notice.key];
  const Icon = presentation.icon;
  return (
    <article
      data-testid="nexus-notification-context"
      dir={ar ? "rtl" : "ltr"}
      className={`overflow-hidden rounded-2xl border bg-bg shadow-sm ${presentation.border}`}
    >
      <div className="flex items-start gap-3 px-3.5 py-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl ${presentation.iconBox}`}
        >
          <Icon className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className={`text-[11px] font-semibold ${presentation.eyebrow}`}>
                {ar ? presentation.ar : presentation.en}
              </p>
              <h2 className="mt-0.5 text-sm font-bold text-text">{notice.title}</h2>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label={ar ? "إخفاء ملخص الإشعار" : "Hide notification summary"}
              className="rounded-lg p-1.5 text-text-subtle transition hover:bg-bg-subtle hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
          <p className="mt-2 text-[13px] leading-6 text-text" dir={ar ? "rtl" : "ltr"}>
            {notice.body}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-subtle">
            <CalendarRange className="size-3.5" aria-hidden />
            <span>{rangeLabel(notice.from, notice.to, lang)}</span>
          </p>
        </div>
      </div>
      <div className={`flex flex-wrap gap-1.5 border-t px-3 py-2.5 ${presentation.footer}`}>
        {notificationQuickActions(notice, lang).map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={disabled}
            onClick={() => onSend(action.prompt)}
            className="rounded-full border border-border bg-bg px-2.5 py-1.5 text-[11px] font-semibold text-text transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
      </div>
    </article>
  );
}
