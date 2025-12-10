import { v } from "convex/values";
import { action, mutation, query, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { callChatWithSchema, embedText } from "./lib/openai";
import { EnhancerSchema } from "./lib/zodSchemas";
import { extractTextFromFile } from "./lib/fileParsers";
import { chunkText } from "./lib/textChunker";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const PROCESSABLE_STATUSES = new Set(["uploaded", "parsed", "failed"]);

type IngestionActionCtx = ActionCtx;

function parseJsonList(value?: string): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
        return [];
    }
}

async function processSingleFile(ctx: IngestionActionCtx, file: Doc<"ingestionFiles">, job: Doc<"ingestionJobs">) {
    if (!PROCESSABLE_STATUSES.has(file.status)) {
        return;
    }

    const blob = await ctx.storage.get(file.storageId);
    if (!blob) {
        throw new Error("File contents missing from storage");
    }

    if (blob.size > MAX_FILE_BYTES) {
        throw new Error(`File exceeds maximum size of ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB`);
    }

    const buffer = await blob.arrayBuffer();
    const rawText = (await extractTextFromFile(buffer, file.mimeType, file.originalFilename)).trim();
    if (!rawText) {
        throw new Error("Parsed document is empty");
    }

    await ctx.runMutation(internal.ingestion.updateFileStatus, {
        fileId: file._id,
        status: "parsed",
        rawText,
        error: "",
    });

    const promptSections = [
        "You are a Knowledge Management Assistant. Normalize the document into concise text and metadata the rest of the system can reuse.",
        job.defaultContext ? `Additional context for this job: ${job.defaultContext}` : null,
        `Filename: ${file.originalFilename}`,
        "Return normalizedText, summary, keyPoints, keywords, and suggestedTags.",
        "Document content:",
        rawText.slice(0, 12000),
    ].filter(Boolean);

    const enriched = await callChatWithSchema(EnhancerSchema, {
        systemPrompt: "Extract structured knowledge from the provided document.",
        userPrompt: promptSections.join("\n\n"),
    });

    await ctx.runMutation(internal.ingestion.updateFileStatus, {
        fileId: file._id,
        status: "ready",
        enrichedText: enriched.normalizedText,
        summary: enriched.summary,
        keyPoints: enriched.keyPoints,
        keywords: enriched.keywords,
        suggestedTags: enriched.suggestedTags,
        error: "",
    });
}

async function refreshJobStatus(ctx: IngestionActionCtx, jobId: Id<"ingestionJobs">) {
    const files = await ctx.runQuery(internal.ingestion.listFiles, { jobId });
    if (files.length === 0) {
        await ctx.runMutation(internal.ingestion.updateJobStatus, { jobId, status: "created" });
        return;
    }

    const hasFailures = files.some((file) => file.status === "failed");
    const allCommitted = files.every((file) => file.status === "committed");
    const allReady = files.every((file) => file.status === "ready" || file.status === "committed");

    const nextStatus = allCommitted ? "committed" : allReady ? "ready" : hasFailures ? "failed" : "processing";
    await ctx.runMutation(internal.ingestion.updateJobStatus, { jobId, status: nextStatus });
}

// --- Mutations ---

const fileStatusEnum = v.union(
    v.literal("uploaded"),
    v.literal("parsed"),
    v.literal("enriched"),
    v.literal("ready"),
    v.literal("committed"),
    v.literal("failed")
);

const jobStatusEnum = v.union(
    v.literal("created"),
    v.literal("processing"),
    v.literal("ready"),
    v.literal("committed"),
    v.literal("failed")
);

export const createJob = mutation({
    args: {
        projectId: v.optional(v.id("projects")),
        name: v.string(),
        defaultContext: v.optional(v.string()),
        defaultTags: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("ingestionJobs", {
            projectId: args.projectId,
            name: args.name,
            defaultContext: args.defaultContext ?? "",
            defaultTags: args.defaultTags ?? [],
            enrichmentProfileId: undefined,
            status: "created",
            createdAt: Date.now(),
        });
    },
});

