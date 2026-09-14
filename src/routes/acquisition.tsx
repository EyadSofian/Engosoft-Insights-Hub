import { createFileRoute } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import { AcquisitionPerformance } from "@/components/acquisition/AcquisitionPerformance";
import { DashboardPageHeader, PageSections } from "@/components/dashboard-bits";
import { useI18n } from "@/lib/i18n";
import { useReportingPeriod } from "@/lib/use-reporting-period";

export const Route = createFileRoute("/acquisition")({ component: Acquisition });

function Acquisition() {
  const { lang } = useI18n();
  const A = lang === "ar";
  const period = useReportingPeriod();
  return (
    <PageSections>
      <DashboardPageHeader
        icon={<TrendingUp size={22} />}
        title={A ? "تحليل أداء الاستحواذ" : "Acquisition Performance"}
        subtitle={
          A
            ? "كم عميلًا ورسالة وصلت، ومن أين بالضبط: حسب الحملة والإعلان والمادة وصفحة الهبوط والنموذج. بالمعرّف الدقيق فقط."
            : "How many leads and messages came in, and exactly where from: by campaign, ad, creative, landing page and form. Exact IDs only."
        }
        period={period || (A ? "الشهر الحالي" : "Month to date")}
        tone="violet"
      />
      <AcquisitionPerformance />
    </PageSections>
  );
}
