import type { LeadLifecycleBucket } from "./lead-course-distribution";

const AR_COURSES: Record<string, string> = {
  Arch: "الهندسة المعمارية",
  Auto: "السيارات",
  BIM: "نمذجة معلومات البناء",
  CFM: "إدارة المرافق",
  CMRP: "الصيانة والاعتمادية",
  Certificate: "الشهادات المهنية",
  Deliveries: "خدمات التوصيل",
  Elec: "الهندسة الكهربائية",
  English: "اللغة الإنجليزية",
  Infra: "البنية التحتية",
  Interior: "التصميم الداخلي",
  Marketing: "التسويق",
  Mech: "الهندسة الميكانيكية",
  Other: "أخرى",
  PMP: "إدارة المشاريع",
  Private: "البرامج الخاصة",
  Safety: "السلامة",
  Steel: "المنشآت المعدنية",
  Struc: "الهندسة الإنشائية",
  Tech: "التقنية",
  Web: "الموقع الإلكتروني",
  civil: "الهندسة المدنية",
  "غير محدد": "دورة غير محددة",
};

const AR_SPECIALTIES: Record<string, string> = {
  Architecture: "الهندسة المعمارية",
  Automotive: "السيارات",
  BIM: "نمذجة معلومات البناء",
  "Civil / infrastructure": "البنية التحتية",
  "Civil / structure": "الهندسة الإنشائية",
  Electrical: "الكهرباء",
  "Facility management": "إدارة المرافق",
  Interior: "التصميم الداخلي",
  Maintenance: "الصيانة",
  Management: "الإدارة",
  Mechanical: "الميكانيكا",
  Other: "أخرى",
  Safety: "السلامة",
  "تحتاج مراجعة": "تحتاج مراجعة",
};

const AR_STAGES: Record<string, string> = {
  Archived: "مؤرشف",
  "Long Follow Up": "متابعة طويلة",
  Lost: "مفقود",
  "Lost / خسارة": "مفقود",
  New: "جديد",
  "New / جديد": "جديد",
  Open: "مفتوح",
  "Open / مفتوح": "مفتوح",
  Preparation: "تجهيز",
  "Quotation Sent": "أُرسل عرض السعر",
  "Unspecified stage": "مرحلة غير محددة",
  Won: "مغلق بنجاح",
  "Won / ربح": "مغلق بنجاح",
};

const EN_STAGES: Record<string, string> = {
  "Lost / خسارة": "Lost",
  "New / جديد": "New",
  "Open / مفتوح": "Open",
  "Won / ربح": "Won",
};

export function courseDisplayName(value: string, arabic: boolean): string {
  if (arabic) return AR_COURSES[value] ?? value;
  return value === "غير محدد" ? "Unspecified course" : value;
}

export function specialtyDisplayName(value: string, arabic: boolean): string {
  if (arabic) return AR_SPECIALTIES[value] ?? value;
  return value === "تحتاج مراجعة" ? "Needs review" : value;
}

export function stageDisplayName(value: string, arabic: boolean): string {
  return arabic ? (AR_STAGES[value] ?? value) : (EN_STAGES[value] ?? value);
}

export function lifecycleDisplayName(bucket: LeadLifecycleBucket, arabic: boolean): string {
  const labels: Record<LeadLifecycleBucket, { ar: string; en: string }> = {
    lead_active: { ar: "عملاء محتملون نشطون", en: "Active leads" },
    lead_lost: { ar: "عملاء محتملون مفقودون", en: "Lost leads" },
    lead_other: { ar: "عملاء محتملون مؤرشفون", en: "Archived leads" },
    opportunity: { ar: "فرص بيعية", en: "Opportunities" },
  };
  return labels[bucket][arabic ? "ar" : "en"];
}

export function recordTypeDisplayName(value: string, arabic: boolean): string {
  if (value === "lead") return arabic ? "عميل محتمل" : "Lead";
  return arabic ? "فرصة بيعية" : "Opportunity";
}

export function groupDisplayName(
  value: string,
  dimension: "course" | "specialty",
  arabic: boolean,
): string {
  return dimension === "course"
    ? courseDisplayName(value, arabic)
    : specialtyDisplayName(value, arabic);
}
