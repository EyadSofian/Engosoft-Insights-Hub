import { createFileRoute } from "@tanstack/react-router";
import type { GlobalFilters, Maybe } from "@/lib/types";

interface ChatBody {
  question?: string;
  filters?: GlobalFilters;
  history?: { role: "user" | "assistant"; content: string }[];
  lang?: "ar" | "en";
}

const EM = "—";
const money = (n: Maybe) => (n === null || !isFinite(n) ? EM : "$" + Math.round(n).toLocaleString("en-US"));
const money2 = (n: Maybe) =>
  n === null || !isFinite(n) ? EM : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const roas = (n: Maybe) => (n === null || !isFinite(n) ? EM : n.toFixed(2) + "×");
const pct = (n: Maybe) => (n === null || !isFinite(n) ? EM : n.toFixed(1) + "%");
const round2 = (n: Maybe) => (n === null || !isFinite(n) ? null : +n.toFixed(2));

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

        // Deterministic answers for the common questions, so headline numbers
        // can never be hallucinated.
        const shortcut = (): string | null => {
          const q = question.toLowerCase();
          const has = (...words: string[]) => words.some((w) => q.includes(w.toLowerCase()));

          if (has("best campaign", "أفضل حملة", "أفضل كامبين", "افضل حملة", "افضل كامبين") && best) {
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
              ? `أرخص تكلفة عميل: **${cheap.name}** بـ ${money2(cheap.cpl)} للعميل على ${cheap.crmLeads} عميل (إنفاق ${money(cheap.spend)}).`
              : `Cheapest CPL: **${cheap.name}** at ${money2(cheap.cpl)} per lead across ${cheap.crmLeads} leads (${money(cheap.spend)} spent).`;
          }
          if (has("total spend", "إجمالي الإنفاق", "اجمالي الانفاق")) {
            return ar
              ? `إجمالي الإنفاق: **${money(totals.spend)}** (ميتا ${money(totals.spendMeta)}، سناب ${money(totals.spendSnap)}).`
              : `Total spend: **${money(totals.spend)}** (Meta ${money(totals.spendMeta)}, Snapchat ${money(totals.spendSnap)}).`;
          }
          if (has("total revenue", "إجمالي الإيراد", "اجمالي الايراد")) {
            return ar
              ? `إجمالي الإيراد: **${money(totals.revenue)}**، منه ${money(totals.attributedRevenue)} مرتبط بحملة (العائد الحقيقي ${roas(totals.attributedRoas)}).`
              : `Total revenue: **${money(totals.revenue)}**, of which ${money(totals.attributedRevenue)} is campaign-attributed (attributed ROAS ${roas(totals.attributedRoas)}).`;
          }
          if (has("total leads", "إجمالي العملاء", "كم عميل")) {
            return ar
              ? `عملاء النظام: **${totals.crmLeads}** (من حملات ${totals.leadsFromCampaign}، من مصادر أخرى ${totals.leadsOther})، ما أبلغت عنه ميتا: **${totals.platformLeads ?? EM}**، صفقات مغلقة: **${totals.won}**.`
              : `CRM leads: **${totals.crmLeads}** (${totals.leadsFromCampaign} from campaigns, ${totals.leadsOther} other), platform-reported: **${totals.platformLeads ?? EM}**, won: **${totals.won}**.`;
          }
          if (has("cpl", "تكلفة العميل")) {
            return ar
              ? `تكلفة العميل المحتمل: **${money2(totals.cpl)}** (الإنفاق ÷ عملاء النظام). التكلفة حسب ما تقوله المنصة: ${money2(totals.platformCpl)}. تكلفة العميل المدفوع فقط: ${money2(totals.attributedCpl)}.`
              : `CPL: **${money2(totals.cpl)}** (spend ÷ CRM leads). Platform-reported CPL: ${money2(totals.platformCpl)}. Paid-only CPL: ${money2(totals.attributedCpl)}.`;
          }
          if (has("conversion", "نسبة الإغلاق", "نسبة الاغلاق", "معدل التحويل")) {
            return ar
              ? `نسبة الإغلاق: **${pct(totals.conversionRate)}** (${totals.won} من ${totals.crmLeads}). نسبة الضياع: ${pct(totals.lostRate)} (${totals.lost}).`
              : `Conversion rate: **${pct(totals.conversionRate)}** (${totals.won} of ${totals.crmLeads}). Lost rate: ${pct(totals.lostRate)} (${totals.lost}).`;
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
            cpl: "spend ÷ CRM leads (business definition). platformCpl = spend ÷ platform-reported leads. attributedCpl = spend ÷ leads that carry a campaign.",
            roas: "revenue ÷ spend. attributedRoas uses only revenue linked to a campaign and is the honest number.",
            acos: "(spend ÷ revenue) × 100, the inverse of ROAS.",
            nulls: "null means the metric is not measurable from this data — never report it as zero.",
            caveats: `Only ${(health.revenueCampaignShare * 100).toFixed(0)}% of revenue carries a campaign. ${health.leadsWithoutSpendSource} leads came from sources with no spend data (TikTok, UChat, WhatsApp), so blended CPL reads cheaper than paid CPL. Close time is measured on ${health.closeSample} leads only.`,
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
            conversionRate: round2(c.conversionRate),
            spend: Math.round(c.spend),
            roas: round2(c.roas),
          })),
          dailyTotals: trend.slice(-21),
          best: best && { name: best.name, roas: round2(best.roas), spend: Math.round(best.spend), revenue: Math.round(best.revenue) },
          leak: leak && { name: leak.name, roas: round2(leak.roas), spend: Math.round(leak.spend), revenue: Math.round(leak.revenue) },
        };

        const key = process.env.OPENAI_API_KEY;
        if (!key) {
          return Response.json({
            answer:
              shortAnswer ??
              (ar
                ? "المساعد الذكي غير مُفعّل. أضف `OPENAI_API_KEY` في إعدادات البيئة لتشغيله. يمكنك حالياً سؤالي عن: أفضل حملة، أين يُهدر الإنفاق، أرخص تكلفة عميل، إجمالي الإنفاق أو الإيراد، نسبة الإغلاق، زمن الإغلاق."
                : "The AI assistant isn't configured. Add `OPENAI_API_KEY` to enable it. Meanwhile you can ask: best campaign, where budget is wasted, cheapest CPL, total spend or revenue, conversion rate, close time."),
            usedShortcut: !!shortAnswer,
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
        ].join(" ");

        try {
          const completion = await client.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.2,
            max_tokens: 500,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "system", content: `CONTEXT (aggregated, no PII):\n${JSON.stringify(context)}` },
              ...(body.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content })),
              { role: "user", content: question },
            ],
          });
          const answer = completion.choices[0]?.message?.content?.trim() || shortAnswer;
          return Response.json({ answer: answer ?? EM, usedShortcut: false });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({
            answer: shortAnswer ?? (ar ? `تعذّر الوصول إلى المساعد الذكي: ${msg}` : `AI request failed: ${msg}`),
            usedShortcut: !!shortAnswer,
          });
        }
      },
    },
  },
});
