import type { GlobalFilters } from "@/lib/types";

/**
 * The page context ENGO Nexus receives with every message.
 *
 * WHY THIS EXISTS
 *
 * A manager standing on the campaigns page and typing "حلل الصفحة دي" is asking
 * about something the words do not name. Without context the agent has to ask
 * "which campaign, which period?", which is a round trip the screen already
 * answers.
 *
 * WHAT IS DELIBERATELY NOT SENT
 *
 * No user identity, no email, no session token, no auth claim. Two reasons:
 * the agent must never treat a browser-supplied role as authorisation, and
 * anything sent here ends up in a conversation transcript. Only the filters and
 * the route — both already visible on screen to whoever is typing — travel.
 *
 * Pure: no React, no DOM reads beyond what the caller passes in.
 */

export type NexusPageType =
  | "overview"
  | "campaigns"
  | "ads"
  | "courses"
  | "sales"
  | "teams"
  | "leads"
  | "lost"
  | "accounting"
  | "products"
  | "media_buyers"
  | "website"
  | "yoy"
  /**
   * Added after an audit found five visible routes resolving to "other".
   *
   * Nexus could not tell which page the user was standing on for Pricing,
   * Weekend, Media Plan, Social Media or Organic — so "حلل الصفحة دي" had
   * nothing to resolve against. Every navigation route now has a type, and a
   * test fails the build if a new one does not.
   */
  | "pricing"
  | "weekend"
  | "media_plan"
  | "social_media"
  | "organic"
  | "guide"
  | "other";

export interface NexusPageContext {
  path: string;
  pageType: NexusPageType;
  language: "ar" | "en";
  /** Only filters that are actually set — an empty object when none are. */
  filters: Partial<Record<string, string>>;
  /**
   * The internal view the page is showing.
   *
   * Four pages switch analytical views without changing the pathname —
   * Website (owner/campaigns/operations), Accounting
   * (summary/months/profitability), Courses (campaigns/alerts/all) and Lost
   * (team/course). Without this, "حلل التاب دي" has nothing to resolve.
   */
  view?: string;
  /** The section in view, when the page declares one. */
  section?: string;
  /** The element the user last interacted with — the referent for "الرقم ده". */
  focusedElementId?: string;
  entityType?: "campaign" | "adset" | "ad" | "course" | "team" | "salesperson" | "source";
  entityId?: string;
  entityName?: string;
  market?: string;
  period?: { from?: string; to?: string; range?: string };
}

/** Route path → the page's analytical subject. */
export function pageTypeFor(path: string): NexusPageType {
  const normalized = (path || "/").toLowerCase().replace(/\/+$/, "") || "/";
  if (normalized === "/") return "overview";
  const first = normalized.split("/")[1] ?? "";
  const map: Record<string, NexusPageType> = {
    campaigns: "campaigns",
    ads: "ads",
    courses: "courses",
    sales: "sales",
    teams: "teams",
    leads: "leads",
    lost: "lost",
    accounting: "accounting",
    products: "products",
    "media-buyers": "media_buyers",
    website: "website",
    yoy: "yoy",
    pricing: "pricing",
    weekend: "weekend",
    "media-plan": "media_plan",
    "social-media": "social_media",
    organic: "organic",
    guide: "guide",
    // Legacy bookmarks that redirect into Accounting.
    "full-invoiced": "accounting",
  };
  return map[first] ?? "other";
}

/**
 * The most specific thing the user is currently looking at.
 *
 * Order matters: an ad is more specific than its ad set, which is more specific
 * than its campaign. Picking the broadest match would attach the wrong subject
 * to a drilled-down view.
 */
export function entityFor(
  filters: GlobalFilters,
): Pick<NexusPageContext, "entityType" | "entityId" | "entityName"> {
  if (filters.ad)
    return { entityType: "ad", entityId: filters.adKey ?? filters.ad, entityName: filters.ad };
  if (filters.adset)
    return {
      entityType: "adset",
      entityId: filters.adsetKey ?? filters.adset,
      entityName: filters.adset,
    };
  if (filters.campaign)
    return {
      entityType: "campaign",
      entityId: filters.campaignKey ?? filters.campaign,
      entityName: filters.campaign,
    };
  if (filters.course)
    return { entityType: "course", entityId: filters.course, entityName: filters.course };
  if (filters.salesperson)
    return {
      entityType: "salesperson",
      entityId: filters.salesperson,
      entityName: filters.salesperson,
    };
  if (filters.salesTeam)
    return { entityType: "team", entityId: filters.salesTeam, entityName: filters.salesTeam };
  if (filters.source)
    return { entityType: "source", entityId: filters.source, entityName: filters.source };
  return {};
}

