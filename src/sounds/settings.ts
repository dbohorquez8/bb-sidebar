// Sound settings: shape, first-install values, per-item reading of a stored
// value, and the volume slider's keyboard rule. Pure.
import { SOUND_IDS, type SoundId } from "./catalog";

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
export function normalizeSoundSettings(raw: unknown): SoundSettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SOUND_SETTINGS };
  }
  const o = raw as Record<string, unknown>;
  const d = DEFAULT_SOUND_SETTINGS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const sound = (v: unknown, fallback: SoundId): SoundId =>
    typeof v === "string" && (SOUND_IDS as readonly string[]).includes(v) ? (v as SoundId) : fallback;
  const volume =
    typeof o.volume === "number" && Number.isFinite(o.volume) && o.volume >= 0 && o.volume <= 100
      ? o.volume
      : d.volume;
  return {
    playSounds: bool(o.playSounds, d.playSounds),
    needsYouEnabled: bool(o.needsYouEnabled, d.needsYouEnabled),
    needsYouSound: sound(o.needsYouSound, d.needsYouSound),
    doneEnabled: bool(o.doneEnabled, d.doneEnabled),
    doneSound: sound(o.doneSound, d.doneSound),
    volume,
  };
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
export function stepVolume(current: number, key: VolumeKey): number {
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return 100;
    case "ArrowRight":
    case "ArrowUp":
    case "PageUp":
      return Math.min(100, (Math.floor(current / VOLUME_STEP) + 1) * VOLUME_STEP);
    default:
      return Math.max(0, (Math.ceil(current / VOLUME_STEP) - 1) * VOLUME_STEP);
  }
}
