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
  throw new Error("not implemented");
}

export function splitPrefixInput(input: string): string[] {
  throw new Error("not implemented");
}

export const ATTENTION_CHANNEL = "attention";
export const PROJECT_ATTENTION_CHANNEL = "project-attention";
