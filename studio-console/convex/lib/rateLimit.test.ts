import { describe, expect, it } from "vitest";
import { consumeFromBucket } from "./rateLimit";

describe("consumeFromBucket", () => {
    it("allows the first request in a new window", () => {
        const result = consumeFromBucket({ now: 1000, windowMs: 1000, limit: 2, bucket: null });
        expect(result.allowed).toBe(true);
        expect(result.nextBucket).toEqual({ windowStart: 1000, count: 1 });
        expect(result.remaining).toBe(1);
        expect(result.resetAt).toBe(2000);
    });

    it("increments within the same window and blocks after the limit", () => {
        const first = consumeFromBucket({
            now: 1000,
            windowMs: 1000,
            limit: 2,
            bucket: { windowStart: 1000, count: 1 },
        });
        expect(first.allowed).toBe(true);
        expect(first.nextBucket.count).toBe(2);

        const second = consumeFromBucket({
            now: 1500,
            windowMs: 1000,
            limit: 2,
            bucket: first.nextBucket,
        });
        expect(second.allowed).toBe(false);
        expect(second.remaining).toBe(0);
        expect(second.resetAt).toBe(2000);
    });

    it("resets after the window expires", () => {
        const result = consumeFromBucket({
            now: 5000,
            windowMs: 1000,
            limit: 2,
            bucket: { windowStart: 1000, count: 2 },
        });
        expect(result.allowed).toBe(true);
        expect(result.nextBucket).toEqual({ windowStart: 5000, count: 1 });
        expect(result.resetAt).toBe(6000);
    });
});

