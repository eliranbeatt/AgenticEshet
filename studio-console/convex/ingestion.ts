import { v } from "convex/values";
import { action, mutation, query, internalQuery, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { callChatWithSchema, embedText } from "./lib/openai";
import { EnhancerSchema } from "./lib/zodSchemas";
import { extractTextFromFile } from "./lib/fileParsers";
import { chunkText } from "./lib/textChunker";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
// --- Mutations ---

export const createJob = mutation({
    args: {
        projectId: v.optional(v.id("projects")),
        name: v.string(),
        sourceType: v.union(v.literal("upload"), v.literal("drive"), v.literal("email"), v.literal("whatsapp")),
        profileId: v.optional(v.id("enrichmentProfiles")),
        defaultContext: v.optional(v.string()),
        defaultTags: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("ingestionJobs", {
            projectId: args.projectId,
            name: args.name,
            sourceType: args.sourceType,
            enrichmentProfileId: args.profileId,
            defaultContext: args.defaultContext ?? "",
            defaultTags: args.defaultTags ?? [],
            status: "created",
            stage: "received",
            progress: { totalFiles: 0, doneFiles: 0, failedFiles: 0 },
            createdAt: Date.now(),
        });
    },
});

export const addFilesToJob = mutation({
    args: {
        jobId: v.id("ingestionJobs"),
        files: v.array(v.object({
            storageId: v.string(),
            name: v.string(),
            mimeType: v.string(),
            size: v.number(),
        })),
    },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.jobId);
        if (!job) throw new Error("Job not found");

        for (const file of args.files) {
            await ctx.db.insert("ingestionFiles", {
                ingestionJobId: args.jobId,
                projectId: job.projectId,
                originalFilename: file.name,
                storageId: file.storageId,
                mimeType: file.mimeType,
                sourceType: job.sourceType,
                sizeBytes: file.size,
                stage: "received",
                status: "uploaded",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
        }

        // Update job progress
        await ctx.db.patch(args.jobId, {
            progress: {
                totalFiles: job.progress.totalFiles + args.files.length,
                doneFiles: job.progress.doneFiles,
                failedFiles: job.progress.failedFiles,
            },
            status: "queued", // Ready to run
        });
    },
});

export const cancelJob = mutation({
    args: { jobId: v.id("ingestionJobs") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.jobId, { status: "cancelled" });
    },
});

export const retryJob = mutation({
    args: { jobId: v.id("ingestionJobs") },
    handler: async (ctx, args) => {
        const job = await ctx.db.get(args.jobId);
        if (!job) throw new Error("Job not found");
        
        // Reset failed files to 'uploaded'/'received' so they can be picked up again
        const failedFiles = await ctx.db
            .query("ingestionFiles")
            .withIndex("by_job", (q) => q.eq("ingestionJobId", args.jobId))
            .filter((q) => q.eq(q.field("status"), "failed"))
            .collect();

        for (const file of failedFiles) {
            await ctx.db.patch(file._id, {
                status: "uploaded",
                stage: "received",
                error: undefined,
            });
        }

        await ctx.db.patch(args.jobId, {
            status: "queued",
            progress: {
                totalFiles: job.progress.totalFiles,
                doneFiles: job.progress.doneFiles, // Keep done count
                failedFiles: 0, // Reset failed count
            }
        });
    },
});

export const retryFile = mutation({
    args: { fileId: v.id("ingestionFiles") },
    handler: async (ctx, args) => {
        const file = await ctx.db.get(args.fileId);
        if (!file) throw new Error("File not found");
        
        await ctx.db.patch(args.fileId, {
            status: "uploaded",
            stage: "received",
            error: undefined,
        });
        
        // We might want to trigger the job run here or let the user do it
    },
});

// --- Internal Mutations ---

export const updateJobStatus = internalMutation({
    args: {
        jobId: v.id("ingestionJobs"),
        status: v.union(
            v.literal("created"),
            v.literal("queued"),
            v.literal("processing"),
            v.literal("running"),
            v.literal("ready"),
            v.literal("committed"),
            v.literal("failed"),
            v.literal("cancelled")
        ),
        stage: v.optional(v.union(
            v.literal("received"),
            v.literal("parsed"),
            v.literal("enriched"),
            v.literal("chunked"),
            v.literal("embedded"),
            v.literal("ready"),
            v.literal("failed")
        )),
        progress: v.optional(v.object({
            totalFiles: v.number(),
            doneFiles: v.number(),
            failedFiles: v.number(),
        })),
        errorSummary: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const update: any = { status: args.status };
        if (args.stage) update.stage = args.stage;
        if (args.progress) update.progress = args.progress;
        if (args.errorSummary) update.errorSummary = args.errorSummary;
        if (args.status === "processing" || args.status === "running") update.startedAt = Date.now();
        if (args.status === "ready" || args.status === "failed") update.finishedAt = Date.now();
        
        await ctx.db.patch(args.jobId, update);
    },
});

