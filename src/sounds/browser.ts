// The browser boundary: Web Audio output, window focus, and the window clock.
// Tests replace the whole boundary through SoundWindowContext.
import { createContext, useContext } from "react";
import type { SoundId } from "./catalog";

export interface SoundOutput {
  /** True while the browser refuses to play sound in this window (Terms "Sound blocked"). */
  isBlocked(): boolean;
  subscribe(listener: () => void): () => void;
  /** Call from a click/key handler: lets the browser start sound if it was blocked. */
  unlock(): Promise<void>;
  /** volume is percent 0–100 (0 = silent). Resolves once started; rejects if it cannot start. */
  play(sound: SoundId, volume: number): Promise<void>;
}

export interface WindowFocusSource {
  hasFocus(): boolean;
  lastInputAt(): number | null;
  subscribe(listener: () => void): () => void;
}

export interface SoundClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SoundWindow {
  /** crypto.randomUUID() once per page load. */
  windowId: string;
  output: SoundOutput;
  focus: WindowFocusSource;
  clock: SoundClock;
}

/** null (the default) means browserSoundWindow(). Tests provide one value per simulated window. */
export const SoundWindowContext = createContext<SoundWindow | null>(null);

export function useSoundWindow(): SoundWindow {
  return useContext(SoundWindowContext) ?? browserSoundWindow();
}

/** One per JS realm, created on first use; every slot in a window shares it. */
export function browserSoundWindow(): SoundWindow {
  throw new Error("not implemented");
}
