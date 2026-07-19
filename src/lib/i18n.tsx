import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Lang = "ar" | "en";
export type Theme = "light" | "dark";

type Entry = { ar: string; en: string };

/**
 * Arabic copy is plain Modern Standard Arabic — the wording someone would
 * actually say, not literal translation and not dialect.
 */
export const DICT = {
  app_title: { ar: "منصة إنجوسوفت للتحليلات", en: "Engosoft Insights" },
  app_sub: { ar: "تحليلات التسويق والمبيعات", en: "Marketing & Sales Intelligence" },

  // nav
  overview: { ar: "نظرة عامة", en: "Overview" },
  campaigns: { ar: "الحملات", en: "Campaigns" },
  ads_tech: { ar: "الإعلانات", en: "Ads / Technical" },
  sales: { ar: "المبيعات", en: "Sales / Revenue" },
  leads: { ar: "العملاء المحتملون", en: "Leads (CRM)" },
  full_invoiced: { ar: "الفواتير", en: "Full Invoiced" },
  lost: { ar: "تحليل الخسائر", en: "Lost Analysis" },
  courses: { ar: "الدورات", en: "Courses" },
  teams: { ar: "فرق المبيعات", en: "Sales Teams" },
  yoy: { ar: "مقارنة سنوية", en: "Year over year" },
  more: { ar: "المزيد", en: "More" },
  // Short forms for the mobile bar, where five labels share one row.
  overview_short: { ar: "الرئيسية", en: "Home" },
  campaigns_short: { ar: "الحملات", en: "Campaigns" },
  leads_short: { ar: "العملاء", en: "Leads" },
  show_more: { ar: "عرض المزيد", en: "Show more" },
  show_less: { ar: "عرض أقل", en: "Show less" },

  // chrome
  refresh: { ar: "تحديث", en: "Refresh" },
  refreshing: { ar: "جارٍ التحديث…", en: "Refreshing…" },
  filters: { ar: "الفلاتر", en: "Filters" },
  apply: { ar: "تطبيق", en: "Apply" },
  reset: { ar: "إعادة تعيين", en: "Reset" },
  // The badge shows when this app last pulled the sheet, which the Refresh
  // button moves — not when the sync jobs last wrote the sheet, which it cannot.
  data_freshness: { ar: "آخر تحديث", en: "Last refresh" },
  live: { ar: "مباشر", en: "Live" },
  stale: { ar: "قديم", en: "Stale" },
  theme: { ar: "المظهر", en: "Theme" },
  search: { ar: "بحث…", en: "Search…" },
  export_csv: { ar: "تصدير CSV", en: "Export CSV" },
  no_data: { ar: "لا توجد بيانات في هذه الفترة", en: "No data for this period" },
  no_results: { ar: "لا توجد نتائج مطابقة", en: "No matching results" },
  loading: { ar: "جارٍ التحميل…", en: "Loading…" },
  showing: { ar: "معروض", en: "Showing" },
  of: { ar: "من", en: "of" },
  rows: { ar: "صف", en: "rows" },
  all: { ar: "الكل", en: "All" },
  clear: { ar: "مسح", en: "Clear" },
  close: { ar: "إغلاق", en: "Close" },
  view_all: { ar: "عرض الكل", en: "View all" },

  // date presets
  date_range: { ar: "الفترة الزمنية", en: "Date range" },
  preset_7: { ar: "آخر ٧ أيام", en: "Last 7 days" },
  preset_30: { ar: "آخر ٣٠ يوماً", en: "Last 30 days" },
  preset_month: { ar: "هذا الشهر", en: "This month" },
  preset_year: { ar: "هذا العام", en: "This year" },
  preset_all: { ar: "كل الفترات", en: "All time" },
  from: { ar: "من", en: "From" },
  to: { ar: "إلى", en: "To" },

  // platform
  platform: { ar: "المنصة", en: "Platform" },
  all_platforms: { ar: "كل المنصات", en: "All platforms" },
  not_reported: { ar: "لا تُبلغ عنه المنصة", en: "Not reported by this platform" },

  // metrics
  spend: { ar: "الإنفاق", en: "Spend" },
  impressions: { ar: "مرات الظهور", en: "Impressions" },
  clicks: { ar: "النقرات", en: "Clicks" },
  link_clicks: { ar: "نقرات الرابط", en: "Link clicks" },
  ctr_all: { ar: "نسبة النقر", en: "CTR (all)" },
  ctr_link: { ar: "نسبة نقر الرابط", en: "CTR (link)" },
  cpm: { ar: "تكلفة الألف ظهور", en: "CPM" },
  cpc: { ar: "تكلفة النقرة", en: "CPC" },
  cpl: { ar: "تكلفة العميل المحتمل", en: "CPL" },
  platform_cpl: { ar: "تكلفة العميل حسب المنصة", en: "Platform CPL" },
  attributed_cpl: { ar: "تكلفة العميل المدفوع", en: "Paid CPL" },
  cpa: { ar: "تكلفة الصفقة", en: "CPA" },
  cpa_basis: { ar: "أساس حساب تكلفة الصفقة", en: "CPA basis" },
  cpa_won: { ar: "الصفقات المغلقة", en: "Won leads" },
  cpa_invoices: { ar: "عدد الفواتير", en: "Invoices" },
  acos: { ar: "نسبة الإنفاق للإيراد", en: "ACOS" },
  crm_leads: { ar: "عملاء محتملون", en: "CRM Leads" },
  platform_leads: { ar: "عملاء حسب المنصة", en: "Platform leads" },
  won: { ar: "صفقات مغلقة", en: "Won" },
  lost_count: { ar: "صفقات ضائعة", en: "Lost" },
  conversion_rate: { ar: "نسبة الإغلاق", en: "Conversion rate" },
  lost_rate: { ar: "نسبة الضياع", en: "Lost rate" },
  avg_close_time: { ar: "متوسط زمن الإغلاق", en: "Avg close time" },
  days: { ar: "يوم", en: "days" },
  based_on: { ar: "محسوب على", en: "based on" },
  closed_leads: { ar: "صفقة مغلقة", en: "closed leads" },
  revenue: { ar: "الإيراد", en: "Revenue" },
  revenue_per_lead: { ar: "الإيراد لكل عميل", en: "Revenue per lead" },
  attributed_revenue: { ar: "إيراد مرتبط بالحملات", en: "Attributed revenue" },
  roas: { ar: "العائد على الإنفاق", en: "ROAS" },
  attributed_roas: { ar: "العائد الحقيقي", en: "Attributed ROAS" },
  orders: { ar: "الطلبات", en: "Orders" },
  avg_order: { ar: "متوسط الطلب", en: "Avg order" },
  aov: { ar: "متوسط قيمة الطلب", en: "AOV" },
  vs_prev: { ar: "مقارنة بالفترة السابقة", en: "vs previous period" },
  non_lead_spend: { ar: "إنفاق لا ينتج عملاء", en: "Non-lead spend" },
  include_non_lead: { ar: "تضمين حسابات الزيارات", en: "Include traffic accounts" },

  // overview
  exec_summary: { ar: "الملخص التنفيذي", en: "Executive summary" },
  best_campaign: { ar: "أفضل حملة", en: "Best campaign" },
  money_leak: { ar: "أكبر إهدار للميزانية", en: "Biggest money leak" },
  top_ad_by_spend: { ar: "أعلى إعلان إنفاقاً", en: "Top ad by spend" },
  funnel: { ar: "مسار التحويل", en: "Conversion funnel" },
  spend_vs_revenue: { ar: "الإنفاق مقابل الإيراد", en: "Spend vs Revenue" },
  where_budget_goes: { ar: "أين تذهب الميزانية", en: "Where the budget goes" },
  top_by_roas: { ar: "الأعلى عائداً", en: "Top by ROAS" },
  quick_actions: { ar: "إجراءات مقترحة", en: "Suggested actions" },

  // entities
  campaign: { ar: "الحملة", en: "Campaign" },
  account: { ar: "الحساب الإعلاني", en: "Ad account" },
  source: { ar: "المصدر", en: "Source" },
  main_category: { ar: "الفئة الرئيسية", en: "Main category" },
  sales_team: { ar: "فريق المبيعات", en: "Sales team" },
  salesperson: { ar: "مندوب المبيعات", en: "Salesperson" },
  course: { ar: "الدورة", en: "Course" },
  category: { ar: "الفئة", en: "Category" },
  stage: { ar: "المرحلة", en: "Stage" },
  contact: { ar: "جهة الاتصال", en: "Contact" },
  customer: { ar: "العميل", en: "Customer" },
  product: { ar: "المنتج", en: "Product" },
  ad_name: { ar: "الإعلان", en: "Ad name" },
  ad_set: { ar: "المجموعة الإعلانية", en: "Ad set" },
  order_ref: { ar: "رقم الطلب", en: "Order ref" },
  invoice_date: { ar: "تاريخ الفاتورة", en: "Invoice date" },
  created: { ar: "تاريخ الإنشاء", en: "Created" },
  date: { ar: "التاريخ", en: "Date" },
  month: { ar: "الشهر", en: "Month" },
  priority: { ar: "الأولوية", en: "Priority" },
  loss_reason: { ar: "سبب الخسارة", en: "Loss reason" },
  order_total: { ar: "قيمة الطلب", en: "Order total" },
  team: { ar: "الفريق", en: "Team" },
  partner: { ar: "الشريك", en: "Partner" },

  // courses
  top_performing: { ar: "الأفضل أداءً", en: "Top performing" },
  underperforming: { ar: "الأضعف أداءً", en: "Underperforming" },
  rank_by: { ar: "ترتيب حسب", en: "Rank by" },
  leads_count: { ar: "عدد العملاء", en: "Leads" },

  // leads / lost
  by_stage: { ar: "حسب المرحلة", en: "By stage" },
  by_source: { ar: "حسب المصدر", en: "By source" },
  by_course: { ar: "حسب الدورة", en: "By course" },
  by_team: { ar: "حسب الفريق", en: "By team" },
  by_category: { ar: "حسب الفئة", en: "By category" },
  by_month: { ar: "حسب الشهر", en: "By month" },
  by_campaign: { ar: "حسب الحملة", en: "By campaign" },
  by_salesperson: { ar: "حسب المندوب", en: "By salesperson" },
  by_day: { ar: "حسب اليوم", en: "By day" },
  by_ad: { ar: "حسب الإعلان", en: "By ad" },
  total_lost: { ar: "إجمالي الخسائر", en: "Total lost" },
  share: { ar: "النسبة", en: "Share" },

  // AI
  ai_assistant: { ar: "المساعد الذكي", en: "AI Assistant" },
  ask_anything: { ar: "اسأل عن أي رقم في اللوحة…", en: "Ask about any number here…" },
  ai_empty: {
    ar: "اسألني عن الحملات أو الإيرادات أو أي رقم معروض. أجيب من بيانات الفترة المحددة حالياً.",
    en: "Ask about campaigns, revenue, or any figure on screen. I answer from the currently filtered data.",
  },
  send: { ar: "إرسال", en: "Send" },
  new_chat: { ar: "محادثة جديدة", en: "New chat" },

  // lead origin
  lead_origin: { ar: "مصدر العملاء", en: "Lead origin" },
  from_campaigns: { ar: "من حملات إعلانية", en: "From campaigns" },
  other_sources: { ar: "من مصادر أخرى", en: "Other sources" },
  origin_note: {
    ar: "أداء الإعلانات المدفوعة لا يُقاس على الرقم المخلوط — العملاء بلا حملة يأتون من قنوات أخرى.",
    en: "Paid performance must not be judged on the blended number — leads with no campaign came from elsewhere.",
  },

  // ad set
  derived: { ar: "مُستنتج", en: "Derived" },
  ambiguous: { ar: "غير مؤكد", en: "Ambiguous" },
  unknown_adset: { ar: "مجموعة إعلانية غير معروفة", en: "Unknown ad set" },
  adset_derived_note: {
    ar: "اسم المجموعة الإعلانية فارغ في تصدير أودو، لذلك يُستنتج من معرّف الإعلان.",
    en: "Ad Set Name is empty in the Odoo export, so it is backfilled from the ad id.",
  },
  adset_ambiguous_note: {
    ar: "اسم هذا الإعلان يظهر تحت أكثر من مجموعة إعلانية، فالقيمة تقديرية.",
    en: "This ad name appears under more than one ad set, so the value is a best guess.",
  },
  inferred_course: { ar: "دورة مُستنتجة", en: "Inferred course" },

  // data quality
  data_notes: { ar: "ملاحظات على البيانات", en: "Data notes" },
  data_health: { ar: "صحة البيانات", en: "Data health" },
  match_rate: { ar: "نسبة مطابقة الحملات", en: "Campaign match rate" },
  adset_resolution: { ar: "نسبة استنتاج المجموعات الإعلانية", en: "Ad-set resolution" },
  revenue_coverage: { ar: "تغطية الحملات على الإيراد", en: "Revenue campaign coverage" },
  coverage: { ar: "التغطية", en: "Coverage" },
  unmatched: { ar: "غير مطابق", en: "Unmatched" },
  upstream_fix: { ar: "الإصلاح الحقيقي في المصدر", en: "The real fix is upstream" },
  upstream_adset: {
    ar: "املأ عمود Ad Set Name في تصدير أودو ليصبح ربط المجموعات الإعلانية دقيقاً بدل استنتاجه.",
    en: "Populate Ad Set Name in the Odoo export so ad-set joins become exact instead of inferred.",
  },
  no_spend_source: {
    ar: "عملاء من مصادر بلا بيانات إنفاق",
    en: "Leads from sources with no spend data",
  },
  no_spend_source_note: {
    ar: "تيك توك ويوشات وواتساب والترشيحات تُنتج عملاء لكن لا يوجد لها إنفاق في الملف، لذلك تظهر تكلفة العميل الإجمالية أرخص من الحقيقة.",
    en: "TikTok, UChat, WhatsApp and referrals produce leads but carry no spend in the sheet, so blended CPL reads cheaper than reality.",
  },
  attributed_note: {
    ar: "الجزء من الإيراد المرتبط فعلياً بحملة إعلانية.",
    en: "The share of revenue that traces back to an ad campaign.",
  },
  lost_population_note: {
    ar: "جدول الخسائر وتصنيف المرحلة «ضائع» في النظام مجموعتان مختلفتان من الصفوف، ولا تتطابق أعدادهما.",
    en: "The Lost tab and CRM stage \"Lost\" are two different row populations; their counts do not match.",
  },

  // yoy
  yoy_empty: {
    ar: "لا توجد بيانات لعام سابق في الملف — أضف صفوف العام الماضي إلى تبويبات الإعلانات والمبيعات لتفعيل المقارنة.",
    en: "No prior-year data in the sheet yet — backfill the ads and sales tabs with last year's rows to enable this comparison.",
  },
  growth: { ar: "النمو", en: "Growth" },
  current_year: { ar: "العام الحالي", en: "Current year" },
  previous_year: { ar: "العام السابق", en: "Previous year" },

  // telegram
  telegram: { ar: "تقرير تيليجرام", en: "Telegram report" },
  send_now: { ar: "إرسال الآن", en: "Send now" },
  preview: { ar: "معاينة", en: "Preview" },
  sent: { ar: "تم الإرسال", en: "Sent" },
} satisfies Record<string, Entry>;

