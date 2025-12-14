import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexHttpClient } from "@/lib/convexServerClient";
import {
    getGoogleDriveOAuthConfig,
    listDriveFolders,
    refreshAccessToken,
} from "@/lib/googleDriveServer";

export const runtime = "nodejs";

const OWNER_USER_ID = "system";

export async function GET(request: Request) {
    const origin = new URL(request.url).origin;
    const { clientId, clientSecret } = getGoogleDriveOAuthConfig(origin);
    const client = getConvexHttpClient();

    const account = await client.query(api.drive.getDriveAccount, { ownerUserId: OWNER_USER_ID });
    if (!account || account.status !== "connected") {
        return NextResponse.json({ error: "Drive not connected" }, { status: 401 });
    }

    const now = Date.now();
    const expiryDate = account.auth.expiryDate ?? 0;
    let accessToken = account.auth.accessToken ?? "";

    if (!accessToken) {
        return NextResponse.json({ error: "Missing access token" }, { status: 401 });
    }

    if (expiryDate && expiryDate < now + 60_000) {
        const refreshToken = account.auth.refreshToken;
        if (!refreshToken) {
            return NextResponse.json({ error: "Missing refresh token; reconnect Drive" }, { status: 401 });
        }

        const refreshed = await refreshAccessToken({
            refreshToken,
            clientId,
            clientSecret,
        });

        accessToken = refreshed.accessToken;

        await client.mutation(api.drive.updateDriveTokens, {
            accountId: account._id,
            accessToken: refreshed.accessToken,
            expiryDate: refreshed.expiryDate,
        });
    }

    try {
        const folders = await listDriveFolders({ accessToken });
        return NextResponse.json({ folders });
    } catch (e) {
        const message = e instanceof Error ? e.message : "unknown_error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

