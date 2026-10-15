import type { AttentionPreset } from "./types";

export interface RawProjectAttention {
  presets: string[];
  ticketPrefixes: string[];
}

export const DEFAULT_PROJECT_ATTENTION: RawProjectAttention = { presets: [], ticketPrefixes: [] };

export interface ProjectAttentionSettings {
  enabledPresets: readonly AttentionPreset[]; // in ATTENTION_PRESETS order
  ticketPrefixes: readonly string[];
}

export interface SkippedSettingItem {
  kind: "preset" | "ticket-prefix";
  value: string;
  reason: "unknown-preset" | "empty-prefix" | "invalid-prefix";
}

export function parseProjectAttention(
  raw: unknown,
  presets: readonly AttentionPreset[],
): { settings: ProjectAttentionSettings; skipped: SkippedSettingItem[] } {
  const skipped: SkippedSettingItem[] = [];
  const source =
    raw !== null && typeof raw === "object" ? (raw as Partial<RawProjectAttention>) : {};
  const rawPresets = Array.isArray(source.presets) ? source.presets : [];
  const rawPrefixes = Array.isArray(source.ticketPrefixes) ? source.ticketPrefixes : [];

  const knownIds = new Set(presets.map((preset) => preset.id));
  const enabledPresets = presets.filter((preset) => rawPresets.includes(preset.id));
  for (const id of rawPresets) {
    if (typeof id !== "string" || !knownIds.has(id)) {
      skipped.push({ kind: "preset", value: String(id), reason: "unknown-preset" });
    }
  }

  const ticketPrefixes: string[] = [];
  for (const prefix of rawPrefixes) {
    if (typeof prefix !== "string") continue;
    if (prefix.length === 0) {
      skipped.push({ kind: "ticket-prefix", value: prefix, reason: "empty-prefix" });
      continue;
    }
    if (prefix.length > 16 || /\s/.test(prefix) || prefix.includes(",")) {
      skipped.push({ kind: "ticket-prefix", value: prefix, reason: "invalid-prefix" });
      continue;
    }
    ticketPrefixes.push(prefix);
  }

  return { settings: { enabledPresets, ticketPrefixes }, skipped };
}

export function splitPrefixInput(input: string): string[] {
  return input.split(",").map((part) => part.trim());
}

export const ATTENTION_CHANNEL = "attention";
export const PROJECT_ATTENTION_CHANNEL = "project-attention";
export const ATTENTION_RULES_CHANNEL = "attention-rules";
