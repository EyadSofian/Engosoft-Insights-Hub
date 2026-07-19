import { createFileRoute } from "@tanstack/react-router";
import type { GlobalFilters } from "@/lib/types";

interface ChatBody {
  question?: string;
  filters?: GlobalFilters;
  history?: { role: "user" | "assistant"; content: string }[];
  lang?: "ar" | "en";
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const roas = (n: number) => n.toFixed(2) + "×";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          getFiltered,
          computeCampaigns,
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
        const campaigns = computeCampaigns(data);
        const courses = computeCourses(data);
        const trend = dailyTrend(data);
        const best = bestCampaign(campaigns);
        const leak = moneyLeak(campaigns);
        const cpl = bestCPL(campaigns);

        const isArabic = /[؀-ۿ]/.test(question);
        const ar = body.lang === "ar" || isArabic;

        // Deterministic answers for the common questions, so the headline
        // numbers can never be hallucinated.
        const shortcut = (): string | null => {
          const q = question.toLowerCase();
          const has = (...words: string[]) => words.some((w) => q.includes(w.toLowerCase()));

          if (has("best campaign", "أفضل حملة", "أفضل كامبين", "افضل حملة", "افضل كامبين") && best) {
            return ar
              ? `**أفضل حملة: ${best.campaign}** — الإنفاق ${money(best.spend)}، الإيراد ${money(best.revenue)}، **ROAS ${roas(best.roas)}**، ${best.crmLeads} عميل محتمل، ${best.won} صفقة مغلقة.${best.topAd ? ` أعلى إعلان إنفاقاً: ${best.topAd.name} (${money(best.topAd.spend)}).` : ""}`
              : `**Best campaign: ${best.campaign}** — Spend ${money(best.spend)}, Revenue ${money(best.revenue)}, **ROAS ${roas(best.roas)}**, ${best.crmLeads} leads, ${best.won} won.${best.topAd ? ` Top ad: ${best.topAd.name} (${money(best.topAd.spend)}).` : ""}`;
          }
          if (has("highest roas", "أعلى roas", "اعلى roas") && best) {
            return ar
              ? `أعلى ROAS: **${best.campaign}** بمعدل **${roas(best.roas)}** (إنفاق ${money(best.spend)}، إيراد ${money(best.revenue)}).`
              : `Highest ROAS: **${best.campaign}** at **${roas(best.roas)}** (Spend ${money(best.spend)}, Revenue ${money(best.revenue)}).`;
          }
          if (has("waste", "wasting", "leak", "إهدار", "أهدر", "اهدر", "هدر") && leak) {
            return ar
              ? `**أكبر إهدار: ${leak.campaign}** — الإنفاق ${money(leak.spend)}، الإيراد ${money(leak.revenue)}، ROAS ${roas(leak.roas)}.${leak.topAd ? ` أكثر إعلان استهلاكاً: ${leak.topAd.name} (${money(leak.topAd.spend)}).` : ""}`
              : `**Biggest money leak: ${leak.campaign}** — Spend ${money(leak.spend)}, Revenue ${money(leak.revenue)}, ROAS ${roas(leak.roas)}.${leak.topAd ? ` Top ad: ${leak.topAd.name} (${money(leak.topAd.spend)}).` : ""}`;
          }
          if (has("cheapest cpl", "lowest cpl", "أرخص", "ارخص") && cpl) {
            return ar
              ? `أرخص تكلفة عميل: **${cpl.campaign}** بـ ${money(cpl.cpl)} للعميل (${cpl.metaLeads || cpl.crmLeads} عميل، إنفاق ${money(cpl.spend)}).`
              : `Cheapest CPL: **${cpl.campaign}** at ${money(cpl.cpl)} per lead (${cpl.metaLeads || cpl.crmLeads} leads, ${money(cpl.spend)} spent).`;
          }
          if (has("total spend", "إجمالي الإنفاق", "اجمالي الانفاق")) {
            return ar ? `إجمالي الإنفاق: **${money(totals.spend)}**.` : `Total spend: **${money(totals.spend)}**.`;
          }
          if (has("total revenue", "إجمالي الإيراد", "اجمالي الايراد")) {
            return ar
              ? `إجمالي الإيراد: **${money(totals.revenue)}**، منه ${money(totals.attributedRevenue)} مرتبط بحملات ميتا (ROAS ${roas(totals.attributedRoas)}).`
              : `Total revenue: **${money(totals.revenue)}**, of which ${money(totals.attributedRevenue)} is campaign-attributed (ROAS ${roas(totals.attributedRoas)}).`;
          }
          if (has("total leads", "إجمالي العملاء", "كم عميل")) {
            return ar
              ? `عملاء CRM: **${totals.crmLeads}**، عملاء ميتا: **${totals.metaLeads}**، صفقات مغلقة: **${totals.won}**.`
              : `CRM leads: **${totals.crmLeads}**, Meta leads: **${totals.metaLeads}**, Won: **${totals.won}**.`;
          }
          if (has("top ad", "أعلى إعلان", "اعلى اعلان")) {
            const ads = campaigns.filter((c) => c.topAd).sort((a, b) => (b.topAd!.spend) - (a.topAd!.spend));
            const t = ads[0];
            if (t?.topAd) {
              return ar
                ? `أعلى إعلان إنفاقاً: **${t.topAd.name}** بـ ${money(t.topAd.spend)} ضمن حملة ${t.campaign}.`
                : `Top ad by spend: **${t.topAd.name}** at ${money(t.topAd.spend)} in campaign ${t.campaign}.`;
            }
          }
          return null;
        };

