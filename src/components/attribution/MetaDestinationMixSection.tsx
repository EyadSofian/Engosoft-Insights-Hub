import { BarChart3 } from "lucide-react";
import { DataTable, type Col } from "@/components/DataTable";
import { PageSection } from "@/components/dashboard-bits";
import { Card, Pill } from "@/components/ui-bits";
import { fmtNum, fmtUSD, useI18n } from "@/lib/i18n";
import { useApi } from "@/lib/use-api";
import type {
  CoverageRow,
  DestinationType,
  IngestionStatus,
  ResultKey,
} from "@/lib/meta-destination-mix";

/**
 * Meta's own aggregate reporting, grouped by where each ad converts. It sits
 * apart from conversation attribution on purpose: none of these figures is an
 * individual Chatwoot conversation, and none is ever added to those counts.
 */

interface MetaDestinationMixResponse {
  configured: boolean;
  ok: boolean;
  period: { from: string | null; to: string | null; preset: string | null };
  fetchedAt: string;
  deliveredAds: number;
  classifiedAds: number;
  unclassifiedAds: number;
  unclassifiedSpendByCurrency: Record<string, number>;
  campaigns: number;
  spendByCurrency: Record<string, number>;
  matrix: CoverageRow[];
  errors: string[];
}

type Copy = { en: string; ar: string };

const TYPE_COPY: Record<DestinationType, { label: Copy; hint: Copy }> = {
  MESSAGING: {
    label: { en: "Messaging", ar: "المراسلة" },
    hint: { en: "WhatsApp, Messenger, Instagram DM", ar: "واتساب وماسنجر ورسائل إنستغرام" },
  },
  WEBSITE_LANDING: {
    label: { en: "Website landing", ar: "صفحة موقع" },
    hint: { en: "External website or Odoo page", ar: "موقع خارجي أو صفحة Odoo" },
  },
  META_INSTANT_FORM: {
    label: { en: "Meta instant form", ar: "نموذج Meta الفوري" },
    hint: {
      en: "Native Facebook / Instagram lead form",
      ar: "نموذج عملاء داخل فيسبوك أو إنستغرام",
    },
  },
  CALL: {
    label: { en: "Call", ar: "مكالمة" },
    hint: { en: "Call ads", ar: "إعلانات الاتصال" },
  },
  OTHER: {
    label: { en: "Other", ar: "أخرى" },
    hint: { en: "Engagement and profile visits", ar: "التفاعل وزيارات الملف" },
  },
};

const RESULT_COPY: Record<ResultKey, Copy> = {
  instantFormLeads: { en: "instant-form leads", ar: "عملاء النموذج الفوري" },
  messagingConversationsStarted: {
    en: "messaging conversations started",
    ar: "محادثات مراسلة بدأت",
  },
  pixelLeads: { en: "pixel leads", ar: "عملاء البكسل" },
  landingPageViews: { en: "landing page views", ar: "مشاهدات صفحة الهبوط" },
  callsPlaced: { en: "calls placed", ar: "مكالمات" },
};

const INGESTION_COPY: Record<DestinationType, { system: Copy; gap: Copy }> = {
  MESSAGING: {
    system: { en: "Meta message listener + Chatwoot", ar: "مستقبل رسائل Meta + Chatwoot" },
    gap: {
      en: "Listener subscribed, but no real Meta delivery observed yet. Messenger and Instagram DM are not subscribed.",
      ar: "المستقبل مشترك، لكن لم يصل أي تسليم حقيقي من Meta بعد. ماسنجر ورسائل إنستغرام غير مشتركين.",
    },
  },
  WEBSITE_LANDING: {
    system: { en: "Landing attribution collector", ar: "مجمّع إسناد صفحات الهبوط" },
    gap: {
      en: "Live on the Odoo CFM page only. Shop, product and training-package pages are not instrumented.",
      ar: "يعمل على صفحة CFM في Odoo فقط. صفحات المتجر والمنتجات والمسارات التدريبية غير مُتتبعة.",
    },
  },
  META_INSTANT_FORM: {
    system: { en: "None", ar: "لا يوجد" },
    gap: {
      en: "No native Lead Ads ingestion. See docs/meta-lead-ads-ingestion-proposal.md.",
      ar: "لا يوجد استيراد أصلي لإعلانات العملاء. راجع docs/meta-lead-ads-ingestion-proposal.md.",
    },
  },
  CALL: {
    system: { en: "None", ar: "لا يوجد" },
    gap: { en: "No call ingestion.", ar: "لا يوجد استيراد للمكالمات." },
  },
  OTHER: {
    system: { en: "—", ar: "—" },
    gap: { en: "Not a conversion path.", ar: "ليس مسار تحويل." },
  },
};

