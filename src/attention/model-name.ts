const FAMILY_ABBREVIATIONS: Readonly<Record<string, string>> = {
  opus: "op",
  sonnet: "so",
  haiku: "ha",
  fable: "fa",
};

function findFamily(segments: readonly string[]): { abbreviation: string; index: number } | null {
  if (segments[0] === "gpt") return { abbreviation: "gpt", index: 0 };
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
