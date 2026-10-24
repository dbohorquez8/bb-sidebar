import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { bbSidebarRpcContract } from "./server";
import {
  ATTENTION_RULES_CHANNEL,
  LABEL_TONES,
  LABEL_TONE_COLOURS,
  attentionRuleSetSchema,
  splitPrefixInput,
  validateSilenceThreshold,
  type AttentionRulesDocument,
  type AttentionRuleSet,
} from "./attention";
import type { AttentionRulesState } from "./attention-rules-state";
import { SettingRow, SettingsGroup, Switch } from "./settings-ui";

const BUTTON =
  "rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const serialize = (document: AttentionRulesDocument): string => `${JSON.stringify(document, null, 2)}\n`;

const MAX_RULE_SETS = 100;
const LAST_SET_NOTE = "A rules file needs at least one rule set.";

/** "Open Spec" -> "open-spec": the id the rules schema accepts, or "" when the name has no usable letters. */
export function deriveRuleSetId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/** A new enabled rule set with empty lists, or the reason the name is refused. */
export function addRuleSet(
  document: AttentionRulesDocument,
  name: string,
): { ok: true; document: AttentionRulesDocument } | { ok: false; reason: string } {
  const label = name.trim();
  if (label === "") return { ok: false, reason: "Enter a name for the rule set." };
  if (label.length > 120) return { ok: false, reason: "The name must be 120 characters or fewer." };
  const id = deriveRuleSetId(label);
  if (id === "") return { ok: false, reason: "The name needs at least one letter." };
  if (document.ruleSets.some((set) => set.id === id)) return { ok: false, reason: `A rule set with the id "${id}" already exists.` };
  if (document.ruleSets.length >= MAX_RULE_SETS) return { ok: false, reason: `A rules file holds at most ${MAX_RULE_SETS} rule sets.` };
  const set: AttentionRuleSet = { id, label, enabled: true, replyMarkers: [], wakeMessages: [], skillStatuses: [], skillLabels: [], labelResets: [] };
  return { ok: true, document: { ...document, ruleSets: [...document.ruleSets, set] } };
}

/**
 * "After [15] minutes of silence", refusing anything `validateSilenceThreshold`
 * refuses. No SDK hook: a plain controlled field, directly Component-testable.
 */
export function SilenceThresholdField({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>After</span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="Silence threshold"
          aria-invalid={error !== null}
          aria-describedby={error ? "silence-threshold-error" : undefined}
          value={minutes}
          onChange={(event) => {
            const result = validateSilenceThreshold(event.target.value);
            if (result.ok) {
              setError(null);
              onChange(result.minutes);
            } else {
              setError(result.reason);
            }
          }}
          className="h-7 w-16 rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
        />
        <span>minutes of silence</span>
      </div>
      {error ? (
        <p id="silence-threshold-error" className="mt-1 text-2xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type Status = AttentionRuleSet["replyMarkers"][number]["status"];
const STATUS_OPTIONS: readonly { value: Status; label: string }[] = [
  { value: "needs-you", label: "Needs you" },
  { value: "working", label: "Working" },
  { value: "background", label: "Waiting" },
  { value: "done", label: "Done" },
];
const FIELD =
  "h-7 min-w-0 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive";

/** Zod's own wording for an empty required text is unfriendly; everything else passes through. */
function friendly(message: string): string {
  return /expected string to have >=1|at least 1|too small/i.test(message) ? "Required." : message;
}

/** Problems from the rules parser, keyed by their dotted path ("replyMarkers.0.marker"). */
function problemsOf(set: AttentionRuleSet): Map<string, string> {
  const result = attentionRuleSetSchema.safeParse(set);
  const map = new Map<string, string>();
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "set";
      if (!map.has(key)) map.set(key, friendly(issue.message));
    }
  }
  return map;
}

function Problem({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="mt-0.5 text-2xs text-destructive">
      {message}
    </p>
  ) : null;
}

function TextCell({
  label,
  value,
  onChange,
  problem,
  problemId,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  problem: string | undefined;
  problemId: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 flex-1 ${className ?? ""}`}>
      <input
        type="text"
        aria-label={label}
        aria-invalid={problem !== undefined}
        aria-describedby={problem ? problemId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${FIELD} w-full`}
      />
      <Problem id={problemId} message={problem} />
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} className={`${BUTTON} shrink-0`} onClick={onClick}>
      Remove
    </button>
  );
}

