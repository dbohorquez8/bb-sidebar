import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import {
  secondaryButtonClass,
  SettingRow,
  SettingsSelect,
  Switch,
  type SaveStatus,
} from "./settings-ui";
import { useSoundSettings } from "./useSoundSettings";
import { useSoundWindow } from "./sounds/browser";
import {
  applyTheme,
  SOUND_IDS,
  SOUND_LABELS,
  stepVolume,
  THEME_IDS,
  THEME_LABELS,
  themeForPair,
  VOLUME_STEP,
  type ChimeStatus,
  type SoundId,
  type SoundSettings,
  type ThemeId,
  type VolumeKey,
} from "./sounds";

/** Slider changes save at most this often (trailing). */
const VOLUME_SAVE_MS = 200;
const VOLUME_KEYS: readonly string[] = ["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "PageUp", "PageDown", "Home", "End"];

function SoundPicker({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: SoundId;
  disabled: boolean;
  onChange(sound: SoundId): void;
}) {
  return (
    <SettingsSelect
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as SoundId)}
      className="w-44"
    >
      {SOUND_IDS.map((id) => (
        <option key={id} value={id}>{SOUND_LABELS[id]}</option>
      ))}
    </SettingsSelect>
  );
}

/** The Sounds settings rows (presentational). */
export function SoundsSection({ settings, soundBlocked, onChange, onPreview }: SoundsSectionProps): ReactElement {
  const off = !settings.playSounds;
  const theme = themeForPair(settings.needsYouSound, settings.doneSound);
  return (
    <>
      <SettingRow
        title="Play sounds"
        description="Play a short sound when a thread needs you or is done."
        control={<Switch label="Play sounds" checked={settings.playSounds} onChange={(playSounds) => onChange({ playSounds })} />}
      />
      {soundBlocked ? (
        <div
          role="status"
          className="mx-4 mb-1 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          Sound is blocked in this window until you click or press a key in it.
        </div>
      ) : null}
      <SettingRow
        title="Theme"
        description="Sets both sounds at once."
        control={
          <SettingsSelect
            aria-label="Theme"
            value={theme}
            disabled={off}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "custom") return;
              const applied = applyTheme(settings, next as ThemeId);
              onChange({ needsYouSound: applied.needsYouSound, doneSound: applied.doneSound });
            }}
            className="w-44"
          >
            {THEME_IDS.map((id) => (
              <option key={id} value={id}>{THEME_LABELS[id]}</option>
            ))}
            {theme === "custom" ? <option value="custom" disabled>Custom</option> : null}
          </SettingsSelect>
        }
      />
      <SettingRow
        title="Needs you"
        description="When a thread starts waiting for you."
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Switch label="Needs you" checked={settings.needsYouEnabled} disabled={off} onChange={(needsYouEnabled) => onChange({ needsYouEnabled })} />
            <SoundPicker label="Needs you sound" value={settings.needsYouSound} disabled={off} onChange={(needsYouSound) => onChange({ needsYouSound })} />
            <button type="button" aria-label="Preview Needs you sound" className={secondaryButtonClass} onClick={() => onPreview("needs-you")}>
              Preview
            </button>
          </div>
        }
      />
      <SettingRow
        title="Done"
        description="When a thread finishes its work."
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Switch label="Done" checked={settings.doneEnabled} disabled={off} onChange={(doneEnabled) => onChange({ doneEnabled })} />
            <SoundPicker label="Done sound" value={settings.doneSound} disabled={off} onChange={(doneSound) => onChange({ doneSound })} />
            <button type="button" aria-label="Preview Done sound" className={secondaryButtonClass} onClick={() => onPreview("done")}>
              Preview
            </button>
          </div>
        }
      />
      <SettingRow
        title="Volume"
        description="Loudness of both sounds."
        control={
          <div className="flex items-center gap-3">
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={100}
              step={VOLUME_STEP}
              value={settings.volume}
              disabled={off}
              onChange={(event) => onChange({ volume: Number(event.target.value) })}
              onKeyDown={(event) => {
                if (off || !VOLUME_KEYS.includes(event.key)) return;
                event.preventDefault();
                onChange({ volume: stepVolume(settings.volume, event.key as VolumeKey) });
              }}
              className="w-40 accent-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
            <output className="w-10 text-right text-xs tabular-nums text-muted-foreground">{settings.volume}%</output>
          </div>
        }
      />
    </>
  );
}

export interface SoundsSectionProps {
  settings: SoundSettings;
  soundBlocked: boolean;
  onChange(patch: Partial<SoundSettings>): void;
  onPreview(status: ChimeStatus): void;
}

/** The Sounds section's container: settings hook, Preview, and save feedback. */
export function SoundsSettings({ onSaveStatus }: { onSaveStatus(status: SaveStatus): void }): ReactElement {
  const { settings: stored, update } = useSoundSettings();
  const { output, clock } = useSoundWindow();
  const soundBlocked = useSyncExternalStore(output.subscribe, output.isBlocked, output.isBlocked);

  // The slider's own value, until its trailing save settles: the readout
  // follows the thumb, never an older answer from the server.
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const draftVersion = useRef(0);
  const saveTimer = useRef<unknown>(null);
  const inFlight = useRef(0);
  const mounted = useRef(true);
  const statusRef = useRef(onSaveStatus);
  statusRef.current = onSaveStatus;
  const updateRef = useRef(update);
  updateRef.current = update;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (saveTimer.current !== null) clock.clearTimeout(saveTimer.current);
    };
  }, [clock]);

  const save = useCallback(async (patch: Partial<SoundSettings>) => {
    inFlight.current += 1;
    statusRef.current("saving");
    let failed = false;
    try {
      await updateRef.current(patch);
    } catch {
      failed = true;
    }
    inFlight.current -= 1;
    if (!mounted.current) return;
    if (failed) statusRef.current("error");
    else if (inFlight.current === 0) statusRef.current("saved");
  }, []);

  const saveVolume = useCallback(
    (volume: number, version: number) => {
      saveTimer.current = null;
      void save({ volume }).then(() => {
        if (mounted.current && draftVersion.current === version) setVolumeDraft(null);
      });
    },
    [save],
  );

  const onChange = useCallback(
    (patch: Partial<SoundSettings>) => {
      const { volume, ...rest } = patch;
      if (Object.keys(rest).length > 0) void save(rest);
      if (volume === undefined) return;
      const version = ++draftVersion.current;
      setVolumeDraft(volume);
      // Trailing: the latest value goes out once the slider pauses.
      if (saveTimer.current !== null) clock.clearTimeout(saveTimer.current);
      saveTimer.current = clock.setTimeout(() => saveVolume(volume, version), VOLUME_SAVE_MS);
    },
    [clock, save, saveVolume],
  );

  const shown = useMemo(
    () => (volumeDraft === null ? stored : { ...stored, volume: volumeDraft }),
    [stored, volumeDraft],
  );
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const onPreview = useCallback(
    (status: ChimeStatus) => {
      // The click is the gesture that lets a blocked window start sound.
      const current = shownRef.current;
      const sound = status === "needs-you" ? current.needsYouSound : current.doneSound;
      void output
        .unlock()
        .catch(() => undefined)
        .then(() => output.play(sound, current.volume))
        .catch(() => undefined);
    },
    [output],
  );

  return <SoundsSection settings={shown} soundBlocked={soundBlocked} onChange={onChange} onPreview={onPreview} />;
}
