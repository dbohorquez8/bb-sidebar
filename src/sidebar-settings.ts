export const SIDEBAR_SETTINGS_CHANNEL = "sidebar-settings";
export const MACHINE_ICONS_CHANNEL = "machine-icons";

export const CHILD_THREAD_SORT_FIELDS = ["created", "activity"] as const;
export type ChildThreadSortField = (typeof CHILD_THREAD_SORT_FIELDS)[number];
export const CHILD_THREAD_SORT_DIRECTIONS = ["ascending", "descending"] as const;
export type ChildThreadSortDirection =
  (typeof CHILD_THREAD_SORT_DIRECTIONS)[number];

export const CHILD_THREAD_ICON_STYLES = ["disc", "provider"] as const;
export type ChildThreadIconStyle = (typeof CHILD_THREAD_ICON_STYLES)[number];

export const PROJECT_COLOR_DISPLAYS = ["all", "full", "grouped"] as const;
export type ProjectColorDisplay = (typeof PROJECT_COLOR_DISPLAYS)[number];

/**
 * Icons the machine indicator can use. "Computer" is the sidebar's own glyph;
 * the rest are BB's built-in icon names (as of BB 0.46.1), minus host-internal ones.
 */
export const MACHINE_ICON_NAMES = [
  "Computer",
  "AiBrain01", "AiBrowser", "AiContentGenerator01", "AlertCircle", "AlertTriangle",
  "AlignLeft", "AppWindow", "Archive", "ArchiveRestore", "ArrowDown", "ArrowLeft",
  "ArrowReloadHorizontal", "ArrowRight", "ArrowTurnBackward", "ArrowTurnForward",
  "ArrowUp", "ArrowUpDown", "ArrowUpRight", "Beaker", "BellDot", "Bot", "Brain",
  "Browser", "Bug", "Calendar", "CalendarCheckOut02", "ChartColumn", "Check",
  "ChevronDown", "ChevronLeft", "ChevronRight", "ChevronUp", "ChevronsDown",
  "ChevronsUp", "ChildThread", "Circle", "CircleArrowShrink", "CircleCheck",
  "CircleQuestion", "CircleX", "Clean", "Clock", "ClockArrowDown", "ClockArrowUp",
  "Cloud", "CloudOff", "Code", "Coffee", "Columns2", "ComputerCloud",
  "ComputerTerminal01", "Copy", "CornerDownLeft", "CornerDownRight", "DateTime",
  "DiffAdded", "DiffConflict", "DiffModified", "DiffRemoved", "DiffRenamed",
  "Discord", "DiscordLogo", "Download", "DragDropHorizontal", "DragDropVertical",
  "Edit", "EditFile", "ElectricPlugs", "Explore", "ExternalLink", "Eye", "EyeOff",
  "File", "FileAttachment", "FileDiff", "FileQuestion", "FileText", "Filter",
  "FilterHorizontal", "Folder", "Folder02", "FolderEdit", "FolderExport",
  "FolderGit", "FolderMinus", "FolderOpen", "FolderPlus", "FolderSync",
  "FolderUnknown", "Fork", "GitBranch", "GitMerge", "GitPullRequest",
  "GitPullRequestArrow", "GitPullRequestClosed", "GitPullRequestDraft", "Github",
  "GithubLogo", "Globe", "GridView", "Home", "Info", "Keyboard", "Laptop", "Layers",
  "Limitation", "Link", "ListEnd", "ListTodo", "ListView", "Lock", "Mail",
  "MailOpen", "Maximize2", "MessageCirclePlus", "MessageQuestion", "MessageSquare",
  "MessageSquarePlus", "Mic", "Minimize2", "Minus", "MoreHorizontal", "MoveTo",
  "NewTab", "News01", "PackageReceive", "Palette", "PanelBottom", "PanelLeft",
  "PanelRight", "Paperclip", "Pause", "Pin", "PinOff", "Play", "Plug02", "Plus",
  "Puzzle", "Repeat", "RotateCcw", "Rows2", "Search", "SecurityCheck", "Sent",
  "Settings", "SideChat", "SlidersHorizontal", "Smartphone", "Sort",
  "SortingAZ02", "SortingNineOne", "SortingOneNine", "SortingZA01", "Square",
  "SquareUnlock02", "Star", "Target", "Terminal", "TextWrap", "TimeSchedule",
  "ToolCase", "Toolbox", "Trash2", "UserRound", "UserRoundPlus", "Workflow", "X",
  "Zap", "ZoomIn", "ZoomOut",
] as const;
export type MachineIconName = (typeof MACHINE_ICON_NAMES)[number];