        const shortAnswer = shortcut();

        // Aggregates only — no lead names, emails, or phone numbers ever leave here.
        const context = {
          window: { from: filters.from, to: filters.to },
          note:
            "Spend covers the Meta window only. `revenue` is all revenue in the window; `attributedRevenue` is the part linked to a Meta campaign. Prefer attributedRoas when judging campaign efficiency.",
          totals,
          topCampaigns: campaigns.slice(0, 20).map((c) => ({
            name: c.campaign,
            spend: Math.round(c.spend),
            impressions: c.impressions,
            ctr: +c.ctrAll.toFixed(2),
            metaLeads: c.metaLeads,
            leads: c.crmLeads,
            won: c.won,
            revenue: Math.round(c.revenue),
            cpl: Math.round(c.cpl),
            roas: +c.roas.toFixed(2),
            topAd: c.topAd?.name,
          })),
          topCourses: courses.slice(0, 12).map((c) => ({
            course: c.course,
            category: c.mainCategory,
            revenue: Math.round(c.revenue),
            orders: c.orders,
            leads: c.leads,
            won: c.won,
            winRate: +c.winRate.toFixed(1),
            spend: Math.round(c.spend),
            roas: +c.roas.toFixed(2),
          })),
          dailyTotals: trend.slice(-21),
          best: best && { name: best.campaign, roas: +best.roas.toFixed(2), spend: Math.round(best.spend), revenue: Math.round(best.revenue) },
          leak: leak && { name: leak.campaign, roas: +leak.roas.toFixed(2), spend: Math.round(leak.spend), revenue: Math.round(leak.revenue) },
        };

        const key = process.env.OPENAI_API_KEY;
        if (!key) {
          return Response.json({
            answer:
              shortAnswer ??
              (ar
                ? "المساعد الذكي غير مُفعّل. أضف `OPENAI_API_KEY` في إعدادات البيئة لتشغيله. يمكنك في الوقت الحالي سؤالي عن: أفضل حملة، أعلى ROAS، أين يُهدر الإنفاق، أرخص تكلفة عميل."
                : "The AI assistant isn't configured. Add `OPENAI_API_KEY` to enable it. Meanwhile you can ask: best campaign, highest ROAS, where budget is wasted, cheapest CPL."),
            usedShortcut: !!shortAnswer,
          });
        }

        const OpenAI = (await import("openai")).default;
        const client = new OpenAI({ apiKey: key });

        const systemPrompt = [
          "You are a marketing and sales data analyst for Engosoft, a training and consulting company.",
          "Answer ONLY from the provided aggregated JSON context. Never invent numbers or campaign names.",
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
          return Response.json({ answer: answer ?? "—", usedShortcut: false });
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
