import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { bbSidebarRpcContract } from "./server";
import {
  ATTENTION_PRESETS,
  PROJECT_ATTENTION_CHANNEL,
  parseProjectAttention,
  splitPrefixInput,
  validateSilenceThreshold,
  type RawProjectAttention,
  type SkippedSettingItem,
} from "./attention";
import { SettingRow, SettingsGroup, SettingsSelect, Switch } from "./settings-ui";

export interface ProjectChoice {
  id: string;
  name: string;
}

const EMPTY_RAW: RawProjectAttention = { presets: [], ticketPrefixes: [] };

const SKIP_REASON_LABEL: Record<SkippedSettingItem["reason"], string> = {
  "unknown-preset": "unknown preset",
  "empty-prefix": "empty prefix",
  "invalid-prefix": "invalid prefix",
};

/**
 * "After [15] minutes of silence", refusing anything `validateSilenceThreshold`
 * refuses. No SDK hook: a plain controlled field, directly Component-testable.
 */
export function SilenceThresholdField({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>After</span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="Silence threshold"
          aria-invalid={error !== null}
          aria-describedby={error ? "silence-threshold-error" : undefined}
          value={minutes}
          onChange={(event) => {
            const result = validateSilenceThreshold(event.target.value);
            if (result.ok) {
              setError(null);
              onChange(result.minutes);
            } else {
              setError(result.reason);
            }
          }}
          className="h-7 w-16 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
        />
        <span>minutes of silence</span>
      </div>
      {error ? (
        <p id="silence-threshold-error" className="mt-1 text-2xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The project picker, per-preset switches, ticket-prefix field, and
 * unreadable-item warning for one project. No SDK hook: every value and
 * callback comes from props, so `AttentionSettings` owns all RPC wiring and
 * this piece is directly Component-testable.
 */
export function ProjectAttentionFields({
  projects,
  selectedProjectId,
  onSelectProject,
  rawForSelected,
  onTogglePreset,
  prefixDraft,
  onPrefixChange,
}: {
  projects: readonly ProjectChoice[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
  rawForSelected: RawProjectAttention;
  onTogglePreset: (presetId: string, enabled: boolean) => void;
  prefixDraft: string;
  onPrefixChange: (value: string) => void;
}) {
  const { settings, skipped } = parseProjectAttention(rawForSelected, ATTENTION_PRESETS);
  return (
    <>
      <SettingRow
        title="Project"
        description="The project the presets and prefixes below apply to."
        control={
          <SettingsSelect
            aria-label="Attention project"
            value={selectedProjectId}
            onChange={(event) => onSelectProject(event.target.value)}
            className="w-48"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </SettingsSelect>
        }
      />
      {ATTENTION_PRESETS.map((preset) => (
        <SettingRow
          key={preset.id}
          title={preset.label}
          control={
            <Switch
              label={preset.label}
              checked={settings.enabledPresets.some((enabled) => enabled.id === preset.id)}
              onChange={(checked) => onTogglePreset(preset.id, checked)}
            />
          }
        />
      ))}
      <SettingRow title="Ticket prefixes" description="Comma-separated, for example WS-, AID-. Each is tried in its own letter case.">
        <input
          type="text"
          aria-label="Ticket prefixes"
          value={prefixDraft}
          onChange={(event) => onPrefixChange(event.target.value)}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
        />
      </SettingRow>
      {skipped.length > 0 ? (
        <div className="px-4 py-2.5">
          <p className="text-2xs text-destructive">
            Not applied: {skipped.map((item) => `"${item.value}" (${SKIP_REASON_LABEL[item.reason]})`).join(", ")}.
          </p>
        </div>
      ) : null}
    </>
  );
}

/**
 * The sidebar-wide silence threshold and the per-project preset/ticket-prefix
 * controls (plan step 12). Project settings round-trip through
 * `getProjectAttention` / `setProjectAttention`; the threshold is a prop
 * owned by `SidebarSettings`'s own draft/save cycle, same as any other
 * sidebar-wide number.
 */
export function AttentionSettings({
  silenceThresholdMinutes,
  onSilenceThresholdChange,
}: {
  silenceThresholdMinutes: number;
  onSilenceThresholdChange: (minutes: number) => void;
}) {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [projects, setProjects] = useState<ProjectChoice[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [rawByProject, setRawByProject] = useState<Record<string, RawProjectAttention>>({});
  const [prefixDraft, setPrefixDraft] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [directory, attention] = await Promise.allSettled([
      rpc.call("listProjects", {}),
      rpc.call("getProjectAttention", {}),
    ]);
    if (directory.status === "fulfilled") {
      setProjects(directory.value.projects);
    } else {
      toast.error("Could not load projects", {
        description: directory.reason instanceof Error ? directory.reason.message : undefined,
      });
    }
    if (attention.status === "fulfilled") {
      setRawByProject(attention.value.projects as Record<string, RawProjectAttention>);
    } else {
      toast.error("Could not load attention settings", {
        description: attention.reason instanceof Error ? attention.reason.message : undefined,
      });
    }
    setLoading(false);
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime(PROJECT_ATTENTION_CHANNEL, () => {
    void load();
  });

  const selectedId = selectedProjectId || projects[0]?.id || "";
  const rawForSelected = rawByProject[selectedId] ?? EMPTY_RAW;

  useEffect(() => {
    setPrefixDraft(rawForSelected.ticketPrefixes.join(", "));
    // Only re-sync the text field when the selected project or its stored
    // row changes; typing itself must not be overwritten mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, rawByProject]);

  const saveProjectAttention = async (next: RawProjectAttention) => {
    setRawByProject((current) => ({ ...current, [selectedId]: next }));
    try {
      await rpc.call("setProjectAttention", {
        projectId: selectedId,
        presets: next.presets,
        ticketPrefixes: next.ticketPrefixes,
      });
    } catch (error) {
      toast.error("Could not save attention settings", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const togglePreset = (presetId: string, enabled: boolean) => {
    const nextPresets = enabled
      ? [...rawForSelected.presets, presetId]
      : rawForSelected.presets.filter((id) => id !== presetId);
    void saveProjectAttention({ presets: nextPresets, ticketPrefixes: rawForSelected.ticketPrefixes });
  };

  const commitPrefixes = (value: string) => {
    setPrefixDraft(value);
    void saveProjectAttention({ presets: rawForSelected.presets, ticketPrefixes: splitPrefixInput(value) });
  };

  return (
    <>
      <SettingRow title="Silence threshold" description="Minutes of silent background work before a card turns Check?.">
        <SilenceThresholdField minutes={silenceThresholdMinutes} onChange={onSilenceThresholdChange} />
      </SettingRow>
      <SettingsGroup title="Per-project presets">
        {loading ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading projects...</p>
        ) : projects.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <ProjectAttentionFields
            projects={projects}
            selectedProjectId={selectedId}
            onSelectProject={setSelectedProjectId}
            rawForSelected={rawForSelected}
            onTogglePreset={togglePreset}
            prefixDraft={prefixDraft}
            onPrefixChange={commitPrefixes}
          />
        )}
      </SettingsGroup>
    </>
  );
}