export interface ChildThreadSort {
  field: ChildThreadSortField;
  direction: ChildThreadSortDirection;
}

export interface SidebarSettingsValues {
  snoozePresets: string;
  inactiveThreadsEnabled: boolean;
  inactiveAfterHours: number;
  showRunningChildrenWhenCollapsed: boolean;
  autoSettleInactive: boolean;
  autoSettleAfterDays: number;
  autoSettleOnMerge: boolean;
  childSortField: ChildThreadSortField;
  childSortDirection: ChildThreadSortDirection;
  childIconStyle: ChildThreadIconStyle;
  /** Experimental: fold threads with live work to one line. */
  compactWorkingThreads: boolean;
  /** Experimental: move threads with live work to their own shelf. */
  workingShelf: boolean;
  /** Experimental: keep the shelves below Active docked to the bottom. */
  dockShelves: boolean;
  projectColorsEnabled: boolean;
  /** Where project stripes appear; enabled project names are always colored. */
  projectColorDisplay: ProjectColorDisplay;
  /** Minutes of silent background work before a card turns Check?. */
  silenceThresholdMinutes: number;
  /** The machine icon for machines without their own: one of MACHINE_ICON_NAMES. */
  machineIcon: MachineIconName;
}

import { safeSetItem } from "./lib/safe-storage";
import {
  SILENCE_THRESHOLD_DEFAULT_MINUTES,
  SILENCE_THRESHOLD_MAX_MINUTES,
  SILENCE_THRESHOLD_MIN_MINUTES,
} from "./attention/silence";
import { DEFAULT_SNOOZE_PRESET_CONFIG } from "./lifecycle";

export const DEFAULT_SIDEBAR_SETTINGS: SidebarSettingsValues = {
  snoozePresets: DEFAULT_SNOOZE_PRESET_CONFIG,
  inactiveThreadsEnabled: true,
  inactiveAfterHours: 6,
  showRunningChildrenWhenCollapsed: true,
  autoSettleInactive: true,
  autoSettleAfterDays: 3,
  autoSettleOnMerge: true,
  childSortField: "created",
  childSortDirection: "ascending",
  childIconStyle: "disc",
  compactWorkingThreads: false,
  workingShelf: false,
  dockShelves: false,
  projectColorsEnabled: false,
  projectColorDisplay: "all",
  silenceThresholdMinutes: SILENCE_THRESHOLD_DEFAULT_MINUTES,
  machineIcon: "Computer",
};

export function childThreadSortOf(
  settings: SidebarSettingsValues | null,
): ChildThreadSort {
  return {
    field: settings?.childSortField ?? DEFAULT_SIDEBAR_SETTINGS.childSortField,
    direction:
      settings?.childSortDirection ??
      DEFAULT_SIDEBAR_SETTINGS.childSortDirection,
  };
}

type ChildThreadSettings = Pick<
  SidebarSettingsValues,
  "childSortField" | "childSortDirection" | "childIconStyle"
>;

function oneOf<const T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function machineIconOf(value: unknown): MachineIconName {
  return oneOf(MACHINE_ICON_NAMES, value, DEFAULT_SIDEBAR_SETTINGS.machineIcon);
}

export function projectColorDisplayOf(value: unknown): ProjectColorDisplay {
  return oneOf(PROJECT_COLOR_DISPLAYS, value, DEFAULT_SIDEBAR_SETTINGS.projectColorDisplay);
}

