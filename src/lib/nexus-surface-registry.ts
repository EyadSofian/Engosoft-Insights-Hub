/**
 * What each analytical surface MEANS, declared by the application itself.
 *
 * WHY A REGISTRY AND NOT THE DOM. Reading the page to work out what the user is
 * looking at gives you strings, not meaning: "7.10x" in a box tells an agent
 * nothing about whether it is a ratio, whether it is period-sensitive, or what
 * question is worth asking about it. Scraping also breaks the moment a heading
 * is reworded. The app knows what it renders, so it says so here.
 *
 * NO LIVE VALUES LIVE HERE. This is meaning, not data: element ids, what they
 * represent, which capability answers them, and what a person might reasonably
 * ask. The figure itself is fetched when a question is actually asked — see
 * `sourceCapability`.
 *
 * This sits alongside `agent-insights-registry.ts`, which owns routing and data
 * access. That one answers "where does the answer live"; this one answers "what
 * is the user looking at".
 */

export interface NexusElement {
  /** Stable id, e.g. "course.roas". Survives copy changes. */
  id: string;
  type: "kpi" | "chart" | "table" | "list" | "card";
  title: { ar: string; en: string };
  /** What it means in business terms, for an explanation. */
  meaning: { ar: string; en: string };
  /** Which surface capability answers a question about it. */
  sourceCapability: string;
  /** Does its value depend on the selected period? */
  periodSensitive: boolean;
  /** Does it depend on the active filters? */
  filterSensitive: boolean;
  /** An entity that must be chosen before it means anything. */
  requiresEntity?: "course" | "campaign" | "team" | "salesperson" | "product";
  /** Questions worth offering for this element specifically. */
  questions: Array<{ ar: string; en: string }>;
}

export interface NexusSection {
  id: string;
  title: { ar: string; en: string };
  /** Elements rendered inside it. */
  elements: string[];
}

export interface NexusTab {
  id: string;
  title: { ar: string; en: string };
  summary: { ar: string; en: string };
  sections: string[];
}

export interface NexusSurfaceManifest {
  id: string;
  route: string;
  title: { ar: string; en: string };
  /** One or two sentences: what this page is for. Shown in the page intro. */
  description: { ar: string; en: string };
  tabs: NexusTab[];
  sections: NexusSection[];
  elements: NexusElement[];
  /** Offered when the user opens the page and has not asked anything yet. */
  suggestedQuestions: Array<{ ar: string; en: string }>;
}

const q = (ar: string, en: string) => ({ ar, en });

/** Money, leads and return show up on nearly every surface. */
const commonElements = (capability: string): NexusElement[] => [
  {
    id: `${capability}.spend`,
    type: "kpi",
    title: q("الإنفاق", "Spend"),
    meaning: q(
      "اللي اتصرف على الإعلانات في الفترة المختارة.",
      "What was spent on ads in the selected period.",
    ),
    sourceCapability: capability,
    periodSensitive: true,
    filterSensitive: true,
    questions: [
      q("الإنفاق ده كويس؟", "Is this spend reasonable?"),
      q("قارنه بالفترة اللي فاتت", "Compare with the previous period"),
    ],
  },
  {
    id: `${capability}.revenue`,
    type: "kpi",
    title: q("الإيراد", "Revenue"),
    meaning: q(
      "الفلوس المحصّلة فعليًا في الفترة، بتاريخ الدفع.",
      "Money actually collected in the period, by payment date.",
    ),
    sourceCapability: capability,
    periodSensitive: true,
    filterSensitive: true,
    questions: [
      q("ليه الإيراد اتغير؟", "Why did revenue change?"),
      q("قارن بالشهر اللي فات", "Compare with last month"),
    ],
  },
  {
    id: `${capability}.roas`,
    type: "kpi",
    title: q("ROAS", "ROAS"),
    meaning: q(
      "كل جنيه إنفاق رجّع كام. بيتقرا مع المبيعات المقفولة مش لوحده.",
      "Return per unit of spend. Read alongside closed sales, never alone.",
    ),
    sourceCapability: capability,
    periodSensitive: true,
    filterSensitive: true,
    questions: [q("يعني إيه ROAS؟", "What is ROAS?"), q("الرقم ده كويس؟", "Is this number good?")],
  },
  {
    id: `${capability}.leads`,
    type: "kpi",
    title: q("الليدز", "Leads"),
    meaning: q(
      "عدد العملاء المحتملين المسجلين في الـCRM في الفترة.",
      "Leads recorded in the CRM during the period.",
    ),
    sourceCapability: capability,
    periodSensitive: true,
    filterSensitive: true,
    questions: [
      q("الليدز دي بتتحول لمبيعات؟", "Are these leads converting?"),
      q("مين أحسن مصدر ليدز؟", "Which source produces the best leads?"),
    ],
  },
];

