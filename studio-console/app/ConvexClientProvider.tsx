"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

export default function ConvexClientProvider({
    children,
}: {
    children: ReactNode;
}) {
    if (!convexClient) {
        if (process.env.NODE_ENV !== "production") {
            console.warn("NEXT_PUBLIC_CONVEX_URL is not set. Update your environment to connect to Convex.");
        }
        return (
            <div className="flex min-h-screen w-full items-center justify-center bg-destructive/10 text-destructive">
                Missing Convex configuration. Set NEXT_PUBLIC_CONVEX_URL in your environment.
            </div>
        );
    }

    return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}
