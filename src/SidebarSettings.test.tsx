// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { SidebarSettings } from "./SidebarSettings";
import { DEFAULT_SIDEBAR_SETTINGS, MACHINE_ICON_NAMES, type SidebarSettingsValues } from "./sidebar-settings";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });
const extraRpc = {
  listProjects: () => ({ projects: [] }),
  listProjectIconSettings: () => ({ projects: [] }),
  getProjectColors: () => ({ colors: {} }),
};

it.each([false, true])("drains an edit made during a pending save, unmounted=%s", async (unmount) => {
  let stored = { ...DEFAULT_SIDEBAR_SETTINGS };
  const pending = deferred<void>();
  const writes: Partial<SidebarSettingsValues>[] = [];
  const slot = renderSlot({ component: SidebarSettings }, {}, { rpc: {
    ...extraRpc,
    getSidebarSettings: () => stored,
    updateSidebarSettings: async input => {
      writes.push(input as Partial<SidebarSettingsValues>);
      if (writes.length === 1) await pending.promise;
      stored = { ...stored, ...input as Partial<SidebarSettingsValues> };
      return stored;
    },
  } });
  await screen.findByRole("switch", { name: "Working shelf" });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("switch", { name: "Compact working threads" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(writes).toEqual([{ compactWorkingThreads: true }]);
  fireEvent.click(screen.getByRole("switch", { name: "Working shelf" }));
  if (unmount) slot.lifecycle.unmount();
  await act(async () => { pending.resolve(); });
  if (!unmount) {
    expect(writes).toEqual([{ compactWorkingThreads: true }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  }
  expect(writes).toEqual([{ compactWorkingThreads: true }, { workingShelf: true }]);
  expect(stored).toMatchObject({ compactWorkingThreads: true, workingShelf: true });
});

it("saves a reversal of the same field made while its first write is pending", async () => {
  let stored = { ...DEFAULT_SIDEBAR_SETTINGS };
  const pending = deferred<void>();
  const writes: unknown[] = [];
  const slot = renderSlot({ component: SidebarSettings }, {}, { rpc: {
    ...extraRpc, getSidebarSettings: () => stored,
    updateSidebarSettings: async input => {
      writes.push(input);
      if (writes.length === 1) await pending.promise;
      stored = { ...stored, ...input as Partial<SidebarSettingsValues> };
      return stored;
    },
  } });
  const toggle = await screen.findByRole("switch", { name: "Working shelf" });
  vi.useFakeTimers();
  fireEvent.click(toggle);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  fireEvent.click(toggle);
  slot.lifecycle.unmount();
  await act(async () => { pending.resolve(); });
  expect(writes).toEqual([{ workingShelf: true }, { workingShelf: false }]);
  expect(stored.workingShelf).toBe(false);
});

it.each([false, true])("preserves an unrelated remote edit, realtime delivered=%s", async (realtime) => {
  let stored = { ...DEFAULT_SIDEBAR_SETTINGS };
  const writes: unknown[] = [];
  const slot = renderSlot({ component: SidebarSettings }, {}, { rpc: {
    ...extraRpc, getSidebarSettings: () => stored,
    updateSidebarSettings: input => { writes.push(input); stored = { ...stored, ...input as Partial<SidebarSettingsValues> }; return stored; },
  } });
  const toggle = await screen.findByRole("switch", { name: "Working shelf" });
  vi.useFakeTimers();
  fireEvent.click(toggle);
  stored = { ...stored, childSortDirection: "descending" };
  if (realtime) await slot.behavior.emitRealtime("sidebar-settings", {});
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(writes).toEqual([{ workingShelf: true }]);
  expect(stored).toMatchObject({ workingShelf: true, childSortDirection: "descending" });
  expect(screen.getByLabelText("Child threads sort direction")).toHaveProperty("value", "descending");
});

it("flushes a valid edit when leaving before the debounce expires", async () => {
  let stored = { ...DEFAULT_SIDEBAR_SETTINGS };
  const slot = renderSlot({ component: SidebarSettings }, {}, { rpc: {
    ...extraRpc, getSidebarSettings: () => stored,
    updateSidebarSettings: input => { stored = { ...stored, ...input as Partial<SidebarSettingsValues> }; return stored; },
  } });
  fireEvent.click(await screen.findByRole("switch", { name: "Working shelf" }));
  slot.lifecycle.unmount();
  await waitFor(() => expect(stored.workingShelf).toBe(true));
});

it("removes obsolete archive-preview cache keys before an early save", async () => {
  let stored = { ...DEFAULT_SIDEBAR_SETTINGS };
  localStorage.setItem("bb-sidebar:settings-cache:v1", JSON.stringify({ ...stored, archivedShelfEnabled: true }));
  const pending = deferred<SidebarSettingsValues>();
  const writes: unknown[] = [];
  renderSlot({ component: SidebarSettings }, {}, { rpc: {
    ...extraRpc, getSidebarSettings: () => pending.promise,
    updateSidebarSettings: input => {
      expect(input).not.toHaveProperty("archivedShelfEnabled");
      writes.push(input);
      stored = { ...stored, ...input as Partial<SidebarSettingsValues> };
      return stored;
    },
  } });
  fireEvent.click(await screen.findByRole("switch", { name: "Working shelf" }));
  await waitFor(() => expect(writes).toEqual([{ workingShelf: true }]));
  await act(async () => { pending.resolve(DEFAULT_SIDEBAR_SETTINGS); });
  expect(screen.getByRole("switch", { name: "Working shelf" }).getAttribute("aria-checked")).toBe("true");
  expect(JSON.parse(localStorage.getItem("bb-sidebar:settings-cache:v1")!)).not.toHaveProperty("archivedShelfEnabled");
});

it("keeps the typing debounce when an earlier settings save finishes", async () => {
  let stored = { ...DEFAULT_SIDEBAR_SETTINGS };
  const pending = deferred<void>();
  const writes: unknown[] = [];
  renderSlot({ component: SidebarSettings }, {}, { rpc: {
    ...extraRpc, getSidebarSettings: () => stored,
    updateSidebarSettings: async input => {
      writes.push(input);
      if (writes.length === 1) await pending.promise;
      stored = { ...stored, ...input as Partial<SidebarSettingsValues> };
      return stored;
    },
  } });
  const toggle = await screen.findByRole("switch", { name: "Working shelf" });
  vi.useFakeTimers();
  fireEvent.click(toggle);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  const days = screen.getByLabelText("Days before auto-settle");
  fireEvent.change(days, { target: { value: "1" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); pending.resolve(); });
  expect(writes).toEqual([{ workingShelf: true }]);
  fireEvent.change(days, { target: { value: "12" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(499); });
  expect(writes).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(writes).toEqual([{ workingShelf: true }, { autoSettleAfterDays: 12 }]);
});

it("saves the default machine icon picked from the library grid", async () => {
  let stored = { ...DEFAULT_SIDEBAR_SETTINGS };
  const writes: unknown[] = [];
  renderSlot({ component: SidebarSettings }, {}, { rpc: {
    ...extraRpc, getSidebarSettings: () => stored,
    updateSidebarSettings: input => { writes.push(input); stored = { ...stored, ...input as Partial<SidebarSettingsValues> }; return stored; },
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Default machine icon: Computer" }));
  const grid = screen.getByRole("radiogroup", { name: "Default machine icon" });
  expect(grid.querySelectorAll("[role=radio]")).toHaveLength(MACHINE_ICON_NAMES.length);
  fireEvent.click(screen.getByRole("radio", { name: "Home" }));
  await waitFor(() => expect(writes).toEqual([{ machineIcon: "Home" }]));
  expect(screen.getByRole("radio", { name: "Home" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.keyDown(grid, { key: "ArrowRight" });
  const next = MACHINE_ICON_NAMES[MACHINE_ICON_NAMES.indexOf("Home") + 1];
  await waitFor(() => expect(writes.at(-1)).toEqual({ machineIcon: next }));
  expect(grid.querySelectorAll("[tabindex='0']")).toHaveLength(1);
});

it("gives each machine its own icon and puts one back on the default", async () => {
  let machines = [
    { id: "host_1", name: "Desk", icon: null as string | null },
    { id: "host_2", name: "Travel", icon: "Laptop" as string | null },
  ];
  const calls: unknown[] = [];
  renderSlot({ component: SidebarSettings }, {}, { rpc: {
    ...extraRpc,
    getSidebarSettings: () => ({ ...DEFAULT_SIDEBAR_SETTINGS, machineIcon: "Home" }),
    updateSidebarSettings: () => DEFAULT_SIDEBAR_SETTINGS,
    listMachineIcons: () => ({ machines }),
    setMachineIcon: (raw: unknown) => {
      const input = raw as { hostId: string; icon: string | null };
      calls.push(input);
      machines = machines.map((machine) => machine.id === input.hostId ? { ...machine, icon: input.icon } : machine);
      return { ok: true };
    },
  } });
  // A machine without its own icon shows the default.
  fireEvent.click(await screen.findByRole("button", { name: "Machine icon for Desk: Home" }));
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Machine icon for Desk" })).getByRole("radio", { name: "Cloud" }));
  await waitFor(() => expect(calls).toEqual([{ hostId: "host_1", icon: "Cloud" }]));
  await screen.findByRole("button", { name: "Machine icon for Desk: Cloud" });
  expect(screen.getByRole("button", { name: "Machine icon for Travel: Laptop" })).toBeDefined();
  fireEvent.click(screen.getAllByRole("button", { name: "Use default" })[1]!);
  await waitFor(() => expect(calls.at(-1)).toEqual({ hostId: "host_2", icon: null }));
  await screen.findByRole("button", { name: "Machine icon for Travel: Home" });
});