/** Filter keys worth sending. FX rates and internal view toggles are noise. */
const SENT_FILTERS = [
  "company",
  "platform",
  "account",
  "campaign",
  "adset",
  "ad",
  "source",
  "course",
  "mainCategory",
  "salesTeam",
  "salesperson",
  "dateBasis",
  "cpaBasis",
  "includeNonLead",
] as const;

export function buildPageContext(input: {
  path: string;
  language: "ar" | "en";
  filters: GlobalFilters;
  /**
   * What the page itself declared: the open tab, the section in view, the
   * element the user last touched, the entity they selected.
   *
   * A pathname cannot carry any of it, and it is what "التاب دي" and "الرقم
   * ده" actually refer to.
   */
  view?: {
    tab?: string | null;
    section?: string | null;
    focusedElementId?: string | null;
    selectedEntity?: { type: string; id?: string; name?: string } | null;
  };
}): NexusPageContext {
  const { path, language, filters, view } = input;
  const sent: Partial<Record<string, string>> = {};
  for (const key of SENT_FILTERS) {
    const value = filters[key];
    if (typeof value === "string" && value) sent[key] = value;
  }

  return {
    path,
    pageType: pageTypeFor(path),
    language,
    filters: sent,
    ...(view?.tab ? { view: view.tab } : {}),
    ...(view?.section ? { section: view.section } : {}),
    ...(view?.focusedElementId ? { focusedElementId: view.focusedElementId } : {}),
    ...(view?.selectedEntity?.name
      ? {
          entityType: view.selectedEntity.type as NexusPageContext["entityType"],
          entityName: view.selectedEntity.name,
          entityId: view.selectedEntity.id,
        }
      : {}),
    ...entityFor(filters),
    market: filters.company,
    period:
      filters.from || filters.to || filters.range
        ? { from: filters.from, to: filters.to, range: filters.range }
        : undefined,
  };
}

/**
 * A compact, human-readable context line prepended to the user's message.
 *
 * Prose rather than JSON on purpose: it costs fewer tokens, and it reads
 * correctly if it ever surfaces in a transcript a person reviews. It is marked
 * as context so the agent treats it as a frame, not as the question.
 */
export function contextPreamble(context: NexusPageContext): string {
  const parts: string[] = [`page=${context.pageType}`];
  /**
   * The tab, section and focused element travel too.
   *
   * They were added to the context object but never emitted here, so "اشرحلي
   * التاب دي" reached the agent with nothing but `page=website` and was
   * answered by describing all three tabs generically. The frame is the only
   * thing the agent sees; a field that is not in it does not exist.
   */
  if (context.view) parts.push(`tab=${context.view}`);
  if (context.section) parts.push(`section=${context.section}`);
  if (context.focusedElementId) parts.push(`element=${context.focusedElementId}`);
  if (context.entityType && context.entityName) {
    parts.push(`${context.entityType}="${context.entityName}"`);
  }
  if (context.period?.from || context.period?.to) {
    parts.push(`period=${context.period.from ?? "?"}..${context.period.to ?? "?"}`);
  } else if (context.period?.range) {
    parts.push(`period=${context.period.range}`);
  }
  for (const [key, value] of Object.entries(context.filters)) {
    if (key === context.entityType) continue;
    parts.push(`${key}=${value}`);
  }
  return `[dashboard context: ${parts.join(" ")}]`;
}

/**
 * Page-specific quick actions for the proactive popup and the welcome state.
 * These are prompts a user on THIS page plausibly wants; a generic list would
 * be ignored, which is the usual fate of a proactive assistant.
 */
