import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ loop: vi.fn(), detail: vi.fn(), performance: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (config: unknown) => config }));
vi.mock("@/lib/api.server", () => ({ json: (value: unknown) => Response.json(value) }));
vi.mock("@/lib/closed-loop.server", () => ({
  getClosedLoop: mocks.loop,
  getCreativeDetail: mocks.detail,
}));
vi.mock("@/lib/acquisition-performance.server", () => ({
  getAcquisitionPerformance: mocks.performance,
}));
beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(mocks)) mock.mockResolvedValue({ configured: true });
});
type HandlerRoute = {
  server: { handlers: { GET: (input: { request: Request }) => Promise<Response> } };
};
describe("acquisition routes retain All time", () => {
  it("passes range=all to closed-loop performance", async () => {
    const { Route } = await import("@/routes/api/acquisition.closed-loop");
    await (Route as unknown as HandlerRoute).server.handlers.GET({
      request: new Request("https://test/api/acquisition/closed-loop?range=all&platform=meta"),
    });
    expect(mocks.loop).toHaveBeenCalledWith(
      expect.objectContaining({ range: "all", platform: "meta" }),
    );
  });
  it("passes the same window to the creative drill-down", async () => {
    const { Route } = await import("@/routes/api/acquisition.creative-detail");
    await (Route as unknown as HandlerRoute).server.handlers.GET({
      request: new Request("https://test/api/acquisition/creative-detail?range=all&creativeId=123"),
    });
    expect(mocks.detail).toHaveBeenCalledWith("123", expect.objectContaining({ range: "all" }));
  });
  it("passes the same window to acquisition performance", async () => {
    const { Route } = await import("@/routes/api/acquisition.performance");
    await (Route as unknown as HandlerRoute).server.handlers.GET({
      request: new Request("https://test/api/acquisition/performance?range=all"),
    });
    expect(mocks.performance).toHaveBeenCalledWith(expect.objectContaining({ range: "all" }));
  });
});
