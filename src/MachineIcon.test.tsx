// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { MachineIcon, MachineIconsProvider } from "./MachineIcon";

afterEach(cleanup);

it("draws the sidebar's own Computer glyph with no provider", () => {
  renderSlot({ component: () => <MachineIcon hostId="host_a" /> }, {});
  expect(document.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("Computer");
});

it("draws a machine's own icon, else the default", async () => {
  renderSlot({
    component: () => (
      <MachineIconsProvider fallback="Home">
        <MachineIcon hostId="host_a" aria-label="a" />
        <MachineIcon hostId="host_b" aria-label="b" />
      </MachineIconsProvider>
    ),
  }, {}, { rpc: { listMachineIcons: () => ({ machines: [
    { id: "host_a", name: "A", icon: "Laptop" },
    { id: "host_b", name: "B", icon: null },
  ] }) } });
  await waitFor(() => expect(document.querySelector('[aria-label="a"]')?.getAttribute("data-icon")).toBe("Laptop"));
  expect(document.querySelector('[aria-label="b"]')?.getAttribute("data-icon")).toBe("Home");
});
