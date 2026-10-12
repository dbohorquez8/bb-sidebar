// The browser boundary: Web Audio output, window focus, and the window clock.
// Tests replace the whole boundary through SoundWindowContext.
import { createContext, useContext } from "react";
import type { SoundId } from "./catalog";
import { renderSoundSamples } from "./synth";

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
  if (!cached) cached = createBrowserSoundWindow();
  return cached;
}

let cached: SoundWindow | null = null;

type AudioContextCtor = new () => AudioContext;

function createBrowserSoundWindow(): SoundWindow {
  const outputListeners = new Set<() => void>();
  const focusListeners = new Set<() => void>();
  let context: AudioContext | null = null;
  let lastInput: number | null = null;
  const buffers = new Map<SoundId, AudioBuffer>();

  const notifyOutput = () => outputListeners.forEach((listener) => listener());
  const notifyFocus = () => focusListeners.forEach((listener) => listener());

  const getContext = (): AudioContext | null => {
    if (context) return context;
    const Ctor: AudioContextCtor | undefined =
      (window as unknown as { AudioContext?: AudioContextCtor }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    context.addEventListener("statechange", notifyOutput);
    return context;
  };

  const resume = async (): Promise<void> => {
    const ctx = getContext();
    if (ctx && ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        // stays blocked
      }
    }
    notifyOutput();
  };

  const onInput = () => {
    lastInput = Date.now();
    if (!context || context.state !== "running") void resume();
  };
  document.addEventListener("pointerdown", onInput, { capture: true, passive: true });
  document.addEventListener("keydown", onInput, { capture: true, passive: true });
  window.addEventListener("focus", notifyFocus);
  window.addEventListener("blur", notifyFocus);
  document.addEventListener("visibilitychange", notifyFocus);
  getContext();

  const output: SoundOutput = {
    isBlocked: () => !context || context.state !== "running",
    subscribe(listener) {
      outputListeners.add(listener);
      return () => {
        outputListeners.delete(listener);
      };
    },
    unlock: resume,
    async play(sound, volume) {
      const ctx = getContext();
      if (!ctx || ctx.state !== "running") throw new Error("sound is blocked");
      let buffer = buffers.get(sound);
      if (!buffer) {
        const samples = renderSoundSamples(sound, ctx.sampleRate);
        buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
        buffer.getChannelData(0).set(samples);
        buffers.set(sound, buffer);
      }
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(100, volume)) / 100;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    },
  };

  const focus: WindowFocusSource = {
    hasFocus: () => document.hasFocus() && document.visibilityState === "visible",
    lastInputAt: () => lastInput,
    subscribe(listener) {
      focusListeners.add(listener);
      return () => {
        focusListeners.delete(listener);
      };
    },
  };

  const clock: SoundClock = {
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };

  return { windowId: crypto.randomUUID(), output, focus, clock };
}
