// The sound list, its picker labels, and the four themes (spec Technical
// Contracts). Pure: no React, no DOM, no clock.
import type { SoundSettings } from "./settings";

/** Picker order is the spec's sound list order. */
export const SOUND_IDS = [
  "soft-rise", "warm-resolve", "clear-question", "gentle-knock", "low-warning", "soft-stop",
  "glass-rise", "glass-resolve", "glass-question", "glass-knock", "glass-warning", "glass-stop",
  "wood-rise", "wood-resolve", "wood-question", "wood-knock", "wood-warning", "wood-stop",
  "minimal-rise", "minimal-resolve", "minimal-question", "minimal-knock", "minimal-warning", "minimal-stop",
] as const;
export type SoundId = (typeof SOUND_IDS)[number];

export const SOUND_LABELS: Readonly<Record<SoundId, string>> = {
  "soft-rise": "Soft rise",
  "warm-resolve": "Warm resolve",
  "clear-question": "Clear question",
  "gentle-knock": "Gentle knock",
  "low-warning": "Low warning",
  "soft-stop": "Soft stop",
  "glass-rise": "Airy rise",
  "glass-resolve": "Glass resolve",
  "glass-question": "Bright question",
  "glass-knock": "Crystal tap",
  "glass-warning": "Glass warning",
  "glass-stop": "Falling glass",
  "wood-rise": "Wood rise",
  "wood-resolve": "Wood resolve",
  "wood-question": "Hollow question",
  "wood-knock": "Gentle wood knock",
  "wood-warning": "Low wood warning",
  "wood-stop": "Wood stop",
  "minimal-rise": "Single rise",
  "minimal-resolve": "Double resolve",
  "minimal-question": "Question pair",
  "minimal-knock": "Approval tick",
  "minimal-warning": "Warning pulse",
  "minimal-stop": "Stop tick",
};

export const THEME_IDS = ["calm", "glass", "wood", "minimal"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const THEME_LABELS: Readonly<Record<ThemeId, string>> = {
  calm: "Calm",
  glass: "Glass",
  wood: "Wood",
  minimal: "Minimal",
};

export const THEME_PAIRS: Readonly<Record<ThemeId, { needsYou: SoundId; done: SoundId }>> = {
  calm: { needsYou: "clear-question", done: "warm-resolve" },
  glass: { needsYou: "glass-question", done: "glass-resolve" },
  wood: { needsYou: "wood-question", done: "wood-resolve" },
  minimal: { needsYou: "minimal-question", done: "minimal-resolve" },
};

/** The theme whose pair is exactly (needsYou, done), in that order; otherwise "custom". */
export function themeForPair(needsYou: SoundId, done: SoundId): ThemeId | "custom" {
  for (const theme of THEME_IDS) {
    const pair = THEME_PAIRS[theme];
    if (pair.needsYou === needsYou && pair.done === done) return theme;
  }
  return "custom";
}

/** Returns settings with both sounds replaced by the theme's pair; nothing else changes. */
export function applyTheme(settings: SoundSettings, theme: ThemeId): SoundSettings {
  const pair = THEME_PAIRS[theme];
  return { ...settings, needsYouSound: pair.needsYou, doneSound: pair.done };
}
