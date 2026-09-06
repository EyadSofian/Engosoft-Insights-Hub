// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NexusAware } from "@/components/engo-nexus/NexusAware";
import {
  clearNexusView,
  getNexusView,
} from "@/components/engo-nexus/state/nexus-view-context";
import { nexusStore } from "@/components/engo-nexus/state/nexus-store";

beforeEach(() => {
  clearNexusView();
  nexusStore.reset();
});

afterEach(cleanup);

describe("NexusAware", () => {
  it("records the KPI the user is pointing at", () => {
    render(
      <NexusAware elementId="overview.leads">
        <button type="button">Leads KPI</button>
      </NexusAware>,
    );

    fireEvent.mouseEnter(screen.getByText("Leads KPI").parentElement!);
    expect(getNexusView().focusedElementId).toBe("overview.leads");
  });

  it("opens Nexus from an accessible, element-specific action", () => {
    render(
      <NexusAware elementId="overview.revenue">
        <div>Revenue KPI</div>
      </NexusAware>,
    );

    const ask = screen.getByRole("button", { name: /Nexus/ });
    fireEvent.click(ask);

    expect(nexusStore.get().open).toBe(true);
    expect(getNexusView().focusedElementId).toBe("overview.revenue");
  });
});
