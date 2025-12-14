import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ENV_FILE = path.join(process.cwd(), ".env.local");

const KEYS = [
    "GOOGLE_DRIVE_CLIENT_ID",
    "GOOGLE_DRIVE_CLIENT_SECRET",
    "GOOGLE_DRIVE_REDIRECT_URI",
] as const;

type DriveConfig = {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
};

function readRuntimeConfig(origin: string): {
    clientId: string | null;
    redirectUri: string;
    hasClientSecret: boolean;
} {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID ?? null;
    const hasClientSecret = Boolean(process.env.GOOGLE_DRIVE_CLIENT_SECRET);
    const redirectUri =
        process.env.GOOGLE_DRIVE_REDIRECT_URI ??
        `${origin}/api/google-drive/auth/callback`;
    return { clientId, redirectUri, hasClientSecret };
}

function setRuntimeConfig(config: DriveConfig) {
    process.env.GOOGLE_DRIVE_CLIENT_ID = config.clientId;
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = config.clientSecret;
    process.env.GOOGLE_DRIVE_REDIRECT_URI = config.redirectUri;
}

function serializeEnvLine(key: string, value: string): string {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    return `${key}="${escaped}"`;
}

async function upsertEnvVars(pairs: Record<string, string>): Promise<void> {
    let existing = "";
    try {
        existing = await fs.readFile(ENV_FILE, "utf8");
    } catch {
        existing = "";
    }

    const lines = existing.split(/\r?\n/);
    const remainingKeys = new Set(Object.keys(pairs));
    const updated: string[] = [];

    for (const line of lines) {
        const match = line.match(/^([A-Z0-9_]+)=/);
        if (!match) {
            updated.push(line);
            continue;
        }
        const key = match[1];
        if (!remainingKeys.has(key)) {
            updated.push(line);
            continue;
        }
        updated.push(serializeEnvLine(key, pairs[key]));
        remainingKeys.delete(key);
    }

    if (updated.length > 0 && updated[updated.length - 1] !== "") {
        updated.push("");
    }

    for (const key of remainingKeys) {
        updated.push(serializeEnvLine(key, pairs[key]));
    }
    updated.push("");

    await fs.writeFile(ENV_FILE, updated.join("\n"), "utf8");
}

export async function GET(request: Request) {
    const origin = new URL(request.url).origin;
    const current = readRuntimeConfig(origin);
    return NextResponse.json({
        clientId: current.clientId,
        redirectUri: current.redirectUri,
        hasClientSecret: current.hasClientSecret,
    });
}

export async function POST(request: Request) {
    const origin = new URL(request.url).origin;
    const body = (await request.json()) as Partial<DriveConfig>;

    const clientId = (body.clientId ?? "").trim();
    const clientSecret = (body.clientSecret ?? "").trim();
    const redirectUri = (body.redirectUri ?? `${origin}/api/google-drive/auth/callback`).trim();

    if (!clientId) {
        return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
    }
    if (!clientSecret) {
        return NextResponse.json({ error: "Missing clientSecret" }, { status: 400 });
    }
    if (!redirectUri.startsWith("http://") && !redirectUri.startsWith("https://")) {
        return NextResponse.json({ error: "redirectUri must be an absolute URL" }, { status: 400 });
    }

    const config: DriveConfig = { clientId, clientSecret, redirectUri };

    await upsertEnvVars({
        GOOGLE_DRIVE_CLIENT_ID: config.clientId,
        GOOGLE_DRIVE_CLIENT_SECRET: config.clientSecret,
        GOOGLE_DRIVE_REDIRECT_URI: config.redirectUri,
    });
    setRuntimeConfig(config);

    const current = readRuntimeConfig(origin);
    return NextResponse.json({
        ok: true,
        clientId: current.clientId,
        redirectUri: current.redirectUri,
        hasClientSecret: current.hasClientSecret,
    });
}

