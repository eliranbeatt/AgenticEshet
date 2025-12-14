import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexHttpClient } from "@/lib/convexServerClient";
import { getGoogleDriveOAuthConfig } from "@/lib/googleDriveServer";

export const runtime = "nodejs";

const OWNER_USER_ID = "system";

export async function POST(request: Request) {
    const origin = new URL(request.url).origin;
    getGoogleDriveOAuthConfig(origin);

    const client = getConvexHttpClient();
    const account = await client.query(api.drive.getDriveAccount, { ownerUserId: OWNER_USER_ID });
    if (!account) return NextResponse.json({ ok: true });

    const tokenToRevoke = account.auth.refreshToken ?? account.auth.accessToken ?? undefined;
    if (tokenToRevoke) {
        try {
            await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
        } catch {
            // Best effort.
        }
    }

    await client.mutation(api.drive.disconnectDriveAccount, {
        accountId: account._id,
    });

    return NextResponse.json({ ok: true });
}