const INGESTION_PILL: Record<
  IngestionStatus,
  { tone: "warning" | "danger" | "neutral"; label: Copy }
> = {
  partial: { tone: "warning", label: { en: "Partial", ar: "جزئي" } },
  missing: { tone: "danger", label: { en: "Missing", ar: "غير موجود" } },
  not_applicable: { tone: "neutral", label: { en: "Not applicable", ar: "لا ينطبق" } },
};

function spendText(spend: Record<string, number>): string {
  const entries = Object.entries(spend).filter(([, value]) => value > 0);
  if (!entries.length) return "—";
  return entries
    .map(([currency, value]) =>
      currency === "USD" ? fmtUSD(value) : `${fmtNum(value)} ${currency}`,
    )
    .join(" · ");
}

export function MetaDestinationMixSection() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const t = (copy: Copy) => (A ? copy.ar : copy.en);
  const mix = useApi<MetaDestinationMixResponse>("/api/meta-destination-mix");
  const data = mix.data;
  const period =
    data?.period.from && data.period.to
      ? `${data.period.from} — ${data.period.to}`
      : A
        ? "آخر 90 يومًا"
        : "Last 90 days";

  const cols: Col<CoverageRow>[] = [
    {
      key: "type",
      header: A ? "نوع الوجهة" : "Destination type",
      always: true,
      sticky: true,
      sortValue: (row) => row.type,
      render: (row) => (
        <div>
          <div className="font-semibold text-text">{t(TYPE_COPY[row.type].label)}</div>
          <div className="mt-0.5 text-[11px] text-text-muted">
            {Object.keys(row.messagingDestinations).length
              ? Object.entries(row.messagingDestinations)
                  .map(([name, ads]) => `${name} (${fmtNum(ads)})`)
                  .join(" · ")
              : t(TYPE_COPY[row.type].hint)}
          </div>
        </div>
      ),
    },
    {
      key: "campaigns",
      header: A ? "الحملات" : "Campaigns",
      align: "right",
      render: (row) => fmtNum(row.campaigns),
      sortValue: (row) => row.campaigns,
    },
    {
      key: "ads",
      header: A ? "الإعلانات" : "Ads",
      align: "right",
      render: (row) => (
        <div>
          <div>{fmtNum(row.ads)}</div>
          {row.mixedDestinationAds > 0 ? (
            <div className="text-[11px] text-text-muted">
              {fmtNum(row.mixedDestinationAds)}{" "}
              {A ? "مختلطة (موقع + نموذج)" : "mixed website + form"}
            </div>
          ) : null}
        </div>
      ),
      sortValue: (row) => row.ads,
    },
    {
      key: "spend",
      header: A ? "صرف Meta" : "Meta spend",
      align: "right",
      render: (row) => spendText(row.spendByCurrency),
      sortValue: (row) => row.spendByCurrency.USD ?? 0,
    },
    {
      key: "result",
      header: A ? "نتيجة Meta الأساسية" : "Meta-reported result",
      align: "right",
      render: (row) =>
        row.primaryResult ? (
          <div>
            <div>{fmtNum(row.results[row.primaryResult])}</div>
            <div className="text-[11px] text-text-muted">{t(RESULT_COPY[row.primaryResult])}</div>
          </div>
        ) : (
          "—"
        ),
      sortValue: (row) => (row.primaryResult ? row.results[row.primaryResult] : -1),
    },
    {
      key: "other",
      header: A ? "نتائج Meta أخرى" : "Other Meta-reported results",
      render: (row) => {
        const others = (Object.entries(row.results) as [ResultKey, number][]).filter(
          ([key, value]) => key !== row.primaryResult && value > 0,
        );
        return others.length ? (
          <div className="space-y-0.5 text-[11px] text-text-muted">
            {others.map(([key, value]) => (
              <div key={key}>
                {fmtNum(value)} {t(RESULT_COPY[key])}
              </div>
            ))}
          </div>
        ) : (
          "—"
        );
      },
    },
    {
      key: "ingestion",
      header: A ? "استيراد Engosoft" : "Engosoft ingestion",
      render: (row) => (
        <div className="space-y-1">
          <Pill tone={INGESTION_PILL[row.ingestion].tone}>
            {t(INGESTION_PILL[row.ingestion].label)}
          </Pill>
          <div className="text-[11px] text-text-muted">{t(INGESTION_COPY[row.type].system)}</div>
        </div>
      ),
      sortValue: (row) => row.ingestion,
    },
    {
      key: "gap",
      header: A ? "الناقص" : "Missing ingestion",
      render: (row) => (
        <div className="max-w-xs text-[11px] leading-relaxed text-text-muted">
          {t(INGESTION_COPY[row.type].gap)}
        </div>
      ),
    },
  ];

  return (
    <PageSection
      title={
        A
          ? "نتائج منصة Meta حسب الوجهة (إجمالية)"
          : "Meta platform results by destination (aggregate)"
      }
      icon={<BarChart3 size={16} />}
      tone="amber"
      hint={
        A
          ? "أرقام يُبلغ عنها Meta لكل إعلان، وليست محادثات Chatwoot فردية."
          : "Figures Meta reports per ad. They are not individual Chatwoot conversations."
      }
    >
      <div className="space-y-3">
        <Card padded className="space-y-2 text-xs leading-relaxed text-text-muted">
          <div className="flex flex-wrap gap-2">
            <Pill tone="warning">{A ? "تقارير Meta الإجمالية" : "Meta-reported aggregate"}</Pill>
            <Pill>{A ? "ليست إسناد محادثات" : "Not conversation attribution"}</Pill>
          </div>
          <p>
            {A
              ? "كل إعلان صُنّف في وجهة واحدة حسب مكان التحويل الفعلي. هذه الأرقام لا تُضاف أبدًا إلى أرقام المحادثات أعلاه، ولا تُستخدم لإسناد أي محادثة بعينها."
              : "Each ad is classified into one destination by where it actually converts. These figures are never added to the conversation figures above and are never used to attribute any individual conversation."}
          </p>
        </Card>
        <DataTable
          rows={data?.matrix || []}
          cols={cols}
          loading={mix.isLoading}
          searchable={(row) => `${row.type} ${t(TYPE_COPY[row.type].label)} ${row.ingestion}`}
          rowKey={(row) => row.type}
          csvFilename="engosoft-meta-destination-mix.csv"
        />
        <p className="text-[11px] leading-relaxed text-text-muted">
          {mix.isError
            ? A
              ? "تعذّر تحميل تقارير Meta الإجمالية."
              : "Meta's aggregate reporting could not be loaded."
            : data && !data.configured
              ? A
                ? "توكن Meta غير مهيأ على الخادم."
                : "The Meta token is not configured on the server."
              : data
                ? `${period} · ${fmtNum(data.campaigns)} ${A ? "حملة" : "campaigns"} · ${fmtNum(data.classifiedAds)} ${A ? "إعلان مصنّف" : "classified ads"}${
                    data.unclassifiedAds
                      ? ` · ${fmtNum(data.unclassifiedAds)} ${A ? "غير مصنّف" : "unclassified"} (${spendText(data.unclassifiedSpendByCurrency)})`
                      : ""
                  }${data.errors.length ? ` · ${fmtNum(data.errors.length)} ${A ? "تنبيه جلب" : "fetch warnings"}` : ""}`
                : ""}
        </p>
      </div>
    </PageSection>
  );
}
