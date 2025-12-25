export function verifyEvidence(
  bundleText: string,
  evidence: { quote: string; startChar: number; endChar: number }
): { valid: boolean; reason?: string; correctedOffsets?: { start: number; end: number } } {
  // 1. Try strict match
  if (evidence.startChar >= 0 && evidence.endChar <= bundleText.length && evidence.startChar < evidence.endChar) {
    const extracted = bundleText.substring(evidence.startChar, evidence.endChar);
    if (extracted === evidence.quote) {
      return { valid: true };
    }
  }
  
  // 2. Try finding the quote
  const index = bundleText.indexOf(evidence.quote);
  if (index !== -1) {
    return { 
        valid: true, 
        correctedOffsets: { start: index, end: index + evidence.quote.length } 
    };
  }

  // 3. Try finding trimmed quote
  const trimmedQuote = evidence.quote.trim();
  if (trimmedQuote.length > 0) {
      const indexTrimmed = bundleText.indexOf(trimmedQuote);
      if (indexTrimmed !== -1) {
          return {
              valid: true,
              correctedOffsets: { start: indexTrimmed, end: indexTrimmed + trimmedQuote.length }
          };
      }
  }

  if (evidence.quote.length > 500) {
    return { valid: false, reason: "Quote too long" };
  }
  
  return { valid: false, reason: "Quote mismatch" };
}
