import { z } from "zod";

/** The only document version understood by the portable v1 contract. */
export const ATTENTION_RULES_VERSION = 1 as const;
export const ATTENTION_RULES_SCHEMA_ID = "./attention-rules.schema.json";

export const LABEL_TONES = ["muted", "primary", "success", "warning", "danger"] as const;
const statusSchema = z.enum(["needs-you", "working", "background", "done"]);
const exactText = z.string().trim().min(1).max(200);
const identifier = z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9-]*$/);

const replyMarkerSchema = z.object({ marker: exactText, status: statusSchema }).strict();
const skillStatusSchema = z.object({ skill: exactText, status: statusSchema }).strict();
const skillLabelSchema = z.object({
  skill: exactText,
  label: z.string().trim().min(1).max(120),
  tone: z.enum(LABEL_TONES).optional(),
  /** "slices": the label also shows finished/total build slices when the thread reports them. */
  progress: z.literal("slices").optional(),
}).strict();
const labelResetSchema = z.object({ skill: exactText }).strict();

export const attentionRuleSetSchema = z.object({
  id: identifier,
  label: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  replyMarkers: z.array(replyMarkerSchema).max(100).default([]),
  skillStatuses: z.array(skillStatusSchema).max(100).default([]),
  skillLabels: z.array(skillLabelSchema).max(100).default([]),
  labelResets: z.array(labelResetSchema).max(100).default([]),
}).strict();

export const attentionRulesDocumentSchema = z.object({
  $schema: z.literal(ATTENTION_RULES_SCHEMA_ID).optional(),
  version: z.literal(ATTENTION_RULES_VERSION),
  ticketPrefixes: z.array(z.string().trim().min(1).max(16).regex(/^[^\s,]+$/)).max(100).default([]),
  ruleSets: z.array(attentionRuleSetSchema).min(1).max(100),
}).strict().superRefine((document, context) => {
  const ids = new Set<string>();
  document.ruleSets.forEach((set, index) => {
    if (ids.has(set.id)) context.addIssue({ code: "custom", path: ["ruleSets", index, "id"], message: "Rule-set ids must be unique." });
    ids.add(set.id);
  });
});

export type AttentionRulesDocument = z.infer<typeof attentionRulesDocumentSchema>;
export type AttentionRuleSet = z.infer<typeof attentionRuleSetSchema>;
export type AttentionRuleDiagnostic = { path: string; message: string };

export type ParsedRules = {
  document: AttentionRulesDocument | null;
  diagnostics: readonly AttentionRuleDiagnostic[];
};

function diagnostics(error: z.ZodError): AttentionRuleDiagnostic[] {
  return error.issues.map((issue) => ({ path: issue.path.join(".") || "document", message: issue.message }));
}

/** Parses only declarative data. Unknown keys are errors, never capabilities. */
export function parseAttentionRules(input: unknown): ParsedRules {
  const parsed = attentionRulesDocumentSchema.safeParse(input);
  if (parsed.success) return { document: parsed.data, diagnostics: [] };

  // A malformed envelope cannot name a versioned document. Inside a sound v1
  // envelope, however, discard only bad declarative members so one typo does
  // not disable an independent safe rule.
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { document: null, diagnostics: diagnostics(parsed.error) };
  }
  const raw = input as Record<string, unknown>;
  if (raw.version !== ATTENTION_RULES_VERSION || !Array.isArray(raw.ruleSets)) {
    return { document: null, diagnostics: diagnostics(parsed.error) };
  }

  const found: AttentionRuleDiagnostic[] = diagnostics(parsed.error);
  const sets: AttentionRuleSet[] = [];
  const ids = new Set<string>();
  raw.ruleSets.forEach((candidate, setIndex) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const value = candidate as Record<string, unknown>;
    const header = z.object({ id: identifier, label: z.string().trim().min(1).max(120), enabled: z.boolean() }).strict()
      .safeParse({ id: value.id, label: value.label, enabled: value.enabled });
    if (!header.success || ids.has(String(value.id))) return;
    ids.add(header.data.id);
    const parseRules = <T>(key: string, schema: z.ZodType<T>): T[] => {
      if (value[key] === undefined) return [];
      if (!Array.isArray(value[key])) return [];
      return value[key].flatMap((rule, ruleIndex) => {
        const result = schema.safeParse(rule);
        if (result.success) return [result.data];
        found.push(...diagnostics(result.error).map((problem) => ({
          ...problem, path: `ruleSets.${setIndex}.${key}.${ruleIndex}${problem.path === "document" ? "" : `.${problem.path}`}`,
        })));
        return [];
      });
    };
    const set = attentionRuleSetSchema.safeParse({
      ...header.data,
      replyMarkers: parseRules("replyMarkers", replyMarkerSchema),
      skillStatuses: parseRules("skillStatuses", skillStatusSchema),
      skillLabels: parseRules("skillLabels", skillLabelSchema),
      labelResets: parseRules("labelResets", labelResetSchema),
    });
    if (set.success) sets.push(set.data);
  });
  const prefixes = Array.isArray(raw.ticketPrefixes)
    ? raw.ticketPrefixes.flatMap((prefix, index) => {
        const result = z.string().trim().min(1).max(16).regex(/^[^\s,]+$/).safeParse(prefix);
        if (result.success) return [result.data];
        found.push(...diagnostics(result.error).map((problem) => ({ ...problem, path: `ticketPrefixes.${index}` })));
        return [];
      })
    : [];
  return sets.length > 0
    ? { document: { version: ATTENTION_RULES_VERSION, ...(raw.$schema === ATTENTION_RULES_SCHEMA_ID ? { $schema: ATTENTION_RULES_SCHEMA_ID } : {}), ticketPrefixes: prefixes, ruleSets: sets }, diagnostics: found }
    : { document: null, diagnostics: found };
}

