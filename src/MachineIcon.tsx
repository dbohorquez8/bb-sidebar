import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  experimental_Icon as BbIcon,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { Icon } from "./components/Icon";
import {
  DEFAULT_SIDEBAR_SETTINGS,
  MACHINE_ICONS_CHANNEL,
  type MachineIconName,
} from "./sidebar-settings";

export interface MachineIconEntry {
  id: string;
  name: string;
  /** The machine's own icon; null uses the default. */
  icon: MachineIconName | null;
}

/** Every machine with its own icon choice, kept current by the realtime channel. */
export function useMachineIconEntries() {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  const [machines, setMachines] = useState<MachineIconEntry[]>([]);
  const request = useRef(0);
  const load = useCallback(async () => {
    const seq = ++request.current;
    try {
      const result = await rpc.call("listMachineIcons", {});
      if (seq === request.current) setMachines(result.machines);
    } catch {
      // Keep the default icon while the backend is reloading.
    }
  }, [rpc]);
  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);
  useRealtime(MACHINE_ICONS_CHANNEL, () => { void load(); });
  useEffect(() => {
    if (connection === "connected" && previousConnection.current !== "connected") void load();
    previousConnection.current = connection;
  }, [connection, load]);
  return { machines, reload: load };
}

interface MachineIcons {
  byHost: ReadonlyMap<string, MachineIconName>;
  fallback: MachineIconName;
}

const MachineIconsContext = createContext<MachineIcons>({
  byHost: new Map(),
  fallback: DEFAULT_SIDEBAR_SETTINGS.machineIcon,
});

/** Supplies each machine's icon, and the default for machines without one. */
export function MachineIconsProvider({ fallback, children }: { fallback: MachineIconName; children: ReactNode }) {
  const { machines } = useMachineIconEntries();
  const value = useMemo(() => ({
    byHost: new Map(machines.flatMap((machine) => machine.icon ? [[machine.id, machine.icon] as const] : [])),
    fallback,
  }), [machines, fallback]);
  return <MachineIconsContext.Provider value={value}>{children}</MachineIconsContext.Provider>;
}

/**
 * One machine icon: the named icon, else the machine's own, else the default.
 * "Computer" is the sidebar's own glyph; every other name is drawn by BB's icon library.
 */
export function MachineIcon({
  name,
  hostId,
  className,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: {
  name?: MachineIconName;
  hostId?: string;
  className?: string;
  "aria-hidden"?: boolean;
  "aria-label"?: string;
}) {
  const { byHost, fallback } = useContext(MachineIconsContext);
  const icon = name ?? (hostId === undefined ? undefined : byHost.get(hostId)) ?? fallback;
  if (icon === "Computer") {
    return <Icon name="Computer" className={className} aria-hidden={ariaHidden} aria-label={ariaLabel} />;
  }
  return <BbIcon name={icon} fallback="Laptop" className={className} aria-hidden={ariaHidden} aria-label={ariaLabel} />;
}
