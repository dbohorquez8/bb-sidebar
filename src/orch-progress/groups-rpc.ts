import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { portScanContract } from "../port-scan-contract";
import type { OrchGroupEntry } from "./contract";

const HOST_TIMEOUT_MS = 8_000;
type RpcResult = { hosts: Array<{ hostId: string; groups: OrchGroupEntry[] }> };

function lacksMethod(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /method.*readOrchestratorGroups|readOrchestratorGroups.*(?:not found|missing|unknown)/i.test(message);
}

/** Read every reachable host's reduced orchestrator ledgers. */
export function createOrchestratorGroups(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: portScanContract });
  async function getOrchestratorGroups(): Promise<RpcResult> {
    const hosts = (await bb.sdk.hosts.list()).filter((candidate) => candidate.status === "connected");
    const readings = await Promise.all(hosts.map(async ({ id: hostId }) => {
      try {
        const result = await host.call("readOrchestratorGroups", {}, {
          hostId,
          signal: AbortSignal.timeout(HOST_TIMEOUT_MS),
        });
        return { hostId, groups: result.groups };
      } catch (error) {
        bb.log.debug(lacksMethod(error)
          ? `orch groups: host ${hostId} lacks readOrchestratorGroups (update bb-sidebar there)`
          : `orch groups: host ${hostId} connection failed`);
        return null;
      }
    }));
    return { hosts: readings.filter((reading): reading is NonNullable<typeof reading> => reading !== null) };
  }
  return { getOrchestratorGroups };
}
