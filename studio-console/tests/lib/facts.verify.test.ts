import { describe, expect, test } from "vitest";

import { verifyEvidence } from "../../convex/lib/facts/verify";

describe("verifyEvidence", () => {
    test("accepts exact offsets", () => {
        const bundle = "Hello world\nSecond line";
        const ev = { quote: "world", startChar: 6, endChar: 11 };
        const res = verifyEvidence(bundle, ev);
        expect(res.valid).toBe(true);
        expect(res.correctedOffsets).toBeUndefined();
    });

    test("corrects offsets when quote exists", () => {
        const bundle = "Hello world";
        const ev = { quote: "world", startChar: 0, endChar: 3 };
        const res = verifyEvidence(bundle, ev);
        expect(res.valid).toBe(true);
        expect(res.correctedOffsets).toEqual({ start: 6, end: 11 });
    });

    test("matches when quote has wrapping quotes", () => {
        const bundle = "FREE_CHAT: budget is 80-120k";
        const ev = { quote: "\"budget is 80-120k\"", startChar: 0, endChar: 0 };
        const res = verifyEvidence(bundle, ev);
        expect(res.valid).toBe(true);
        expect(res.correctedOffsets).toBeTruthy();
        const { start, end } = res.correctedOffsets!;
        expect(bundle.substring(start, end)).toBe("budget is 80-120k");
    });

    test("matches despite whitespace differences", () => {
        const bundle = "Line1: a\n\nLine2: b   c\t d";
        const ev = { quote: "Line2: b c d", startChar: 0, endChar: 0 };
        const res = verifyEvidence(bundle, ev);
        expect(res.valid).toBe(true);
        expect(res.correctedOffsets).toBeTruthy();
        const { start, end } = res.correctedOffsets!;
        expect(bundle.substring(start, end).replace(/\s+/g, " ").trim()).toBe("Line2: b c d");
    });
});
