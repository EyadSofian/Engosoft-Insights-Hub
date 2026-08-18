// How every ads metric is *described* to a reader. Presentation only.
//
// Nothing here computes anything. The numbers keep coming from
// `metrics.server.ts`; this file exists so a non-technical manager can read a
// card and know what the figure means, which sheet the numerator and the
// denominator came from, which date column the window hangs on, and why the
// value is sometimes a dash instead of a number.
//
// Rules the copy follows:
//   • Never a bare abbreviation. Always the Arabic name with the abbreviation
//     in brackets — "تكلفة العميل المحتمل (CPL)".
//   • A dash means "not measurable", never zero. Every entry says when that
//     legitimately happens.
//   • The date basis is the one the code actually filters on, not the one an
//     idealised spec would use. Where those differ the copy says so.

export type MetricKey =
  | "spend"
  | "impressions"
  | "clicks"
  | "ctrAll"
  | "ctrLink"
  | "cpm"
  | "cpc"
  | "platformLeads"
  | "cpl"
  | "crmLeads"
  | "won"
  | "lost"
  | "conversionRate"
  | "lostRate"
  | "revenue"
  | "attributedRevenue"
  | "revenuePerLead"
  | "cpa"
  | "roas"
  | "acos";

/** The four bands a metric belongs to, used for card order and table headers. */
export type MetricGroup = "advertising" | "crm" | "accounting" | "efficiency";

export const METRIC_GROUP_LABEL: Record<MetricGroup, { ar: string; en: string }> = {
  advertising: { ar: "الإعلانات", en: "Advertising" },
  crm: { ar: "العملاء (CRM)", en: "CRM" },
  accounting: { ar: "الحسابات", en: "Accounting" },
  efficiency: { ar: "الكفاءة", en: "Efficiency" },
};

interface MetricCopy {
  /** Arabic name plus abbreviation, or the English name. Never an abbreviation alone. */
  label: string;
  /** Very short label for tight spots like table headers. Still not a bare abbreviation. */
  short: string;
  /** One line, shown under the value on a card. */
  formula: string;
  /** What the number means, in one plain sentence. */
  what: string;
  /** How it is computed, naming numerator and denominator. */
  how: string;
  /** Which sheet or system the numerator and the denominator come from. */
  source: string;
  /** The date column the reporting window filters on. */
  dateBasis: string;
  /** Why this can legitimately show a dash. */
  whenEmpty: string;
}

export interface MetricDef {
  key: MetricKey;
  group: MetricGroup;
  /** Cost ratios: a lower value is the good outcome. Drives tone, never the arrow. */
  lowerIsBetter?: boolean;
  /**
   * Undefined without platform spend. On a platform that has no spend tab these
   * render as "غير متاح" rather than 0 — a 0% ACOS on missing cost data reads as
   * a real result and gets acted on.
   */
  needsSpend?: boolean;
  ar: MetricCopy;
  en: MetricCopy;
}

const CRM_WINDOW_AR = "الفلترة بتاريخ إنشاء الليد، يعني الليدز اللي اتفتحت في الفترة المختارة.";
const CRM_WINDOW_EN =
  "Filtered by lead creation date — the leads opened inside the selected period.";

