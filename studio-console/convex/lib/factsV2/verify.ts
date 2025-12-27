type EvidenceInput = {
    quoteHe: string;
    startChar?: number;
    endChar?: number;
};

type VerificationResult = {
    valid: boolean;
    correctedOffsets?: { start: number; end: number };
};

const MAX_QUOTE_LENGTH = 500;

export function verifyEvidenceV2(args: {
    bundleText: string;
    chunkText: string;
    chunkStart: number;
    evidence: EvidenceInput;
}): VerificationResult {
    const { bundleText, chunkText, chunkStart, evidence } = args;
    const quote = evidence.quoteHe;
    if (!quote || quote.length > MAX_QUOTE_LENGTH) {
        return { valid: false };
    }

    const start = evidence.startChar ?? -1;
    const end = evidence.endChar ?? -1;
    if (start >= 0 && end > start && end <= chunkText.length) {
        const slice = chunkText.slice(start, end);
        if (slice === quote) {
            return { valid: true, correctedOffsets: { start: chunkStart + start, end: chunkStart + end } };
        }
    }

    const indexInChunk = chunkText.indexOf(quote);
    if (indexInChunk !== -1) {
        return {
            valid: true,
            correctedOffsets: {
                start: chunkStart + indexInChunk,
                end: chunkStart + indexInChunk + quote.length,
            },
        };
    }

    const indexInBundle = bundleText.indexOf(quote);
    if (indexInBundle !== -1) {
        return {
            valid: true,
            correctedOffsets: {
                start: indexInBundle,
                end: indexInBundle + quote.length,
            },
        };
    }

    const trimmedQuote = quote.trim();
    if (trimmedQuote.length > 0) {
        const trimmedIndex = bundleText.indexOf(trimmedQuote);
        if (trimmedIndex !== -1) {
            return {
                valid: true,
                correctedOffsets: {
                    start: trimmedIndex,
                    end: trimmedIndex + trimmedQuote.length,
                },
            };
        }
    }

    return { valid: false };
}
