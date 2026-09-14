/** Labels and cells shared by the acquisition sections. */

export type Copy = { en: string; ar: string };

export const ENTITY: Record<string, Copy> = {
  meta_lead: { en: "Meta instant form lead", ar: "عميل Meta Lead Form" },
  chatwoot_conversation: { en: "Chatwoot conversation", ar: "محادثة Chatwoot" },
  landing_submission: { en: "Landing submission", ar: "إرسال صفحة هبوط" },
  landing_visit: { en: "Landing visit", ar: "زيارة صفحة هبوط" },
};

export const DESTINATION: Record<string, Copy> = {
  meta_instant_form: { en: "Meta instant form", ar: "نموذج Meta الفوري" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  messenger: { en: "Messenger", ar: "ماسنجر" },
  instagram_dm: { en: "Instagram DM", ar: "رسائل إنستغرام" },
  website_chat: { en: "Website chat", ar: "دردشة الموقع" },
  landing_page: { en: "Landing page", ar: "صفحة هبوط" },
  unknown: { en: "Unknown", ar: "غير معروف" },
};

export const SOURCE: Record<string, Copy> = {
  meta_instant_form: { en: "Meta instant form", ar: "نموذج Meta الفوري" },
  meta_whatsapp_referral: { en: "Meta ad → WhatsApp", ar: "إعلان Meta ← واتساب" },
  meta_messenger_referral: { en: "Meta ad → Messenger", ar: "إعلان Meta ← ماسنجر" },
  meta_instagram_referral: { en: "Meta ad → Instagram DM", ar: "إعلان Meta ← إنستغرام" },
  landing_page_form: { en: "Landing page form", ar: "نموذج صفحة الهبوط" },
  landing_page_visit: { en: "Landing page visit", ar: "زيارة صفحة الهبوط" },
  website_chat: { en: "Website chat", ar: "دردشة الموقع" },
  direct_or_organic: { en: "Direct or organic", ar: "مباشر أو عضوي" },
  unknown: { en: "Unknown", ar: "غير معروف" },
};

export const PLATFORM: Record<string, Copy> = {
  facebook: { en: "Facebook", ar: "فيسبوك" },
  instagram: { en: "Instagram", ar: "إنستغرام" },
  messenger: { en: "Messenger", ar: "ماسنجر" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  audience_network: { en: "Meta Audience Network", ar: "شبكة جمهور Meta" },
  google: { en: "Google", ar: "جوجل" },
  tiktok: { en: "TikTok", ar: "تيك توك" },
  snapchat: { en: "Snapchat", ar: "سناب شات" },
  website: { en: "Website", ar: "الموقع" },
  direct: { en: "Direct", ar: "مباشر" },
  other: { en: "Other", ar: "أخرى" },
  unknown: { en: "Unknown", ar: "غير معروف" },
};

export function label(map: Record<string, Copy>, key: string, A: boolean): string {
  const copy = map[key];
  return copy ? (A ? copy.ar : copy.en) : key || "—";
}

export function nameWithId(name: string, id: string) {
  if (!name && !id) return "—";
  return (
    <div>
      <div className="text-text">{name || "—"}</div>
      {id ? <div className="font-mono text-[11px] text-text-muted">{id}</div> : null}
    </div>
  );
}