export const METRICS: Record<MetricKey, MetricDef> = {
  spend: {
    key: "spend",
    group: "advertising",
    ar: {
      label: "الإنفاق الإعلاني",
      short: "الإنفاق",
      formula: "مجموع الإنفاق من منصات الإعلان",
      what: "الفلوس اللي اتصرفت فعلاً على الإعلانات في الفترة المختارة.",
      how: "جمع عمود Spend لكل صف إعلان × يوم داخل الفترة.",
      source: "تبويبات Meta وSnap، وTikTok Marketing API عند تفعيل بيانات الاعتماد.",
      dateBasis: "تاريخ الإعلان (عمود التاريخ في تبويب المنصة).",
      whenEmpty:
        "بيبقى صفر لو مفيش صرف في الفترة، وبيبقى «غير متاح» لو المنصة أصلاً ملهاش تبويب إنفاق.",
    },
    en: {
      label: "Ad spend",
      short: "Spend",
      formula: "Sum of Spend from the ad platforms",
      what: "The money actually spent on ads inside the selected period.",
      how: "Sums the Spend column over every ad × day row in the window.",
      source: "Meta and Snap ad tabs, plus TikTok Marketing API when credentials are configured.",
      dateBasis: "Ad date (the date column on the platform tab).",
      whenEmpty:
        "Zero when nothing was spent; not available when the platform has no spend tab at all.",
    },
  },

  impressions: {
    key: "impressions",
    group: "advertising",
    ar: {
      label: "مرات الظهور (Impressions)",
      short: "مرات الظهور",
      formula: "مجموع مرات ظهور الإعلان",
      what: "كام مرة الإعلان اتعرض على الشاشة.",
      how: "جمع عمود Impressions لكل صف إعلان × يوم.",
      source: "تبويبات الإعلانات في المنصات.",
      dateBasis: "تاريخ الإعلان.",
      whenEmpty: "بيفضل فاضي لو المنصة مبتصدرش العمود ده.",
    },
    en: {
      label: "Impressions",
      short: "Impressions",
      formula: "Sum of ad impressions",
      what: "How many times the ad was put on a screen.",
      how: "Sums the Impressions column over every ad × day row.",
      source: "Platform ad tabs.",
      dateBasis: "Ad date.",
      whenEmpty: "Empty when the platform does not export this column.",
    },
  },

  clicks: {
    key: "clicks",
    group: "advertising",
    ar: {
      label: "النقرات الكلية (Clicks all)",
      short: "النقرات",
      formula: "مجموع كل النقرات على الإعلان",
      what: "كل النقرات على الإعلان، مش نقرات اللينك بس.",
      how: "جمع عمود Clicks (all) لكل صف إعلان × يوم.",
      source: "تبويبات الإعلانات في المنصات.",
      dateBasis: "تاريخ الإعلان.",
      whenEmpty: "بيفضل فاضي لو المنصة مبتصدرش العمود ده.",
    },
    en: {
      label: "Clicks (all)",
      short: "Clicks",
      formula: "Sum of all ad clicks",
      what: "Every click on the ad, not only link clicks.",
      how: "Sums the Clicks (all) column over every ad × day row.",
      source: "Platform ad tabs.",
      dateBasis: "Ad date.",
      whenEmpty: "Empty when the platform does not export this column.",
    },
  },

  ctrAll: {
    key: "ctrAll",
    group: "advertising",
    needsSpend: true,
    ar: {
      label: "نسبة النقر لكل مرات الظهور (CTR)",
      short: "نسبة النقر",
      formula: "النقرات ÷ مرات الظهور × ١٠٠",
      what: "من كل ١٠٠ مرة ظهور، كام واحدة اتحوّلت لنقرة. مؤشر على قوة الإبداع والاستهداف.",
      how: "بنجمع النقرات كلها وبنجمع مرات الظهور كلها الأول، وبعدين بنقسّم — مش متوسط نِسَب. ده معناه إن النسبة موزونة بحجم كل إعلان.",
      source: "البسط والمقام الاتنين من تبويبات الإعلانات: Clicks (all) و Impressions.",
      dateBasis: "تاريخ الإعلان.",
      whenEmpty: "بتظهر شرطة لو مرات الظهور صفر أو المنصة ملهاش بيانات إعلانات.",
    },
    en: {
      label: "Click-through rate (CTR)",
      short: "CTR",
      formula: "Clicks ÷ Impressions × 100",
      what: "Out of every 100 impressions, how many became a click.",
      how: "Clicks and impressions are each summed first, then divided — never an average of percentages. That keeps the rate weighted by each ad's volume.",
      source: "Both sides come from the ad tabs: Clicks (all) and Impressions.",
      dateBasis: "Ad date.",
      whenEmpty: "A dash when impressions are zero or the platform has no ad rows.",
    },
  },

  ctrLink: {
    key: "ctrLink",
    group: "advertising",
    needsSpend: true,
    ar: {
      label: "نسبة نقر الرابط (Link CTR)",
      short: "نقر الرابط",
      formula: "نقرات الرابط ÷ مرات الظهور × ١٠٠",
      what: "نسبة اللي دوسوا على اللينك نفسه، مش أي حتة في الإعلان.",
      how: "المقام بيحسب مرات الظهور بتاعة المنصات اللي بتبلّغ عن نقرات الرابط بس.",
      source: "عمود Link Clicks في تبويب المنصة.",
      dateBasis: "تاريخ الإعلان.",
      whenEmpty: "سناب شات مش بتصدّر نقرات الرابط، فبتظهر شرطة — مش صفر.",
    },
    en: {
      label: "Link click-through rate",
      short: "Link CTR",
      formula: "Link clicks ÷ Impressions × 100",
      what: "The share of impressions that produced a click on the link itself.",
      how: "The denominator only counts impressions from platforms that report link clicks.",
      source: "The Link Clicks column on the platform tab.",
      dateBasis: "Ad date.",
      whenEmpty: "Snapchat does not export link clicks, so it renders a dash — never a zero.",
    },
  },

  cpm: {
    key: "cpm",
    group: "efficiency",
    lowerIsBetter: true,
    needsSpend: true,
    ar: {
      label: "تكلفة الألف ظهور (CPM)",
      short: "تكلفة الألف ظهور",
      formula: "الإنفاق ÷ مرات الظهور × ١٠٠٠",
      what: "بتدفع كام عشان الإعلان يظهر ألف مرة.",
      how: "الإنفاق مقسوم على مرات الظهور ومضروب في ألف.",
      source: "الإنفاق ومرات الظهور من تبويبات الإعلانات.",
      dateBasis: "تاريخ الإعلان.",
      whenEmpty: "شرطة لو مرات الظهور صفر.",
    },
    en: {
      label: "Cost per thousand impressions (CPM)",
      short: "CPM",
      formula: "Spend ÷ Impressions × 1,000",
      what: "What a thousand impressions cost.",
      how: "Spend divided by impressions, times a thousand.",
      source: "Spend and impressions from the ad tabs.",
      dateBasis: "Ad date.",
      whenEmpty: "A dash when impressions are zero.",
    },
  },

  cpc: {
    key: "cpc",
    group: "efficiency",
    lowerIsBetter: true,
    needsSpend: true,
    ar: {
      label: "تكلفة النقرة (CPC)",
      short: "تكلفة النقرة",
      formula: "الإنفاق ÷ النقرات",
      what: "بتدفع كام على كل نقرة.",
      how: "الإنفاق مقسوم على إجمالي النقرات.",
      source: "الإنفاق والنقرات من تبويبات الإعلانات.",
      dateBasis: "تاريخ الإعلان.",
      whenEmpty: "شرطة لو مفيش نقرات.",
    },
    en: {
      label: "Cost per click (CPC)",
      short: "CPC",
      formula: "Spend ÷ Clicks",
      what: "What each click costs.",
      how: "Spend divided by total clicks.",
      source: "Spend and clicks from the ad tabs.",
      dateBasis: "Ad date.",
      whenEmpty: "A dash when there were no clicks.",
    },
  },

  platformLeads: {
    key: "platformLeads",
    group: "advertising",
    ar: {
      label: "ليدز / تحويلات المنصة",
      short: "نتيجة المنصة",
      formula: "مجموع النتيجة اللي المنصة نفسها بلّغت عنها حسب هدف الحملة",
      what: "في حملات جمع الليدز ده عدد الليدز؛ وفي حملات web-con ده عدد تحويلات الموقع — مش عدد أودو.",
      how: "هدف الحملة ظاهر على الصف. Lead Forms تُعرض كليدز، وحملات web-con تُعرض كتحويلات موقع.",
      source: "تبويبات الإعلانات في المنصات، مش الـCRM.",
      dateBasis: "تاريخ الإعلان.",
      whenEmpty:
        "شرطة لو المنصة مبتبلّغش عن نتيجة. الرقم ده هو مقام تكلفة الليد أو تكلفة التحويل حسب هدف الحملة.",
    },
    en: {
      label: "Platform leads / conversions",
      short: "Platform result",
      formula: "Sum of the result reported for the campaign objective",
      what: "Lead-form submissions for lead campaigns; website conversions for web-con campaigns. This is not Odoo CRM.",
      how: "The row shows the objective, so lead forms and website conversions are never presented as the same business event.",
      source: "Platform ad tabs, not the CRM.",
      dateBasis: "Ad date.",
      whenEmpty:
        "A dash when the platform reports no result. This is the cost-per-lead or cost-per-conversion denominator, depending on the objective.",
    },
  },

  cpl: {
    key: "cpl",
    group: "efficiency",
    lowerIsBetter: true,
    needsSpend: true,
    ar: {
      label: "تكلفة النتيجة (ليد / تحويل)",
      short: "تكلفة النتيجة",
      formula: "الإنفاق ÷ نتيجة المنصة",
      what: "تكلفة الليد في حملات Lead، أو تكلفة تحويل الموقع في حملات web-con.",
      how: "إجمالي الإنفاق مقسوم على النتيجة اللي المنصة بلّغت عنها حسب هدف الحملة.",
      source: "البسط: الإنفاق من تبويبات الإعلانات. المقام: عملاء المنصات من نفس التبويبات.",
      dateBasis: "تاريخ الإعلان للطرفين.",
      whenEmpty: "شرطة لو المنصة مبتبلّغش عن ليدز، أو لو مفيش تبويب إنفاق للمنصة أصلاً.",
    },
    en: {
      label: "Cost per result (lead / conversion)",
      short: "Cost / result",
      formula: "Spend ÷ Platform result",
      what: "Cost per lead for lead campaigns, or cost per website conversion for web-con.",
      how: "Total ad spend divided by the result reported for that campaign objective.",
      source: "Numerator: spend from the ad tabs. Denominator: platform leads from the same tabs.",
      dateBasis: "Ad date on both sides.",
      whenEmpty: "A dash when the platform reports no leads, or has no spend tab at all.",
    },
  },

  crmLeads: {
    key: "crmLeads",
    group: "crm",
    ar: {
      label: "العملاء المحتملين في النظام (CRM Leads)",
      short: "عملاء النظام",
      formula: "ليدز الـCRM + صفوف تحليل الخسائر",
      what: "إجمالي العملاء النظيف: الليدز المفتوحة في أودو زائد الليدز المؤرشفة في تحليل الخسائر.",
      how: "بنجمع الصفوف اللي عدّت شروط الاستبعاد الحالية، ومش بنعدّ الصف مرتين.",
      source: "CRM Leads من أودو مباشرة، و Lost Analysis للمؤرشف.",
      dateBasis: CRM_WINDOW_AR,
      whenEmpty: "صفر معناه مفيش ليدز في الفترة دي فعلاً.",
    },
    en: {
      label: "CRM leads",
      short: "CRM leads",
      formula: "CRM leads + Lost Analysis rows",
      what: "The clean lead total: open Odoo leads plus the archived rows in Lost Analysis.",
      how: "Counts rows that pass the current exclusion guards, deduplicated by Odoo id.",
      source: "CRM Leads direct from Odoo, and Lost Analysis for the archived population.",
      dateBasis: CRM_WINDOW_EN,
      whenEmpty: "Zero genuinely means no leads in this period.",
    },
  },

  won: {
    key: "won",
    group: "crm",
    ar: {
      label: "الصفقات الرابحة (Won)",
      short: "صفقات رابحة",
      formula: "عدد الليدز اللي حالتها Won",
      what: "عدد العملاء اللي قفلوا فعلاً واشتروا.",
      how: "عدّ ليدز الـCRM اللي التعريف الحالي بيعتبرها رابحة، ومعاهم الصفقات اللي اتقفلت رابحة واتأرشفت بعد كده — الأرشيف مكان الصفقة المقفولة، مش مرادف للخسارة.",
      source: "CRM Leads في أودو، ومعاها الأرشيف للصفقات اللي اتقفلت رابحة واتأرشفت بعد كده.",
      // The one comparison every reader eventually makes, so it is answered
      // here rather than left to look like a bug.
      dateBasis:
        "الفلترة بتاريخ إنشاء الليد — يعني الليدز اللي اتفتحت في الفترة وكسبت، مش اللي قفلت في الفترة. عشان كده الرقم ده ممكن يختلف عن Total Closed Won في داشبورد أودو: أودو بيعد اللي اتقفل في الشهر، وإحنا بنعد اللي اتفتح في الشهر وكسب. ليد اتفتح في يوليو وقفل في أغسطس بيبان عند أودو في أغسطس، وعندنا في يوليو.",
      whenEmpty: "صفر معناه مفيش صفقة قفلت من ليدز الفترة دي.",
    },
    en: {
      label: "Won deals",
      short: "Won",
      formula: "Count of leads in the Won state",
      what: "How many leads actually closed and bought.",
      how: "Counts CRM leads the current definition treats as won, plus deals closed won and then archived — the archive is where a closed deal lives, not a synonym for lost.",
      source: "CRM Leads in Odoo, plus the archive for deals won and then filed away.",
      dateBasis:
        "Filtered by lead creation date — leads opened in the window that went on to win, not deals closed in the window. This is why the figure can differ from Total Closed Won on Odoo's own dashboard: Odoo counts what closed in the month, this counts what opened in the month and won. A lead opened in July and closed in August appears under August in Odoo and under July here.",
      whenEmpty: "Zero means none of this period's leads closed.",
    },
  },

  lost: {
    key: "lost",
    group: "crm",
    ar: {
      label: "الصفقات الضائعة (Lost)",
      short: "صفقات ضائعة",
      formula: "صفوف تحليل الخسائر",
      what: "العملاء اللي اتأرشفوا كخسارة مؤكدة.",
      how: "من تبويب Lost Analysis بس، وبنستبعد منه الصفوف اللي حالتها لسه Won — الصفقة الرابحة بتتأرشف زي أي صفقة مقفولة، ومش خسارة. مرحلة Lost جوه CRM Leads مش بتتحسب هنا خالص.",
      source: "أرشيف Lost المباشر من Odoo.",
      dateBasis: CRM_WINDOW_AR,
      whenEmpty: "صفر معناه مفيش خسائر مؤرشفة في الفترة.",
    },
    en: {
      label: "Lost deals",
      short: "Lost",
      formula: "Lost Analysis rows",
      what: "Leads archived as a confirmed loss.",
      how: "From the Lost Analysis tab only, excluding rows whose stage is still Won — a won deal gets archived like any closed record and is not a loss. CRM stage text never increments this counter.",
      source: "Direct Odoo Lost archive.",
      dateBasis: CRM_WINDOW_EN,
      whenEmpty: "Zero means no archived losses in the period.",
    },
  },

  conversionRate: {
    key: "conversionRate",
    group: "crm",
    ar: {
      label: "نسبة الإغلاق (Conversion Rate)",
      short: "نسبة الإغلاق",
      formula: "الصفقات الرابحة ÷ إجمالي العملاء النظيف × ١٠٠",
      what: "من كل ١٠٠ ليد، كام واحد اشترى.",
      how: "البسط: عدد الصفقات الرابحة (النشطة والمؤرشفة). المقام: إجمالي العملاء النظيف = ليدز الـCRM + صفوف تحليل الخسائر.",
      source: "البسط والمقام من CRM Leads و Lost Analysis.",
      dateBasis: CRM_WINDOW_AR,
      whenEmpty: "شرطة لو مفيش ليدز في الفترة أصلاً.",
    },
    en: {
      label: "Conversion rate",
      short: "Conversion",
      formula: "Won ÷ Total clean leads × 100",
      what: "Out of every 100 leads, how many bought.",
      how: "Numerator: won count, active and archived. Denominator: clean lead total = CRM leads + Lost Analysis rows.",
      source: "Both sides from CRM Leads and Lost Analysis.",
      dateBasis: CRM_WINDOW_EN,
      whenEmpty: "A dash when the period has no leads at all.",
    },
  },

  lostRate: {
    key: "lostRate",
    group: "crm",
    lowerIsBetter: true,
    ar: {
      label: "نسبة الضياع (Lost Rate)",
      short: "نسبة الضياع",
      formula: "تحليل الخسائر ÷ إجمالي العملاء النظيف × ١٠٠",
      what: "من كل ١٠٠ ليد، كام واحد ضاع خلاص.",
      how: "البسط: صفوف Lost Analysis. المقام: نفس إجمالي العملاء النظيف بتاع نسبة الإغلاق.",
      source: "Lost Analysis للبسط، و CRM Leads + Lost Analysis للمقام.",
      dateBasis: CRM_WINDOW_AR,
      whenEmpty: "شرطة لو مفيش ليدز في الفترة.",
    },
    en: {
      label: "Lost rate",
      short: "Lost rate",
      formula: "Lost Analysis ÷ Total clean leads × 100",
      what: "Out of every 100 leads, how many were lost for good.",
      how: "Numerator: Lost Analysis rows. Denominator: the same clean lead total as the conversion rate.",
      source: "Lost Analysis for the numerator; CRM Leads + Lost Analysis for the denominator.",
      dateBasis: CRM_WINDOW_EN,
      whenEmpty: "A dash when the period has no leads.",
    },
  },

  revenue: {
    key: "revenue",
    group: "accounting",
    ar: {
      label: "الإيراد المحصّل",
      short: "الإيراد",
      formula: "مجموع USD Paid من الفواتير المدفوعة",
      what: "الفلوس اللي اتحصّلت فعلاً — مش أوامر بيع ولا فواتير لسه متدفعتش.",
      how: "جمع عمود USD Paid على مستوى بند المنتج داخل الفواتير المدفوعة.",
      source:
        "تبويب Accounting — الفواتير المدفوعة. أوامر البيع و Full Invoiced Orders مش مصدر إيراد.",
      dateBasis: "تاريخ الدفع (Payment Date).",
      whenEmpty: "صفر معناه مفيش تحصيل في الفترة دي.",
    },
    en: {
      label: "Collected revenue",
      short: "Revenue",
      formula: "Sum of USD Paid on paid invoices",
      what: "Money actually collected — not sales orders and not unpaid invoices.",
      how: "Sums the USD Paid column at invoice product-line grain across paid invoices.",
      source:
        "The Accounting tab — paid invoices. Sales orders and Full Invoiced Orders are never a revenue source.",
      dateBasis: "Payment Date.",
      whenEmpty: "Zero means nothing was collected in this period.",
    },
  },

  attributedRevenue: {
    key: "attributedRevenue",
    group: "accounting",
    ar: {
      label: "الإيراد المرتبط بالحملات",
      short: "إيراد الحملات",
      formula: "USD Paid للفواتير اللي عليها حملة صرفت في نفس الفترة",
      what: "الجزء من التحصيل اللي نقدر نرجّعه لحملة إعلانية بعينها.",
      how: "نفس تعريف الإيراد، بس مقصور على الفواتير اللي أبعاد الحملة بتاعتها بتطابق حملة صرفت في الفترة.",
      source: "تبويب Accounting لأبعاد الحملة، وتبويبات الإعلانات لتأكيد إن الحملة صرفت.",
      dateBasis: "تاريخ الدفع للإيراد، وتاريخ الإعلان لتأكيد الصرف.",
      whenEmpty: "بيقل عن الإيراد الكلي دايمًا، لأن فيه تحصيل مالوش حملة معروفة.",
    },
    en: {
      label: "Campaign-linked revenue",
      short: "Linked revenue",
      formula: "USD Paid on invoices tied to a campaign that spent in the window",
      what: "The share of collections traceable to a specific campaign.",
      how: "Same revenue definition, restricted to invoices whose campaign dimensions match a campaign that spent in the window.",
      source: "Accounting for the campaign dimensions; the ad tabs to confirm the campaign spent.",
      dateBasis: "Payment Date for revenue; ad date for the spend check.",
      whenEmpty:
        "Always lower than total revenue, because some collections carry no known campaign.",
    },
  },

  revenuePerLead: {
    key: "revenuePerLead",
    group: "accounting",
    ar: {
      label: "الإيراد لكل عميل",
      short: "إيراد لكل عميل",
      formula: "الإيراد ÷ إجمالي العملاء النظيف",
      what: "كل ليد بيجيب كام في المتوسط، حتى لو ملوش صفقة.",
      how: "الإيراد المحصّل مقسوم على إجمالي العملاء النظيف.",
      source: "Accounting للبسط، و CRM Leads + Lost Analysis للمقام.",
      dateBasis: "تاريخ الدفع للبسط، وتاريخ إنشاء الليد للمقام.",
      whenEmpty: "شرطة لو مفيش ليدز في الفترة.",
    },
    en: {
      label: "Revenue per lead",
      short: "Rev / lead",
      formula: "Revenue ÷ Total clean leads",
      what: "What an average lead is worth, including the ones that never closed.",
      how: "Collected revenue divided by the clean lead total.",
      source: "Accounting for the numerator; CRM Leads + Lost Analysis for the denominator.",
      dateBasis: "Payment Date for the numerator, lead creation date for the denominator.",
      whenEmpty: "A dash when the period has no leads.",
    },
  },

  cpa: {
    key: "cpa",
    group: "efficiency",
    lowerIsBetter: true,
    needsSpend: true,
    ar: {
      label: "تكلفة الصفقة المغلقة (CPA)",
      short: "تكلفة الصفقة",
      formula: "الإنفاق ÷ الصفقات الرابحة",
      what: "بتدفع كام إعلانات عشان تقفل صفقة واحدة.",
      how: "إجمالي الإنفاق مقسوم على عدد الصفقات الرابحة. الأساس الافتراضي هو الصفقات الرابحة؛ فيه أساس بديل بعدد الفواتير بيتغيّر من الفلاتر.",
      source: "البسط: الإنفاق من تبويبات الإعلانات. المقام: Won من CRM Leads.",
      dateBasis: "تاريخ الإعلان للإنفاق، وتاريخ إنشاء الليد للصفقات.",
      whenEmpty: "شرطة لو مفيش صفقات رابحة، أو لو المنصة ملهاش إنفاق مسجّل.",
    },
    en: {
      label: "Cost per acquisition (CPA)",
      short: "CPA",
      formula: "Spend ÷ Won deals",
      what: "What one closed deal costs in advertising.",
      how: "Total spend divided by the Won count. Won deals is the default basis; an invoice-count basis is available from the filters.",
      source: "Numerator: spend from the ad tabs. Denominator: Won from CRM Leads.",
      dateBasis: "Ad date for spend, lead creation date for the deals.",
      whenEmpty: "A dash when there are no won deals, or the platform has no recorded spend.",
    },
  },

  roas: {
    key: "roas",
    group: "efficiency",
    needsSpend: true,
    ar: {
      label: "العائد على الإنفاق الإعلاني (ROAS)",
      short: "العائد",
      formula: "الإيراد ÷ الإنفاق",
      what: "كل دولار إعلانات رجّع كام دولار تحصيل. فوق ١× يعني الفلوس رجعت.",
      how: "الإيراد المحصّل مقسوم على إجمالي الإنفاق الإعلاني.",
      source: "البسط: Accounting — الفواتير المدفوعة. المقام: الإنفاق من تبويبات الإعلانات.",
      dateBasis: "تاريخ الدفع للإيراد، وتاريخ الإعلان للإنفاق.",
      whenEmpty: "شرطة لو مفيش إنفاق — القسمة على صفر مش صفر، دي قيمة مش موجودة.",
    },
    en: {
      label: "Return on ad spend (ROAS)",
      short: "ROAS",
      formula: "Revenue ÷ Spend",
      what: "What each advertising dollar returned in collections. Above 1× means the money came back.",
      how: "Collected revenue divided by total ad spend.",
      source: "Numerator: Accounting paid invoices. Denominator: spend from the ad tabs.",
      dateBasis: "Payment Date for revenue, ad date for spend.",
      whenEmpty: "A dash when there was no spend — dividing by zero is undefined, not zero.",
    },
  },

  acos: {
    key: "acos",
    group: "efficiency",
    lowerIsBetter: true,
    needsSpend: true,
    ar: {
      label: "نسبة الإنفاق إلى الإيراد (ACOS)",
      short: "نسبة الإنفاق للإيراد",
      formula: "الإنفاق ÷ الإيراد × ١٠٠",
      what: "الإعلانات بتاكل كام في المية من التحصيل. كل ما تقل كل ما يكون أحسن.",
      how: "الإنفاق مقسوم على الإيراد المحصّل ومضروب في ١٠٠. هي المقلوب المئوي للعائد.",
      source: "البسط: الإنفاق من تبويبات الإعلانات. المقام: Accounting — الفواتير المدفوعة.",
      dateBasis: "تاريخ الإعلان للإنفاق، وتاريخ الدفع للإيراد.",
      whenEmpty: "شرطة لو مفيش إيراد، أو لو المنصة ملهاش تبويب إنفاق — صفر هنا هيبقى معلومة غلط.",
    },
    en: {
      label: "Advertising cost of sales (ACOS)",
      short: "ACOS",
      formula: "Spend ÷ Revenue × 100",
      what: "What percentage of collections advertising eats. Lower is better.",
      how: "Spend divided by collected revenue, times 100 — the percentage inverse of ROAS.",
      source: "Numerator: spend from the ad tabs. Denominator: Accounting paid invoices.",
      dateBasis: "Ad date for spend, Payment Date for revenue.",
      whenEmpty:
        "A dash when there is no revenue, or the platform has no spend tab — a zero here would be a false reading.",
    },
  },
};

/** Order used by the glossary panel, grouped so one band reads at a time. */
export const GLOSSARY_ORDER: MetricKey[] = [
  "spend",
  "impressions",
  "clicks",
  "ctrAll",
  "ctrLink",
  "platformLeads",
  "crmLeads",
  "won",
  "lost",
  "conversionRate",
  "lostRate",
  "revenue",
  "attributedRevenue",
  "revenuePerLead",
  "cpl",
  "cpa",
  "cpm",
  "cpc",
  "roas",
  "acos",
];

export function metricCopy(key: MetricKey, lang: "ar" | "en"): MetricCopy {
  return METRICS[key][lang];
}