export const updateJobStatus = mutation({
    args: {
        jobId: v.id("ingestionJobs"),
        status: jobStatusEnum,
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.jobId, { status: args.status });
    },
});

export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        return await ctx.storage.generateUploadUrl();
    },
});

export const registerFile = mutation({
    args: {
        jobId: v.id("ingestionJobs"),
        storageId: v.string(),
        filename: v.string(),
        mimeType: v.string(),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.jobId);
        if (!job) throw new Error("Job not found");

        return await ctx.db.insert("ingestionFiles", {
            ingestionJobId: args.jobId,
            projectId: job.projectId,
            originalFilename: args.filename,
            storageId: args.storageId,
            mimeType: args.mimeType,
            status: "uploaded",
        });
    },
});

export const updateFileStatus = mutation({
    args: {
        fileId: v.id("ingestionFiles"),
        status: v.optional(fileStatusEnum),
        rawText: v.optional(v.string()),
        enrichedText: v.optional(v.string()),
        summary: v.optional(v.string()),
        keyPoints: v.optional(v.array(v.string())),
        keywords: v.optional(v.array(v.string())),
        suggestedTags: v.optional(v.array(v.string())),
        error: v.optional(v.string()),
        ragDocId: v.optional(v.id("knowledgeDocs")),
    },
    handler: async (ctx, args) => {
        const update: Partial<Doc<"ingestionFiles">> = {};
        if (args.status) update.status = args.status;
        if (args.rawText !== undefined) update.rawText = args.rawText;
        if (args.enrichedText !== undefined) update.enrichedText = args.enrichedText;
        if (args.summary !== undefined) update.summary = args.summary;
        if (args.keyPoints !== undefined) update.keyPointsJson = JSON.stringify(args.keyPoints);
        if (args.keywords !== undefined) update.keywordsJson = JSON.stringify(args.keywords);
        if (args.suggestedTags !== undefined) update.suggestedTagsJson = JSON.stringify(args.suggestedTags);
        if ("error" in args) update.error = args.error && args.error.length > 0 ? args.error : undefined;
        if ("ragDocId" in args) update.ragDocId = args.ragDocId;
        await ctx.db.patch(args.fileId, update);
    },
});

// --- Actions ---

export const processFile = action({
    args: { fileId: v.id("ingestionFiles") },
    handler: async (ctx, args) => {
        const file = await ctx.runQuery(internal.ingestion.getFile, { fileId: args.fileId });
        if (!file) throw new Error("File not found");
        const job = await ctx.runQuery(internal.ingestion.getJob, { jobId: file.ingestionJobId });
        if (!job) throw new Error("Job not found");

        await ctx.runMutation(internal.ingestion.updateJobStatus, { jobId: job._id, status: "processing" });

        try {
            await processSingleFile(ctx, file, job);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            await ctx.runMutation(internal.ingestion.updateFileStatus, {
                fileId: args.fileId,
                status: "failed",
                error: message,
            });
        } finally {
            await refreshJobStatus(ctx, job._id);
        }
    },
});

export const runIngestionJob = action({
    args: { jobId: v.id("ingestionJobs") },
    handler: async (ctx, args) => {
        const job = await ctx.runQuery(internal.ingestion.getJob, { jobId: args.jobId });
        if (!job) throw new Error("Job not found");
        const files = await ctx.runQuery(internal.ingestion.listFiles, { jobId: args.jobId });
        if (files.length === 0) throw new Error("No files registered for this job");

        await ctx.runMutation(internal.ingestion.updateJobStatus, { jobId: args.jobId, status: "processing" });

        for (const file of files) {
            if (!PROCESSABLE_STATUSES.has(file.status)) continue;
            try {
                await processSingleFile(ctx, file, job);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : "Unknown error";
                await ctx.runMutation(internal.ingestion.updateFileStatus, {
                    fileId: file._id,
                    status: "failed",
                    error: message,
                });
            }
        }

        await refreshJobStatus(ctx, job._id);
    },
});