export const NEXUS_SURFACES: NexusSurfaceManifest[] = [
  {
    id: "overview",
    route: "/",
    title: q("تحليلات البيزنس", "Business analytics"),
    description: q(
      "الصورة الكاملة للشركة في الفترة المختارة: الإنفاق، الليدز، المبيعات والإيراد.",
      "The whole company for the selected period: spend, leads, sales and revenue.",
    ),
    tabs: [],
    sections: [
      {
        id: "kpis",
        title: q("المؤشرات الأساسية", "Headline KPIs"),
        elements: ["overview.spend", "overview.revenue", "overview.roas", "overview.leads"],
      },
    ],
    elements: commonElements("overview"),
    suggestedQuestions: [
      q("إيه أهم ملاحظة الشهر ده؟", "What stands out this month?"),
      q("ليه الإيراد اتغير؟", "Why did revenue change?"),
      q("مين محتاج تدخل؟", "What needs attention?"),
    ],
  },
  {
    id: "courses",
    route: "/courses",
    title: q("الدورات", "Courses"),
    description: q(
      "أداء كل كورس: الحملات المرتبطة بيه، المنتجات اللي اتباعت، والإيراد.",
      "How each course performs: its campaigns, the products that sold, and revenue.",
    ),
    tabs: [
      {
        id: "campaigns",
        title: q("الحملات", "Campaigns"),
        summary: q(
          "الحملات المرتبطة بالكورس وأداء كل واحدة.",
          "The campaigns behind this course and how each performed.",
        ),
        sections: ["active_campaigns", "previous_campaigns"],
      },
      {
        id: "alerts",
        title: q("التنبيهات", "Alerts"),
        summary: q("الكورسات اللي محتاجة تدخل.", "Courses that need attention."),
        sections: ["alerts"],
      },
      {
        id: "all",
        title: q("كل الكورسات", "All courses"),
        summary: q("جدول بكل الكورسات وأدائها.", "Every course and its performance."),
        sections: ["course_table"],
      },
    ],
    sections: [
      {
        id: "active_campaigns",
        title: q("الحملات الشغالة", "Active campaigns"),
        elements: ["course.campaigns"],
      },
      {
        id: "previous_campaigns",
        title: q("الحملات السابقة", "Previous campaigns"),
        elements: ["course.campaigns"],
      },
      { id: "alerts", title: q("التنبيهات", "Alerts"), elements: [] },
      {
        id: "course_table",
        title: q("جدول الكورسات", "Course table"),
        elements: ["course.revenue", "course.roas"],
      },
      {
        id: "product_mix",
        title: q("المنتجات اللي اتباعت", "Products sold"),
        elements: ["course.products"],
      },
    ],
    elements: [
      ...commonElements("courses"),
      {
        id: "course.campaigns",
        type: "table",
        title: q("حملات الكورس", "Course campaigns"),
        meaning: q(
          "كل حملة مرتبطة بالكورس ده وأداؤها. الحالة بتيجي من المنصة نفسها مش من الإنفاق.",
          "Every campaign attached to this course. Active state comes from the platform, not from spend.",
        ),
        sourceCapability: "courses",
        periodSensitive: true,
        filterSensitive: true,
        requiresEntity: "course",
        questions: [
          q("أنهي حملة كانت أحسن؟", "Which campaign performed best?"),
          q("مين فيهم أضعف؟", "Which is weakest?"),
        ],
      },
      {
        id: "course.products",
        type: "table",
        title: q("المنتجات المباعة", "Sold products"),
        meaning: q(
          "المنتجات اللي اتباعت فعلًا تحت الكورس ده، من الفواتير مش من اسم الحملة.",
          "The products actually sold under this course, from invoices — not from campaign names.",
        ),
        sourceCapability: "courses",
        periodSensitive: true,
        filterSensitive: true,
        requiresEntity: "course",
        questions: [
          q("أكتر منتج اتباع؟", "Which product sold most?"),
          q("سعره كام دلوقتي؟", "What does it cost now?"),
        ],
      },
    ],
    suggestedQuestions: [
      q("مين بيبيع أحسن؟", "Which course sells best?"),
      q("مين محتاج تدخل؟", "Which course needs attention?"),
    ],
  },
  {
    id: "website",
    route: "/website",
    title: q("أداء الموقع", "Website performance"),
    description: q(
      "ليدز الموقع ومبيعاته الموحّدة من Odoo وشيت المبيعات الإضافي.",
      "Website leads and sales, reconciled from Odoo and the supplementary sales sheet.",
    ),
    tabs: [
      {
        id: "owner",
        title: q("ملخص المالك", "Owner summary"),
        summary: q("الأرقام والقرار في نظرة واحدة.", "The figures and the decision at a glance."),
        sections: ["kpis"],
      },
      {
        id: "campaigns",
        title: q("حملات الموقع", "Website campaigns"),
        summary: q("صرف ونتائج وربط البيع.", "Spend, results and sales attribution."),
        sections: ["campaigns"],
      },
      {
        id: "operations",
        title: q("الليدز والمبيعات", "Leads and sales"),
        summary: q("التفاصيل والمتابعة اليومية.", "Detail and daily follow-up."),
        sections: ["leads"],
      },
    ],
    sections: [
      { id: "kpis", title: q("المؤشرات", "KPIs"), elements: ["website.sales", "website.leads"] },
      { id: "campaigns", title: q("الحملات", "Campaigns"), elements: ["website.spend"] },
      { id: "leads", title: q("الليدز", "Leads"), elements: ["website.leads"] },
    ],
    elements: [
      ...commonElements("website"),
      {
        id: "website.sales",
        type: "kpi",
        title: q("مبيعات الموقع", "Website sales"),
        meaning: q(
          "المبيعات المتطابقة بين Odoo وشيت الموقع بعد منع تكرار رقم الأوردر.",
          "Sales reconciled between Odoo and the website sheet, de-duplicated by order id.",
        ),
        sourceCapability: "website",
        periodSensitive: true,
        filterSensitive: true,
        questions: [
          q("الموقع باع بكام؟", "How much did the website sell?"),
          q("أكتر كورس اتباع من الموقع؟", "Which course sold most online?"),
        ],
      },
    ],
    suggestedQuestions: [
      q("الموقع باع بكام الشهر ده؟", "How much did the website sell this month?"),
      q("أنهي حملة جابت مبيعات؟", "Which campaign produced sales?"),
    ],
  },
  {
    id: "campaigns",
    route: "/campaigns",
    title: q("الحملات", "Campaigns"),
    description: q(
      "أداء كل حملة إعلانية: الإنفاق، الليدز، المبيعات والعائد.",
      "How each ad campaign performs: spend, leads, sales and return.",
    ),
    tabs: [],
    sections: [
      { id: "kpis", title: q("المؤشرات", "KPIs"), elements: ["campaigns.spend", "campaigns.roas"] },
    ],
    elements: commonElements("campaigns"),
    suggestedQuestions: [
      q("أنهي حملة أحسن؟", "Which campaign is best?"),
      q("مين محتاج مراجعة؟", "Which needs review?"),
    ],
  },
  {
    id: "accounting",
    route: "/accounting",
    title: q("المبيعات والمحاسبة", "Sales and accounting"),
    description: q(
      "الإيراد المحصّل والفواتير وربحية المنتجات.",
      "Collected revenue, invoices and product profitability.",
    ),
    tabs: [
      {
        id: "summary",
        title: q("الملخص", "Summary"),
        summary: q("الصورة العامة للإيراد.", "The revenue picture."),
        sections: ["kpis"],
      },
      {
        id: "months",
        title: q("الشهور", "Months"),
        summary: q("الاتجاه شهر بشهر.", "The month-by-month trend."),
        sections: ["kpis"],
      },
      {
        id: "profitability",
        title: q("الربحية", "Profitability"),
        summary: q("الهامش بعد التكاليف.", "Margin after costs."),
        sections: ["kpis"],
      },
    ],
    sections: [{ id: "kpis", title: q("المؤشرات", "KPIs"), elements: ["accounting.revenue"] }],
    elements: commonElements("accounting"),
    suggestedQuestions: [
      q("إيراد الشهر ده كام؟", "What is this month's revenue?"),
      q("أنهي منتج أعلى ربحية؟", "Which product is most profitable?"),
    ],
  },
  {
    id: "leads",
    route: "/leads",
    title: q("الليدز", "Leads"),
    description: q(
      "العملاء المحتملين ومصادرهم ومتابعتهم.",
      "Leads, where they came from and how they are followed up.",
    ),
    tabs: [],
    sections: [{ id: "kpis", title: q("المؤشرات", "KPIs"), elements: ["leads.leads"] }],
    elements: commonElements("leads"),
    suggestedQuestions: [
      q("كام ليد الشهر ده؟", "How many leads this month?"),
      q("مين أحسن مصدر؟", "Which source is best?"),
    ],
  },
  {
    id: "lost",
    route: "/lost",
    title: q("الصفقات الضائعة", "Lost deals"),
    description: q(
      "الليدز اللي ضاعت وأسبابها، بالفريق وبالكورس.",
      "Lost leads and the reasons behind them, by team and by course.",
    ),
    tabs: [
      {
        id: "team",
        title: q("بالفريق", "By team"),
        summary: q("حسب الفريق.", "By team."),
        sections: ["kpis"],
      },
      {
        id: "course",
        title: q("بالكورس", "By course"),
        summary: q("حسب الكورس.", "By course."),
        sections: ["kpis"],
      },
    ],
    sections: [{ id: "kpis", title: q("المؤشرات", "KPIs"), elements: ["lost.leads"] }],
    elements: commonElements("lost"),
    suggestedQuestions: [
      q("ليه بنخسر؟", "Why are we losing?"),
      q("أنهي كورس أعلى خسارة؟", "Which course loses most?"),
    ],
  },
  {
    id: "teams",
    route: "/teams",
    title: q("الفرق", "Teams"),
    description: q(
      "أداء فرق المبيعات والمندوبين: الليدز، التحويل، والإيراد.",
      "Sales team and rep performance: leads, conversion and revenue.",
    ),
    tabs: [],
    sections: [{ id: "kpis", title: q("المؤشرات", "KPIs"), elements: ["teams.revenue"] }],
    elements: commonElements("teams"),
    suggestedQuestions: [
      q("مين أحسن فريق؟", "Which team performs best?"),
      q("مين محتاج دعم؟", "Who needs support?"),
    ],
  },
  {
    id: "ads",
    route: "/ads",
    title: q("الإعلانات", "Ads"),
    description: q(
      "أداء الإعلانات والمجموعات الإعلانية: الظهور، النقر، والليدز.",
      "Ad and ad-set performance: impressions, clicks and leads.",
    ),
    tabs: [],
    sections: [{ id: "kpis", title: q("المؤشرات", "KPIs"), elements: ["ads.spend"] }],
    elements: commonElements("ads"),
    suggestedQuestions: [q("أنهي إعلان أحسن؟", "Which ad performs best?")],
  },
  {
    id: "pricing",
    route: "/pricing",
    title: q("الأسعار", "Pricing"),
    description: q(
      "كتالوج الأسعار الداخلي. السعر الحالي المعتمد بييجي من PriceEngo.",
      "The internal price catalogue. The authoritative current price comes from PriceEngo.",
    ),
    tabs: [],
    sections: [],
    elements: [],
    suggestedQuestions: [q("سعر الكورس ده كام؟", "What does this course cost?")],
  },
  {
    id: "weekend",
    route: "/weekend",
    title: q("الويك إند", "Weekend"),
    description: q(
      "مقارنة أداء الويك إند بباقي أيام الأسبوع في الإنفاق والليدز والمبيعات.",
      "Weekend versus weekday performance across spend, leads and sales.",
    ),
    tabs: [],
    sections: [],
    elements: commonElements("weekend"),
    suggestedQuestions: [q("الويك إند أحسن ولا لأ؟", "Is the weekend better?")],
  },
  {
    id: "yoy",
    route: "/yoy",
    title: q("سنة بسنة", "Year on year"),
    description: q(
      "مقارنة أداء السنة دي بالسنة اللي فاتت لنفس الفترة.",
      "This year against last, over the same period.",
    ),
    tabs: [],
    sections: [],
    elements: commonElements("yoy"),
    suggestedQuestions: [q("السنة دي أحسن؟", "Is this year better?")],
  },
  {
    id: "media_buyers",
    route: "/media-buyers",
    title: q("الميديا بايرز", "Media buyers"),
    description: q(
      "أداء كل ميديا باير: الحملات اللي بيديرها، إنفاقه، والنتائج اللي جابها.",
      "How each media buyer performs: the campaigns they run, their spend and the results.",
    ),
    tabs: [],
    sections: [],
    elements: commonElements("media_buyers"),
    suggestedQuestions: [q("مين أحسن ميديا باير؟", "Which media buyer performs best?")],
  },
  {
    id: "media_plan",
    route: "/media-plan",
    title: q("خطة الميديا", "Media plan"),
    description: q(
      "خطة الميديا للشهر: أهداف الليدز والمبيعات والميزانية المخصصة لكل كورس.",
      "The month's media plan: lead and sales targets, and the budget allocated per course.",
    ),
    tabs: [],
    sections: [],
    elements: [],
    suggestedQuestions: [q("إحنا فين من الخطة؟", "How are we tracking against plan?")],
  },
  {
    id: "social_media",
    route: "/social-media",
    title: q("السوشيال ميديا", "Social media"),
    description: q(
      "أداء القنوات الاجتماعية المدفوعة والأورجانيك جنب بعض.",
      "Paid and organic social channel performance, side by side.",
    ),
    tabs: [],
    sections: [],
    elements: commonElements("social_media"),
    suggestedQuestions: [q("أنهي قناة أحسن؟", "Which channel performs best?")],
  },
  {
    id: "organic",
    route: "/organic",
    title: q("الأورجانيك", "Organic"),
    description: q(
      "الليدز والمبيعات اللي جت من غير إنفاق إعلاني.",
      "Leads and sales that arrived without ad spend.",
    ),
    tabs: [],
    sections: [],
    elements: commonElements("organic"),
    suggestedQuestions: [q("الأورجانيك جاب كام؟", "How much did organic bring?")],
  },
];

