type Evidence = { quote: string; startChar: number; endChar: number };

function stripWrappingQuotes(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2) return trimmed;

  const starts = trimmed[0];
  const ends = trimmed[trimmed.length - 1];
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["\u201C", "\u201D"], // “ ”
    ["\u2018", "\u2019"], // ‘ ’
    ["\u00AB", "\u00BB"], // « »
  ];

  for (const [l, r] of pairs) {
    if (starts === l && ends === r) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

function buildWhitespaceNormalizedTextWithMap(original: string): { normalized: string; mapToOriginal: number[] } {
  const mapToOriginal: number[] = [];
  let normalized = "";
  let inWhitespace = false;

  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    const isWs = /\s/.test(ch);

    if (isWs) {
      if (normalized.length === 0) {
        inWhitespace = true;
        continue;
      }
      if (!inWhitespace) {
        normalized += " ";
        mapToOriginal.push(i);
        inWhitespace = true;
      }
      continue;
    }

    inWhitespace = false;
    normalized += ch;
    mapToOriginal.push(i);
  }

  // Trim trailing space (and the corresponding map entry)
  if (normalized.endsWith(" ")) {
    normalized = normalized.slice(0, -1);
    mapToOriginal.pop();
  }

  return { normalized, mapToOriginal };
}

function normalizeForSearch(text: string): string {
  return normalizeQuotes(stripWrappingQuotes(text))
    .trim()
    .replace(/\s+/g, " ");
}

export function verifyEvidence(
  bundleText: string,
  evidence: Evidence
): { valid: boolean; reason?: string; correctedOffsets?: { start: number; end: number } } {
  const rawQuote = evidence.quote ?? "";

  // 1. Strict match using provided offsets.
  if (evidence.startChar >= 0 && evidence.endChar <= bundleText.length && evidence.startChar < evidence.endChar) {
    const extracted = bundleText.substring(evidence.startChar, evidence.endChar);
    if (extracted === rawQuote) {
      return { valid: true };
    }
  }

  // 2. Exact search.
  const exactIndex = bundleText.indexOf(rawQuote);
  if (exactIndex !== -1) {
    return { valid: true, correctedOffsets: { start: exactIndex, end: exactIndex + rawQuote.length } };
  }

  // 3. Try trimmed / unwrapped / quote-normalized search.
  const canonicalQuote = normalizeQuotes(stripWrappingQuotes(rawQuote));
  if (canonicalQuote.trim().length > 0) {
    const idx = bundleText.indexOf(canonicalQuote);
    if (idx !== -1) {
      return { valid: true, correctedOffsets: { start: idx, end: idx + canonicalQuote.length } };
    }
  }

  // 4. Whitespace-normalized search with offset mapping back to original bundle.
  const needle = normalizeForSearch(rawQuote);
  if (needle.length > 0) {
    const { normalized: hay, mapToOriginal } = buildWhitespaceNormalizedTextWithMap(bundleText);
    const hayNorm = normalizeQuotes(hay);
    const needleNorm = normalizeQuotes(needle);
    const found = hayNorm.indexOf(needleNorm);
    if (found !== -1) {
      const startOriginal = mapToOriginal[found] ?? 0;
      const endOriginalInclusive = mapToOriginal[found + needleNorm.length - 1] ?? startOriginal;
      return {
        valid: true,
        correctedOffsets: { start: startOriginal, end: endOriginalInclusive + 1 },
      };
    }
  }

  if (rawQuote.length > 500) {
    return { valid: false, reason: "Quote too long" };
  }

  return { valid: false, reason: "Quote mismatch" };
}
