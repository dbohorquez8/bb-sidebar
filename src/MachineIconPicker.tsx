import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { bbSidebarRpcContract } from "./server";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";
import { MachineIcon, useMachineIconEntries } from "./MachineIcon";
import { SettingRow } from "./settings-ui";
import { MACHINE_ICON_NAMES, type MachineIconName } from "./sidebar-settings";

/** The default machine icon, then one row per machine to give it its own. */
export function MachineIconSettings({
  defaultIcon,
  onDefaultChange,
}: {
  defaultIcon: MachineIconName;
  onDefaultChange: (icon: MachineIconName) => void;
}) {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const { machines, reload } = useMachineIconEntries();
  const setIcon = async (hostId: string, icon: MachineIconName | null) => {
    try {
      await rpc.call("setMachineIcon", { hostId, icon });
    } catch {
      toast.error("Could not save the machine icon");
    }
    await reload();
  };
  return (
    <>
      <MachineIconPicker
        title="Default machine icon"
        description="Marks which machine a thread runs on, for machines without their own icon."
        label="Default machine icon"
        value={defaultIcon}
        onChange={onDefaultChange}
      />
      {machines.map((machine) => (
        <MachineIconPicker
          key={machine.id}
          title={machine.name}
          description={machine.icon === null ? "Uses the default icon." : undefined}
          label={`Machine icon for ${machine.name}`}
          value={machine.icon ?? defaultIcon}
          onChange={(icon) => void setIcon(machine.id, icon)}
          action={machine.icon === null ? null : (
            <button
              type="button"
              onClick={() => void setIcon(machine.id, null)}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Use default
            </button>
          )}
        />
      ))}
    </>
  );
}

/** One icon choice from BB's icon library: a button that opens a grid. */
function MachineIconPicker({
  title,
  description,
  label,
  value,
  onChange,
  action = null,
}: {
  title: ReactNode;
  description?: ReactNode;
  label: string;
  value: MachineIconName;
  onChange: (icon: MachineIconName) => void;
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const gridId = useId();
  // One tab stop for the grid; arrow keys move and choose, as radio groups do.
  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const count = MACHINE_ICON_NAMES.length;
    const next = MACHINE_ICON_NAMES[(MACHINE_ICON_NAMES.indexOf(value) + step + count) % count]!;
    onChange(next);
    event.currentTarget.querySelector<HTMLElement>(`[aria-label="${next}"]`)?.focus();
  };
  return (
    <SettingRow
      title={title}
      description={description}
      control={
        <div className="flex items-center gap-3">
          {action}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={gridId}
            aria-label={`${label}: ${value}`}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex h-8 w-40 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
          >
            <MachineIcon name={value} aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{value}</span>
            <Icon
              name={open ? "ChevronUp" : "ChevronDown"}
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          </button>
        </div>
      }
    >
      {open ? (
        <div
          id={gridId}
          role="radiogroup"
          aria-label={label}
          onKeyDown={onGridKeyDown}
          className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1"
        >
          {MACHINE_ICON_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={name === value}
              tabIndex={name === value ? 0 : -1}
              aria-label={name}
              title={name}
              onClick={() => onChange(name)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
                name === value && "bg-muted text-foreground ring-1 ring-border",
              )}
            >
              <MachineIcon name={name} aria-hidden className="size-4" />
            </button>
          ))}
        </div>
      ) : null}
    </SettingRow>
  );
}
