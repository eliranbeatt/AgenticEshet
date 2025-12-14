import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexHttpClient } from "@/lib/convexServerClient";
import {
    downloadDriveFileContent,
    exportDriveFileContent,
    getExportMimeType,
    getGoogleDriveOAuthConfig,
    isGoogleWorkspaceFile,
    listDriveFilesInFolder,
    refreshAccessToken,
} from "@/lib/googleDriveServer";

export const runtime = "nodejs";

const OWNER_USER_ID = "system";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type SyncRequestBody = {
    watchId: string;
};

export async function POST(request: Request) {
    const origin = new URL(request.url).origin;
    const { clientId, clientSecret } = getGoogleDriveOAuthConfig(origin);
    const client = getConvexHttpClient();

    const body = (await request.json()) as Partial<SyncRequestBody>;
    if (!body.watchId) {
        return NextResponse.json({ error: "Missing watchId" }, { status: 400 });
    }

    const watchId = body.watchId as Id<"connectorWatches">;
    const watch = await client.query(api.drive.getWatch, { watchId });
    if (!watch) {
        return NextResponse.json({ error: "Watch not found" }, { status: 404 });
    }
    if (!watch.enabled) {
        return NextResponse.json({ error: "Watch is disabled" }, { status: 400 });
    }

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

    const modifiedAfter = watch.cursorState.lastSyncAt ?? undefined;
    const driveFiles = await listDriveFilesInFolder({
        accessToken,
        folderId: watch.externalId,
        modifiedAfter,
    });

    const uploadedFiles: Array<{ storageId: string; name: string; mimeType: string; size: number }> = [];
    const skippedFiles: Array<{ name: string; reason: string }> = [];

    for (const file of driveFiles) {
        if (file.mimeType === "application/vnd.google-apps.folder") continue;

        let outputName = file.name;
        let outputMimeType = file.mimeType;
        let buffer: ArrayBuffer;

        try {
            if (isGoogleWorkspaceFile(file.mimeType)) {
                const exportInfo = getExportMimeType(file.mimeType);
                if (!exportInfo) {
                    skippedFiles.push({ name: file.name, reason: `Unsupported Google file type: ${file.mimeType}` });
                    continue;
                }
                buffer = await exportDriveFileContent({
                    accessToken,
                    fileId: file.id,
                    exportMimeType: exportInfo.exportMimeType,
                });
                outputMimeType = exportInfo.exportMimeType;
                if (!outputName.toLowerCase().endsWith(exportInfo.extension)) {
                    outputName = `${outputName}${exportInfo.extension}`;
                }
            } else {
                buffer = await downloadDriveFileContent({ accessToken, fileId: file.id });
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : "download_failed";
            skippedFiles.push({ name: file.name, reason: message });
            continue;
        }

        if (buffer.byteLength > MAX_FILE_BYTES) {
            skippedFiles.push({ name: outputName, reason: `File too large (${buffer.byteLength} bytes)` });
            continue;
        }

        try {
            const postUrl = await client.mutation(api.ingestion.generateUploadUrl, {});
            const uploadResponse = await fetch(postUrl, {
                method: "POST",
                headers: { "Content-Type": outputMimeType || "application/octet-stream" },
                body: Buffer.from(buffer),
            });

            if (!uploadResponse.ok) {
                const text = await uploadResponse.text();
                skippedFiles.push({ name: outputName, reason: `Upload failed (${uploadResponse.status}): ${text}` });
                continue;
            }

            const { storageId } = (await uploadResponse.json()) as { storageId: string };
            uploadedFiles.push({
                storageId,
                name: outputName,
                mimeType: outputMimeType || "application/octet-stream",
                size: buffer.byteLength,
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : "upload_failed";
            skippedFiles.push({ name: outputName, reason: message });
        }
    }

    await client.mutation(api.drive.updateWatchCursor, {
        watchId: watch._id,
        cursorState: {
            pageToken: watch.cursorState.pageToken ?? undefined,
            lastSyncAt: now,
        },
    });

    if (uploadedFiles.length === 0) {
        return NextResponse.json({
            ingestionJobId: null,
            addedFiles: 0,
            skippedFiles,
        });
    }

    const ingestionJobId = await client.mutation(api.ingestion.createJob, {
        projectId: watch.projectId,
        name: `Drive: ${watch.name} (${new Date(now).toISOString()})`,
        sourceType: "drive",
        profileId: undefined,
        defaultContext: "",
        defaultTags: [],
    });

    await client.mutation(api.ingestion.addFilesToJob, {
        jobId: ingestionJobId,
        files: uploadedFiles,
    });

    return NextResponse.json({
        ingestionJobId,
        addedFiles: uploadedFiles.length,
        skippedFiles,
    });
}
