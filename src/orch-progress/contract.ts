import { z } from "zod";

export const orchTicketSchema = z.object({
  id: z.string().min(1),
  phase: z.string().nullable(),
  stopKind: z.string().nullable(),
  // True only for a non-empty string (after trim) or a non-empty object/array.
  hasQuestion: z.boolean(),
  verification: z.string().nullable(),
  threadId: z.string().nullable(),
});

// One entry per groups/<id>/ledger.md found on a host.
export const orchGroupEntrySchema = z.discriminatedUnion("readable", [
  z.object({ readable: z.literal(false), groupId: z.string(), mtimeMs: z.number() }),
  z.object({
    readable: z.literal(true),
    groupId: z.string(),
    mtimeMs: z.number(),
    caller: z.string().min(1),
    epic: z.string().nullable(),
    tickets: z.array(orchTicketSchema).max(500),
  }),
]);

export type OrchTicket = z.infer<typeof orchTicketSchema>;
export type OrchGroupEntry = z.infer<typeof orchGroupEntrySchema>;

export const ORCH_MAX_TICKETS = 500;
export const ORCH_MAX_GROUPS = 2000;

/** Host methods spread into `portScanContract`. */
export const orchProgressHostMethods = {
  readOrchestratorGroups: {
    input: z.object({}),
    output: z.object({ groups: z.array(orchGroupEntrySchema).max(ORCH_MAX_GROUPS) }),
  },
} as const;
