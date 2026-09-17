import { describe, expect, it } from "vitest";
import { isRetryableTikTokFailure } from "@/lib/tiktok.server";

describe("TikTok transient failures", () => {
  it("retries the upstream timeout returned in the live hierarchy error", () => {
    expect(
      isRetryableTikTokFailure(
        200,
        "remote or network error[remote]: error_code=1204 reason=request timeout connect_timeout=50ms",
      ),
    ).toBe(true);
  });

  it("retries ordinary transient gateway responses", () => {
    expect(isRetryableTikTokFailure(503, "Service unavailable")).toBe(true);
  });

  it("does not retry permanent API validation errors", () => {
    expect(isRetryableTikTokFailure(400, "Invalid advertiser_id")).toBe(false);
  });
});
