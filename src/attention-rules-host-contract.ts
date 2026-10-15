import { z } from "zod";

/** The one portable file managed by the host entry. */
export const ATTENTION_RULES_FILENAME = "attention-rules.json";

export const attentionRulesFileSchema = z.object({
  exists: z.boolean(),
  content: z.string().nullable(),
}).strict();

export const attentionRulesHostMethods = {
  readAttentionRules: {
    input: z.object({}).strict(),
    output: attentionRulesFileSchema,
  },
  writeAttentionRules: {
    input: z.object({ content: z.string().max(1_000_000) }).strict(),
    output: attentionRulesFileSchema,
  },
  installAttentionRulesExample: {
    input: z.object({ content: z.string().min(1).max(1_000_000) }).strict(),
    output: attentionRulesFileSchema,
  },
  watchAttentionRules: {
    input: z.object({}).strict(),
    output: z.object({ watching: z.boolean(), error: z.string().optional() }).strict(),
  },
} as const;

export const attentionRulesHostSignals = {
  attentionRulesChanged: { payload: attentionRulesFileSchema },
  attentionRulesWatchError: { payload: z.object({ message: z.string().min(1) }).strict() },
} as const;