export const commitIngestionJob = action({
    args: {
        jobId: v.id("ingestionJobs"),
        fileIds: v.optional(v.array(v.id("ingestionFiles"))),
    },
    handler: async (ctx, args) => {
        const job = await ctx.runQuery(internal.ingestion.getJob, { jobId: args.jobId });
        if (!job) throw new Error("Job not found");
        const files = await ctx.runQuery(internal.ingestion.listFiles, { jobId: args.jobId });
        if (files.length === 0) throw new Error("No files registered for this job");

        const readyFiles = files.filter((file) => file.status === "ready" || file.status === "committed");
        const targeted = args.fileIds && args.fileIds.length > 0
            ? readyFiles.filter((file) => args.fileIds?.some((id) => id === file._id))
            : readyFiles;

        if (targeted.length === 0) throw new Error("No ready files selected to commit");

        const committedDocIds: Id<"knowledgeDocs">[] = [];

        for (const file of targeted) {
            if (file.status === "committed") {
                committedDocIds.push(file.ragDocId as Id<"knowledgeDocs">);
                continue;
            }

            const textSource = file.enrichedText ?? file.rawText;
            if (!textSource) {
                await ctx.runMutation(internal.ingestion.updateFileStatus, {
                    fileId: file._id,
                    status: "failed",
                    error: "Missing enriched text to commit",
                });
                continue;
            }

            const fileTags = parseJsonList(file.suggestedTagsJson);
            const keyPoints = parseJsonList(file.keyPointsJson);
            const keywords = parseJsonList(file.keywordsJson);
            const tags = Array.from(new Set([...(job.defaultTags || []), ...fileTags]));
            const docId = await ctx.runMutation(internal.knowledge.createDocRecord, {
                projectId: file.projectId ?? job.projectId,
                title: file.originalFilename,
                storageId: file.storageId,
                summary: file.summary || "No summary provided",
                tags,
                keyPoints,
                keywords,
                status: "processing",
            });

            const chunks = chunkText(textSource, 1200, 150);
            if (chunks.length === 0) {
                await ctx.runMutation(internal.ingestion.updateFileStatus, {
                    fileId: file._id,
                    status: "failed",
                    error: "Unable to chunk text for embeddings",
                });
                continue;
            }

            const chunkPayload = [];
            for (const chunk of chunks) {
                const embedding = await embedText(chunk);
                chunkPayload.push({
                    docId,
                    projectId: file.projectId ?? job.projectId,
                    text: chunk,
                    embedding,
                });
            }

            await ctx.runMutation(internal.knowledge.insertChunks, { chunks: chunkPayload });
            await ctx.runMutation(internal.knowledge.updateDocStatus, { docId, status: "ready" });
            await ctx.runMutation(internal.ingestion.updateFileStatus, {
                fileId: file._id,
                status: "committed",
                ragDocId: docId,
                error: "",
            });
            committedDocIds.push(docId);
        }

        await refreshJobStatus(ctx, job._id);
        return { committedDocIds };
    },
});

// --- Internal Queries ---

export const getFile = internalQuery({
    args: { fileId: v.id("ingestionFiles") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.fileId);
    },
});

export const getJob = internalQuery({
    args: { jobId: v.id("ingestionJobs") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.jobId);
    },
});

export const listJobs = query({
    args: { projectId: v.optional(v.id("projects")) },
    handler: async (ctx, args) => {
        if (args.projectId) {
            return await ctx.db
                .query("ingestionJobs")
                .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
                .order("desc")
                .collect();
        }
        return await ctx.db.query("ingestionJobs").order("desc").collect();
    },
});

export const listFiles = query({
    args: { jobId: v.id("ingestionJobs") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("ingestionFiles")
            .withIndex("by_job", (q) => q.eq("ingestionJobId", args.jobId))
            .order("desc")
            .collect();
    },
});
