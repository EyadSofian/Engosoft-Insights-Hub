import { describe, expect, it } from "vitest";
import {
  NEXUS_NOTIFICATION_MESSAGE,
  notificationAnalysisPrompt,
  notificationQuickActions,
  parseNexusNotificationMessage,
  type NexusNotificationContext,
  type NexusNotificationKey,
} from "../src/components/engo-nexus/lib/nexus-notification";

const notice = (key: NexusNotificationKey): NexusNotificationContext => ({
  id: `notice-${key}`,
  source: "qodo",
  key,
  type: `insights.${key}`,
  title: "ملخص عربي",
  body: "تفاصيل عربية واضحة",
  from: "2026-09-01",
  to: "2026-09-10",
  createdAt: "2026-09-10T08:30:00.000Z",
});

describe("Nexus notification handoff", () => {
  it("rejects a message whose key and notification type do not match", () => {
    expect(
      parseNexusNotificationMessage({
        type: NEXUS_NOTIFICATION_MESSAGE,
        notification: notice("leads"),
      }),
    ).toBeNull();
  });

  it.each<NexusNotificationKey>(["leads", "website", "campaigns", "employees"])(
    "keeps the %s Arabic analysis and actions free of embedded English jargon",
    (key) => {
      const context = notice(key);
      const copy = [
        notificationAnalysisPrompt(context, "ar"),
        ...notificationQuickActions(context, "ar").flatMap((action) => [
          action.label,
          action.prompt,
        ]),
      ].join(" ");

      expect(copy).not.toMatch(/\b(?:ROAS|KPI|HR|coaching|creative|audience|attribution)\b/i);
    },
  );
});
