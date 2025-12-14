const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OIDC_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

export const GOOGLE_DRIVE_SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/drive.readonly",
];

export type GoogleDriveTokens = {
    accessToken: string;
    refreshToken?: string;
    expiryDate?: number;
    scope?: string;
    tokenType?: string;
    idToken?: string;
};

export type GoogleUserInfo = {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
};

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing env var: ${name}`);
    return value;
}

export function getGoogleDriveOAuthConfig(requestOrigin: string): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
} {
    const clientId = requireEnv("GOOGLE_DRIVE_CLIENT_ID");
    const clientSecret = requireEnv("GOOGLE_DRIVE_CLIENT_SECRET");

    const redirectUri =
        process.env.GOOGLE_DRIVE_REDIRECT_URI ??
        `${requestOrigin}/api/google-drive/auth/callback`;

    return { clientId, clientSecret, redirectUri };
}

export function buildGoogleDriveAuthUrl(params: {
    clientId: string;
    redirectUri: string;
    state: string;
    scopes?: string[];
}): string {
    const scope = (params.scopes ?? GOOGLE_DRIVE_SCOPES).join(" ");
    const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
    url.searchParams.set("client_id", params.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", params.state);
    return url.toString();
}

export async function exchangeCodeForTokens(params: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}): Promise<GoogleDriveTokens> {
    const body = new URLSearchParams();
    body.set("code", params.code);
    body.set("client_id", params.clientId);
    body.set("client_secret", params.clientSecret);
    body.set("redirect_uri", params.redirectUri);
    body.set("grant_type", "authorization_code");

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as {
        access_token: string;
        expires_in?: number;
        refresh_token?: string;
        scope?: string;
        token_type?: string;
        id_token?: string;
    };

    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiryDate: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
        scope: json.scope,
        tokenType: json.token_type,
        idToken: json.id_token,
    };
}

export async function refreshAccessToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
}): Promise<Pick<GoogleDriveTokens, "accessToken" | "expiryDate" | "scope" | "tokenType" | "idToken">> {
    const body = new URLSearchParams();
    body.set("client_id", params.clientId);
    body.set("client_secret", params.clientSecret);
    body.set("refresh_token", params.refreshToken);
    body.set("grant_type", "refresh_token");

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token refresh failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as {
        access_token: string;
        expires_in?: number;
        scope?: string;
        token_type?: string;
        id_token?: string;
    };

    return {
        accessToken: json.access_token,
        expiryDate: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
        scope: json.scope,
        tokenType: json.token_type,
        idToken: json.id_token,
    };
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(GOOGLE_OIDC_USERINFO_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch userinfo (${response.status}): ${text}`);
    }
    return (await response.json()) as GoogleUserInfo;
}

export type DriveFolder = { id: string; name: string };

export async function listDriveFolders(params: {
    accessToken: string;
    pageSize?: number;
}): Promise<DriveFolder[]> {
    const url = new URL(GOOGLE_DRIVE_FILES_URL);
    url.searchParams.set("q", "mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    url.searchParams.set("pageSize", String(params.pageSize ?? 50));
    url.searchParams.set("fields", "files(id,name)");
    url.searchParams.set("orderBy", "name");

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Drive folders list failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as { files?: DriveFolder[] };
    return json.files ?? [];
}

export type DriveFile = {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
};

export async function listDriveFilesInFolder(params: {
    accessToken: string;
    folderId: string;
    modifiedAfter?: number;
}): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    const modifiedAfterFilter = params.modifiedAfter
        ? ` and modifiedTime > '${new Date(params.modifiedAfter).toISOString()}'`
        : "";

    while (true) {
        const url = new URL(GOOGLE_DRIVE_FILES_URL);
        url.searchParams.set(
            "q",
            `'${params.folderId}' in parents and trashed = false${modifiedAfterFilter}`
        );
        url.searchParams.set("pageSize", "1000");
        url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime)");
        url.searchParams.set("orderBy", "modifiedTime desc");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: { Authorization: `Bearer ${params.accessToken}` },
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Drive files list failed (${response.status}): ${text}`);
        }

        const json = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
        files.push(...(json.files ?? []));
        if (!json.nextPageToken) break;
        pageToken = json.nextPageToken;
    }

    return files;
}

export function isGoogleWorkspaceFile(mimeType: string): boolean {
    return mimeType.startsWith("application/vnd.google-apps.");
}

export function getExportMimeType(mimeType: string): { exportMimeType: string; extension: string } | null {
    if (mimeType === "application/vnd.google-apps.document") {
        return { exportMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx" };
    }
    if (mimeType === "application/vnd.google-apps.spreadsheet") {
        return { exportMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: ".xlsx" };
    }
    if (mimeType === "application/vnd.google-apps.presentation") {
        return { exportMimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" };
    }
    if (mimeType === "application/vnd.google-apps.drawing") {
        return { exportMimeType: "application/pdf", extension: ".pdf" };
    }
    return null;
}

export async function downloadDriveFileContent(params: {
    accessToken: string;
    fileId: string;
}): Promise<ArrayBuffer> {
    const url = new URL(`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(params.fileId)}`);
    url.searchParams.set("alt", "media");

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Drive download failed (${response.status}): ${text}`);
    }
    return await response.arrayBuffer();
}

export async function exportDriveFileContent(params: {
    accessToken: string;
    fileId: string;
    exportMimeType: string;
}): Promise<ArrayBuffer> {
    const url = new URL(`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(params.fileId)}/export`);
    url.searchParams.set("mimeType", params.exportMimeType);

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Drive export failed (${response.status}): ${text}`);
    }
    return await response.arrayBuffer();
}

