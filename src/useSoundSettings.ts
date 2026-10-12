import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { bbSidebarRpcContract } from "./server";
import { safeSetItem } from "./lib/safe-storage";
import {
  DEFAULT_SOUND_SETTINGS,
  normalizeSoundSettings,
  SOUND_SETTINGS_CHANNEL,
  type SoundSettings,
} from "./sounds";

const CACHE_KEY = "bb-sidebar:sound-settings-cache:v1";
const KEYS = Object.keys(DEFAULT_SOUND_SETTINGS) as Array<keyof SoundSettings>;

const readCache = (): SoundSettings | null => {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw === null ? null : normalizeSoundSettings(JSON.parse(raw));
  } catch {
    return null;
  }
};

const sameSettings = (a: SoundSettings, b: SoundSettings): boolean => KEYS.every((key) => a[key] === b[key]);

/**
 * The global sound settings: `getSoundSettings` on mount, a reload on
 * SOUND_SETTINGS_CHANNEL, and a local cache for the first paint.
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
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [settings, setSettings] = useState<SoundSettings>(() => readCache() ?? DEFAULT_SOUND_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  /** The last answer the server gave; failed saves revert to it. */
  const confirmed = useRef<SoundSettings>(settings);
  /** Saves still in flight, per patched key. */
  const inFlight = useRef(new Map<keyof SoundSettings, number>());
  const loadSeq = useRef(0);
  const mounted = useRef(true);

  const accept = useCallback((answer: SoundSettings) => {
    confirmed.current = answer;
    safeSetItem(CACHE_KEY, JSON.stringify(answer));
    setSettings((held) => {
      const next = { ...answer } as Record<keyof SoundSettings, unknown>;
      for (const key of KEYS) if (inFlight.current.has(key)) next[key] = held[key];
      return sameSettings(held, next as unknown as SoundSettings) ? held : (next as unknown as SoundSettings);
    });
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const answer = normalizeSoundSettings(await rpc.call("getSoundSettings", {}));
      if (seq !== loadSeq.current || !mounted.current) return;
      accept(answer);
      setLoaded(true);
    } catch {
      void 0; // Keep the cache or defaults; the next channel signal retries.
    }
  }, [rpc, accept]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadSeq.current += 1;
    };
  }, [load]);
  useRealtime(SOUND_SETTINGS_CHANNEL, () => {
    void load();
  });

  const update = useCallback(
    async (patch: Partial<SoundSettings>): Promise<SoundSettings> => {
      const keys = (Object.keys(patch) as Array<keyof SoundSettings>).filter((key) => patch[key] !== undefined);
      for (const key of keys) inFlight.current.set(key, (inFlight.current.get(key) ?? 0) + 1);
      if (mounted.current) {
        setSettings((held) => {
          const next = { ...held, ...patch };
          return sameSettings(held, next) ? held : next;
        });
      }
      const settle = () => {
        for (const key of keys) {
          const left = (inFlight.current.get(key) ?? 1) - 1;
          if (left <= 0) inFlight.current.delete(key);
          else inFlight.current.set(key, left);
        }
      };
      try {
        const answer = normalizeSoundSettings(await rpc.call("updateSoundSettings", patch));
        settle();
        if (mounted.current) accept(answer);
        return answer;
      } catch (error) {
        settle();
        // Revert only keys that no newer save is still holding.
        if (mounted.current) {
          setSettings((held) => {
            const next = { ...held } as Record<keyof SoundSettings, unknown>;
            for (const key of keys) if (!inFlight.current.has(key)) next[key] = confirmed.current[key];
            return sameSettings(held, next as unknown as SoundSettings) ? held : (next as unknown as SoundSettings);
          });
        }
        throw error;
      }
    },
    [rpc, accept],
  );

  return { settings, loaded, update };
}
