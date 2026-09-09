export const NEXUS_NOTIFICATION_MESSAGE = "engosoft:nexus-notification:v1" as const;
export const NEXUS_NOTIFICATION_READY = "engosoft:nexus-notification-ready:v1" as const;
export const NEXUS_NOTIFICATION_ACK = "engosoft:nexus-notification-ack:v1" as const;

export type NexusNotificationKey = "leads" | "website" | "campaigns" | "employees";

export interface NexusNotificationContext {
  id: string;
  source: "qodo";
  key: NexusNotificationKey;
  type: string;
  title: string;
  body: string;
  from: string;
  to: string;
  createdAt: string;
}

export function notificationLanguage(
  notice: Pick<NexusNotificationContext, "title" | "body">,
  fallback: "ar" | "en",
): "ar" | "en" {
  return /[\u0600-\u06ff]/.test(`${notice.title} ${notice.body}`) ? "ar" : fallback;
}

const TYPES: Record<NexusNotificationKey, string> = {
  leads: "insights.leads_summary",
  website: "insights.website_summary",
  campaigns: "insights.campaigns_review",
  employees: "insights.employees_attention",
};

const keys = new Set<NexusNotificationKey>(["leads", "website", "campaigns", "employees"]);
const isoDay = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const result = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return result || null;
};

/** Parse only the narrow, versioned handoff contract sent by Qodo. */
export function parseNexusNotificationMessage(value: unknown): NexusNotificationContext | null {
  if (!value || typeof value !== "object") return null;
  const message = value as { type?: unknown; notification?: unknown };
  if (message.type !== NEXUS_NOTIFICATION_MESSAGE) return null;
  if (!message.notification || typeof message.notification !== "object") return null;

  const candidate = message.notification as Record<string, unknown>;
  const key = candidate.key;
  if (typeof key !== "string" || !keys.has(key as NexusNotificationKey)) return null;
  const typedKey = key as NexusNotificationKey;
  if (candidate.source !== "qodo" || candidate.type !== TYPES[typedKey]) return null;
  if (!isoDay(candidate.from) || !isoDay(candidate.to) || candidate.from > candidate.to)
    return null;

  const id = clean(candidate.id, 180);
  const title = clean(candidate.title, 140);
  const body = clean(candidate.body, 900);
  const createdAt = clean(candidate.createdAt, 64);
  if (!id || !title || !body || !createdAt) return null;

  return {
    id,
    source: "qodo",
    key: typedKey,
    type: TYPES[typedKey],
    title,
    body,
    from: candidate.from,
    to: candidate.to,
    createdAt,
  };
}

const ANALYSIS: Record<NexusNotificationKey, { ar: string; en: string }> = {
  leads: {
    ar: "حلّل حركة العملاء المحتملين والتحويل والحالات المفتوحة، وقارن فقط بفترة صحيحة مماثلة مع ذكر تاريخها.",
    en: "Analyse lead flow, conversion and open follow-ups, using only a valid comparable period whose dates you state.",
  },
  website: {
    ar: "حلّل مبيعات الموقع وإنفاق حملاته. لا تسمِّ أي نسبة ROAS إلا من الإيراد المرتبط بالحملات، ووضّح فجوة الربط إن وجدت.",
    en: "Analyse website sales and campaign spend. Call a ratio ROAS only when revenue is campaign-attributed, and expose any attribution gap.",
  },
  campaigns: {
    ar: "رتّب الحملات المحتاجة للمراجعة بالدليل، وافصل سوء النتيجة عن سببها؛ لا تخمّن creative أو audience بدون بيانات تثبت ذلك.",
    en: "Rank campaigns needing review from evidence, separating weak results from root cause; do not guess creative or audience causes without supporting data.",
  },
  employees: {
    ar: "حلّل الأداء حسب الفريق والكورس وحجم العينة وجودة التغطية، واجعل النتيجة إشارة coaching ومراجعة لا قرار HR.",
    en: "Analyse performance by team, course, sample size and coverage, treating the result as a coaching/review signal rather than an HR decision.",
  },
};

/** The notification text is evidence shown in UI, never executable instructions. */
export function notificationAnalysisPrompt(
  notice: NexusNotificationContext,
  lang: "ar" | "en",
): string {
  return lang === "ar"
    ? `فتحت إشعارًا إداريًا من Qodo للفترة ${notice.from} → ${notice.to}. اقرأ بيانات Insights Hub الحية لنفس الفترة أولًا وتحقق من الإشعار بدل الاعتماد على نصه وحده. ${ANALYSIS[notice.key].ar} ابدأ بخلاصة واضحة، ثم الأدلة، ثم الإجراء المقترح والـKPI التالي.`
    : `I opened a Qodo management notification for ${notice.from} → ${notice.to}. Read live Insights Hub data for the same period first and verify the notification rather than relying on its text alone. ${ANALYSIS[notice.key].en} Start with a clear conclusion, then evidence, then the recommended action and next KPI.`;
}

