// Chime's sound definitions, rendered to samples in the browser instead of
// shipping WAV files (plan "Assets decision"). Pure.
import type { SoundId } from "./catalog";

export interface SoundDefinition {
  /** Seconds. */
  duration: number;
  notes: readonly (readonly [frequency: number, start: number, duration: number])[];
  gain: number;
  timbre?: "glass" | "wood" | "minimal";
  percussive?: boolean;
}

/** Copied verbatim from Chime 0.1.0 scripts/generate-sounds.mjs (MIT). Ported in plan step 7. */
export const SOUND_DEFINITIONS: Readonly<Record<SoundId, SoundDefinition>> =
  {} as Readonly<Record<SoundId, SoundDefinition>>;

/** Same math as Chime's wavBuffer (envelope, toneSample, 25 ms tail fade, clamp to [-1, 1]), as floats, no 16-bit rounding. */
export function renderSoundSamples(_id: SoundId, _sampleRate: number): Float32Array {
  throw new Error("not implemented");
}
