import { createFileRoute } from "@tanstack/react-router";
import { Images } from "lucide-react";
import { CreativeAnalytics } from "@/components/ads/CreativeAnalytics";
import { DashboardPageHeader, PageSections } from "@/components/dashboard-bits";
import { useFilters } from "@/lib/filter-store";
import { useI18n } from "@/lib/i18n";
import { acquisitionChannel } from "@/lib/acquisition-channel";
import { useReportingPeriod } from "@/lib/use-reporting-period";
import { useRegisterNexusView } from "@/components/engo-nexus/state/nexus-view-context";

export const Route = createFileRoute("/creatives")({ component: Creatives });

function Creatives() {
  const { lang } = useI18n();
  const period = useReportingPeriod();
  const filters = useFilters();
  const selected = acquisitionChannel(filters);
  useRegisterNexusView("ads", { tab: "creatives" });

  return (
    <PageSections>
      <DashboardPageHeader
        icon={<Images size={21} />}
        title={lang === "ar" ? "الكرياتيف" : "Creatives"}
        subtitle={
          lang === "ar"
            ? "مكتبة المواد الإعلانية ونتائجها، داخل مساحة التسويق."
            : "The creative library and its delivery results, inside Marketing."
        }
        period={period || undefined}
        tone="mint"
      />
      <CreativeAnalytics selected={selected} />
    </PageSections>
  );
}
