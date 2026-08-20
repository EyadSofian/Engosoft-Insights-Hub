import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/courses")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const {
          attributedAdCourse,
          archivedLostReportingDate,
          authoritativeLostLeads,
          computeCourses,
          computeTotals,
          getFiltered,
          groupBy,
          isPreviousComparable,
          previousPeriod,
        } = await import("@/lib/metrics.server");
        const { parseFilters, json } = await import("@/lib/api.server");
        const { accountingReportingDate } = await import("@/lib/accounting-policy");
        const { normalizeName } = await import("@/lib/sheet-cache.server");

        const filters = await parseFilters(request);
        const organicScope = filters.channel === "organic";
        const data = await getFiltered(filters);
        const prevRange = previousPeriod(filters.from, filters.to);
        // No prior-period revenue delta when that window predates the data.
        const prevComparable = await isPreviousComparable(prevRange);
        const prevData =
          prevComparable && prevRange ? await getFiltered({ ...filters, ...prevRange }) : null;

        const courses = computeCourses(data, prevData ?? undefined);
        const detail = new URL(request.url).searchParams.get("detail")?.trim() ?? "";

        let drill = null;
        if (detail) {
          const courseKey = normalizeName(detail);
          const isCourse = (value: string) => normalizeName(value) === courseKey;

          type MonthAcc = {
            month: string;
            spend: number;
            platformLeads: number | null;
            leads: number;
            lost: number;
            won: number;
            revenue: number;
            invoiceRefs: Set<string>;
            salesOrderRefs: Set<string>;
          };
          const monthly = new Map<string, MonthAcc>();
          const atMonth = (month: string) => {
            let value = monthly.get(month);
            if (!value) {
              value = {
                month,
                spend: 0,
                platformLeads: null,
                leads: 0,
                lost: 0,
                won: 0,
                revenue: 0,
                invoiceRefs: new Set(),
                salesOrderRefs: new Set(),
              };
              monthly.set(month, value);
            }
            return value;
          };

          type CampaignAcc = {
            key: string;
            name: string;
            platforms: Set<import("@/lib/types").Platform>;
            accounts: Set<string>;
            sources: Set<string>;
            objective: import("@/lib/types").CampaignObjective;
            spend: number;
            latestSpend: number;
            latestDates: Set<string>;
            platformLeads: number | null;
            crmLeads: number;
            lost: number;
            won: number;
            revenue: number;
            invoiceRefs: Set<string>;
            salesOrderRefs: Set<string>;
            spendDateMin: string;
            spendDateMax: string;
            attributionSources: Set<string>;
            attributionConfidence: number;
            officialActive: boolean;
            statusSpend24h: number;
            statusCheckedAt: string;
            statusSource: import("@/lib/types").CampaignStateSource | "";
          };
          const campaignMap = new Map<string, CampaignAcc>();
          const campaignKey = (key: string, name: string) => key || `name:${normalizeName(name)}`;
          const atCampaign = (key: string, name: string) => {
            const stableKey = campaignKey(key, name);
            let value = campaignMap.get(stableKey);
            if (!value) {
              value = {
                key: stableKey,
                name: name || "—",
                platforms: new Set(),
                accounts: new Set(),
                sources: new Set(),
                objective: "unknown",
                spend: 0,
                latestSpend: 0,
                latestDates: new Set(),
                platformLeads: null,
                crmLeads: 0,
                lost: 0,
                won: 0,
                revenue: 0,
                invoiceRefs: new Set(),
                salesOrderRefs: new Set(),
                spendDateMin: "",
                spendDateMax: "",
                attributionSources: new Set(),
                attributionConfidence: 1,
                officialActive: false,
                statusSpend24h: 0,
                statusCheckedAt: "",
                statusSource: "",
              };
              campaignMap.set(stableKey, value);
            }
            if ((!value.name || value.name === "—") && name) value.name = name;
            return value;
          };

          // Latest-day spend remains available as reporting context, but never
          // decides the operational Active/Previous split below.
          const latestByPlatform = new Map<import("@/lib/types").Platform, string>();
          for (const ad of data.ads) {
            if (!ad.date) continue;
            const current = latestByPlatform.get(ad.platform) ?? "";
            if (ad.date > current) latestByPlatform.set(ad.platform, ad.date);
          }

          const spendBySource: Record<string, number> = {
            source_mapping: 0,
            campaign_name: 0,
            crm_leads: 0,
          };

          // Build the official-status join from full ad history so an Active
          // campaign does not disappear just because the selected month has no
          // spend for it.
          //
          // Membership needs the course to *dominate* the campaign, not merely
          // to appear in it once. A single matching ad row used to be enough,
          // over unfiltered all-time history — so one mislabelled creative from
          // last November kept its campaign in the wrong course's "eligible to
          // run now" list permanently, whatever date range was selected.
          const campaignCourseWeight = new Map<string, Map<string, number>>();
          const campaignCourseSource = new Map<
            string,
            import("@/lib/metrics.server").CourseAttributionSource
          >();
          for (const ad of data.snapshot.ads) {
            const attribution = attributedAdCourse(ad, data.snapshot);
            if (!attribution.course) continue;
            let byCourse = campaignCourseWeight.get(ad.campaignKey);
            if (!byCourse) {
              byCourse = new Map();
              campaignCourseWeight.set(ad.campaignKey, byCourse);
            }
            // Weight by spend, and by row count for campaigns that never spent
            // — an organic campaign still belongs to exactly one course.
            byCourse.set(
              attribution.course,
              (byCourse.get(attribution.course) ?? 0) + ad.spend + 1,
            );
            if (isCourse(attribution.course) && attribution.source)
              campaignCourseSource.set(ad.campaignKey, attribution.source);
          }
          const dominatedByCourse = (campaignKey: string): boolean => {
            const byCourse = campaignCourseWeight.get(campaignKey);
            if (!byCourse) return false;
            let total = 0;
            let mine = 0;
            for (const [course, weight] of byCourse) {
              total += weight;
              if (isCourse(course)) mine += weight;
            }
            return total > 0 && mine / total > 0.5;
          };

          // Course status follows the platform's official Active snapshot. It
          // deliberately does not infer Active from spend. A campaign can be
          // officially Active and spend zero in the selected period.
          if (!organicScope) {
            for (const state of data.snapshot.campaignStates) {
              if (state.deliveryState !== "active") continue;
              if (filters.platform && state.platform !== filters.platform) continue;
              if (filters.account && state.account !== filters.account) continue;
              if (filters.campaignKey && state.campaignKey !== filters.campaignKey) continue;
              if (filters.campaign && state.name !== filters.campaign) continue;
              const meta = data.snapshot.campaigns.get(state.campaignKey);
              const namedCourse = isCourse(meta?.course ?? "");
              if (!namedCourse && !dominatedByCourse(state.campaignKey)) continue;
              const campaign = atCampaign(state.campaignKey, state.name);
              campaign.platforms.add(state.platform);
              if (state.account) campaign.accounts.add(state.account);
              if (meta && meta.objective !== "unknown") campaign.objective = meta.objective;
              // Without this an Active campaign with no spend in the window
              // rendered "Course match: —", which reads as an unattributed row
              // rather than one that simply did not spend this month.
              const source = namedCourse
                ? meta?.courseSource || "campaign_name"
                : campaignCourseSource.get(state.campaignKey);
              if (source) campaign.attributionSources.add(source);
              campaign.officialActive = true;
              campaign.statusSpend24h = state.spend24h;
              campaign.statusCheckedAt = state.checkedAt;
              campaign.statusSource = state.source;
            }
          }

          for (const ad of data.ads) {
            const attribution = attributedAdCourse(ad, data.snapshot);
            if (!isCourse(attribution.course)) continue;
            const campaign = atCampaign(ad.campaignKey, ad.campaign);
            campaign.platforms.add(ad.platform);
            if (ad.account) campaign.accounts.add(ad.account);
            if (campaign.objective === "unknown" || ad.objective === "leads")
              campaign.objective = ad.objective;
            campaign.spend += ad.spend;
            if (ad.platformLeads !== null)
              campaign.platformLeads = (campaign.platformLeads ?? 0) + ad.platformLeads;
            if (
              ad.date &&
              ad.spend > 0 &&
              (!campaign.spendDateMin || ad.date < campaign.spendDateMin)
            )
              campaign.spendDateMin = ad.date;
            if (ad.date && ad.spend > 0 && ad.date > campaign.spendDateMax)
              campaign.spendDateMax = ad.date;
            if (attribution.source) {
              campaign.attributionSources.add(attribution.source);
              spendBySource[attribution.source] =
                (spendBySource[attribution.source] ?? 0) + ad.spend;
            }
            campaign.attributionConfidence = Math.min(
              campaign.attributionConfidence,
              attribution.confidence,
            );
            if (ad.date && ad.date === latestByPlatform.get(ad.platform) && ad.spend > 0) {
              campaign.latestSpend += ad.spend;
              campaign.latestDates.add(ad.date);
            }

            if (ad.date) {
              const month = atMonth(ad.date.slice(0, 7));
              month.spend += ad.spend;
              if (ad.platformLeads !== null)
                month.platformLeads = (month.platformLeads ?? 0) + ad.platformLeads;
            }
          }

          const crmRows = data.crm.filter((row) => isCourse(row.course));
          for (const row of crmRows) {
            if (row.createdAt) {
              const month = atMonth(row.createdAt.slice(0, 7));
              month.leads++;
              if (row.isWon) month.won++;
            }
            if (!row.fromCampaign) continue;
            const campaign = atCampaign(row.campaignKey, row.campaignName);
            if (row.source) campaign.sources.add(row.source);
            campaign.crmLeads++;
            if (row.isWon) campaign.won++;
          }

          // Archived Odoo opportunities are the only Lost authority. They stay
          // in the lead denominator and are attributed to the same course and
          // campaign dimensions they carried before archival.
          const lostRows = authoritativeLostLeads(data).filter((row) => isCourse(row.course));
          for (const row of lostRows) {
            const lostDate = archivedLostReportingDate(row, data.snapshot);
            if (lostDate) {
              const month = atMonth(lostDate.slice(0, 7));
              month.leads++;
              month.lost++;
            }
            if (!row.campaignKey && !row.campaignName) continue;
            const campaign = atCampaign(row.campaignKey, row.campaignName);
            if (row.source) campaign.sources.add(row.source);
            campaign.crmLeads++;
            campaign.lost++;
          }

          const invoiceRows = data.accounting.filter((row) => isCourse(row.course));
          for (const row of invoiceRows) {
            const date = accountingReportingDate(row, data.applied.dateBasis ?? "payment");
            if (date) {
              const month = atMonth(date.slice(0, 7));
              month.revenue += row.usdPaid;
              if (row.movement && !row.isCreditNote) month.invoiceRefs.add(row.movement);
            }
            if (!row.campaignKey && !row.campaignName) continue;
            const campaign = atCampaign(row.campaignKey, row.campaignName);
            if (row.source) campaign.sources.add(row.source);
            campaign.revenue += row.usdPaid;
            if (row.movement && !row.isCreditNote) campaign.invoiceRefs.add(row.movement);
          }

          const orderRows = data.invoiced.filter((row) => isCourse(row.course));
          for (const row of orderRows) {
            if (row.revenueDate && row.orderRef)
              atMonth(row.revenueDate.slice(0, 7)).salesOrderRefs.add(row.orderRef);
            if ((!row.campaignKey && !row.campaignName) || !row.orderRef) continue;
            const campaign = atCampaign(row.campaignKey, row.campaignName);
            if (row.source) campaign.sources.add(row.source);
            campaign.salesOrderRefs.add(row.orderRef);
          }

          const campaignRows = [...campaignMap.values()]
            .filter((row) =>
              organicScope
                ? row.crmLeads > 0 ||
                  row.won > 0 ||
                  row.lost > 0 ||
                  row.revenue !== 0 ||
                  row.invoiceRefs.size > 0 ||
                  row.salesOrderRefs.size > 0
                : row.spend > 0 || row.officialActive,
            )
            .map((row) => ({
              key: row.key,
              name: row.name,
              platforms: [...row.platforms],
              accounts: [...row.accounts],
              sources: [...row.sources].sort(),
              objective: row.objective,
              spend: row.spend,
              latestSpend: row.latestSpend,
              latestDates: [...row.latestDates].sort(),
              platformLeads: row.platformLeads,
              crmLeads: row.crmLeads,
              lost: row.lost,
              won: row.won,
              revenue: row.revenue,
              invoices: row.invoiceRefs.size,
              salesOrders: row.salesOrderRefs.size,
              roas: row.spend > 0 ? row.revenue / row.spend : null,
              spendDateMin: row.spendDateMin,
              spendDateMax: row.spendDateMax,
              attributionSources: [...row.attributionSources],
              attributionConfidence: row.attributionConfidence,
              officialActive: row.officialActive,
              statusSpend24h: row.statusSpend24h,
              statusCheckedAt: row.statusCheckedAt,
              statusSource: row.statusSource,
            }));

          drill = {
            course: detail,
            latestWindow: Object.fromEntries(latestByPlatform),
            activeCampaigns: campaignRows
              .filter((row) => row.officialActive)
              .sort((a, b) => b.statusSpend24h - a.statusSpend24h || b.spend - a.spend),
            previousCampaigns: campaignRows
              .filter((row) => !row.officialActive)
              .sort((a, b) =>
                organicScope
                  ? b.revenue - a.revenue || b.crmLeads - a.crmLeads
                  : b.spendDateMax.localeCompare(a.spendDateMax) || b.spend - a.spend,
              ),
            previousCampaignCount: campaignRows.filter((row) => !row.officialActive).length,
            attribution: {
              spendBySource,
              totalAttributedSpend: Object.values(spendBySource).reduce(
                (sum, value) => sum + value,
                0,
              ),
            },
            campaigns: groupBy(
              crmRows.filter((row) => row.fromCampaign),
              (row) => row.campaignName,
            ),
            salespeople: groupBy(crmRows, (row) => row.salesperson || "—"),
            teams: groupBy(crmRows, (row) => row.salesTeam || "—"),
            monthly: [...monthly.values()]
              .sort((a, b) => a.month.localeCompare(b.month))
              .map((row) => ({
                month: row.month,
                spend: row.spend,
                platformLeads: row.platformLeads,
                leads: row.leads,
                lost: row.lost,
                won: row.won,
                salesOrders: row.salesOrderRefs.size,
                invoices: row.invoiceRefs.size,
                revenue: row.revenue,
                roas: row.spend > 0 ? row.revenue / row.spend : null,
              })),
          };
        }

        return json({
          courses,
          totals: computeTotals(data),
          drill,
          prevRange,
          prevComparable,
          health: data.snapshot.health,
          appliedFilters: filters,
        });
      },
    },
  },
});
