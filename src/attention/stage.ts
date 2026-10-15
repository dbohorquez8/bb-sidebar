import type { ThreadEventRowLike } from "./types";

interface ToolCallStartedData {
  item?: { type?: string; tool?: string; arguments?: { skill?: unknown } };
}

interface TurnRequestedMention {
  resource?: { kind?: string; source?: string; name?: string };
}

interface TurnRequestedInputBlock {
  mentions?: readonly TurnRequestedMention[];
}

interface TurnRequestedData {
  input?: readonly TurnRequestedInputBlock[];
}

export function extractStepInvocation(row: ThreadEventRowLike): string | null {
  if (row.type === "item/started") {
    const data = row.data as ToolCallStartedData;
    if (data.item?.type === "toolCall" && data.item.tool === "Skill") {
      const skill = data.item.arguments?.skill;
      if (typeof skill === "string" && skill.length > 0) {
        return skill.startsWith("/") ? skill.slice(1) : skill;
      }
    }
    return null;
  }

  if (row.type === "client/turn/requested") {
    const data = row.data as TurnRequestedData;
    let lastName: string | null = null;
    for (const block of data.input ?? []) {
      for (const mention of block.mentions ?? []) {
        const resource = mention.resource;
        if (
          resource?.kind === "command" &&
          resource.source === "skill" &&
          typeof resource.name === "string"
        ) {
          lastName = resource.name;
        }
      }
    }
    return lastName;
  }

  return null;
}