export const updateFileStatus = internalMutation({
    args: {
        fileId: v.id("ingestionFiles"),
        status: v.union(
            v.literal("uploaded"),
            v.literal("parsed"),
            v.literal("enriched"),
            v.literal("ready"),
            v.literal("committed"),
            v.literal("failed")
        ),
        stage: v.union(
            v.literal("received"),
            v.literal("parsed"),
            v.literal("enriched"),
            v.literal("chunked"),
            v.literal("embedded"),
            v.literal("ready"),
            v.literal("failed")
        ),
        rawText: v.optional(v.string()),
        enrichedText: v.optional(v.string()),
        summary: v.optional(v.string()),
        keyPoints: v.optional(v.array(v.string())),
        keywords: v.optional(v.array(v.string())),
        suggestedTags: v.optional(v.array(v.string())),
        topics: v.optional(v.array(v.string())),
        domain: v.optional(v.string()),
        clientName: v.optional(v.string()),
        language: v.optional(v.string()),
        error: v.optional(v.string()),
        ragDocId: v.optional(v.id("knowledgeDocs")),
        parsed: v.optional(v.object({
            textBytes: v.optional(v.number()),
            pageCount: v.optional(v.number()),
            sheetNames: v.optional(v.array(v.string())),
            slideCount: v.optional(v.number()),
            imageMeta: v.optional(v.object({
                width: v.number(),
                height: v.number(),
                format: v.string(),
            })),
        })),
    },
    handler: async (ctx, args) => {
        const update: any = { 
            status: args.status,
            stage: args.stage,
            updatedAt: Date.now()
        };
        
        if (args.rawText !== undefined) update.rawText = args.rawText;
        if (args.enrichedText !== undefined) update.enrichedText = args.enrichedText;
        if (args.summary !== undefined) update.summary = args.summary;
        if (args.keyPoints !== undefined) update.keyPointsJson = JSON.stringify(args.keyPoints);
        if (args.keywords !== undefined) update.keywordsJson = JSON.stringify(args.keywords);
        if (args.suggestedTags !== undefined) update.suggestedTagsJson = JSON.stringify(args.suggestedTags);
        if (args.topics !== undefined) update.topicsJson = JSON.stringify(args.topics);
        if (args.domain !== undefined) update.domain = args.domain;
        if (args.clientName !== undefined) update.clientName = args.clientName;
        if (args.language !== undefined) update.language = args.language;
        if (args.error !== undefined) update.error = args.error;
        if (args.ragDocId !== undefined) update.ragDocId = args.ragDocId;
        if (args.parsed !== undefined) update.parsed = args.parsed;

        await ctx.db.patch(args.fileId, update);
    },
});

// --- Actions ---

export const runJob = action({
    args: { jobId: v.id("ingestionJobs") },
    handler: async (ctx, args) => {
        // Use public query via api since we changed getJob to public
        const job = await ctx.runQuery(api.ingestion.getJob, { jobId: args.jobId });
        if (!job) throw new Error("Job not found");
        
        if (job.status === "cancelled") return;

        await ctx.runMutation(internal.ingestion.updateJobStatus, { 
            jobId: args.jobId, 
            status: "running",
            stage: "parsed" // Start with parsing
        });

        const files: Doc<"ingestionFiles">[] = await ctx.runQuery(api.ingestion.listFiles, { jobId: args.jobId });
        
        let doneFiles = job.progress.doneFiles;
        let failedFiles = job.progress.failedFiles;

        for (const file of files) {
            if (file.status === "ready" || file.status === "committed") continue;
            if (file.status === "failed") continue; // Skip already failed unless retried

            try {
                await processSingleFile(ctx, file, job);
                doneFiles++;
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : "Unknown error";
                await ctx.runMutation(internal.ingestion.updateFileStatus, {
                    fileId: file._id,
                    status: "failed",
                    stage: "failed",
                    error: message,
                });
                failedFiles++;
            }
            
            // Update progress after each file
            await ctx.runMutation(internal.ingestion.updateJobStatus, {
                jobId: args.jobId,
                status: "running",
                progress: {
                    totalFiles: job.progress.totalFiles,
                    doneFiles,
                    failedFiles,
                }
            });
        }

        const finalStatus = failedFiles > 0 ? "failed" : "ready";
        await ctx.runMutation(internal.ingestion.updateJobStatus, {
            jobId: args.jobId,
            status: finalStatus,
            stage: "ready",
            progress: {
                totalFiles: job.progress.totalFiles,
                doneFiles,
                failedFiles,
            }
        });
    },
});

