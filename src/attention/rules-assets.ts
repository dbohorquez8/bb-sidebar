import { toJSONSchema } from "zod";
import { attentionRulesDocumentSchema, ATTENTION_RULES_SCHEMA_ID } from "./rules";

// Keep the runtime contract and published schema coupled. The checked-in JSON
// artifact is the portable documentation copy; this export is the packaged API.
export const attentionRulesJsonSchema = {
  ...toJSONSchema(attentionRulesDocumentSchema),
  $id: ATTENTION_RULES_SCHEMA_ID,
} as const;

export const ATTENTION_RULES_EXAMPLE = {
  $schema: ATTENTION_RULES_SCHEMA_ID,
  version: 1,
  ticketPrefixes: ["WS-", "AID-"],
  ruleSets: [
    {
      id: "adhd-ish",
      label: "adhd-ish",
      enabled: true,
      replyMarkers: [
        { marker: "🔴 NEEDS YOU", status: "needs-you" },
        { marker: "🟢", status: "background" },
        { marker: "🟡", status: "working" },
        { marker: "⚪", status: "done" },
      ],
      skillStatuses: [], skillLabels: [], labelResets: [],
    },
    {
      id: "ddd",
      label: "DDD",
      enabled: true,
      replyMarkers: [], skillStatuses: [],
      skillLabels: [
        { skill: "ddd:scaffold", label: "Scaffolding" },
        { skill: "ddd:explore", label: "Exploring" },
        { skill: "ddd:propose", label: "Proposing" },
        { skill: "ddd:spec", label: "Specifying" },
        { skill: "ddd:validation-plan", label: "Validating" },
        { skill: "ddd:plan", label: "Planning" },
        { skill: "ddd:slice", label: "Slicing" },
        { skill: "ddd:dispatch", label: "Building", progress: "slices" },
        { skill: "ddd:verify", label: "Verifying" },
        { skill: "ddd:push", label: "Shipping" },
        { skill: "finalize", label: "Finalizing" },
      ],
      labelResets: [{ skill: "implement" }, { skill: "ddd:scaffold" }],
    },
    {
      id: "coding-loop",
      label: "coding-loop",
      enabled: true,
      replyMarkers: [], skillStatuses: [], labelResets: [],
      skillLabels: [{ skill: "coding-loop", label: "Looping" }],
    },
  ],
} as const;

export const ATTENTION_RULES_EXAMPLE_JSON = `${JSON.stringify(ATTENTION_RULES_EXAMPLE, null, 2)}\n`;

/** Legacy preset ids → the rule-set ids that carry the same data in the example. */
export const LEGACY_PRESET_RULE_SET: Readonly<Record<string, string>> = {
  "adhd-ish-state-markers": "adhd-ish",
  "ddd-workflow": "ddd",
  "coding-loop-workflow": "coding-loop",
};
