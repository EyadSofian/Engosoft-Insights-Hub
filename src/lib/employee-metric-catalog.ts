// How every figure on the employee screen is *described* to the person reading
// it. Presentation only — nothing here computes anything.
//
// This screen puts two revenue bases and two conversion rates next to each
// other, and they legitimately disagree. Every question asked about it so far
// has been the same question underneath: "why does this number not match the
// one beside it?" The answer is almost always the date basis, so each entry
// says which date its window hangs on, in the plainest wording available.
//
// The Arabic is deliberately spoken Egyptian rather than فصحى: the readers are
// sales managers, and a card nobody reads explains nothing.

export type EmployeeMetricKey =
  | "target"
  | "achievementPaid"
  | "achievementOrders"
  | "paidCollections"
  | "totalLeads"
  | "conversionAll"
  | "conversionDecided"
  | "bestSelling"
  | "leastSelling"
  | "bestConverting"
  | "needsSupport";

export interface EmployeeMetricCopy {
  label: string;
  formula: string;
  /** What the number answers, in one sentence. */
  what: string;
  /** How it is computed, naming both sides of the fraction. */
  how: string;
  /** Which table it is read from. */
  source: string;
  /** Which date column the window filters on — the usual cause of confusion. */
  dateBasis: string;
  /** When it legitimately shows a dash, so a dash never reads as a bug. */
  whenEmpty: string;
}

export interface EmployeeMetricDefinition {
  key: EmployeeMetricKey;
  ar: EmployeeMetricCopy;
  en: EmployeeMetricCopy;
}

/** Repeated so often that a shared constant keeps the wording identical. */
const PAYMENT_WINDOW_AR = "بتاريخ دفع الفاتورة. يعني الفلوس اللي دخلت في الفترة دي.";
const PAYMENT_WINDOW_EN = "Invoice payment date — money that arrived inside the window.";
const ORDER_WINDOW_AR = "بتاريخ أمر البيع. يعني اللي اتباع في الفترة دي.";
const ORDER_WINDOW_EN = "Sale order date — what was sold inside the window.";
const LEAD_WINDOW_AR = "بتاريخ إنشاء الليد. يعني الليدز اللي دخلت له في الفترة دي.";
const LEAD_WINDOW_EN = "Lead creation date — leads that arrived inside the window.";