/**
 * The child-thread settings from an untrusted record, such as a database row
 * or a cache written by an older version. Missing or unknown values fall back
 * to the defaults.
 */
export function childThreadSettingsOf(value: {
  [Key in keyof ChildThreadSettings]?: unknown;
}): ChildThreadSettings {
  return {
    childSortField: oneOf(
      CHILD_THREAD_SORT_FIELDS,
      value.childSortField,
      DEFAULT_SIDEBAR_SETTINGS.childSortField,
    ),
    childSortDirection: oneOf(
      CHILD_THREAD_SORT_DIRECTIONS,
      value.childSortDirection,
      DEFAULT_SIDEBAR_SETTINGS.childSortDirection,
    ),
    childIconStyle: oneOf(
      CHILD_THREAD_ICON_STYLES,
      value.childIconStyle,
      DEFAULT_SIDEBAR_SETTINGS.childIconStyle,
    ),
  };
}

const SIDEBAR_SETTINGS_CACHE_KEY = "bb-sidebar:settings-cache:v1";
const settingsByRpcClient = new WeakMap<object, SidebarSettingsValues>();

// Old previews may have cached removed settings. Never forward unknown keys
// from storage (or an older server response) to the strict settings RPC.
function currentSettingsOnly(value: SidebarSettingsValues): SidebarSettingsValues {
  return Object.fromEntries(Object.keys(DEFAULT_SIDEBAR_SETTINGS).map((key) => [
    key, value[key as keyof SidebarSettingsValues] ?? DEFAULT_SIDEBAR_SETTINGS[key as keyof SidebarSettingsValues],
  ])) as unknown as SidebarSettingsValues;
}

function silenceThresholdOf(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SILENCE_THRESHOLD_MIN_MINUTES &&
    value <= SILENCE_THRESHOLD_MAX_MINUTES
    ? value
    : DEFAULT_SIDEBAR_SETTINGS.silenceThresholdMinutes;
}

function readStoredSidebarSettings(): SidebarSettingsValues | null {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_SETTINGS_CACHE_KEY);
    if (!stored) return null;
    const value = JSON.parse(stored) as Partial<SidebarSettingsValues>;
    if (
      typeof value.snoozePresets !== "string" ||
      typeof value.inactiveThreadsEnabled !== "boolean" ||
      typeof value.inactiveAfterHours !== "number" ||
      typeof value.showRunningChildrenWhenCollapsed !== "boolean" ||
      typeof value.autoSettleInactive !== "boolean" ||
      typeof value.autoSettleAfterDays !== "number" ||
      typeof value.autoSettleOnMerge !== "boolean"
    ) {
      return null;
    }
    // A cache written before the child-thread settings existed lacks them.
    // It is still good for everything else, so fill the gaps with defaults
    // instead of dropping it and flashing the old settings until the load.
    return currentSettingsOnly({
      ...value,
      ...childThreadSettingsOf(value),
      compactWorkingThreads: value.compactWorkingThreads === true,
      workingShelf: value.workingShelf === true,
      dockShelves: value.dockShelves === true,
      projectColorsEnabled: value.projectColorsEnabled === true,
      projectColorDisplay: projectColorDisplayOf(value.projectColorDisplay),
      silenceThresholdMinutes: silenceThresholdOf(value.silenceThresholdMinutes),
      machineIcon: machineIconOf(value.machineIcon),
    } as SidebarSettingsValues);
  } catch {
    return null;
  }
}

export function cachedSidebarSettings(
  rpcClient: object,
): SidebarSettingsValues | null {
  const cached = settingsByRpcClient.get(rpcClient);
  if (cached) return cached;
  const stored = readStoredSidebarSettings();
  if (stored) settingsByRpcClient.set(rpcClient, stored);
  return stored;
}

export function cacheSidebarSettings(
  rpcClient: object,
  values: SidebarSettingsValues,
): SidebarSettingsValues {
  values = currentSettingsOnly(values);
  settingsByRpcClient.set(rpcClient, values);
  safeSetItem(SIDEBAR_SETTINGS_CACHE_KEY, JSON.stringify(values));
  return values;
}
