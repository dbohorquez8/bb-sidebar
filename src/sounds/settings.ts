// Sound settings: shape, first-install values, per-item reading of a stored
// value, and the volume slider's keyboard rule. Pure.
import type { SoundId } from "./catalog";

export const SOUND_SETTINGS_CHANNEL = "sound-settings";

export interface SoundSettings {
  /** "Play sounds", the main switch. */
  playSounds: boolean;
  needsYouEnabled: boolean;
  needsYouSound: SoundId;
  doneEnabled: boolean;
  doneSound: SoundId;
  /** Percent 0–100. A stored value need not be a multiple of 5 (IN-09: 37 is readable). */
  volume: number;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  playSounds: false,
  needsYouEnabled: true,
  needsYouSound: "clear-question",
  doneEnabled: true,
  doneSound: "warm-resolve",
  volume: 50,
};

/**
 * Reads an untrusted stored value. Each item falls back to its default alone:
 * a boolean item must be `true` or `false`; a sound must be one of SOUND_IDS;
 * the volume must be a finite number with 0 <= v <= 100 (kept as is, not
 * rounded). Anything that is not a plain object gives DEFAULT_SOUND_SETTINGS.
 * Unknown keys are ignored.
 */
export function normalizeSoundSettings(_raw: unknown): SoundSettings {
  throw new Error("not implemented");
}

export const VOLUME_STEP = 5;
export type VolumeKey =
  | "ArrowRight" | "ArrowUp" | "ArrowLeft" | "ArrowDown"
  | "PageUp" | "PageDown" | "Home" | "End";

/**
 * Slider keyboard rule. Right/Up/PageUp: next multiple of 5 above `current`
 * (37 -> 40, 50 -> 55), capped at 100. Left/Down/PageDown: next multiple of 5
 * below (37 -> 35, 50 -> 45), floored at 0. Home: 0. End: 100.
 */
export function stepVolume(_current: number, _key: VolumeKey): number {
  throw new Error("not implemented");
}