export const EMPLOYEE_METRICS: Record<EmployeeMetricKey, EmployeeMetricDefinition> = {
  target: {
    key: "target",
    ar: {
      label: "التارجت",
      formula: "الرقم اللي الإدارة كتباه",
      what: "التارجت المطلوب من الموظف في الشهر ده.",
      how: "مش محسوب من حاجة — ده الرقم المكتوب في ملف تارجت الشهر زي ما هو، كامل. مش بيتقسّم بالأيام لو الشهر لسه في نصه.",
      source: "ملف التارجت الشهري، وأي تعديل اتعمل عليه من زر «تعديل التارجت».",
      dateBasis: "الشهر كله، مش الفترة المختارة.",
      whenEmpty:
        "شرطة يعني مفيش تارجت متحطّ له الشهر ده — زي أجازة الوضع، أو موظفي العمليات اللي بيبيعوا بلا تارجت. شرطة مش صفر.",
    },
    en: {
      label: "Target",
      formula: "As published by management",
      what: "The quota set for this employee this month.",
      how: "Not calculated — it is the number in the monthly target file, whole. It is not scaled down because the month is only half over.",
      source: "The monthly target file, plus any edit made from “Edit targets”.",
      dateBasis: "The whole month, not the selected window.",
      whenEmpty:
        "A dash means no quota was published for him this month — maternity leave, or Operation staff who sell without one. A dash is not a zero.",
    },
  },

  achievementPaid: {
    key: "achievementPaid",
    ar: {
      label: "إنجاز التحصيل",
      formula: "التحصيل المدفوع ÷ التارجت × ١٠٠",
      what: "قد إيه من تارجته دخل فلوس فعلاً.",
      how: "البسط: الفلوس اللي اتحصّلت باسمه في الفترة. المقام: التارجت الكامل للشهر.",
      source: "سطور الفواتير المدفوعة في أودو.",
      dateBasis: PAYMENT_WINDOW_AR + " فممكن تكون فلوس بيعة قديمة اتدفعت دلوقتي.",
      whenEmpty:
        "شرطة لو مفيش تارجت منشور، أو التارجت صفر (زي قائد فريق تارجته على الفريق مش عليه).",
    },
    en: {
      label: "Collections vs target",
      formula: "Paid collections ÷ target × 100",
      what: "How much of his quota has actually been paid.",
      how: "Numerator: money collected on his name in the window. Denominator: the whole monthly quota.",
      source: "Paid invoice lines in Odoo.",
      dateBasis: PAYMENT_WINDOW_EN + " It can be money from a much older sale.",
      whenEmpty:
        "A dash when no quota is published, or the quota is zero (a team leader carrying the team's number rather than a personal one).",
    },
  },

  achievementOrders: {
    key: "achievementOrders",
    ar: {
      label: "إنجاز أوامر البيع",
      formula: "أوامر البيع ÷ التارجت × ١٠٠",
      what: "قد إيه من تارجته باعه فعلاً، بغض النظر عن الفلوس وصلت ولا لأ.",
      how: "البسط: مجموع أوامر البيع المسجّلة باسمه في الفترة. المقام: التارجت الكامل للشهر.",
      source: "سطور أوامر البيع في أودو.",
      dateBasis: ORDER_WINDOW_AR,
      whenEmpty: "شرطة لو مفيش تارجت، أو مفيش أوامر بيع باسمه في الفترة.",
    },
    en: {
      label: "Sale orders vs target",
      formula: "Sale orders ÷ target × 100",
      what: "How much of his quota he has actually sold, whether or not the money has arrived.",
      how: "Numerator: sale orders booked on his name in the window. Denominator: the whole monthly quota.",
      source: "Sale order lines in Odoo.",
      dateBasis: ORDER_WINDOW_EN,
      whenEmpty: "A dash when there is no quota, or no sale orders on his name in the window.",
    },
  },

  paidCollections: {
    key: "paidCollections",
    ar: {
      label: "التحصيل المدفوع",
      formula: "مجموع المحصَّل بالدولار",
      what: "الفلوس اللي دخلت فعلاً على فواتيره في الفترة.",
      how: "بنجمع سطور الفواتير المدفوعة. عدد الفواتير بيتحسب بالفاتورة مش بالسطر — الفاتورة الواحدة ممكن يكون فيها كذا منتج.",
      source: "سطور الفواتير المدفوعة في أودو.",
      dateBasis: PAYMENT_WINDOW_AR,
      whenEmpty: "صفر يعني مفيش أي تحصيل باسمه في الفترة.",
    },
    en: {
      label: "Paid collections",
      formula: "Sum of USD collected",
      what: "Money that actually arrived on his invoices in the window.",
      how: "Paid invoice lines are summed. The invoice count is per invoice, not per line — one invoice can hold several products.",
      source: "Paid invoice lines in Odoo.",
      dateBasis: PAYMENT_WINDOW_EN,
      whenEmpty: "Zero means nothing was collected on his name in the window.",
    },
  },

  totalLeads: {
    key: "totalLeads",
    ar: {
      label: "إجمالي الليدز",
      formula: "عدد الليدز اللي دخلت له",
      what: "كام ليد اتوزّع عليه في الفترة.",
      how: "بنعد ليدز الـCRM النشطة + الأرشيف الخاسر، بعد استبعاد المراحل اللي مش ليدز تجارية.",
      source: "Odoo CRM والأرشيف الخاسر.",
      dateBasis: LEAD_WINDOW_AR,
      whenEmpty: "صفر يعني مفيش ليدز دخلت له في الفترة.",
    },
    en: {
      label: "Total leads",
      formula: "Count of leads routed to him",
      what: "How many leads he received in the window.",
      how: "Active CRM leads plus the lost archive, after excluding stages that are not commercial leads.",
      source: "Odoo CRM and the lost archive.",
      dateBasis: LEAD_WINDOW_EN,
      whenEmpty: "Zero means no leads reached him in the window.",
    },
  },

  conversionAll: {
    key: "conversionAll",
    ar: {
      label: "تحويل كل الليدز",
      formula: "Won ÷ كل الليدز × ١٠٠",
      what: "من كل ١٠٠ ليد دخلت له، كام واحد قفل Won.",
      how: "البسط: عدد اللي بقى Won. المقام: كل الليدز اللي دخلت له، بما فيها اللي لسه شغّال عليها.",
      source: "Odoo CRM.",
      dateBasis: LEAD_WINDOW_AR + " عشان كده الرقم بيبقى واطي في نص الشهر: أغلب الليدز لسه مفتوحة.",
      whenEmpty: "شرطة لو مفيش ليدز خالص.",
    },
    en: {
      label: "Lead conversion",
      formula: "Won ÷ all leads × 100",
      what: "Of every 100 leads he received, how many closed Won.",
      how: "Numerator: leads now Won. Denominator: every lead he received, including the ones still in play.",
      source: "Odoo CRM.",
      dateBasis: LEAD_WINDOW_EN + " That is why it reads low mid-month: most leads are still open.",
      whenEmpty: "A dash when he received no leads at all.",
    },
  },

  conversionDecided: {
    key: "conversionDecided",
    ar: {
      label: "تحويل الحالات المحسومة",
      formula: "Won ÷ (Won + Lost) × ١٠٠",
      what: "من الليدز اللي خلصت فعلاً، كام منها كسبها.",
      how: "الليدز اللي لسه مفتوحة مش داخلة في الحساب أصلاً — لا في البسط ولا في المقام.",
      source: "Odoo CRM والأرشيف الخاسر.",
      dateBasis: LEAD_WINDOW_AR,
      whenEmpty: "شرطة لو مفيش ولا ليد اتحسمت لسه.",
    },
    en: {
      label: "Decided conversion",
      formula: "Won ÷ (Won + Lost) × 100",
      what: "Of the leads that have actually finished, how many he won.",
      how: "Leads still open are excluded from both sides of the fraction.",
      source: "Odoo CRM and the lost archive.",
      dateBasis: LEAD_WINDOW_EN,
      whenEmpty: "A dash until at least one lead has been decided.",
    },
  },

  bestSelling: {
    key: "bestSelling",
    ar: {
      label: "أفضل مبيعات",
      formula: "أعلى كورس في الفلوس المحصَّلة",
      what: "الكورس اللي جاب أكبر فلوس باسمه في الفترة.",
      how: "بنجمع المحصَّل لكل كورس ونجيب الأعلى. النسبة تحته هي نصيب الكورس ده من إجمالي مبيعاته.",
      source: "سطور الفواتير المدفوعة، والكورس متاخد من اسم المنتج.",
      dateBasis: PAYMENT_WINDOW_AR,
      whenEmpty: "شرطة لو مباعش أي حاجة في الفترة.",
    },
    en: {
      label: "Best sales",
      formula: "Highest collected course",
      what: "The course that brought in the most money on his name in the window.",
      how: "Collections are summed per course and the highest is taken. The percentage below is that course's share of his total sales.",
      source: "Paid invoice lines; the course comes from the product name.",
      dateBasis: PAYMENT_WINDOW_EN,
      whenEmpty: "A dash when he sold nothing in the window.",
    },
  },

  leastSelling: {
    key: "leastSelling",
    ar: {
      label: "أقل مبيعات",
      formula: "أقل كورس في الفلوس المحصَّلة",
      what: "أضعف كورس من ناحية الفلوس، من بين الكورسات اللي باع فيها فعلاً.",
      how: "الكورس اللي مباعش فيه ولا مرة مش داخل المقارنة أصلاً — مش منطقي نقارن كورس بصفر بكورس شغّال.",
      source: "سطور الفواتير المدفوعة.",
      dateBasis: PAYMENT_WINDOW_AR,
      whenEmpty: "شرطة لو باع في كورس واحد بس — ساعتها هو الأفضل والأقل في نفس الوقت.",
    },
    en: {
      label: "Lowest sales",
      formula: "Lowest collected course",
      what: "His weakest course by money, among the ones he actually sold.",
      how: "A course he never sold is not in the comparison — comparing a zero against a working course says nothing.",
      source: "Paid invoice lines.",
      dateBasis: PAYMENT_WINDOW_EN,
      whenEmpty: "A dash when he sold only one course — it would be both best and worst.",
    },
  },

  bestConverting: {
    key: "bestConverting",
    ar: {
      label: "أفضل تحويل",
      formula: "أعلى (Won ÷ ليدز الكورس)",
      what: "الكورس اللي بيقفل فيه أحسن من غيره.",
      how: "بنقارن الكورسات اللي بيبيعها بس، وبشرطين: ١٠ ليدز على الأقل، وفيه Won حقيقي واحد على الأقل. من غير الشرط التاني كان ممكن كورس تحويله صفر يطلع «الأفضل».",
      source: "ليدز Odoo CRM.",
      dateBasis: LEAD_WINDOW_AR,
      whenEmpty:
        "شرطة لو لسه مفيش Won في أي كورس من ليدز الفترة، أو مفيش كورس وصل لـ١٠ ليدز. لاحظ إن السطر اللي تحته (الفواتير والفلوس) بتاريخ الدفع مش بتاريخ الليد — عشان كده ممكن تلاقي ٢ Won جنبهم ٧ فواتير: الفواتير دي فلوس دخلت الشهر ده من ليدز أقدم.",
    },
    en: {
      label: "Best conversion",
      formula: "Highest (Won ÷ course leads)",
      what: "The course he closes best.",
      how: "Only courses he sells are compared, and on two conditions: at least 10 leads, and at least one real win. Without the second, a course converting at zero could be announced as his best.",
      source: "Odoo CRM leads.",
      dateBasis: LEAD_WINDOW_EN,
      whenEmpty:
        "A dash when no course has a win yet from this window's leads, or none reached 10 leads. Note the line beneath it (invoices and money) is dated by payment, not by lead — which is why 2 Won can sit beside 7 invoices: that money arrived this month from older leads.",
    },
  },

  needsSupport: {
    key: "needsSupport",
    ar: {
      label: "يحتاج دعم",
      formula: "أقل (Won ÷ ليدز الكورس)",
      what: "الكورس اللي بيضيّع فيه ليدز أكتر من غيره.",
      how: "بنقارن الكورسات اللي بيبيعها بس، وبشرطين: ١٠ ليدز على الأقل، و٥ ليدز على الأقل اتحسمت (Won أو Lost). الليدز اللي لسه مفتوحة مش محسوبة ضده — لسه شغّال عليها.",
      source: "ليدز Odoo CRM والأرشيف الخاسر.",
      dateBasis: LEAD_WINDOW_AR,
      whenEmpty:
        "شرطة لو لسه مفيش كورس اتحسم فيه ٥ ليدز — أقل من كده الرقم بيبقى صدفة مش نتيجة. وكورس مباعش فيه خالص عمره ما هيظهر هنا، لأن ده بيقول إن الليدز اتوزّعت غلط مش إن الموظف ضعيف.",
    },
    en: {
      label: "Needs support",
      formula: "Lowest (Won ÷ course leads)",
      what: "The course where he is losing the most leads.",
      how: "Only courses he sells are compared, and on two conditions: at least 10 leads, and at least 5 settled (Won or Lost). Leads still open are not counted against him — he is still working them.",
      source: "Odoo CRM leads and the lost archive.",
      dateBasis: LEAD_WINDOW_EN,
      whenEmpty:
        "A dash until some course has 5 settled leads — below that the rate is chance, not a result. A course he never sold will never appear here: that would describe misrouted leads, not a weak seller.",
    },
  },
};