async function processSingleFile(ctx: ActionCtx, file: Doc<"ingestionFiles">, job: Doc<"ingestionJobs">) {
    // 1. PARSE
    if (file.stage === "received" || file.stage === "failed") {
        const blob = await ctx.storage.get(file.storageId);
        if (!blob) throw new Error("File contents missing from storage");
        if (blob.size > MAX_FILE_BYTES) throw new Error(`File exceeds maximum size`);

        const buffer = await blob.arrayBuffer();
        const rawText = (await extractTextFromFile(buffer, file.mimeType, file.originalFilename)).trim();
        if (!rawText) throw new Error("Parsed document is empty");

        await ctx.runMutation(internal.ingestion.updateFileStatus, {
            fileId: file._id,
            status: "parsed",
            stage: "parsed",
            rawText,
            parsed: { textBytes: rawText.length }
        });
        
        // Update local file object for next steps
        file.rawText = rawText;
    }

    // 2. ENRICH
    // ... (Logic similar to existing, but using new stages)
    const promptSections = [
        "You are a Knowledge Management Assistant. Normalize the document into concise text and metadata.",
        job.defaultContext ? `Additional context: ${job.defaultContext}` : null,
        `Filename: ${file.originalFilename}`,
        "Return normalizedText, summary, keyPoints, keywords, and suggestedTags.",
        "Document content:",
        file.rawText!.slice(0, 12000),
    ].filter(Boolean);

    const enriched = await callChatWithSchema(EnhancerSchema, {
        systemPrompt: "Extract structured knowledge.",
        userPrompt: promptSections.join("\n\n"),
    });

    await ctx.runMutation(internal.ingestion.updateFileStatus, {
        fileId: file._id,
        status: "enriched",
        stage: "enriched",
        enrichedText: enriched.normalizedText,
        summary: enriched.summary,
        keyPoints: enriched.keyPoints,
        keywords: enriched.keywords,
        suggestedTags: enriched.suggestedTags,
        topics: enriched.topics ?? [],
        domain: enriched.domain ?? undefined,
        clientName: enriched.clientName ?? undefined,
        language: enriched.language ?? undefined,
    });

    // 3. CHUNK & EMBED & COMMIT (Combined for now as "Ready")
    // In the plan, "Ready" means searchable in RAG.
    // So we should create the knowledgeDoc and chunks here.
    
    const textSource = enriched.normalizedText ?? file.rawText!;
    const tags = Array.from(new Set([...(job.defaultTags || []), ...(enriched.suggestedTags || [])]));
    
    const docId = await ctx.runMutation(internal.knowledge.createDocRecord, {
        projectId: file.projectId ?? job.projectId,
        title: file.originalFilename,
        storageId: file.storageId,
        summary: enriched.summary || "No summary",
        tags,
        keyPoints: enriched.keyPoints || [],
        keywords: enriched.keywords || [],
        topics: enriched.topics || [],
        domain: enriched.domain ?? undefined,
        clientName: enriched.clientName ?? undefined,
        language: enriched.language ?? undefined,
        sourceType: "doc_upload",
        sourceRefId: file._id,
        status: "processing",
    });

    const chunks = chunkText(textSource, 1200, 150);
    const chunkPayload = [];
    for (const chunk of chunks) {
        const embedding = await embedText(chunk);
        chunkPayload.push({
            docId,
            projectId: file.projectId ?? job.projectId,
            sourceType: "doc_upload" as const,
            clientName: enriched.clientName ?? undefined,
            topics: enriched.topics || [],
            domain: enriched.domain ?? undefined,
            createdAt: Date.now(),
            text: chunk,
            embedding,
        });
    }

    await ctx.runMutation(internal.knowledge.insertChunks, { chunks: chunkPayload });
    await ctx.runMutation(internal.knowledge.updateDocStatus, { docId, status: "ready" });
    
    await ctx.runMutation(internal.ingestion.updateFileStatus, {
        fileId: file._id,
        status: "ready",
        stage: "ready",
        ragDocId: docId,
    });
}

// --- Queries ---

export const getJob = query({
    args: { jobId: v.id("ingestionJobs") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.jobId);
    },
});

export const getFile = internalQuery({
    args: { fileId: v.id("ingestionFiles") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.fileId);
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

export const generateUploadUrl = mutation({
    args: {},
    handler: async (ctx) => {
        return await ctx.storage.generateUploadUrl();
    },
});
