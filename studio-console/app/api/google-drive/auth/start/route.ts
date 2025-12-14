import crypto from "crypto";
import { NextResponse } from "next/server";
import { buildGoogleDriveAuthUrl, getGoogleDriveOAuthConfig } from "@/lib/googleDriveServer";

export const runtime = "nodejs";

const STATE_COOKIE = "gd_oauth_state";
const PROJECT_COOKIE = "gd_oauth_project";
const RETURN_TO_COOKIE = "gd_oauth_return_to";

export async function GET(request: Request) {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId") ?? "";
    const returnTo = url.searchParams.get("returnTo") ?? "/ingestion/connectors";

    const origin = url.origin;
    const { clientId, redirectUri } = getGoogleDriveOAuthConfig(origin);

    const state = crypto.randomBytes(24).toString("hex");
    const authUrl = buildGoogleDriveAuthUrl({
        clientId,
        redirectUri,
        state,
    });

    const response = NextResponse.redirect(authUrl);
    const secure = process.env.NODE_ENV === "production";

    response.cookies.set(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        maxAge: 60 * 10,
        path: "/",
    });
    response.cookies.set(PROJECT_COOKIE, projectId, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        maxAge: 60 * 10,
        path: "/",
    });
    response.cookies.set(RETURN_TO_COOKIE, returnTo, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        maxAge: 60 * 10,
        path: "/",
    });

    return response;
}

