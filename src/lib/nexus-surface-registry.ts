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
  // Declared because every analytical page now lets a reader OPEN these
  // figures. A KPI the user can drill into and Nexus cannot name is a KPI where
  // "اشرحلي الرقم ده" answers about the wrong thing.
  {
    id: `${capability}.won`,
    type: "kpi",
    title: q("الصفقات المغلقة", "Won deals"),
    meaning: q(
      "عدد العملاء اللي وصلوا لمرحلة الربح جوه الفترة المختارة.",
      "How many leads reached the won stage inside the selected period.",
    ),
    sourceCapability: capability,
    periodSensitive: true,
    filterSensitive: true,
    questions: [
      q("مين أكتر حد قفل صفقات؟", "Who closed the most?"),
      q("الرقم ده كويس بالنسبة للتارجت؟", "Is this good against target?"),
    ],
  },
  {
    id: `${capability}.conversion`,
    type: "kpi",
    title: q("معدل التحويل", "Conversion rate"),
    meaning: q(
      "نسبة العملاء اللي بقوا صفقات مكسوبة. بتتقرا مع عدد الليدز نفسه مش لوحدها.",
      "The share of leads that became won deals. Read with the lead count, never alone.",
    ),
    sourceCapability: capability,
    periodSensitive: true,
    filterSensitive: true,
    questions: [
      q("النسبة دي محسوبة على إيه؟", "What is this measured against?"),
      q("مين أعلى وأقل في التحويل؟", "Who converts best and worst?"),
    ],
  },
  {
    id: `${capability}.lost`,
    type: "kpi",
    title: q("الصفقات الضائعة", "Lost deals"),
    meaning: q(
      "الصفقات اللي اتقفلت خسارة، من مصدر الخسائر المعتمد لوحده.",
      "Deals closed as lost, from the approved Lost source only.",
    ),
    sourceCapability: capability,
    periodSensitive: true,
    filterSensitive: true,
    questions: [
      q("إيه أهم أسباب الخسارة؟", "What are the main loss reasons?"),
      q("مين أكتر فريق متأثر؟", "Which team is most affected?"),
    ],
  },
  {
    id: `${capability}.cpl`,
    type: "kpi",
    title: q("تكلفة الليد", "Cost per lead"),
    meaning: q(
      "الإنفاق مقسوم على الليدز اللي أبلغت عنها المنصات، مش ليدز الـCRM.",
      "Spend divided by platform-reported leads, not CRM leads.",
    ),
    sourceCapability: capability,
    periodSensitive: true,
    filterSensitive: true,
    questions: [
      q("التكلفة دي عالية؟", "Is this cost high?"),
      q("أنهي منصة أرخص؟", "Which platform is cheapest?"),
    ],
  },
  {
    id: `${capability}.cpa`,
    type: "kpi",
    title: q("تكلفة الصفقة", "Cost per won deal"),
    meaning: q(
      "الإعلان كلّف كام مقابل كل صفقة مكسوبة في الفترة.",
      "What advertising cost for each won deal in the period.",
    ),
    sourceCapability: capability,
    periodSensitive: true,
    filterSensitive: true,
    questions: [
      q("الرقم ده كويس؟", "Is this number good?"),
      q("قارنه بالفترة اللي فاتت", "Compare with the previous period"),
    ],
  },
  {
    id: `${capability}.acos`,
    type: "kpi",
    title: q("ACOS", "ACOS"),
    meaning: q(
      "الإنفاق كنسبة من الإيراد المحصّل. كل ما قلّت كان الإعلان أرخص مقابل اللي رجّعه.",
      "Spend as a share of collected revenue. Lower means cheaper advertising for what it returned.",
    ),
    sourceCapability: capability,
    periodSensitive: true,
    filterSensitive: true,
    questions: [q("يعني إيه ACOS؟", "What is ACOS?"), q("الرقم ده كويس؟", "Is this number good?")],
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
    /**
     * `{entity}` is replaced by whatever the page has selected — so standing on
     * Courses with CFM open offers "أرتبلك الموظفين اللي باعوا CFM؟" rather
     * than a sentence about "the course". A generic offer is the usual reason a
     * proactive assistant gets dismissed.
     */
    suggestedQuestions: [
      q("تحب أقارن {entity} بالشهر اللي فات؟", "Compare {entity} with last month?"),
      q("أرتبلك الموظفين اللي باعوا {entity}؟", "Rank the people who sold {entity}?"),
      q("أجيب السعر والعروض الحالية؟", "Fetch the current price and offers?"),
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
      q("أكتر كورس اتباع من الموقع؟", "Which course sold most online?"),
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
      q(
        "قارن الحملات على الإيراد والـROAS وجودة الليدز",
        "Compare campaigns on revenue, ROAS and lead quality?",
      ),
      q(
        "رتب أفضل الحملات وقولي الترتيب مبني على إيه",
        "Rank the best campaigns and explain the basis",
      ),
      q("رتب الحملات المحتاجة مراجعة واشرح السبب", "Rank campaigns needing review and explain why"),
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
      {
        id: "marketing",
        title: q("أداء المبيعات من التسويق", "Sales performance"),
        summary: q(
          "كل صفقة ومصدرها وحملتها وإعلانها ومادتها والإيراد المدفوع، مؤرخة بتاريخ وصول العميل.",
          "Each deal with its source, campaign, ad, creative and paid revenue, dated by when the lead arrived.",
        ),
        sections: ["kpis"],
      },
    ],
    sections: [{ id: "kpis", title: q("المؤشرات", "KPIs"), elements: ["accounting.revenue"] }],
    elements: commonElements("accounting"),
    suggestedQuestions: [
      q("إيراد الشهر ده كام؟", "What is this month's revenue?"),
      q("أنهي منتج أعلى ربحية؟", "Which product is most profitable?"),
      q("قارن الشهر ده بالشهر اللي فات", "Compare this month with last month"),
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
      q("في ليدز اتوزعت ومحدش كلمها؟", "Are there distributed leads nobody called?"),
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
      q("أنهي فريق أعلى نسبة خسارة؟", "Which team has the highest loss rate?"),
    ],
  },
  {
    id: "teams",
    route: "/teams",
    title: q("أداء الموظفين", "Employee Performance"),
    description: q(
      "أداء الموظفين وفرق المبيعات: التارجت الشهري، المحقق بالتحصيل، نسبة التحقيق، الليدز والتحويل — لكل وحدة وفريق وموظف.",
      "Employee and sales-team performance: monthly target, collected achievement, achievement rate, leads and conversion — per unit, team and person.",
    ),
    /**
     * The units-and-teams target board is a tab, and it was not listed.
     *
     * A manager pointed at "إجمالي التارجت $162,000" on this page and the agent
     * said it had no target data. The figure was in /api/teams the whole time,
     * nested under `targets`, which nothing had declared — so neither the
     * flattener nor this registry knew the tab existed.
     */
    tabs: [
      {
        id: "targets",
        title: q("أداء الوحدات والتيمات", "Units and team performance"),
        summary: q(
          "متابعة التارجت من تحصيل Odoo: إجمالي التارجت، المحقق بالتحصيل، نسبة التحقيق والمتبقي — للوحدة والفريق والموظف.",
          "Target tracking from Odoo collections: total target, collected achievement, achievement rate and remaining — by unit, team and person.",
        ),
        sections: ["targets"],
      },
      {
        id: "agents",
        title: q("أداء كل موظف", "Per-employee performance"),
        summary: q(
          "بطاقة كل موظف: التارجت، المحقق، الليدز، المكالمات، والكورسات اللي باعها.",
          "One card per employee: target, achieved, leads, calls and the courses they sold.",
        ),
        sections: ["kpis"],
      },
    ],
    sections: [
      { id: "kpis", title: q("المؤشرات", "KPIs"), elements: ["teams.revenue"] },
      {
        id: "targets",
        title: q("التارجت", "Targets"),
        elements: ["teams.target", "teams.achievement"],
      },
    ],
    elements: [
      ...commonElements("teams"),
      {
        id: "teams.target",
        type: "kpi" as const,
        title: q("إجمالي التارجت", "Total target"),
        meaning: q(
          "التارجت الشهري المنشور لكل الموظفين المطابقين، بالدولار.",
          "The published monthly quota across all matched employees, in USD.",
        ),
        sourceCapability: "teams",
        periodSensitive: true,
        filterSensitive: true,
        questions: [
          q("التارجت كام الشهر ده؟", "What is this month's target?"),
          q("فاضل كام على التارجت؟", "How much is left against target?"),
        ],
      },
      {
        id: "teams.achievement",
        type: "kpi" as const,
        title: q("نسبة التحقيق", "Achievement rate"),
        meaning: q(
          "المحقق بالتحصيل ÷ التارجت. التحصيل من Odoo، مش الفواتير المفتوحة.",
          "Collected achievement over target. Collection is from Odoo, not open invoices.",
        ),
        sourceCapability: "teams",
        periodSensitive: true,
        filterSensitive: true,
        questions: [
          q("نسبة التحقيق كام؟", "What is the achievement rate?"),
          q("مين لسه بعيد عن تارجته؟", "Who is furthest from quota?"),
        ],
      },
    ],
    suggestedQuestions: [
      q(
        "تحب أرتب الفريق حسب تحقيق التارجت ولا حسب كورس معين؟",
        "Rank the team by quota attainment, or by a particular course?",
      ),
      q("مين أحسن فريق؟", "Which team performs best?"),
      q("مين لسه بعيد عن تارجته؟", "Who is furthest from their quota?"),
      q("مين أنسب موظف يبيع كورس PMP؟", "Who is best placed to sell PMP?"),
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
    suggestedQuestions: [
      q("رتب الإعلانات بالأرقام وقولي معيار الترتيب", "Rank the ads and state the ranking basis"),
      q("أنهي إعلان محتاج مراجعة وليه؟", "Which ad needs review and why?"),
      q(
        "حلل CPL الإعلانات من غير ما تفترض سبب مش موجود",
        "Analyse ad CPL without assuming an unsupported cause",
      ),
    ],
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
    suggestedQuestions: [
      q("سعر الكورس ده كام؟", "What does this course cost?"),
      q("في عروض شغالة دلوقتي؟", "Are there any live offers right now?"),
    ],
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
    suggestedQuestions: [
      q("الويك إند أحسن ولا لأ؟", "Is the weekend better?"),
      q("نزوّد ولا نقلّل صرف الويك إند؟", "Should we raise or cut weekend spend?"),
    ],
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
    suggestedQuestions: [
      q("السنة دي أحسن؟", "Is this year better?"),
      q("أنهي كورس اتحسن أكتر سنة بسنة؟", "Which course improved most year on year?"),
    ],
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
    suggestedQuestions: [
      q("مين أحسن ميديا باير؟", "Which media buyer performs best?"),
      q("كام من الإنفاق مش متعيّن لحد؟", "How much spend is assigned to nobody?"),
    ],
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
    suggestedQuestions: [
      q(
        "تحب أشوف إحنا سابقين ولا متأخرين عن pacing الخطة؟",
        "See whether we are ahead of or behind the plan's pacing?",
      ),
      q("إحنا فين من الخطة؟", "How are we tracking against plan?"),
      q("أنهي كورس أبعد عن خطته؟", "Which course is furthest from its plan?"),
    ],
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
    suggestedQuestions: [
      q("أنهي قناة أحسن؟", "Which channel performs best?"),
      q("قارن المدفوع بالأورجانيك", "Compare paid against organic"),
    ],
  },
  {
    id: "acquisition_performance",
    route: "/acquisition",
    title: q("تحليل أداء الاستحواذ", "Acquisition performance"),
    description: q(
      "كم عميلًا ورسالة وصلت اليوم وفي الفترة، ومن أين بالضبط: القناة والحملة والإعلان والمادة وصفحة الهبوط ونموذج Meta.",
      "How many leads and messages arrived today and in the period, and exactly where from: channel, campaign, ad, creative, landing page and Meta form.",
    ),
    tabs: [
      {
        id: "overview",
        title: q("نظرة عامة", "Overview"),
        summary: q(
          "الصرف والعملاء والمطابقون والمؤهلون والمكسوبون والإيراد المدفوع والعائد، مع الأفضل وتغطية البيانات.",
          "Spend, leads, CRM matched, qualified, won, paid revenue and ROAS, with the best performers and data coverage.",
        ),
        sections: ["closed_loop", "today"],
      },
      {
        id: "ads",
        title: q("الإعلانات والمواد", "Ads & creatives"),
        summary: q(
          "من الحملة إلى مجموعة الإعلان إلى الإعلان إلى المادة وأصولها، مع الصرف والعملاء والفوز والإيراد.",
          "Campaign to ad set to ad to creative and its assets, with spend, leads, wins and revenue.",
        ),
        sections: ["hierarchy", "assets"],
      },
      {
        id: "leads",
        title: q("العملاء والجودة", "Leads & quality"),
        summary: q(
          "عملاء اليوم والفترة، ونماذج Meta، وصفحات الهبوط، وجودة العملاء لا عددهم.",
          "Today's and the period's leads, Meta forms, landing pages, and lead quality rather than volume.",
        ),
        sections: ["forms", "landing", "quality", "breakdowns"],
      },
      {
        id: "sales",
        title: q("المبيعات والإيراد", "Sales & revenue"),
        summary: q(
          "نتائج CRM والصفقات المكسوبة وأوامر البيع والفواتير والإيراد المدفوع لكل عميل متتبَّع.",
          "CRM outcomes, won deals, sales orders, invoices and paid revenue for every tracked lead.",
        ),
        sections: ["sales"],
      },
      {
        id: "coverage",
        title: q("تغطية البيانات", "Data coverage"),
        summary: q(
          "إلى أي حد نتتبع الحملة والمادة والنموذج وCRM والرسائل، مع التفاصيل التقنية عند الطلب.",
          "How far campaign, creative, form, CRM and messaging tracking reaches, with technical details on request.",
        ),
        sections: ["closed_loop"],
      },
    ],
    sections: [
      {
        id: "closed_loop",
        title: q("الربط المغلق", "Closed loop"),
        elements: [
          "acquisition_performance.closed_loop_coverage",
          "acquisition_performance.closed_loop_funnel",
        ],
      },
      {
        id: "hierarchy",
        title: q("هرم Meta", "Meta hierarchy"),
        elements: [
          "acquisition_performance.campaign_table",
          "acquisition_performance.creative_table",
        ],
      },
      {
        id: "assets",
        title: q("الأصول", "Assets"),
        elements: ["acquisition_performance.asset_table"],
      },
      {
        id: "forms",
        title: q("نماذج Meta", "Meta forms"),
        elements: [],
      },
      {
        id: "landing",
        title: q("صفحات الهبوط", "Landing pages"),
        elements: ["acquisition_performance.landing_pages"],
      },
      {
        id: "quality",
        title: q("جودة العملاء", "Lead quality"),
        elements: ["acquisition_performance.lead_quality"],
      },
      {
        id: "sales",
        title: q("نتائج المبيعات", "Sales outcomes"),
        elements: ["acquisition_performance.sales_outcomes"],
      },
      {
        id: "today",
        title: q("اليوم", "Today"),
        elements: ["acquisition_performance.today_total", "acquisition_performance.top_campaign"],
      },
      {
        id: "breakdowns",
        title: q("القنوات والوجهات", "Channels and destinations"),
        elements: [],
      },
    ],
    elements: [
      {
        id: "acquisition_performance.today_total",
        type: "kpi",
        title: q("استحواذ اليوم", "Today's acquisitions"),
        meaning: q(
          "محادثات Chatwoot وعملاء نماذج Meta وإرسالات صفحات الهبوط في يوم العمل الحالي.",
          "Chatwoot conversations, Meta form leads and landing submissions in the current business day.",
        ),
        sourceCapability: "acquisition_performance",
        periodSensitive: false,
        filterSensitive: false,
        questions: [
          q("جالنا كام عميل النهارده ومنين؟", "How many leads came today, and from where?"),
        ],
      },
      {
        id: "acquisition_performance.top_campaign",
        type: "card",
        title: q("أعلى حملة", "Top campaign"),
        meaning: q(
          "الحملة صاحبة أكبر عدد استحواذ مرتبط بمعرّفها الدقيق اليوم.",
          "The campaign with the most acquisitions linked to its exact ID today.",
        ),
        sourceCapability: "acquisition_performance",
        periodSensitive: false,
        filterSensitive: false,
        questions: [q("أنهي حملة جابت أكتر النهارده؟", "Which campaign brought the most today?")],
      },
      {
        id: "acquisition_performance.campaign_table",
        type: "table",
        title: q("أداء الحملات", "Campaign performance"),
        meaning: q(
          "الاستحواذ الدقيق والصرف ثم نتائجه في CRM والمبيعات لكل حملة ومجموعة إعلان وإعلان، بالمعرّف فقط.",
          "Exact acquisitions and spend, then their CRM and sales results, for each campaign, ad set and ad, by ID only.",
        ),
        sourceCapability: "acquisition_performance",
        periodSensitive: true,
        filterSensitive: true,
        questions: [
          q("أنهي حملة أقل تكلفة استحواذ؟", "Which campaign has the lowest cost per acquisition?"),
        ],
      },
      {
        id: "acquisition_performance.creative_table",
        type: "table",
        title: q("أداء المواد الإعلانية", "Creative performance"),
        meaning: q(
          "العملاء المرتبطون بمعرّف كل مادة إعلانية ونسبة تأهيلهم وفوزهم والإيراد وROAS.",
          "Leads linked to each creative ID, with qualification, win rate, revenue and ROAS.",
        ),
        sourceCapability: "acquisition_performance",
        periodSensitive: true,
        filterSensitive: true,
        questions: [q("أنهي كريتيف جاب أكتر عملاء؟", "Which creative brought the most leads?")],
      },
      {
        id: "acquisition_performance.landing_pages",
        type: "table",
        title: q("أداء صفحات الهبوط", "Landing page performance"),
        meaning: q(
          "المشاهدات والزوار وبدء النماذج والإرسالات ومعدل التحويل لكل صفحة هبوط متتبعة.",
          "Views, visitors, form starts, submissions and conversion rate for each tracked landing page.",
        ),
        sourceCapability: "acquisition_performance",
        periodSensitive: true,
        filterSensitive: true,
        questions: [q("أنهي صفحة هبوط بتحوّل أحسن؟", "Which landing page converts best?")],
      },
      {
        id: "acquisition_performance.closed_loop_coverage",
        type: "kpi",
        title: q("تغطية الربط المغلق", "Closed-loop coverage"),
        meaning: q(
          "نسبة الاستحواذ الذي يحمل معرّف حملة ومجموعة وإعلان ومادة ونموذج، ونسبة المطابق منه في CRM.",
          "The share of acquisitions carrying a campaign, ad set, ad, creative and form ID, and the share matched in the CRM.",
        ),
        sourceCapability: "acquisition_performance",
        periodSensitive: true,
        filterSensitive: false,
        questions: [
          q(
            "كام في المية من العملاء مربوطين بالمبيعات؟",
            "What share of leads is linked to sales?",
          ),
        ],
      },
      {
        id: "acquisition_performance.closed_loop_funnel",
        type: "chart",
        title: q("القمع من الإعلان للإيراد", "Ad-to-revenue funnel"),
        meaning: q(
          "الصرف ثم العملاء ثم المطابقون في CRM ثم المهتمون والمؤهلون وعروض الأسعار والفوز والفواتير والإيراد المدفوع.",
          "Spend, leads, CRM-matched, interested, qualified, quotations, wins, invoices and paid revenue.",
        ),
        sourceCapability: "acquisition_performance",
        periodSensitive: true,
        filterSensitive: true,
        questions: [q("فين بنخسر العملاء في القمع؟", "Where do leads drop out of the funnel?")],
      },
      {
        id: "acquisition_performance.asset_table",
        type: "table",
        title: q("أداء الأصول", "Asset performance"),
        meaning: q(
          "الفيديوهات والصور داخل المواد الإعلانية مع نتائج المادة التي تحتويها، كتقارير فقط.",
          "Videos and images inside creatives with the results of the creative that holds them, as reporting only.",
        ),
        sourceCapability: "acquisition_performance",
        periodSensitive: true,
        filterSensitive: true,
        questions: [q("أنهي فيديو في أحسن كريتيف؟", "Which video is in the best creative?")],
      },
      {
        id: "acquisition_performance.lead_quality",
        type: "table",
        title: q("ترتيب جودة العملاء", "Lead quality ranking"),
        meaning: q(
          "المصادر مرتبة بنسبة التأهيل والفوز والإيراد لكل عميل، وليس بأقل تكلفة عميل.",
          "Sources ranked by qualification, win rate and revenue per lead, not by lowest cost per lead.",
        ),
        sourceCapability: "acquisition_performance",
        periodSensitive: true,
        filterSensitive: true,
        questions: [
          q(
            "أنهي كريتيف بيجيب عملاء بيشتروا فعلًا؟",
            "Which creative brings leads who actually buy?",
          ),
        ],
      },
      {
        id: "acquisition_performance.sales_outcomes",
        type: "table",
        title: q("نتائج المبيعات", "Sales outcomes"),
        meaning: q(
          "كل عميل مرتبط بمعرّف دقيق مع مرحلته في CRM والمسؤول وأمر البيع والفاتورة والإيراد المدفوع.",
          "Each exactly linked lead with its CRM stage, salesperson, sale order, invoice and paid revenue.",
        ),
        sourceCapability: "acquisition_performance",
        periodSensitive: true,
        filterSensitive: true,
        questions: [q("مين كسب من عملاء الحملة دي؟", "Who won deals from this campaign's leads?")],
      },
    ],
    suggestedQuestions: [
      q("جالنا كام عميل ورسالة النهارده؟", "How many leads and messages came in today?"),
      q("أنهي كريتيف جاب أعلى إيراد؟", "Which creative brought the most revenue?"),
      q("ليه الإسناد الدقيق صفر؟", "Why is exact attribution zero?"),
    ],
  },
  {
    id: "attribution",
    route: "/attribution",
    title: q("إسناد محادثات واتساب", "Conversation attribution"),
    description: q(
      "يربط محادثات واتساب بدليل الإعلان أو الرابط ونتيجة CRM، ويُظهر غير المعروف كحالة صريحة.",
      "Connects WhatsApp conversations to ad or link evidence and CRM outcomes, with unknown attribution shown explicitly.",
    ),
    tabs: [],
    sections: [
      {
        id: "kpis",
        title: q("مؤشرات الإسناد", "Attribution KPIs"),
        elements: [
          "attribution.conversations",
          "attribution.evidence_attributed",
          "attribution.ctwa",
          "attribution.unknown_rate",
          "attribution.crm_matched",
          "attribution.spend",
          "attribution.cpl",
          "attribution.cpa",
          "attribution.roas",
        ],
      },
    ],
    elements: [
      {
        id: "attribution.conversations",
        type: "kpi",
        title: q("المحادثات", "Conversations"),
        meaning: q(
          "كل محادثات Chatwoot التي دخلت سجل الإسناد في الفترة المختارة.",
          "All Chatwoot conversations recorded by attribution in the selected period.",
        ),
        sourceCapability: "attribution",
        periodSensitive: true,
        filterSensitive: true,
        questions: [q("المحادثات دي جاية منين؟", "Where did these conversations come from?")],
      },
      {
        id: "attribution.evidence_attributed",
        type: "kpi",
        title: q("منسوبة بدليل", "Evidence-attributed"),
        meaning: q(
          "محادثات لها دليل CTWA أو UTM أو توكن تتبع صالح.",
          "Conversations backed by CTWA, UTM, or a valid tracking token.",
        ),
        sourceCapability: "attribution",
        periodSensitive: true,
        filterSensitive: true,
        questions: [q("إيه أنواع الدليل الموجودة؟", "Which evidence types are present?")],
      },
      {
        id: "attribution.ctwa",
        type: "kpi",
        title: q("Click-to-WhatsApp", "Click-to-WhatsApp"),
        meaning: q(
          "محادثات معها إحالة إعلان Meta الأصلية داخل رسالة واتساب.",
          "Conversations carrying Meta's native ad referral inside the WhatsApp message.",
        ),
        sourceCapability: "attribution",
        periodSensitive: true,
        filterSensitive: true,
        questions: [
          q("أنهي حملات CTWA جابت محادثات؟", "Which CTWA campaigns produced conversations?"),
        ],
      },
      {
        id: "attribution.unknown_rate",
        type: "kpi",
        title: q("نسبة غير معروفة", "Unknown rate"),
        meaning: q(
          "نسبة المحادثات التي لم يصل معها دليل كافٍ لإثبات المصدر.",
          "The share of conversations without enough evidence to prove a source.",
        ),
        sourceCapability: "attribution",
        periodSensitive: true,
        filterSensitive: true,
        questions: [q("ليه الإسناد غير معروف؟", "Why is attribution unknown?")],
      },
      {
        id: "attribution.crm_matched",
        type: "kpi",
        title: q("عملاء CRM مطابقون", "CRM matched"),
        meaning: q(
          "محادثات أمكن ربطها بسجل CRM دون نسخ بيانات العميل إلى دليل الإسناد.",
          "Conversations matched to CRM records without copying customer data into attribution evidence.",
        ),
        sourceCapability: "attribution",
        periodSensitive: true,
        filterSensitive: true,
        questions: [q("كام محادثة اتحولت لصفقة؟", "How many conversations became won deals?")],
      },
      {
        id: "attribution.spend",
        type: "kpi",
        title: q("الصرف المطابق", "Matched spend"),
        meaning: q(
          "إنفاق الحملات التي تطابق معرّفها مع دليل المحادثة تطابقًا دقيقًا.",
          "Spend from campaigns whose IDs exactly match conversation evidence.",
        ),
        sourceCapability: "attribution",
        periodSensitive: true,
        filterSensitive: true,
        questions: [
          q("الصرف متغطي على كام محادثة؟", "How many conversations does this spend cover?"),
        ],
      },
      {
        id: "attribution.cpl",
        type: "kpi",
        title: q("تكلفة محادثة واتساب", "Cost per WhatsApp conversation"),
        meaning: q(
          "الصرف المطابق مقسومًا على المحادثات المغطاة بنفس معرّفات الحملات.",
          "Matched spend divided by conversations covered by the same campaign IDs.",
        ),
        sourceCapability: "attribution",
        periodSensitive: true,
        filterSensitive: true,
        questions: [
          q("أنهي حملة أقل تكلفة للمحادثة؟", "Which campaign has the lowest conversation cost?"),
        ],
      },
      {
        id: "attribution.cpa",
        type: "kpi",
        title: q("تكلفة الصفقة", "Cost per acquisition"),
        meaning: q(
          "الصرف المطابق مقسومًا على محادثات CRM المغلقة بنجاح.",
          "Matched spend divided by CRM-won conversations.",
        ),
        sourceCapability: "attribution",
        periodSensitive: true,
        filterSensitive: true,
        questions: [q("أنهي حملة أقل CPA؟", "Which campaign has the lowest CPA?")],
      },
      {
        id: "attribution.roas",
        type: "kpi",
        title: q("ROAS", "ROAS"),
        meaning: q(
          "إيراد محادثات CRM المغطاة مقسومًا على الصرف المطابق فقط.",
          "Revenue from covered CRM conversations divided by matched spend only.",
        ),
        sourceCapability: "attribution",
        periodSensitive: true,
        filterSensitive: true,
        questions: [
          q("العائد ده مبني على تغطية قد إيه؟", "How much coverage supports this return?"),
        ],
      },
    ],
    suggestedQuestions: [
      q(
        "أنهي حملات جابت محادثات واتساب فعلية؟",
        "Which campaigns produced real WhatsApp conversations?",
      ),
      q("كام محادثة لسه مصدرها غير معروف؟", "How many conversations still have an unknown source?"),
      q("إيه المحادثات اللي اتحولت لصفقات؟", "Which conversations became won deals?"),
    ],
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
    suggestedQuestions: [
      q("الأورجانيك جاب كام؟", "How much did organic bring?"),
      q("مين أحسن مصدر أورجانيك؟", "Which organic source is best?"),
    ],
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