export type DictKey = keyof typeof DICT;

interface AppCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  t: (k: DictKey) => string;
  dir: "ltr" | "rtl";
}

const Ctx = createContext<AppCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");
  const [theme, setThemeState] = useState<Theme>("light");

  // Restore preferences after hydration so SSR markup stays stable.
  useEffect(() => {
    const storedLang = window.localStorage.getItem("engo_lang") as Lang | null;
    if (storedLang === "ar" || storedLang === "en") setLangState(storedLang);

    const storedTheme = window.localStorage.getItem("engo_theme") as Theme | null;
    if (storedTheme === "light" || storedTheme === "dark") {
      setThemeState(storedTheme);
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setThemeState("dark");
    }
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    window.localStorage.setItem("engo_lang", l);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    window.localStorage.setItem("engo_theme", t);
  }, []);

  const value = useMemo<AppCtx>(
    () => ({
      lang,
      setLang,
      theme,
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
      t: (k: DictKey) => DICT[k]?.[lang] ?? String(k),
      dir: lang === "ar" ? "rtl" : "ltr",
    }),
    [lang, theme, setLang, setTheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/* --- formatters ----------------------------------------------------------
   Figures always use Latin digits, in both languages: this is a finance
   dashboard and Arabic-Indic digits would fight the tabular alignment.
------------------------------------------------------------------------- */

const EM_DASH = "—";

export function fmtUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return EM_DASH;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return "$" + (n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1) + "M";
  if (abs >= 10_000) return "$" + (n / 1_000).toFixed(abs >= 100_000 ? 0 : 1) + "K";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: abs < 100 ? 2 : 0 });
}

export function fmtUSDFull(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return EM_DASH;
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return EM_DASH;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return EM_DASH;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (n / 1_000).toFixed(abs >= 10_000 ? 0 : 1) + "K";
  return String(Math.round(n));
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return EM_DASH;
  return n.toFixed(digits) + "%";
}

/**
 * A ROAS of exactly 0 is a real, important result (spent money, earned nothing)
 * so it renders as 0.00× — call sites show "—" themselves when there was no spend.
 */
export function fmtRoas(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return EM_DASH;
  return n.toFixed(2) + "×";
}

export function fmtDelta(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return EM_DASH;
  return (n >= 0 ? "+" : "") + n.toFixed(0) + "%";
}

export function fmtDate(v: string | null | undefined, lang: Lang = "en"): string {
  if (!v) return EM_DASH;
  const d = new Date(v.length <= 10 ? v + "T00:00:00" : v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(v: string | null | undefined, lang: Lang = "en"): string {
  if (!v) return EM_DASH;
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Short axis label, e.g. "12 Jul". */
export function fmtDayShort(v: string, lang: Lang = "en"): string {
  const d = new Date(v + "T00:00:00");
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}
