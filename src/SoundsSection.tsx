import type { ReactElement } from "react";
import type { SaveStatus } from "./settings-ui";
import type { ChimeStatus, SoundSettings } from "./sounds";

export interface SoundsSectionProps {
  settings: SoundSettings;
  soundBlocked: boolean;
  onChange(patch: Partial<SoundSettings>): void;
  onPreview(status: ChimeStatus): void;
}

/** The Sounds settings rows (presentational). */
export function SoundsSection(_props: SoundsSectionProps): ReactElement {
  return null as unknown as ReactElement;
}

/** The Sounds section's container: settings hook, Preview, and save feedback. */
export function SoundsSettings(_props: { onSaveStatus(status: SaveStatus): void }): ReactElement {
  return null as unknown as ReactElement;
}
