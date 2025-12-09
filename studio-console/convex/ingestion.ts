import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { callChatWithSchema } from "./lib/openai";
import { EnhancerSchema } from "./lib/zodSchemas";

// --- Mutations ---

export const createJob = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("ingestionJobs", {
      projectId: args.projectId,
      name: args.name,
      defaultContext: "",
      defaultTags: [],
      status: "created",
      createdAt: Date.now(),
    });
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
    status: v.union(v.literal("parsed"), v.literal("enriched"), v.literal("failed")),
    rawText: v.optional(v.string()),
    enrichedData: v.optional(v.object({
        summary: v.string(),
        keyPoints: v.array(v.string()),
        keywords: v.array(v.string()),
        suggestedTags: v.array(v.string()),
    })),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const update: any = { status: args.status };
    if (args.rawText) update.rawText = args.rawText;
    if (args.enrichedData) {
        update.summary = args.enrichedData.summary;
        update.keyPointsJson = JSON.stringify(args.enrichedData.keyPoints);
        update.keywordsJson = JSON.stringify(args.enrichedData.keywords);
        update.suggestedTagsJson = JSON.stringify(args.enrichedData.suggestedTags);
    }
    if (args.error) update.error = args.error;
    
    await ctx.db.patch(args.fileId, update);
  },
});

// --- Actions ---

export const processFile = action({
    args: { fileId: v.id("ingestionFiles") },
    handler: async (ctx, args) => {
        const file = await ctx.runQuery(internal.ingestion.getFile, { fileId: args.fileId });
        if (!file) throw new Error("File not found");

        try {
            // 1. Get File Content
            const url = await ctx.storage.getUrl(file.storageId);
            if (!url) throw new Error("Storage URL not found");
            
            const response = await fetch(url);
            const blob = await response.blob();
            const text = await blob.text(); // Assuming text/md for now. TODO: PDF/Docx parsing

            await ctx.runMutation(internal.ingestion.updateFileStatus, {
                fileId: args.fileId,
                status: "parsed",
                rawText: text,
            });

            // 2. Enrich with LLM
            const prompt = `Analyze this document:
            Filename: ${file.originalFilename}
            Content:
            ${text.substring(0, 10000)}... (truncated)`; // Limit context

            const enriched = await callChatWithSchema(EnhancerSchema, {
                systemPrompt: "You are a Knowledge Management Assistant. Summarize and tag this document.",
                userPrompt: prompt
            });

            await ctx.runMutation(internal.ingestion.updateFileStatus, {
                fileId: args.fileId,
                status: "enriched",
                enrichedData: enriched,
            });

        } catch (err: any) {
            await ctx.runMutation(internal.ingestion.updateFileStatus, {
                fileId: args.fileId,
                status: "failed",
                error: err.message || "Unknown error",
            });
        }
    }
});

// --- Internal Queries ---

export const getFile = query({
    args: { fileId: v.id("ingestionFiles") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.fileId);
    }
});

export const listJobs = query({
    args: { projectId: v.optional(v.id("projects")) },
    handler: async (ctx, args) => {
        if (args.projectId) {
            return await ctx.db.query("ingestionJobs").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
        }
        return await ctx.db.query("ingestionJobs").collect();
    }
});

export const listFiles = query({
    args: { jobId: v.id("ingestionJobs") },
    handler: async (ctx, args) => {
        return await ctx.db.query("ingestionFiles").withIndex("by_job", (q) => q.eq("ingestionJobId", args.jobId)).collect();
    }
});
