import type { GlobalFilters } from "@/lib/types";
import { contextualQuestions } from "@/lib/nexus-surface-registry";

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
    /** Page-local read parameters. Only the explicit allow-list below travels. */
    parameters?: Record<string, string>;
  };
}): NexusPageContext {
  const { path, language, filters, view } = input;
  const sent: Partial<Record<string, string>> = {};
  for (const key of SENT_FILTERS) {
    const value = filters[key];
    if (typeof value === "string" && value) sent[key] = value;
  }
  // The media-plan month is local page state rather than a global dashboard
  // filter. Without it, changing the month on screen left Nexus reading the
  // current month. Keep this allow-list deliberately narrow.
  for (const key of ["month"] as const) {
    const value = view?.parameters?.[key];
    if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) sent[key] = value;
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
 * The frame version. Bumped when the frame's KEYS change, so an old client and
 * a new agent can recognise each other rather than silently misreading.
 */
export const NEXUS_CONTEXT_VERSION = 2;

/**
 * The structured context frame prepended to the user's message.
 *
 * WHAT IT IS. A bounded, versioned `key=value` list that the agent parses
 * against an allow-list on its own side (the bot's src/lib/page-context.ts).
 * Every value is quoted, so a campaign or a person's name with spaces arrives
 * whole; no value may contain a bracket, because the frame ends at its first
 * one and a value that could close it early is a value that could inject.
 *
 * WHAT IS DELIBERATELY NOT IN IT. No user identity, no email, no session token,
 * no role and no permission claim. Two reasons, and both are absolute: the
 * agent must never treat a browser-supplied role as authorisation, and anything
 * put here ends up in a conversation transcript.
 *
 * `v2` adds the explicit `route`, `entityType` / `entityId` / `entityLabel`
 * triple and the timestamp. `v1` packed the entity as a bare `course="X"`,
 * which the agent still accepts.
 */
export function contextPreamble(context: NexusPageContext): string {
  const parts: string[] = [`v=${NEXUS_CONTEXT_VERSION}`, `page=${context.pageType}`];

  /** Values are quoted and stripped of anything that could close the frame. */
  const put = (key: string, value: string | undefined | null) => {
    if (!value) return;
    const clean = String(value)
      .replace(/[\][\[{}<>\n\r"]/g, " ")
      .trim()
      .slice(0, 120);
    if (!clean) return;
    parts.push(`${key}="${clean}"`);
  };

  put("route", context.path);
  /**
   * The tab, section and focused element travel too.
   *
   * They were added to the context object but never emitted, so "اشرحلي التاب
   * دي" reached the agent with nothing but `page=website` and was answered by
   * describing all three tabs generically. The frame is the only thing the
   * agent sees; a field that is not in it does not exist.
   */
  put("tab", context.view);
  put("section", context.section);
  put("element", context.focusedElementId);

  if (context.entityType && context.entityName) {
    put("entityType", context.entityType);
    put("entityLabel", context.entityName);
    // The id travels so the agent never re-resolves an entity by fuzzy name.
    // It is never rendered — the agent is told so, and its render guard
    // enforces it.
    put("entityId", context.entityId);
  }

  if (context.period?.from || context.period?.to) {
    parts.push(`period=${context.period.from ?? "?"}..${context.period.to ?? "?"}`);
  } else if (context.period?.range) {
    put("period", context.period.range);
  }

  for (const [key, value] of Object.entries(context.filters)) {
    if (key === context.entityType) continue;
    put(key, value);
  }

  parts.push(`ts=${new Date().toISOString()}`);
  return `[dashboard context: ${parts.join(" ")}]`;
}

/**
 * The questions worth offering on this page — from ONE source.
 *
 * WHAT THIS REPLACES. There were two lists of suggestions: a hardcoded map here
 * and `suggestedQuestions` in `nexus-surface-registry.ts`. Two lists drift, and
 * this one had no entry at all for media plan, weekend, year-on-year, media
 * buyers, social or organic — so the pages where a manager most needs a nudge
 * fell through to the same three generic prompts.
 *
 * The registry is now the only source. It already declares what each surface
 * means and which questions belong to it, and it is the same file the panel
 * reads for element-level questions.
 *
 * WHAT THE SELECTION ADDS. A selected entity is substituted into the prompt, so
 * standing on Courses with CFM selected offers "أرتبلك الموظفين اللي باعوا
 * CFM؟" rather than a sentence about "the course". A generic offer is the usual
 * reason a proactive assistant gets dismissed.
 */
export function quickActionsFor(
  pageType: NexusPageType,
  lang: "ar" | "en",
  options: { entityLabel?: string | null; elementId?: string | null } = {},
): Array<{ id: string; label: string; prompt: string }> {
  /** Two page types are aliases of a surface rather than surfaces themselves. */
  const SURFACE_ALIAS: Partial<Record<NexusPageType, string>> = {
    sales: "accounting",
    products: "accounting",
  };
  const surfaceId = SURFACE_ALIAS[pageType] ?? pageType;

  /** An element the user is standing on beats the surface's general list. */
  const questions = contextualQuestions(surfaceId, options.elementId ?? null, lang);

  /**
   * `{entity}` in a registry question is the selected thing, or the page's own
   * generic noun when nothing is selected. A placeholder rather than a regex
   * over Arabic pronouns: "قارنه" and "باعوه" carry the referent as a SUFFIX,
   * and no substitution over those is going to stay correct.
   */
  const GENERIC: Partial<Record<string, { ar: string; en: string }>> = {
    courses: { ar: "الكورس ده", en: "this course" },
    campaigns: { ar: "الحملة دي", en: "this campaign" },
    ads: { ar: "الإعلان ده", en: "this ad" },
    teams: { ar: "الفريق ده", en: "this team" },
    leads: { ar: "المصدر ده", en: "this source" },
    media_plan: { ar: "الخطة دي", en: "this plan" },
  };
  const label =
    options.entityLabel?.trim() || GENERIC[surfaceId]?.[lang] || (lang === "ar" ? "ده" : "this");

  const actions = questions.slice(0, 4).map((question, index) => {
    const prompt = question.replaceAll("{entity}", label);
    return { id: `q${index + 1}`, label: shortLabel(prompt), prompt };
  });

  if (actions.length > 0) return actions;

  /** Only reached by a surface with no questions at all — the guide page. */
  const ar = lang === "ar";
  return [
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
}

/**
 * A chip label from a prompt.
 *
 * A pill is a few words wide. The full question is still what gets SENT — this
 * only decides what fits on the button.
 */
function shortLabel(prompt: string): string {
  const cleaned = prompt
    .replace(/^تحب\s+/, "")
    .replace(/[؟?]\s*$/, "")
    .trim();
  const words = cleaned.split(/\s+/);
  return words.length <= 4 ? cleaned : `${words.slice(0, 4).join(" ")}…`;
}

/**
 * The user's own words, with the context frame removed.
 *
 * The frame is prepended when sending so the agent sees it, but showing it back
 * in the user's own bubble would be noise — they did not type it.
 */
export function stripContext(text: string): string {
  return text.replace(/^\[dashboard context:[^\]]*\]\s*\n?/, "").replace(SELECTION_FRAME_RE, "");
}

/**
 * The frame that carries a selected item's internal id without showing it.
 *
 * Production: the user tapped "PMP + CAPM Recorded + Exam — ONLINE" and their
 * own bubble read "8b2a6699-8558-43b9-b846-72d68db6f162". The button displayed
 * the label and sent the value, and for a native Botpress choice block the
 * value is a productId.
 *
 * Sending the label alone would fix the transcript and lose the identity — the
 * agent would have to re-resolve a product it had already resolved, by fuzzy
 * name match, which is the exact step that gives a wrong-variant price. So the
 * id travels the way the dashboard context already travels: prepended to the
 * text for the agent, stripped from the bubble for the reader.
 */
const SELECTION_FRAME_RE = /^\[selection:[^\]]*\]\s*\n?/;

/**
 * One canonical selection message: readable for the human, exact for the agent.
 *
 * `internalValue` is omitted from the frame when it is the label itself —
 * a plain quick reply like "أيوه" needs no identity frame.
 */
export function selectionMessage(input: {
  displayLabel: string;
  internalValue?: string | null;
}): string {
  const label = input.displayLabel.trim();
  const value = input.internalValue?.trim();
  if (!value || value === label) return label;
  return `[selection: id=${value}]\n${label}`;
}

/** The internal id a selection message carries, if any. */
export function selectionValueOf(text: string): string | null {
  const match = /^\[selection: id=([^\]]*)\]/.exec(text.trim());
  return match ? match[1]?.trim() || null : null;
}