const BY_ID = new Map(NEXUS_SURFACES.map((surface) => [surface.id, surface]));
const BY_ROUTE = new Map(NEXUS_SURFACES.map((surface) => [surface.route, surface]));
const ELEMENTS = new Map<string, NexusElement>();
for (const surface of NEXUS_SURFACES) {
  for (const element of surface.elements) ELEMENTS.set(element.id, element);
}

export const surfaceManifest = (id: string): NexusSurfaceManifest | null => BY_ID.get(id) ?? null;

export const manifestForRoute = (path: string): NexusSurfaceManifest | null => {
  const normalized = (path || "/").toLowerCase().replace(/\/+$/, "") || "/";
  return (
    BY_ROUTE.get(normalized) ??
    NEXUS_SURFACES.find(
      (surface) => surface.route !== "/" && normalized.startsWith(`${surface.route}/`),
    ) ??
    null
  );
};

export const elementManifest = (id: string): NexusElement | null => ELEMENTS.get(id) ?? null;

/**
 * The questions worth offering right now.
 *
 * Element beats section beats surface: the most specific thing the user is
 * looking at is the thing they are most likely asking about.
 */
export function contextualQuestions(
  surfaceId: string,
  elementId?: string | null,
  lang: "ar" | "en" = "ar",
): string[] {
  const element = elementId ? elementManifest(elementId) : null;
  if (element) return element.questions.map((question) => question[lang]).slice(0, 4);
  const surface = surfaceManifest(surfaceId);
  return (surface?.suggestedQuestions ?? []).map((question) => question[lang]).slice(0, 4);
}
