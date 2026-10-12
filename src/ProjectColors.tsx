import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { automaticProjectColor, projectColorsById, projectColorStyle, PROJECT_COLORS_CHANNEL } from "./project-colors";
import type { ProjectColorDisplay } from "./sidebar-settings";

export type ProjectStripeView = "full" | "collapsed" | "group-full" | "group-collapsed";

export function useProjectColorOverrides(enabled = true) {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const request = useRef(0);
  const load = useCallback(async () => {
    if (!enabled) return;
    const seq = ++request.current;
    try {
      const result = await rpc.call("getProjectColors", {});
      if (seq === request.current) setOverrides(result.colors);
    } catch {
      // Keep automatic colors while the backend is reloading.
    }
  }, [enabled, rpc]);
  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);
  useRealtime(PROJECT_COLORS_CHANNEL, () => { void load(); });
  useEffect(() => {
    if (connection === "connected" && previousConnection.current !== "connected") void load();
    previousConnection.current = connection;
  }, [connection, load]);
  return { overrides, reload: load };
}

const ProjectColorsContext = createContext<{
  colors: ReadonlyMap<string, string>;
  display: ProjectColorDisplay;
} | null>(null);

// Every project's colour, custom or automatic, whether or not the Project
// colors display setting is on: ticket chips use it either way.
const ProjectColorValuesContext = createContext<ReadonlyMap<string, string> | null>(null);

export function ProjectColorsProvider({ enabled, chipsNeedColors = false, display, projectIds, children }: {
  enabled: boolean;
  /** Load custom colours for ticket chips even while Project colors is off. */
  chipsNeedColors?: boolean;
  display: ProjectColorDisplay;
  projectIds: readonly string[];
  children: ReactNode;
}) {
  const { overrides } = useProjectColorOverrides(enabled || chipsNeedColors);
  const colors = useMemo(() => projectColorsById(projectIds, overrides), [projectIds, overrides]);
  const value = useMemo(() => enabled ? { colors, display } : null, [enabled, colors, display]);
  return (
    <ProjectColorValuesContext.Provider value={colors}>
      <ProjectColorsContext.Provider value={value}>{children}</ProjectColorsContext.Provider>
    </ProjectColorValuesContext.Provider>
  );
}

/** The project's colour, custom or automatic, also when Project colors is off. */
export function useProjectColorValue(projectId: string | undefined): string | undefined {
  const colors = useContext(ProjectColorValuesContext);
  if (!projectId) return undefined;
  return colors?.get(projectId) ?? automaticProjectColor(projectId);
}

export function useProjectColor(projectId: string | undefined) {
  const context = useContext(ProjectColorsContext);
  if (!context || !projectId) return undefined;
  return projectColorStyle(context.colors.get(projectId) ?? automaticProjectColor(projectId));
}

export function useProjectStripeColor(projectId: string, view: ProjectStripeView = "full") {
  const context = useContext(ProjectColorsContext);
  const color = useProjectColor(projectId);
  if (!context) return undefined;
  if (context.display === "full" && (view === "collapsed" || view === "group-collapsed")) return undefined;
  if (context.display === "grouped" && view !== "group-full" && view !== "group-collapsed") return undefined;
  return color;
}
