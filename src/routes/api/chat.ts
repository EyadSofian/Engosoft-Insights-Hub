import { createFileRoute } from "@tanstack/react-router";
import type { GlobalFilters, Maybe } from "@/lib/types";

interface ChatBody {
  question?: string;
  filters?: GlobalFilters;
  history?: { role: "user" | "assistant"; content: string }[];
  lang?: "ar" | "en";
  page?: string;
}

const EM = "—";
const money = (n: Maybe) =>
  n === null || !isFinite(n) ? EM : "$" + Math.round(n).toLocaleString("en-US");
const money2 = (n: Maybe) =>
  n === null || !isFinite(n) ? EM : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const roas = (n: Maybe) => (n === null || !isFinite(n) ? EM : n.toFixed(2) + "×");
const pct = (n: Maybe) => (n === null || !isFinite(n) ? EM : n.toFixed(1) + "%");
const round2 = (n: Maybe) => (n === null || !isFinite(n) ? null : +n.toFixed(2));
const normalized = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          getFiltered,
          computePerf,
          computeCourses,
          computeTotals,
          bestCampaign,
          moneyLeak,
          bestCPL,
          dailyTrend,
          getDefaultRange,
        } = await import("@/lib/metrics.server");

        const body = (await request.json()) as ChatBody;
        const question = (body.question || "").trim();
        if (!question) return Response.json({ error: "Missing question" }, { status: 400 });

        // Mirror the dashboard's default window so chat and screen agree.
        const filters = { ...(body.filters ?? {}) };
        if (!filters.from && !filters.to) {
          const d = await getDefaultRange();
          filters.from = d.from;
          filters.to = d.to;
        }

        const data = await getFiltered(filters);
        const totals = computeTotals(data);
        const campaigns = computePerf(data, "campaign");
        const courses = computeCourses(data);
        const trend = dailyTrend(data);
        const best = bestCampaign(campaigns);
        const leak = moneyLeak(campaigns);
        const cheap = bestCPL(campaigns);
        const health = data.snapshot.health;

        const isArabic = /[؀-ۿ]/.test(question);
        const ar = body.lang === "ar" || isArabic;
        const qNormalized = normalized(question);
        const page = body.page || "/";

        const selectedActiveStates = data.snapshot.campaignStates.filter((state) => {
          if (state.deliveryState !== "active") return false;
          if (filters.platform && state.platform !== filters.platform) return false;
          if (filters.account && state.account !== filters.account) return false;
          return true;
        });
        const activeStates = [
          ...new Map(
            selectedActiveStates.map((state) => [
              `${state.platform}:${state.campaignId || state.campaignKey}`,
              state,
            ]),
          ).values(),
        ];
        const activeByPlatform = activeStates.reduce<Record<string, number>>((acc, state) => {
          acc[state.platform] = (acc[state.platform] ?? 0) + 1;
          return acc;
        }, {});

        const campaignMention = campaigns.find((campaign) => {
          const name = normalized(campaign.name);
          if (name.length >= 5 && qNormalized.includes(name)) return true;
          const significant = name.split(" ").filter((token) => token.length >= 4);
          return (
            significant.length > 1 &&
            significant.filter((token) => qNormalized.includes(token)).length >= 2
          );
        });
        const courseMention = courses.find((course) => {
          const names = [course.course, course.mainCategory]
            .flatMap((value) => normalized(value).split(" "))
            .filter((token) => token.length >= 3);
          return names.some((token) => qNormalized.split(" ").includes(token));
        });

        // Deterministic answers for the common questions, so headline numbers
        // can never be hallucinated.
        const shortcut = (): string | null => {
          const q = question.toLowerCase();
          const has = (...words: string[]) => words.some((w) => q.includes(w.toLowerCase()));

          if (has("what can you do", "تقدر تعمل ايه", "تعمل ايه", "بتعرف ايه", "ممكن اسالك")) {
            return ar
              ? "أقدر أشرح أي رقم في الداشبورد ومصدره، ألخّص حملة أو دورة، أقارن الإنفاق بالمبيعات، أعدّ الحملات الـActive، وأوصلك للصفحة الصح. أنا ملتزم بالفترة والفلاتر الظاهرة ومش بخمّن رقم ناقص. جرّب: **دورة PMP صرفت وباعت كام؟**"
              : "I can explain dashboard figures and sources, summarize campaigns or courses, compare spend with sales, count officially active campaigns, and link you to the right page. I follow the visible filters and never invent missing values.";
          }
          if (
            has(
              "جاي منين",
              "جايه منين",
              "المصدر ايه",
              "مصدر الرقم",
              "بيتحسب ازاي",
              "where does",
              "data source",
              "calculated",
            )
          ) {
            const sourceByPage: Record<string, { ar: string; en: string }> = {
              "/lost": {
                ar: "أرقام Lost من **أرشيف Odoo المباشر فقط**، والفترة ماشية على `Close Date`. مفيش Google Sheet fallback داخل الرقم.",
                en: "Lost comes only from the **direct Odoo archive**, filtered by `Close Date`; no Google Sheet fallback enters the number.",
              },
              "/courses": {
                ar: "صرف الدورة من منصات الإعلان بعد ربط اسم الإعلان ثم Ad set ثم الحملة؛ الليدز وWon/Lost من Odoo، والإيراد والفواتير من Accounting حسب `Payment Date`.",
                en: "Course spend comes from ad platforms via ad → ad set → campaign matching; leads/Won/Lost come from Odoo, and paid revenue/invoices come from Accounting by `Payment Date`.",
              },
              "/accounting": {
                ar: "الإيراد من سطور الفواتير المدفوعة في Odoo، ويتعرض حسب `Payment Date` مش Due Date. افتح [الحسابات](/accounting) لرؤية الفاتورة والحركة.",
                en: "Revenue comes from paid Odoo invoice lines and is reported by `Payment Date`, not Due Date. Open [Accounting](/accounting) for the invoice movement.",
              },
              "/campaigns": {
                ar: "الصرف من APIs المنصات، الليدز وWon/Lost من Odoo، والإيراد المدفوع من Accounting. صف الحملة للفترة المختارة والسهم يفتح إجمالي تاريخها.",
                en: "Spend comes from platform APIs, leads/Won/Lost from Odoo, and paid revenue from Accounting. The row is period-based; expanding it shows lifetime totals.",
              },
              "/ads": {
                ar: "مقاييس الإعلان من APIs المنصات، وCRM/المبيعات من Odoo وAccounting بعد مطابقة الحملة والإعلان.",
                en: "Ad metrics come from platform APIs; CRM and sales come from Odoo and Accounting after campaign/ad matching.",
              },
            };
            const source = sourceByPage[page] ?? {
              ar: "الصرف من Meta وSnapchat وTikTok وGoogle Ads؛ الليدز وWon/Lost من Odoo؛ الإيراد والفواتير من Accounting حسب Payment Date. التفاصيل الكاملة في [دليل الاستخدام](/guide).",
              en: "Spend comes from Meta, Snapchat, TikTok and Google Ads; leads/Won/Lost from Odoo; paid revenue and invoices from Accounting by Payment Date. See the [user guide](/guide).",
            };
            return ar ? source.ar : source.en;
          }
          if (
            has(
              "active campaign",
              "active campaigns",
              "حمله شغاله",
              "حملة شغالة",
              "حملات شغاله",
              "حملات شغالة",
              "كام حملة",
              "كام حمله",
            )
          ) {
            const labels: Record<string, string> = {
              meta: ar ? "ميتا" : "Meta",
              snapchat: ar ? "سناب" : "Snapchat",
              tiktok: ar ? "تيك توك" : "TikTok",
              google: ar ? "جوجل" : "Google",
            };
            const parts = Object.entries(activeByPlatform).map(
              ([platform, count]) => `${labels[platform] ?? platform} ${count}`,
            );
            return ar
              ? `الحملات اللي المنصات نفسها معلّماها Active: **${activeStates.length}** (${parts.join("، ") || "لا يوجد"}). الصرف مش هو اللي بيحدد الحالة. افتح [الحملات](/campaigns) للتفاصيل.`
              : `Officially Active campaigns: **${activeStates.length}** (${parts.join(", ") || "none"}). Spend does not decide status. Open [Campaigns](/campaigns) for details.`;
          }
          if (courseMention) {
            return ar
              ? `**${courseMention.course}** في الفترة المختارة: صرف ${money(courseMention.spend)}، ${courseMention.crmLeads} ليد، ${courseMention.lost} Lost، ${courseMention.won} Won، ${courseMention.orders} أمر بيع، وإيراد مدفوع ${money(courseMention.revenue)} (ROAS ${roas(courseMention.roas)}). افتح [الدورات](/courses) للحملات ومقارنة الشهور.`
              : `**${courseMention.course}** in the selected period: ${money(courseMention.spend)} spend, ${courseMention.crmLeads} leads, ${courseMention.lost} Lost, ${courseMention.won} Won, ${courseMention.orders} sales orders, and ${money(courseMention.revenue)} paid revenue (ROAS ${roas(courseMention.roas)}). Open [Courses](/courses) for campaigns and month comparison.`;
          }
          if (campaignMention) {
            return ar
              ? `**${campaignMention.name}** في الفترة المختارة: صرف ${money(campaignMention.spend)}، ${campaignMention.crmLeads} ليد CRM، ${campaignMention.lost} Lost، ${campaignMention.won} Won، ${campaignMention.salesOrders} أمر بيع، وإيراد مدفوع ${money(campaignMention.revenue)} (ROAS ${roas(campaignMention.roas)}). افتح [الحملات](/campaigns) واضغط السهم لإجمالي التاريخ.`
              : `**${campaignMention.name}** in the selected period: ${money(campaignMention.spend)} spend, ${campaignMention.crmLeads} CRM leads, ${campaignMention.lost} Lost, ${campaignMention.won} Won, ${campaignMention.salesOrders} sales orders, and ${money(campaignMention.revenue)} paid revenue (ROAS ${roas(campaignMention.roas)}). Open [Campaigns](/campaigns) and expand it for lifetime totals.`;
          }

          if (
            has("best campaign", "أفضل حملة", "أفضل كامبين", "افضل حملة", "افضل كامبين") &&
            best
          ) {
            return ar
              ? `**أفضل حملة: ${best.name}** — الإنفاق ${money(best.spend)}، الإيراد ${money(best.revenue)}، **العائد ${roas(best.roas)}**، ${best.crmLeads} عميل محتمل، ${best.won} صفقة مغلقة.`
              : `**Best campaign: ${best.name}** — Spend ${money(best.spend)}, Revenue ${money(best.revenue)}, **ROAS ${roas(best.roas)}**, ${best.crmLeads} leads, ${best.won} won.`;
          }
          if (has("waste", "wasting", "leak", "إهدار", "أهدر", "اهدر", "هدر") && leak) {
            return ar
              ? `**أكبر إهدار: ${leak.name}** — الإنفاق ${money(leak.spend)}، الإيراد ${money(leak.revenue)}، العائد ${roas(leak.roas)}.`
              : `**Biggest money leak: ${leak.name}** — Spend ${money(leak.spend)}, Revenue ${money(leak.revenue)}, ROAS ${roas(leak.roas)}.`;
          }
          if (has("cheapest cpl", "lowest cpl", "أرخص", "ارخص") && cheap) {
            return ar
              ? `أرخص تكلفة lead معلن عنها: **${cheap.name}** بـ ${money2(cheap.cpl)} على ${cheap.platformLeads ?? 0} lead من المنصة (إنفاق ${money(cheap.spend)}).`
              : `Cheapest reported CPL: **${cheap.name}** at ${money2(cheap.cpl)} across ${cheap.platformLeads ?? 0} platform leads (${money(cheap.spend)} spent).`;
          }
          if (has("total spend", "إجمالي الإنفاق", "اجمالي الانفاق")) {
            const spendPartsAr = [
              `ميتا ${money(totals.spendMeta)}`,
              `سناب ${money(totals.spendSnap)}`,
              totals.spendTikTok > 0 ? `تيك توك ${money(totals.spendTikTok)}` : "",
              totals.spendGoogle > 0 ? `جوجل ${money(totals.spendGoogle)}` : "",
            ].filter(Boolean);
            const spendPartsEn = [
              `Meta ${money(totals.spendMeta)}`,
              `Snapchat ${money(totals.spendSnap)}`,
              totals.spendTikTok > 0 ? `TikTok ${money(totals.spendTikTok)}` : "",
              totals.spendGoogle > 0 ? `Google ${money(totals.spendGoogle)}` : "",
            ].filter(Boolean);
            return ar
              ? `إجمالي الإنفاق: **${money(totals.spend)}** (${spendPartsAr.join("، ")}).`
              : `Total spend: **${money(totals.spend)}** (${spendPartsEn.join(", ")}).`;
          }
          if (has("total revenue", "إجمالي الإيراد", "اجمالي الايراد")) {
            return ar
              ? `إجمالي الإيراد المحصَّل: **${money(totals.revenue)}** من Accounting.USD Paid حسب Payment Date. منه ${money(totals.attributedRevenue)} مرتبط بحملات.`
              : `Collected revenue: **${money(totals.revenue)}** from Accounting.USD Paid by Payment Date. ${money(totals.attributedRevenue)} is campaign-linked.`;
          }
          if (has("total leads", "إجمالي العملاء", "كم عميل")) {
            return ar
              ? `إجمالي العملاء: **${totals.totalLeads}** = ${totals.crmLeads} CRM بدون Lost + ${totals.lost} Lost مؤرشف${totals.archivedWon > 0 ? ` + ${totals.archivedWon} Won مؤرشف` : ""}. Leads المبلّغ عنها من منصات الإعلان: **${totals.platformLeads ?? EM}**، Won: **${totals.won}**.`
              : `Total leads: **${totals.totalLeads}** = ${totals.crmLeads} non-lost CRM + ${totals.lost} archived Lost${totals.archivedWon > 0 ? ` + ${totals.archivedWon} archived Won` : ""}. Ad-platform-reported leads: **${totals.platformLeads ?? EM}**, won: **${totals.won}**.`;
          }
          if (
            has(
              "فين الحملات",
              "الحملات منين",
              "أجيب الحملات",
              "اجيب الحملات",
              "where are campaigns",
            )
          ) {
            return ar
              ? "افتح **التسويق ← الحملات** أو [اضغط هنا](/campaigns). هتلاقي حالة Active من المنصات نفسها، وتحت كل حملة أرقام الفترة المختارة؛ افتح السهم لرؤية إجمالي تاريخها."
              : "Open **Marketing → Campaigns** or [go there now](/campaigns). Active status comes from the ad platforms; each row shows the selected period and expands to lifetime totals.";
          }
          if (has("فين الليدز", "الليدز منين", "أجيب الليدز", "اجيب الليدز", "where are leads")) {
            return ar
              ? "افتح **إدارة العملاء ← العملاء المحتملون** من [هنا](/leads). الليدز الحالية من CRM في Odoo، أما Lost فمن أرشيف Odoo المباشر وتلاقيه في [تحليل الخسائر](/lost)."
              : "Open **CRM → Leads** [here](/leads). Current leads come from Odoo CRM; archived Lost is read directly from Odoo and appears in [Lost Analysis](/lost).";
          }
          if (
            has("فين الدورات", "الدورات منين", "أجيب الدورات", "اجيب الدورات", "where are courses")
          ) {
            return ar
              ? "افتح **التسويق ← الدورات** أو [اضغط هنا](/courses). اختار الدورة لتشوف إنفاق وليدز وLost وWon وإيراد الفترة، والحملات المرتبطة ومقارنة الشهور."
              : "Open **Marketing → Courses** [here](/courses). Select a course to see period spend, leads, Lost, Won, revenue, linked campaigns, and month comparisons.";
          }
          if (has("cpl", "تكلفة العميل")) {
            return ar
              ? `تكلفة العميل المحتمل: **${money2(totals.cpl)}** = إجمالي الإنفاق ${money(totals.spend)} ÷ ${totals.platformLeads ?? EM} lead من Meta/Snap.`
              : `CPL: **${money2(totals.cpl)}** = total spend ${money(totals.spend)} ÷ ${totals.platformLeads ?? EM} Meta/Snap leads.`;
          }
          if (has("conversion", "نسبة الإغلاق", "نسبة الاغلاق", "معدل التحويل")) {
            return ar
              ? `نسبة الإغلاق: **${pct(totals.conversionRate)}** (${totals.won} من ${totals.totalLeads}). نسبة الضياع: ${pct(totals.lostRate)} (${totals.lost} من Lost Analysis فقط).`
              : `Conversion rate: **${pct(totals.conversionRate)}** (${totals.won} of ${totals.totalLeads}). Lost rate: ${pct(totals.lostRate)} (${totals.lost} from Lost Analysis only).`;
          }
          if (has("close time", "زمن الإغلاق", "مدة الإغلاق", "كم يوم")) {
            return ar
              ? `متوسط زمن الإغلاق: **${totals.avgCloseDays === null ? EM : totals.avgCloseDays.toFixed(1) + " يوماً"}**، محسوباً على ${totals.closeSample} صفقة مغلقة فقط.`
              : `Average close time: **${totals.avgCloseDays === null ? EM : totals.avgCloseDays.toFixed(1) + " days"}**, over ${totals.closeSample} closed leads only.`;
          }
          return null;
        };

        const shortAnswer = shortcut();

        // Aggregates only — no lead names, emails, or phone numbers leave here.
        const context = {
          window: { from: filters.from, to: filters.to },
          definitions: {
            cpl: "total ad spend ÷ leads reported by Meta and Snapchat.",
            cpa: "total ad spend ÷ won deals.",
            lost: "Lost Analysis only. CRM stage Lost is excluded.",
            navigation:
              "Campaigns: /campaigns. Leads: /leads. Archived Lost: /lost. Courses: /courses. Paid invoices: /accounting. Full user guide: /guide.",
            revenue: "Accounting.USD Paid filtered by Payment Date at invoice product-line grain.",
            roas: "Accounting.USD Paid revenue ÷ total ad spend. attributedRoas uses campaign-linked Accounting revenue.",
            acos: "(spend ÷ revenue) × 100, the inverse of ROAS.",
            nulls:
              "null means the metric is not measurable from this data — never report it as zero.",
            caveats: `Campaign attribution comes from Accounting when populated and uses the legacy order bridge only as a compatibility fallback. Close time is measured on ${health.closeSample} closed leads only.`,
            lostAuthority: `${health.lostAuthority}; reporting date basis: ${health.lostDateBasis}.`,
          },
          totals,
          topCampaigns: campaigns.slice(0, 20).map((c) => ({
            name: c.name,
            platforms: c.platforms,
            spend: Math.round(c.spend),
            impressions: c.impressions,
            ctr: round2(c.ctrAll),
            platformLeads: c.platformLeads,
            leads: c.crmLeads,
            won: c.won,
            lost: c.lost,
            revenue: Math.round(c.revenue),
            cpl: round2(c.cpl),
            roas: round2(c.roas),
            acos: round2(c.acos),
          })),
          topCourses: courses.slice(0, 12).map((c) => ({
            course: c.course,
            category: c.mainCategory,
            revenue: Math.round(c.revenue),
            orders: c.orders,
            leads: c.crmLeads,
            won: c.won,
            lost: c.lost,
            conversionRate: round2(c.conversionRate),
            spend: Math.round(c.spend),
            roas: round2(c.roas),
          })),
          dailyTotals: trend.slice(-21),
          best: best && {
            name: best.name,
            roas: round2(best.roas),
            spend: Math.round(best.spend),
            revenue: Math.round(best.revenue),
          },
          leak: leak && {
            name: leak.name,
            roas: round2(leak.roas),
            spend: Math.round(leak.spend),
            revenue: Math.round(leak.revenue),
          },
          officiallyActiveCampaigns: {
            total: activeStates.length,
            byPlatform: activeByPlatform,
          },
          currentPage: page,
        };

        const key = process.env.OPENAI_API_KEY;
        if (!key) {
          return Response.json({
            answer:
              shortAnswer ??
              (ar
                ? `أنا شغال حالياً على بيانات الداشبورد المفلترة: إنفاق **${money(totals.spend)}**، إيراد مدفوع **${money(totals.revenue)}**، ${totals.totalLeads} ليد و${totals.won} Won. اسألني باسم حملة أو دورة، أو اكتب «الرقم ده جاي منين؟». المحادثة التحليلية المفتوحة هتتوسع لما يتربط API الذكاء الخارجي.`
                : `I'm currently working from the filtered dashboard data: **${money(totals.spend)}** spend, **${money(totals.revenue)}** paid revenue, ${totals.totalLeads} leads and ${totals.won} won. Ask by campaign/course name or ask where a number comes from. Open-ended analysis will expand when the external AI API is connected.`),
            usedShortcut: !!shortAnswer,
            mode: "dashboard",
          });
        }

        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({ apiKey: key });

        const systemPrompt = [
          "You are a marketing and sales data analyst for Engosoft, a training and consulting company.",
          "Answer ONLY from the provided aggregated JSON context. Never invent numbers or campaign names.",
          "A null value means the metric is not measurable — say so, never report it as zero.",
          "Respect the `definitions` block: CPL, ROAS and ACOS have specific meanings here.",
          "Be concise: 2-4 sentences. Always cite concrete figures and campaign names.",
          "Use markdown for emphasis on names and numbers.",
          "Reply in the user's language. If the question is Arabic, reply in simple, clear Modern Standard Arabic — everyday wording, not stiff or literal, and not dialect.",
          "If the context does not contain the answer, say so plainly instead of guessing.",
          "When the user asks where to find something in the dashboard, give the exact section path and an internal markdown link from the navigation definition.",
        ].join(" ");

        try {
          const completion = await client.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.2,
            max_tokens: 500,
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "system",
                content: `CONTEXT (aggregated, no PII):\n${JSON.stringify(context)}`,
              },
              ...(body.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content })),
              { role: "user", content: question },
            ],
          });
          const answer = completion.choices[0]?.message?.content?.trim() || shortAnswer;
          return Response.json({ answer: answer ?? EM, usedShortcut: false });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({
            answer:
              shortAnswer ??
              (ar ? `تعذّر الوصول إلى المساعد الذكي: ${msg}` : `AI request failed: ${msg}`),
            usedShortcut: !!shortAnswer,
          });
        }
      },
    },
  },
});
