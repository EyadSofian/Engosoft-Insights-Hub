import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ call: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/odoo.server", () => ({
  odooCallWithPolicy: mocks.call,
  searchRead: mocks.read,
  companyContext: (extra: object) => ({ allowed_company_ids: [2, 3, 4], ...extra }),
  m2oName: (value?: [number, string] | false) => (value ? value[1] : ""),
}));

import { plainChatterBody, readLostChatter } from "@/lib/lost-chatter.server";

beforeEach(() => vi.clearAllMocks());

describe("Lost chatter evidence", () => {
  it("renders Odoo HTML as plain text, not executable markup", () => {
    expect(plainChatterBody("<p>Called &amp; followed up</p><script>alert(1)</script>")).toBe(
      "Called & followed up",
    );
  });

  it("shows exact duration and only pre-loss messages as previous evidence", async () => {
    mocks.call.mockResolvedValue({
      id: {},
      create_date: {},
      type: {},
      lost_verification_date: {},
      date_last_stage_update: {},
      date_closed: {},
      write_date: {},
    });
    mocks.read.mockImplementation(async (model: string) =>
      model === "crm.lead"
        ? [
            {
              id: 42,
              type: "opportunity",
              create_date: "2026-09-01 09:00:00",
              lost_verification_date: "2026-09-03 09:00:00",
            },
          ]
        : [
            { id: 3, date: "2026-09-04 10:00:00", body: "After loss", author_id: [7, "Agent"] },
            {
              id: 2,
              date: "2026-09-02 11:00:00",
              body: "<p>Call logged</p>",
              author_id: [7, "Agent"],
            },
            { id: 1, date: "2026-09-01 10:00:00", body: "Initial note" },
          ],
    );
    const result = await readLostChatter(42);
    expect(result?.elapsedHours).toBe(48);
    expect(result?.lostDateBasis).toBe("lost_verification_date");
    expect(result?.lastBeforeLoss?.text).toBe("Call logged");
    expect(result?.messages[0].beforeLoss).toBe(false);
    expect(mocks.read.mock.calls[1][0]).toBe("mail.message");
    expect(mocks.read.mock.calls[1][1]).toContainEqual(["res_id", "=", 42]);
  });
});
