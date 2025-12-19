export type RateLimitBucket = {
    windowStart: number;
    count: number;
};

export function consumeFromBucket(args: {
    now: number;
    windowMs: number;
    limit: number;
    bucket: RateLimitBucket | null;
}): {
    allowed: boolean;
    nextBucket: RateLimitBucket;
    remaining: number;
    resetAt: number;
} {
    const windowStart =
        !args.bucket || args.now - args.bucket.windowStart >= args.windowMs ? args.now : args.bucket.windowStart;
    const count = !args.bucket || windowStart !== args.bucket.windowStart ? 0 : args.bucket.count;

    if (count >= args.limit) {
        return {
            allowed: false,
            nextBucket: { windowStart, count },
            remaining: 0,
            resetAt: windowStart + args.windowMs,
        };
    }

    const nextCount = count + 1;
    return {
        allowed: true,
        nextBucket: { windowStart, count: nextCount },
        remaining: Math.max(0, args.limit - nextCount),
        resetAt: windowStart + args.windowMs,
    };
}

