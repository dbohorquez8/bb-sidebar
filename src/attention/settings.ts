export function splitPrefixInput(input: string): string[] {
  return input.split(",").map((part) => part.trim());
}

export const ATTENTION_CHANNEL = "attention";
export const PROJECT_ATTENTION_CHANNEL = "project-attention";
export const ATTENTION_RULES_CHANNEL = "attention-rules";
