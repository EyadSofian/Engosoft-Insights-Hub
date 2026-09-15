import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import logoImg from "@/assets/engosoft-logo.png";

/**
 * A short footer in the document flow — never fixed, so it can only ever sit
 * after the last card, not over it.
 *
 * On a phone it stacks: brand, navigation, legal, copyright. From `sm` it is a
 * single wrapping row. The inline end keeps clear of the assistant launcher,
 * which floats in that corner, and the bottom respects the iPhone home bar.
 */
export function AppFooter() {
  const { t, lang } = useI18n();
  const A = lang === "ar";
  const link =
    "inline-flex min-h-9 items-center rounded-md text-[12.5px] font-medium text-text-muted transition-colors hover:text-text sm:min-h-0";

  return (
    <footer
      className="pad-safe-x [--pad-x:0.875rem] sm:[--pad-x:1.5rem] mx-auto w-full max-w-[1600px]"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex flex-col gap-3 border-t border-border pt-5 pe-16 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2 sm:pt-4 sm:pe-20">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-border bg-white">
            <img src={logoImg} alt="" className="h-5 w-5 object-contain" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-[13px] font-bold tracking-tight text-text">ENGOSOFT</div>
            <div className="truncate text-[11px] text-text-muted">{t("app_sub")}</div>
          </div>
        </div>

        <nav aria-label={A ? "روابط التذييل" : "Footer"} className="sm:ms-auto">
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
            <li>
              <Link to="/guide" className={link}>
                {A ? "دليل الاستخدام" : "User guide"}
              </Link>
            </li>
            <li>
              <Link to="/acquisition" search={{ section: "coverage" }} className={link}>
                {A ? "تغطية البيانات" : "Data coverage"}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label={A ? "الروابط القانونية" : "Legal"}>
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
            <li>
              <a
                href="https://engosoft.com/privacy"
                target="_blank"
                rel="noreferrer"
                className={link}
              >
                {A ? "الخصوصية" : "Privacy"}
              </a>
            </li>
            <li>
              <a
                href="https://engosoft.com/terms-and-conditions"
                target="_blank"
                rel="noreferrer"
                className={link}
              >
                {A ? "الشروط" : "Terms"}
              </a>
            </li>
            <li>
              <a href="/legal/data-deletion.html" className={link}>
                {A ? "حذف البيانات" : "Data deletion"}
              </a>
            </li>
          </ul>
        </nav>

        <p className="text-[11.5px] text-text-subtle">© {new Date().getFullYear()} Engosoft</p>
      </div>
    </footer>
  );
}
