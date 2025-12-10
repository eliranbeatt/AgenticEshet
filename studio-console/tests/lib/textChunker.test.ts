import { describe, expect, it } from "vitest";
import { chunkText } from "../../convex/lib/textChunker";

describe("chunkText", () => {
    it("splits text into overlapping windows", () => {
        const text = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
        const chunkSize = 16;
        const overlap = 4;

        const chunks = chunkText(text, chunkSize, overlap);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0].length).toBeLessThanOrEqual(chunkSize);

        const firstTail = chunks[0].slice(-overlap);
        const secondHead = chunks[1].slice(0, overlap);
        expect(secondHead).toEqual(firstTail);

        const stitched = chunks.reduce((acc, chunk, index) => {
            if (index === 0) return chunk;
            return acc + chunk.slice(overlap);
        }, "");
        const normalized = text.replace(/\s+/g, " ").trim();
        expect(stitched.startsWith(normalized.slice(0, stitched.length))).toBe(true);
    });

    it("returns empty array for blank text", () => {
        expect(chunkText("   ")).toEqual([]);
    });
});
