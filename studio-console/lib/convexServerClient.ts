import { ConvexHttpClient } from "convex/browser";

export function getConvexHttpClient(): ConvexHttpClient {
    const convexUrl =
        process.env.CONVEX_URL ??
        process.env.NEXT_PUBLIC_CONVEX_URL;

    if (!convexUrl) {
        throw new Error("Missing CONVEX_URL or NEXT_PUBLIC_CONVEX_URL");
    }

    return new ConvexHttpClient(convexUrl);
}

