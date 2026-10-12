const FAMILY_ABBREVIATIONS: Readonly<Record<string, string>> = {
  fable: "F",
  opus: "O",
  sonnet: "S",
  haiku: "H",
};

function findFamily(segments: readonly string[]): { abbreviation: string; index: number } | null {
  // Codex ids name the tier after the version ("gpt-5.6-terra"): the tier's
  // initial (A, S, T, L) leads, and the version still follows it.
  if (segments[0] === "gpt") {
    const tier = segments.slice(1).find((segment) => /^[a-z]+$/.test(segment));
    return { abbreviation: tier ? tier[0].toUpperCase() : "G", index: 0 };
  }
  for (const [index, segment] of segments.entries()) {
    const abbreviation = FAMILY_ABBREVIATIONS[segment];
    if (abbreviation) return { abbreviation, index };
  }
  return null;
}

export function shortModelName(model: string | null | undefined): string | null {
  if (!model) return null;
  let stripped = model;
  while (/\[[^[\]]*\]$/.test(stripped)) {
    stripped = stripped.slice(0, stripped.lastIndexOf("["));
  }

  const segments = stripped.split(/[-/]/);
  const family = findFamily(segments);
  if (!family) return stripped;

  const versionParts: string[] = [];
  for (let index = family.index + 1; index < segments.length; index++) {
    const segment = segments[index];
    if (/^\d{8}$/.test(segment)) continue;
    if (/^\d+(\.\d+)*$/.test(segment)) {
      versionParts.push(segment);
      continue;
    }
    break;
  }

  return versionParts.length > 0 ? `${family.abbreviation}${versionParts.join(".")}` : family.abbreviation;
}
