import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { api } from "@/convex/_generated/api";
import { getConvexHttpClient } from "@/lib/convexServerClient";
import {
    exchangeCodeForTokens,
    fetchGoogleUserInfo,
    getGoogleDriveOAuthConfig,
} from "@/lib/googleDriveServer";

export const runtime = "nodejs";

const STATE_COOKIE = "gd_oauth_state";
const PROJECT_COOKIE = "gd_oauth_project";
const RETURN_TO_COOKIE = "gd_oauth_return_to";

const OWNER_USER_ID = "system";

export async function GET(request: Request) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const origin = url.origin;
    const { clientId, clientSecret, redirectUri } = getGoogleDriveOAuthConfig(origin);

    const secure = process.env.NODE_ENV === "production";

    const cookieStore = await cookies();
    const cookieState = cookieStore.get(STATE_COOKIE)?.value;
    const cookieProjectId = cookieStore.get(PROJECT_COOKIE)?.value;
    const cookieReturnTo = cookieStore.get(RETURN_TO_COOKIE)?.value;

    const returnTo = cookieReturnTo || "/ingestion/connectors";

    const clearCookies = (res: NextResponse) => {
        res.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/", secure, httpOnly: true });
        res.cookies.set(PROJECT_COOKIE, "", { maxAge: 0, path: "/", secure, httpOnly: true });
        res.cookies.set(RETURN_TO_COOKIE, "", { maxAge: 0, path: "/", secure, httpOnly: true });
    };

    if (error) {
        const res = NextResponse.redirect(new URL(`${returnTo}?drive=error&reason=${encodeURIComponent(error)}`, origin));
        clearCookies(res);
        return res;
    }

    if (!code) {
        const res = NextResponse.redirect(new URL(`${returnTo}?drive=error&reason=missing_code`, origin));
        clearCookies(res);
        return res;
    }

    if (!state || !cookieState || state !== cookieState) {
        const res = NextResponse.redirect(new URL(`${returnTo}?drive=error&reason=invalid_state`, origin));
        clearCookies(res);
        return res;
    }

    try {
        const tokens = await exchangeCodeForTokens({
            code,
            clientId,
            clientSecret,
            redirectUri,
        });

        const userinfo = await fetchGoogleUserInfo(tokens.accessToken);

        const client = getConvexHttpClient();
        await client.mutation(api.drive.upsertDriveAccountFromOAuth, {
            ownerUserId: OWNER_USER_ID,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiryDate: tokens.expiryDate,
            email: userinfo.email ?? undefined,
            googleUserId: userinfo.sub,
        });

        const nextUrl = new URL(returnTo, origin);
        nextUrl.searchParams.set("drive", "connected");
        if (cookieProjectId) nextUrl.searchParams.set("projectId", cookieProjectId);

        const res = NextResponse.redirect(nextUrl);
        clearCookies(res);
        return res;
    } catch (e) {
        const message = e instanceof Error ? e.message : "unknown_error";
        const res = NextResponse.redirect(new URL(`${returnTo}?drive=error&reason=${encodeURIComponent(message)}`, origin));
        clearCookies(res);
        return res;
    }
}
