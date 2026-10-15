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
      replyMarkers: [], skillStatuses: [], labelResets: [],
      skillLabels: [{ skill: "finalize", label: "Finalizing", tone: "primary" }],
    },
    {
      id: "coding-loop",
      label: "coding-loop",
      enabled: true,
      replyMarkers: [], skillStatuses: [], skillLabels: [], labelResets: [],
    },
  ],
} as const;

export const ATTENTION_RULES_EXAMPLE_JSON = `${JSON.stringify(ATTENTION_RULES_EXAMPLE, null, 2)}\n`;
