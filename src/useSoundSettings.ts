import type { SoundSettings } from "./sounds";

/**
 * The global sound settings: `getSoundSettings` on mount, a reload on
 * SOUND_SETTINGS_CHANNEL, and a local cache ("bb-sidebar:sound-settings-cache:v1",
 * normalized on read) for the first paint.
 */
export function useSoundSettings(): {
  /** DEFAULT_SOUND_SETTINGS until the first load (or the local cache). */
  settings: SoundSettings;
  loaded: boolean;
  /**
   * Applies the patch to the returned `settings` at once (optimistic, local
   * state), then saves. Until that save settles, an incoming load
   * (SOUND_SETTINGS_CHANNEL) does not overwrite the patched keys; after it
   * settles, the server's answer wins. A failed save reverts the patched keys.
   * So a slider drag and its readout never jump back (AC-51).
   */
  update(patch: Partial<SoundSettings>): Promise<SoundSettings>;
} {
  throw new Error("not implemented");
}
