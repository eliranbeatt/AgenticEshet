export function verifyEvidence(
  bundleText: string,
  evidence: { quote: string; startChar: number; endChar: number }
): { valid: boolean; reason?: string } {
  if (evidence.startChar < 0 || evidence.endChar > bundleText.length || evidence.startChar >= evidence.endChar) {
    return { valid: false, reason: "Invalid offsets" };
  }
  
  const extracted = bundleText.substring(evidence.startChar, evidence.endChar);
  if (extracted !== evidence.quote) {
    return { valid: false, reason: "Quote mismatch" };
  }
  
  if (evidence.quote.length > 500) {
    return { valid: false, reason: "Quote too long" };
  }
  
  return { valid: true };
}