export function quickActionsFor(
  pageType: NexusPageType,
  lang: "ar" | "en",
): Array<{ id: string; label: string; prompt: string }> {
  const ar = lang === "ar";
  const byPage: Partial<
    Record<NexusPageType, Array<{ id: string; label: string; prompt: string }>>
  > = {
    campaigns: [
      {
        id: "analyse",
        label: ar ? "حلل الحملات" : "Analyse campaigns",
        prompt: ar
          ? "حلل أداء الحملات في الفترة دي"
          : "Analyse campaign performance for this period",
      },
      {
        id: "roas",
        label: ar ? "أعلى ROAS" : "Best ROAS",
        prompt: ar ? "أنهي حملة عندها أعلى ROAS؟" : "Which campaign has the highest ROAS?",
      },
      {
        id: "problem",
        label: ar ? "فين المشكلة؟" : "Where is the problem?",
        prompt: ar
          ? "فين المشكلة في الحملات دلوقتي؟"
          : "Where is the problem in the campaigns right now?",
      },
    ],
    ads: [
      {
        id: "creative",
        label: ar ? "الكرياتيف" : "Creative",
        prompt: ar ? "في كرياتيف بايظ ولا لأ؟" : "Is any creative fatiguing?",
      },
      {
        id: "cpl",
        label: "CPL",
        prompt: ar ? "CPL بتاع الإعلانات دي كويس؟" : "Is the CPL for these ads good?",
      },
    ],
    sales: [
      {
        id: "team",
        label: ar ? "أداء الفريق" : "Team performance",
        prompt: ar ? "حلل أداء فريق المبيعات" : "Analyse the sales team's performance",
      },
      {
        id: "conversion",
        label: "Conversion",
        prompt: ar ? "ليه الـ conversion قل؟" : "Why did conversion drop?",
      },
      {
        id: "lost",
        label: "Lost leads",
        prompt: ar ? "إيه أسباب خسارة الليدات؟" : "What are the lead loss reasons?",
      },
    ],
    teams: [
      {
        id: "team",
        label: ar ? "أداء الفريق" : "Team performance",
        prompt: ar ? "حلل أداء الفرق" : "Analyse team performance",
      },
      {
        id: "followup",
        label: ar ? "المتابعة" : "Follow-up",
        prompt: ar ? "المتابعة كويسة ولا في مشكلة؟" : "Is follow-up coverage healthy?",
      },
    ],
    lost: [
      {
        id: "reasons",
        label: ar ? "أسباب الخسارة" : "Loss reasons",
        prompt: ar ? "حلل أسباب خسارة الليدات" : "Analyse the lead loss reasons",
      },
    ],
    courses: [
      {
        id: "analyse",
        label: ar ? "حلل الكورس" : "Analyse course",
        prompt: ar ? "حلل أداء الكورس ده" : "Analyse this course's performance",
      },
      {
        id: "revenue",
        label: ar ? "الإيرادات" : "Revenue",
        prompt: ar ? "الكورس ده عمل كام إيراد؟" : "How much revenue did this course make?",
      },
      {
        id: "price",
        label: ar ? "السعر الحالي" : "Current price",
        prompt: ar ? "السعر الحالي للكورس ده كام؟" : "What is this course's current price?",
      },
    ],
    products: [
      {
        id: "price",
        label: ar ? "أسعار الكورسات" : "Course prices",
        prompt: ar ? "أسعار الكورسات الحالية إيه؟" : "What are the current course prices?",
      },
    ],
    accounting: [
      {
        id: "revenue",
        label: ar ? "الإيرادات" : "Revenue",
        prompt: ar ? "كام الإيرادات الشهر ده؟" : "What is revenue this month?",
      },
    ],
  };

  const general = [
    {
      id: "performance",
      label: ar ? "حلل الأداء" : "Analyse performance",
      prompt: ar ? "حلل أداء الشركة الفترة دي" : "Analyse company performance for this period",
    },
    {
      id: "sales",
      label: ar ? "شوف المبيعات" : "See sales",
      prompt: ar ? "إيه أخبار المبيعات؟" : "How are sales doing?",
    },
    {
      id: "prices",
      label: ar ? "أسعار الكورسات" : "Course prices",
      prompt: ar ? "أسعار الكورسات الحالية إيه؟" : "What are the current course prices?",
    },
  ];

  return byPage[pageType] ?? general;
}

/**
 * The user's own words, with the context frame removed.
 *
 * The frame is prepended when sending so the agent sees it, but showing it back
 * in the user's own bubble would be noise — they did not type it.
 */
export function stripContext(text: string): string {
  return text.replace(/^\[dashboard context:[^\]]*\]\s*\n?/, "");
}
