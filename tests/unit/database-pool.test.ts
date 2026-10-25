import { describe, expect, it } from "vitest";
import { withDatasetWritePermit } from "../../src/lib/database-pool.server.ts";

describe("shared database write gate", () => {
  it("limits concurrent dataset writes and drains queued work", async () => {
    let active = 0;
    let peak = 0;
    const writes = Array.from({ length: 12 }, (_, index) =>
      withDatasetWritePermit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return index;
      }),
    );

    await expect(Promise.all(writes)).resolves.toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it("releases a write slot when a transaction fails", async () => {
    await expect(
      withDatasetWritePermit(async () => {
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");

    await expect(withDatasetWritePermit(async () => "next write")).resolves.toBe("next write");
  });
});