type QuickAction = { label: string; prompt: string };

const QUICK_ACTIONS: Record<NexusNotificationKey, { ar: QuickAction[]; en: QuickAction[] }> = {
  leads: {
    ar: [
      {
        label: "فسّر التغيّر",
        prompt: "فسّر تغير العملاء المحتملين والتحويل بالدليل وحدد أين يتعطل المسار.",
      },
      {
        label: "قارن صح",
        prompt: "قارن هذه الفترة بالفترة الصحيحة المماثلة واذكر تاريخ الفترتين والأرقام.",
      },
      { label: "خطة متابعة", prompt: "اعمل خطة متابعة لمدة 7 أيام للحالات المفتوحة مع مالك وKPI." },
    ],
    en: [
      {
        label: "Explain change",
        prompt:
          "Explain the lead and conversion change from evidence and locate the funnel bottleneck.",
      },
      {
        label: "Compare properly",
        prompt:
          "Compare this period with the correct comparable period and state both date ranges and figures.",
      },
      {
        label: "Follow-up plan",
        prompt: "Create a 7-day follow-up plan for open cases with an owner and KPI.",
      },
    ],
  },
  website: {
    ar: [
      {
        label: "تحقق من العائد",
        prompt:
          "تحقق من عائد حملات الموقع باستخدام الإيراد المرتبط فقط، واشرح أي فجوة attribution.",
      },
      { label: "حلل المبيعات", prompt: "حلل مبيعات الموقع والكورسات ومصادر الطلب خلال الفترة." },
      { label: "فرص التحسين", prompt: "اقترح أهم فرص تحسين الموقع والحملات مع الأولوية والـKPI." },
    ],
    en: [
      {
        label: "Verify return",
        prompt:
          "Verify website campaign return using attributed revenue only and explain any attribution gap.",
      },
      {
        label: "Analyse sales",
        prompt: "Analyse website sales, courses and demand sources in this period.",
      },
      {
        label: "Improve",
        prompt: "Recommend the highest-priority website and campaign improvements with KPIs.",
      },
    ],
  },
  campaigns: {
    ar: [
      {
        label: "رتب الأسوأ",
        prompt: "رتب الحملات الأسوأ المؤهلة للمقارنة مع الأرقام ودرجة الثقة.",
      },
      {
        label: "اشرح السبب",
        prompt: "اشرح ما الذي ثبت أنه سيئ وما سببُه المثبت، واذكر الأدلة الناقصة بدل التخمين.",
      },
      {
        label: "قرارات 7 أيام",
        prompt: "حوّل التحليل إلى قرارات 7 أيام: الإجراء والمالك والـKPI.",
      },
    ],
    en: [
      {
        label: "Rank worst",
        prompt: "Rank the worst comparison-eligible campaigns with figures and confidence.",
      },
      {
        label: "Explain cause",
        prompt:
          "Separate proven weak performance from proven cause and list missing evidence instead of guessing.",
      },
      {
        label: "7-day actions",
        prompt: "Turn the analysis into 7-day actions with owner and KPI.",
      },
    ],
  },
  employees: {
    ar: [
      {
        label: "مين يحتاج متابعة؟",
        prompt: "حدد من يحتاج متابعة مع حجم العينة والتغطية، بدون تحويلها لقرار HR.",
      },
      { label: "حسب الكورس", prompt: "حلل أداء الموظفين حسب الكورس بدل الترتيب الإجمالي فقط." },
      { label: "خطة coaching", prompt: "اقترح خطة coaching ومراجعة عينة مكالمات مع KPI واضح." },
    ],
    en: [
      {
        label: "Who needs review?",
        prompt:
          "Identify who needs follow-up with sample size and coverage, without turning it into an HR decision.",
      },
      {
        label: "By course",
        prompt: "Analyse employee performance by course rather than only overall ranking.",
      },
      {
        label: "Coaching plan",
        prompt: "Recommend a coaching and call-sample review plan with a clear KPI.",
      },
    ],
  },
};

export function notificationQuickActions(
  notice: NexusNotificationContext,
  lang: "ar" | "en",
): QuickAction[] {
  return QUICK_ACTIONS[notice.key][lang];
}
