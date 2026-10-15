import { ATTENTION_RULES_VERSION, type AttentionRulesDocument } from "./rules";
import { LEGACY_PRESET_RULE_SET } from "./rules-assets";

/** Legacy project attention row, as stored before the global rules file. */
export interface LegacyProjectAttentionRow {
  presets: readonly unknown[];
  ticketPrefixes: readonly unknown[];
}

export interface GlobalAttentionSelection {
  ruleSetIds: string[];
  ticketPrefixes: string[];
}

/**
 * Union of every project's enabled presets and prefixes, once each. Unknown,
 * disabled, empty, and invalid values contribute nothing.
 */
export function migrateLegacyAttention(rows: readonly LegacyProjectAttentionRow[]): GlobalAttentionSelection {
  const ruleSetIds = new Set<string>();
  const ticketPrefixes = new Set<string>();
  for (const row of rows) {
    for (const preset of row.presets) {
      const id = typeof preset === "string" ? LEGACY_PRESET_RULE_SET[preset] : undefined;
      if (id) ruleSetIds.add(id);
    }
    for (const prefix of row.ticketPrefixes) {
      if (typeof prefix !== "string" || prefix.length === 0 || prefix.length > 16 || /[\s,]/.test(prefix)) continue;
      ticketPrefixes.add(prefix);
    }
  }
  return { ruleSetIds: [...ruleSetIds], ticketPrefixes: [...ticketPrefixes] };
}

/** Applies a migrated global selection to a document that is about to be installed. */
export function applyGlobalSelection(
  document: AttentionRulesDocument,
  selection: GlobalAttentionSelection | null,
): AttentionRulesDocument {
  if (!selection || (selection.ruleSetIds.length === 0 && selection.ticketPrefixes.length === 0)) return document;
  return {
    ...document,
    version: ATTENTION_RULES_VERSION,
    ticketPrefixes: selection.ticketPrefixes.length > 0 ? selection.ticketPrefixes : document.ticketPrefixes,
    ruleSets: selection.ruleSetIds.length > 0
      ? document.ruleSets.map((set) => ({ ...set, enabled: selection.ruleSetIds.includes(set.id) }))
      : document.ruleSets,
  };
}
