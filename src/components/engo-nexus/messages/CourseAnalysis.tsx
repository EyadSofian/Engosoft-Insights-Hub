import { useState } from "react";
import type { CourseAnalysisMessage } from "../lib/nexus-message-schema";
import {
  presentationMode,
  filterRows,
  TOP_CARDS_IN_TABLE_MODE,
  type VerdictFilter,
} from "../lib/nexus-layout";
import { MetricGrid } from "./MetricGrid";
import { CampaignCard } from "./CampaignCard";
import { CampaignCarousel } from "./CampaignCarousel";
import { CampaignTable } from "./CampaignTable";
import { ProductVariantCard, ProductCarousel, ProductTable } from "./ProductVariantCard";
import { RecommendationCard } from "./RecommendationCard";
import { QuickActions } from "./QuickActions";
import { ExpandableSection } from "./ExpandableSection";
import { SourceBadges } from "./SourceBadges";
import { LtrText } from "./LtrText";

const L = {
  ar: {
    campaigns: "أفضل الحملات",
    products: "أكثر المنتجات مبيعًا",
    showAll: (n: number) => `عرض كل الحملات (${n})`,
    hide: "إخفاء القائمة",
    allProducts: (n: number) => `عرض كل المنتجات (${n})`,
    best: "الأفضل",
    worst: "الأضعف",
    all: "الكل",
  },
  en: {
    campaigns: "Top campaigns",
    products: "Best sellers",
    showAll: (n: number) => `Show all campaigns (${n})`,
    hide: "Hide list",
    allProducts: (n: number) => `Show all products (${n})`,
    best: "Best",
    worst: "Weakest",
    all: "All",
  },
} as const;

/**
 * A course analysis, assembled from typed data.
 *
 * THE LAYOUT IS A FUNCTION OF COUNT, NOT OF THE MODEL'S PROSE. `presentationMode`
 * decides cards / carousel / table from `campaigns.length`, so seventeen
 * campaigns can never render as seventeen stacked cards no matter how the answer
 * was worded. Every interaction below — expanding, filtering, sorting, paging —
 * is local state over data already delivered; none of it calls the model.
 *
 * Nothing here interpolates an object into a string. Each field is chosen by a
 * component that knows its type, which is what ended "[object Object]".
 */
export function CourseAnalysis({
  message,
  lang,
  onSend,
  disabled,
}: {
  message: CourseAnalysisMessage;
  lang: "ar" | "en";
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const t = L[lang];
  const [filter, setFilter] = useState<VerdictFilter>("all");
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);

  const campaignMode = presentationMode(message.campaigns.length);
  const productMode = presentationMode(message.products.length);
  const filtered = filterRows(message.campaigns, filter);

  return (
    <div className="space-y-3" data-testid="nexus-course-analysis">
      <header>
        <h3 className="text-sm font-semibold text-text">
          <LtrText>{message.course}</LtrText>
          {message.period?.label ? (
            <span className="font-normal text-text-muted"> — {message.period.label}</span>
          ) : null}
        </h3>
      </header>

      {message.summary.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface p-3">
          <MetricGrid metrics={message.summary.slice(0, 4)} lang={lang} columns={2} />
          {message.summary.length > 4 ? (
            <ExpandableSection
              label={lang === "ar" ? "عرض التفاصيل" : "Show details"}
              openLabel={lang === "ar" ? "إخفاء التفاصيل" : "Hide details"}
              testId="nexus-summary-details"
            >
              <MetricGrid metrics={message.summary.slice(4)} lang={lang} columns={2} />
            </ExpandableSection>
          ) : null}
        </section>
      ) : null}

      {message.campaigns.length > 0 ? (
        <section>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {t.campaigns}
            </h4>
            {message.campaigns.length > 3 ? (
              <div className="flex gap-1" data-testid="nexus-campaign-filters">
                {(
                  [
                    ["all", t.all],
                    ["best", t.best],
                    ["worst", t.worst],
                  ] as Array<[VerdictFilter, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={`rounded border px-1.5 py-0.5 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      filter === value
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-text-muted hover:bg-surface-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {campaignMode === "cards" || filter !== "all" ? (
            <div className="space-y-2">
              {filtered.map((campaign) => (
                <CampaignCard
                  key={campaign.key}
                  campaign={campaign}
                  lang={lang}
                  onSend={onSend}
                  disabled={disabled}
                />
              ))}
            </div>
          ) : campaignMode === "carousel" ? (
            <CampaignCarousel
              campaigns={message.campaigns}
              lang={lang}
              onSend={onSend}
              disabled={disabled}
            />
          ) : (
            <>
              <div className="space-y-2">
                {message.campaigns.slice(0, TOP_CARDS_IN_TABLE_MODE).map((campaign) => (
                  <CampaignCard
                    key={campaign.key}
                    campaign={campaign}
                    lang={lang}
                    onSend={onSend}
                    disabled={disabled}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowAllCampaigns((value) => !value)}
                aria-expanded={showAllCampaigns}
                className="mt-2 rounded text-xs font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                data-testid="nexus-show-all-campaigns"
              >
                {showAllCampaigns ? t.hide : t.showAll(message.campaigns.length)}
              </button>
              {showAllCampaigns ? (
                <div className="mt-2 max-h-72 overflow-y-auto">
                  <CampaignTable
                    campaigns={message.campaigns}
                    lang={lang}
                    onSend={onSend}
                    disabled={disabled}
                  />
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {message.products.length > 0 ? (
        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t.products}
          </h4>
          {productMode === "cards" ? (
            <div className="space-y-2">
              {message.products.map((product) => (
                <ProductVariantCard
                  key={product.productId ?? product.displayName}
                  product={product}
                  lang={lang}
                  onSend={onSend}
                  disabled={disabled}
                />
              ))}
            </div>
          ) : productMode === "carousel" ? (
            <ProductCarousel
              products={message.products}
              lang={lang}
              onSend={onSend}
              disabled={disabled}
            />
          ) : (
            <>
              <div className="space-y-2">
                {message.products.slice(0, TOP_CARDS_IN_TABLE_MODE).map((product) => (
                  <ProductVariantCard
                    key={product.productId ?? product.displayName}
                    product={product}
                    lang={lang}
                    onSend={onSend}
                    disabled={disabled}
                  />
                ))}
              </div>
              <ExpandableSection
                label={t.allProducts(message.products.length)}
                openLabel={t.hide}
                testId="nexus-all-products"
              >
                <div className="max-h-72 overflow-y-auto">
                  <ProductTable
                    products={message.products}
                    lang={lang}
                    onSend={onSend}
                    disabled={disabled}
                  />
                </div>
              </ExpandableSection>
            </>
          )}
        </section>
      ) : null}

      {message.recommendation ? (
        <RecommendationCard
          recommendation={message.recommendation}
          lang={lang}
          onSend={onSend}
          disabled={disabled}
        />
      ) : null}

      <QuickActions actions={message.actions} onSend={onSend} disabled={disabled} />
      <SourceBadges sources={message.sources} lang={lang} />
    </div>
  );
}