/** Global selection is deliberately independent of any project or host object. */
export function selectedRuleSets(document: AttentionRulesDocument | null | undefined): readonly AttentionRuleSet[] {
  return document?.ruleSets.filter((set) => set.enabled) ?? [];
}

export function selectedTicketPrefixes(document: AttentionRulesDocument | null | undefined): readonly string[] {
  return [...new Set(document?.ticketPrefixes ?? [])];
}

export type NeutralRuleEvent =
  | { kind: "reply"; text: string | null }
  | { kind: "skill"; skill: string };

export type RuleLabel = {
  text: string;
  tone?: z.infer<typeof skillLabelSchema>["tone"];
  progress?: z.infer<typeof skillLabelSchema>["progress"];
};
export type RuleOutcome = { status: z.infer<typeof statusSchema> | null; label: RuleLabel | null };

/**
 * Fold one neutral event. It receives no SDK row, browser value, filesystem
 * handle, or sidebar object; callers persist its result, never reply text.
 */
export function evaluateRuleEvent(
  document: AttentionRulesDocument | null | undefined,
  previous: RuleOutcome = { status: null, label: null },
  event: NeutralRuleEvent,
): RuleOutcome {
  if (!document) return previous;
  const sets = selectedRuleSets(document);
  if (event.kind === "reply") {
    if (!event.text) return previous;
    // A marker matches at the start of a line (emoji variation selectors ignored);
    // the longest marker wins within a line and the last matching line wins.
    const normalize = (value: string) => value.replace(/\uFE0F/g, "");
    let status = previous.status;
    for (const line of event.text.split(/\r?\n/)) {
      const text = normalize(line.trimStart());
      let longest = -1;
      for (const set of sets) {
        for (const rule of set.replyMarkers) {
          const marker = normalize(rule.marker);
          if (text.startsWith(marker) && marker.length >= longest) {
            longest = marker.length;
            status = rule.status;
          }
        }
      }
    }
    return { ...previous, status };
  }

  let label = previous.label;
  let status = previous.status;
  for (const set of sets) {
    if (set.labelResets.some((rule) => rule.skill === event.skill)) label = null;
    for (const rule of set.skillLabels) {
      if (rule.skill === event.skill) label = { text: rule.label, ...(rule.tone ? { tone: rule.tone } : {}), ...(rule.progress ? { progress: rule.progress } : {}) };
    }
    for (const rule of set.skillStatuses) if (rule.skill === event.skill) status = rule.status;
  }
  return { status, label };
}

/** Every skill name any selected rule set reacts to. */
export function ruleSkills(document: AttentionRulesDocument | null | undefined): ReadonlySet<string> {
  const skills = new Set<string>();
  for (const set of selectedRuleSets(document)) {
    for (const rule of [...set.skillStatuses, ...set.skillLabels, ...set.labelResets]) skills.add(rule.skill);
  }
  return skills;
}

/** True when invoking the skill resets the label under a selected rule set. */
export function resetsLabel(document: AttentionRulesDocument | null | undefined, skill: string): boolean {
  return selectedRuleSets(document).some((set) => set.labelResets.some((rule) => rule.skill === skill));
}

export function rulesVersionOf(document: AttentionRulesDocument | null | undefined): number | null {
  return document?.version ?? null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Bumped when the meaning of stored observations changes, so every record is
 * rebuilt from the history once. 2: /clear resets sticky state (WS-70).
 */
const OBSERVATION_REVISION = 2;

/**
 * Stamp of one active document's content: it changes whenever any rule, label,
 * enabled flag, or prefix changes and is stable across restarts. Stored
 * observations carry it so records made under other rules are rebuilt.
 */
export function rulesDocumentVersion(document: AttentionRulesDocument | null | undefined): string | null {
  if (!document) return null;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const char of `r${OBSERVATION_REVISION}\u0000${canonicalJson(document)}`) {
    const code = char.codePointAt(0)!;
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `v${ATTENTION_RULES_VERSION}-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}