function FormSection({ title, hint, onAdd, addLabel, children }: { title: string; hint: string; onAdd: () => void; addLabel: string; children: ReactNode }) {
  return (
    <fieldset className="mt-3 min-w-0 border-0 p-0">
      <legend className="text-xs font-medium text-foreground">{title}</legend>
      <p className="mb-1 text-2xs text-muted-foreground">{hint}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
      <button type="button" className={`${BUTTON} mt-1.5`} onClick={onAdd}>
        {addLabel}
      </button>
    </fieldset>
  );
}

function StatusSelect({ label, value, onChange }: { label: string; value: Status; onChange: (value: Status) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as Status)} className={FIELD}>
      {STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

type ArrayKey = "replyMarkers" | "skillStatuses" | "skillLabels" | "labelResets";

/**
 * Form editor for one rule set: rows for reply markers, skill statuses, skill labels
 * and label resets. Validation comes from the same schema the host parser uses, and
 * shows only after the first save attempt so fresh empty rows are not flagged early.
 */
export function RuleSetForm({
  set,
  onSave,
  onCancel,
}: {
  set: AttentionRuleSet;
  onSave: (next: AttentionRuleSet) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<AttentionRuleSet>(set);
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [json, setJson] = useState(() => JSON.stringify(set, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const uid = useId();

  const problems = problemsOf(draft);
  const shown = (path: string): string | undefined => (attempted ? problems.get(path) : undefined);
  const update = (next: AttentionRuleSet) => {
    setDraft(next);
    setJson(JSON.stringify(next, null, 2));
    setJsonError(null);
  };
  const edit = <K extends ArrayKey>(key: K, index: number, patch: Partial<AttentionRuleSet[K][number]>) =>
    update({ ...draft, [key]: draft[key].map((row, at) => (at === index ? { ...row, ...patch } : row)) });
  const add = <K extends ArrayKey>(key: K, row: AttentionRuleSet[K][number]) => update({ ...draft, [key]: [...draft[key], row] });
  const remove = (key: ArrayKey, index: number) => update({ ...draft, [key]: draft[key].filter((_, at) => at !== index) });

  const save = async () => {
    setAttempted(true);
    if (problems.size > 0) return;
    const failure = await onSave(draft);
    if (failure) setSaveError(failure);
  };
  const applyJson = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (cause) {
      setJsonError(`Invalid JSON: ${errorText(cause)}`);
      return;
    }
    const result = attentionRuleSetSchema.safeParse(parsed);
    if (!result.success) {
      setJsonError(result.error.issues.map((issue) => `${issue.path.join(".") || "set"}: ${friendly(issue.message)}`).join("; "));
      return;
    }
    setDraft(result.data);
    setJson(JSON.stringify(result.data, null, 2));
    setJsonError(null);
  };

  return (
    <div className="px-4 pb-3">
      <label className="block text-xs font-medium text-foreground" htmlFor={`${uid}-name`}>
        Rule set name
      </label>
      <input
        id={`${uid}-name`}
        type="text"
        aria-invalid={shown("label") !== undefined}
        aria-describedby={shown("label") ? `${uid}-name-problem` : undefined}
        value={draft.label}
        onChange={(event) => update({ ...draft, label: event.target.value })}
        className={`${FIELD} mt-1 w-full`}
      />
      <Problem id={`${uid}-name-problem`} message={shown("label")} />

      <FormSection
        title="Reply markers"
        hint="When a thread's last reply starts with this text, the card takes that status."
        addLabel="Add reply marker"
        onAdd={() => add("replyMarkers", { marker: "", status: "working" })}
      >
        {draft.replyMarkers.map((row, index) => (
          <div key={index} className="flex items-start gap-1.5">
            <TextCell label={`Reply marker ${index + 1} text`} value={row.marker} onChange={(marker) => edit("replyMarkers", index, { marker })} problem={shown(`replyMarkers.${index}.marker`)} problemId={`${uid}-rm-${index}`} />
            <StatusSelect label={`Reply marker ${index + 1} status`} value={row.status} onChange={(status) => edit("replyMarkers", index, { status })} />
            <RemoveButton label={`Remove reply marker ${index + 1}`} onClick={() => remove("replyMarkers", index)} />
          </div>
        ))}
      </FormSection>

      <FormSection
        title="Skill statuses"
        hint="When this skill runs, the card takes that status."
        addLabel="Add skill status"
        onAdd={() => add("skillStatuses", { skill: "", status: "working" })}
      >
        {draft.skillStatuses.map((row, index) => (
          <div key={index} className="flex items-start gap-1.5">
            <TextCell label={`Skill status ${index + 1} skill`} value={row.skill} onChange={(skill) => edit("skillStatuses", index, { skill })} problem={shown(`skillStatuses.${index}.skill`)} problemId={`${uid}-ss-${index}`} />
            <StatusSelect label={`Skill status ${index + 1} status`} value={row.status} onChange={(status) => edit("skillStatuses", index, { status })} />
            <RemoveButton label={`Remove skill status ${index + 1}`} onClick={() => remove("skillStatuses", index)} />
          </div>
        ))}
      </FormSection>

      <FormSection
        title="Skill labels"
        hint="When this skill runs, the card shows the label until another label or a reset replaces it."
        addLabel="Add skill label"
        onAdd={() => add("skillLabels", { skill: "", label: "" })}
      >
        {draft.skillLabels.map((row, index) => (
          <div key={index} className="flex flex-wrap items-start gap-1.5">
            <TextCell label={`Skill label ${index + 1} skill`} value={row.skill} onChange={(skill) => edit("skillLabels", index, { skill })} problem={shown(`skillLabels.${index}.skill`)} problemId={`${uid}-sl-${index}-skill`} />
            <TextCell label={`Skill label ${index + 1} text`} value={row.label} onChange={(label) => edit("skillLabels", index, { label })} problem={shown(`skillLabels.${index}.label`)} problemId={`${uid}-sl-${index}-label`} />
            <span
              aria-hidden
              className="mt-2 size-2.5 shrink-0 rounded-full border border-border"
              style={{ background: row.tone ? LABEL_TONE_COLOURS[row.tone] : "transparent" }}
            />
            <select
              aria-label={`Skill label ${index + 1} tone`}
              value={row.tone ?? ""}
              onChange={(event) => edit("skillLabels", index, { tone: event.target.value === "" ? undefined : (event.target.value as (typeof LABEL_TONES)[number]) })}
              className={FIELD}
            >
              <option value="">Default tone</option>
              {LABEL_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {tone[0]!.toUpperCase() + tone.slice(1)}
                </option>
              ))}
            </select>
            <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch
                label={`Skill label ${index + 1} show build progress`}
                checked={row.progress === "slices"}
                onChange={(on) => edit("skillLabels", index, { progress: on ? "slices" : undefined })}
              />
              Show build progress
            </span>
            <RemoveButton label={`Remove skill label ${index + 1}`} onClick={() => remove("skillLabels", index)} />
          </div>
        ))}
      </FormSection>

      <FormSection
        title="Label resets"
        hint="When this skill runs, the current label is cleared."
        addLabel="Add label reset"
        onAdd={() => add("labelResets", { skill: "" })}
      >
        {draft.labelResets.map((row, index) => (
          <div key={index} className="flex items-start gap-1.5">
            <TextCell label={`Label reset ${index + 1} skill`} value={row.skill} onChange={(skill) => edit("labelResets", index, { skill })} problem={shown(`labelResets.${index}.skill`)} problemId={`${uid}-lr-${index}`} />
            <RemoveButton label={`Remove label reset ${index + 1}`} onClick={() => remove("labelResets", index)} />
          </div>
        ))}
      </FormSection>

      {attempted && problems.size > 0 ? (
        <p role="alert" className="mt-2 text-2xs text-destructive">
          Not saved: fix the highlighted fields.
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="mt-2 text-2xs text-destructive">
          {saveError}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button type="button" className={BUTTON} onClick={() => void save()}>
          Save rule set
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">Edit as JSON</summary>
        <textarea
          aria-label={`${set.label} rule set JSON`}
          aria-invalid={jsonError !== null}
          value={json}
          onChange={(event) => setJson(event.target.value)}
          rows={10}
          spellCheck={false}
          className="mt-1.5 w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
        />
        {jsonError ? (
          <p role="alert" className="mt-1 text-2xs text-destructive">
            {jsonError}
          </p>
        ) : null}
        <button type="button" className={`${BUTTON} mt-1.5`} onClick={applyJson}>
          Apply JSON to form
        </button>
      </details>
    </div>
  );
}

/** One rule set: accessible on/off switch plus an inline form editor. */
export function RuleSetRow({
  set,
  onToggle,
  onSave,
  onRemove,
  canRemove,
}: {
  set: AttentionRuleSet;
  onToggle: (enabled: boolean) => void;
  onSave: (next: AttentionRuleSet) => Promise<string | null>;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const counts = [
    [set.replyMarkers.length, "reply markers"],
    [set.skillStatuses.length, "skill statuses"],
    [set.skillLabels.length, "skill labels"],
    [set.labelResets.length, "label resets"],
  ] as const;

  return (
    <li>
      <SettingRow
        title={set.label}
        description={counts.filter(([count]) => count > 0).map(([count, name]) => `${count} ${name}`).join(", ") || "No rules"}
        control={
          <div className="flex items-center gap-2">
            <button type="button" className={BUTTON} aria-expanded={editing} onClick={() => setEditing(!editing)}>
              {editing ? "Close" : `Edit ${set.label}`}
            </button>
            <button type="button" className={BUTTON} disabled={!canRemove} aria-label={`Remove ${set.label}`} onClick={() => setConfirming(true)}>
              Remove
            </button>
            <Switch label={set.label} checked={set.enabled} onChange={onToggle} />
          </div>
        }
      />
      {!canRemove ? <p className="px-4 pb-2 text-2xs text-muted-foreground">{LAST_SET_NOTE}</p> : null}
      {confirming ? (
        <div role="alertdialog" aria-label={`Remove ${set.label}?`} className="flex flex-wrap items-center gap-2 px-4 pb-2.5">
          <p className="text-xs text-foreground">Remove {set.label} and all its rules? This cannot be undone.</p>
          <button type="button" className={BUTTON} aria-label={`Remove rule set ${set.label}`}
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
          >
            Remove rule set
          </button>
          <button type="button" className={BUTTON} autoFocus onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : null}
      {editing ? (
        <RuleSetForm
          set={set}
          onSave={async (next) => {
            const failure = await onSave(next);
            if (!failure) setEditing(false);
            return failure;
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </li>
  );
}

/** "Add rule set": a name becomes the label and the derived id; the new set starts enabled and empty. */
export function AddRuleSetForm({ onAdd }: { onAdd: (name: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const uid = useId();

  const close = () => {
    setOpen(false);
    setName("");
    setError(null);
  };
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const failure = await onAdd(name);
    inFlight.current = false;
    setSaving(false);
    if (failure) setError(failure);
    else close();
  };

  if (!open) {
    return (
      <div className="px-4 py-2.5">
        <button type="button" className={BUTTON} onClick={() => setOpen(true)}>
          Add rule set
        </button>
      </div>
    );
  }
  return (
    <div className="px-4 py-2.5">
      <label className="block text-xs font-medium text-foreground" htmlFor={`${uid}-new-name`}>
        New rule set name
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={`${uid}-new-name`}
          type="text"
          autoFocus
          aria-invalid={error !== null}
          aria-describedby={error ? `${uid}-new-problem` : undefined}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
            if (event.key === "Escape") close();
          }}
          className={`${FIELD} flex-1`}
        />
        <button type="button" className={BUTTON} disabled={saving} onClick={() => void submit()}>
          Create rule set
        </button>
        <button type="button" className={BUTTON} onClick={close}>
          Cancel
        </button>
      </div>
      <Problem id={`${uid}-new-problem`} message={error ?? undefined} />
    </div>
  );
}

/** Global ticket prefixes, committed on blur or Enter as one whole-document save. */
export function TicketPrefixField({
  prefixes,
  onCommit,
}: {
  prefixes: readonly string[];
  onCommit: (prefixes: string[]) => Promise<string | null>;
}) {
  const stored = prefixes.join(", ");
  const [draft, setDraft] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  const commit = async () => {
    const next = splitPrefixInput(draft);
    if (next.join(", ") === stored) {
      setError(null);
      return;
    }
    setError(await onCommit(next));
  };

  return (
    <SettingRow title="Ticket prefixes" description="Comma-separated, for example WS-, AID-. Applied to every project.">
      <input
        type="text"
        aria-label="Ticket prefixes"
        aria-invalid={error !== null}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
        }}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
      />
      {error ? <p role="alert" className="mt-1 text-2xs text-destructive">{error}</p> : null}
    </SettingRow>
  );
}

/**
 * The sidebar-wide silence threshold and the global attention rules. Rules live
 * in one file owned by the host; every read, install, reload, and save goes
 * through the server's rules RPCs, and the global channel refreshes this view
 * after a hand edit. Opening or reloading never installs the example.
 */
export function AttentionSettings({
  silenceThresholdMinutes,
  onSilenceThresholdChange,
}: {
  silenceThresholdMinutes: number;
  onSilenceThresholdChange: (minutes: number) => void;
}) {
  const rpc = useRpc<typeof bbSidebarRpcContract>();
  const [state, setState] = useState<AttentionRulesState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (call: () => Promise<AttentionRulesState>): Promise<AttentionRulesState | null> => {
      try {
        const next = await call();
        if (mounted.current) {
          setState(next);
          setLoadError(null);
        }
        return next;
      } catch (error) {
        if (mounted.current) setLoadError(errorText(error));
        return null;
      }
    },
    [],
  );

  const load = useCallback(() => run(() => rpc.call("getAttentionRules", {})), [rpc, run]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime(ATTENTION_RULES_CHANNEL, () => {
    void load();
  });

  const reload = async () => {
    setBusy(true);
    setNotice(null);
    const next = await run(() => rpc.call("reloadAttentionRules", {}));
    setBusy(false);
    if (next) setNotice(next.file === "absent" ? "Reloaded: no rules file yet." : next.retained ? "Reloaded: the file is invalid; the last valid rules stay active." : "Rules reloaded.");
  };

  const install = async () => {
    setBusy(true);
    setNotice(null);
    const next = await run(() => rpc.call("installAttentionRulesExample", {}));
    setBusy(false);
    if (next) setNotice("Example rules installed.");
  };

  /** Saves the complete document; resolves to an error message, or null on success. */
  const saveDocument = async (document: AttentionRulesDocument): Promise<string | null> => {
    try {
      const next = await rpc.call("saveAttentionRules", { content: serialize(document) });
      if (mounted.current) {
        setState(next);
        setLoadError(null);
        setNotice(null);
      }
      // A host write failure comes back as state.problem, not a thrown error; the file is unchanged.
      return next.problem ? `Not saved: ${next.problem}` : null;
    } catch (error) {
      return errorText(error);
    }
  };

  const document = state?.document ?? null;
  const reportSaveFailure = async (document_: AttentionRulesDocument) => {
    const failure = await saveDocument(document_);
    if (failure) setLoadError(failure);
  };
  const showWatcherFallback = state !== null && state.watcher.status === "unavailable";

  return (
    <>
      <SettingRow title="Silence threshold" description="Minutes of silent background work before a card turns Check?.">
        <SilenceThresholdField minutes={silenceThresholdMinutes} onChange={onSilenceThresholdChange} />
      </SettingRow>
      <SettingsGroup title="Attention rules">
        {state === null && loadError === null ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading rules...</p>
        ) : null}
        {loadError ? (
          <p role="alert" className="px-4 py-2.5 text-xs text-destructive">
            {loadError}
          </p>
        ) : null}
        {state?.problem ? (
          <p role="alert" className="px-4 py-2.5 text-xs text-destructive">
            Could not reach the rules file: {state.problem}
          </p>
        ) : null}
        {showWatcherFallback ? (
          <p role="status" className="px-4 py-2.5 text-xs text-muted-foreground">
            Automatic reload is off ({state.watcher.message ?? "the host watcher is unavailable"}). Use Reload rules after editing the file.
          </p>
        ) : null}
        {state && state.diagnostics.length > 0 ? (
          <div role="alert" className="px-4 py-2.5">
            <p className="text-xs text-destructive">
              {state.retained
                ? "The rules file is invalid. The last valid rules stay active."
                : document
                  ? "Some rules in the file are not applied."
                  : "The rules file is invalid. No custom rules are active."}
            </p>
            <ul className="mt-1 list-disc pl-4 text-2xs text-destructive">
              {state.diagnostics.map((item, index) => (
                <li key={`${item.path}-${index}`}>
                  {item.path}: {item.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {state?.file === "absent" ? (
          <div className="px-4 py-2.5">
            <p className="text-sm text-foreground">No rules file yet.</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Without one, cards use only BB's own status. Install the example rules, then edit them here or in the file.
            </p>
            <button type="button" className={`${BUTTON} mt-2`} disabled={busy} onClick={() => void install()}>
              Install example rules
            </button>
          </div>
        ) : null}
        {document ? (
          <>
            <ul aria-label="Rule sets">
              {document.ruleSets.map((set) => (
                <RuleSetRow
                  key={set.id}
                  set={set}
                  onToggle={(enabled) =>
                    void reportSaveFailure({
                      ...document,
                      ruleSets: document.ruleSets.map((candidate) => (candidate.id === set.id ? { ...candidate, enabled } : candidate)),
                    })
                  }
                  onSave={(next) =>
                    saveDocument({
                      ...document,
                      ruleSets: document.ruleSets.map((candidate) => (candidate.id === set.id ? next : candidate)),
                    })
                  }
                  canRemove={document.ruleSets.length > 1}
                  onRemove={() =>
                    void reportSaveFailure({
                      ...document,
                      ruleSets: document.ruleSets.filter((candidate) => candidate.id !== set.id),
                    })
                  }
                />
              ))}
            </ul>
            <AddRuleSetForm
              onAdd={async (name) => {
                const added = addRuleSet(document, name);
                return added.ok ? saveDocument(added.document) : added.reason;
              }}
            />
            <TicketPrefixField prefixes={document.ticketPrefixes} onCommit={(ticketPrefixes) => saveDocument({ ...document, ticketPrefixes })} />
          </>
        ) : null}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void reload()}>
            Reload rules
          </button>
          {notice ? (
            <span role="status" className="text-xs text-muted-foreground">
              {notice}
            </span>
          ) : null}
        </div>
      </SettingsGroup>
    </>
  );
}
