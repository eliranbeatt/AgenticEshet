import { v } from "convex/values";
import { query, mutation, internalMutation, action, internalQuery } from "./_generated/server";
import { embedText } from "./lib/openai";
import { internal } from "./_generated/api";
import { Id, Doc } from "./_generated/dataModel";

// --- Queries ---

export const listRecentDocs = query({
    args: {
        projectId: v.id("projects"),
        limit: v.number(),
        sourceTypes: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const docs = await ctx.db
            .query("knowledgeDocs")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .take(args.limit * 5);

        const filtered = docs
            .filter((doc) => doc.sourceType && args.sourceTypes.includes(doc.sourceType))
            .slice(0, args.limit);

        return filtered;
    },
});

export const listDocs = query({
    args: { projectId: v.optional(v.id("projects")) },
    handler: async (ctx, args) => {
        if (!args.projectId) return [];
        return await ctx.db
            .query("knowledgeDocs")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();
    },
});

export const getDocDetail = query({
    args: { docId: v.id("knowledgeDocs") },
    handler: async (ctx, args) => {
        const doc = await ctx.db.get(args.docId);
        if (!doc) return null;

        let downloadUrl = null;
        if (doc.storageId) {
            downloadUrl = await ctx.storage.getUrl(doc.storageId);
        }

        return { ...doc, downloadUrl };
    },
});

// --- Internal Mutations (for Ingestion) ---

export const createDocRecord = internalMutation({
    args: {
        projectId: v.optional(v.id("projects")),
        title: v.string(),
        storageId: v.string(),
        summary: v.string(),
        tags: v.array(v.string()),
        keyPoints: v.array(v.string()),
        keywords: v.array(v.string()),
        topics: v.array(v.string()),
        domain: v.optional(v.string()),
        clientName: v.optional(v.string()),
        language: v.optional(v.string()),
        sourceType: v.string(),
        sourceRefId: v.optional(v.string()),
        status: v.string(),
    },
    handler: async (ctx, args) => {
        const docId = await ctx.db.insert("knowledgeDocs", {
            projectId: args.projectId,
            title: args.title,
            storageId: args.storageId,
            summary: args.summary,
            tags: args.tags,
            keyPoints: args.keyPoints,
            keywords: args.keywords,
            topics: args.topics,
            domain: args.domain,
            clientName: args.clientName,
            language: args.language,
            sourceType: args.sourceType as any,
            sourceRefId: args.sourceRefId,
            processingStatus: args.status as any,
            createdAt: Date.now(),
        });
        return docId;
    },
});

export const insertChunks = internalMutation({
    args: {
        chunks: v.array(v.object({
            docId: v.id("knowledgeDocs"),
            projectId: v.optional(v.id("projects")),
            sourceType: v.optional(v.string()),
            clientName: v.optional(v.string()),
            topics: v.optional(v.array(v.string())),
            domain: v.optional(v.string()),
            phase: v.optional(v.string()),
            createdAt: v.optional(v.number()),
            text: v.string(),
            embedding: v.array(v.float64()),
        })),
    },
    handler: async (ctx, args) => {
        for (const chunk of args.chunks) {
            await ctx.db.insert("knowledgeChunks", {
                ...chunk,
                sourceType: chunk.sourceType as any,
            });
        }
    },
});

export const updateDocStatus = internalMutation({
    args: {
        docId: v.id("knowledgeDocs"),
        status: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.docId, {
            processingStatus: args.status as any,
        });
    },
});

// --- Internal helpers for action ---

export const getChunks = internalQuery({
    args: { chunkIds: v.array(v.id("knowledgeChunks")) },
    handler: async (ctx, args) => {
        const chunks = await Promise.all(args.chunkIds.map(id => ctx.db.get(id)));
        return chunks.filter((c): c is Doc<"knowledgeChunks"> => c !== null);
    }
});

export const getDocsByIds = internalQuery({
    args: { docIds: v.array(v.id("knowledgeDocs")) },
    handler: async (ctx, args) => {
        const docs = await Promise.all(args.docIds.map(id => ctx.db.get(id)));
        return docs.filter((d): d is Doc<"knowledgeDocs"> => d !== null);
    }
});

// --- Actions (Search) ---

export const dynamicSearch = action({
    args: {
        projectId: v.id("projects"),
        query: v.string(),
        scope: v.union(v.literal("project"), v.literal("global"), v.literal("both")),
        limit: v.number(),
        minScore: v.number(),
        sourceTypes: v.optional(v.array(v.string())),
        includeSummaries: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const embedding = await embedText(args.query);

        // Vector search filter construction
        const filter = (q: any) => {
            if (args.scope === "project") {
                return q.eq("projectId", args.projectId);
            }
            if (args.scope === "global") {
                // Trying to match null/undefined projectId
                // Note: Convex vector search filtering might behave differently with optional fields depending on index config.
                // We will assume normal equality works.
                // If not, we might need a separate index or strategy.
                return q.eq("projectId", undefined);
            }
            // "both" -> no filter
            return undefined;
        };

        const results = await ctx.vectorSearch("knowledgeChunks", "by_embedding", {
            vector: embedding,
            limit: args.limit * 3,
            filter: args.scope !== "both" ? filter : undefined,
        });

        const relevantResults = results.filter((r) => r._score >= args.minScore);

        // Fetch chunks to check metadata
        const chunks = await ctx.runQuery(internal.knowledge.getChunks, {
            chunkIds: relevantResults.map(r => r._id)
        });

        const chunksWithScore = chunks.map(chunk => {
            const score = relevantResults.find(r => r._id === chunk._id)?._score ?? 0;
            return { ...chunk, score };
        });

        // Filter by sourceTypes and scope (if "both", distinguish)
        const filteredChunks = chunksWithScore.filter(c => {
            // Filter source types
            if (args.sourceTypes && c.sourceType && !args.sourceTypes.includes(c.sourceType)) {
                return false;
            }
            // Double check scope logic if needed
            if (args.scope === "project" && c.projectId !== args.projectId) return false;
            // if scope is global, we expect projectId undefined.

            return true;
        });

        const topChunks = filteredChunks.slice(0, args.limit);
        const uniqueDocIds = [...new Set(topChunks.map(c => c.docId))];

        const docs = await ctx.runQuery(internal.knowledge.getDocsByIds, { docIds: uniqueDocIds });
        const docsMap = new Map(docs.map(d => [d._id, d]));

        return topChunks.map(chunk => {
            const doc = docsMap.get(chunk.docId);
            if (!doc) return null;
            return {
                chunkId: chunk._id,
                docId: chunk.docId,
                text: chunk.text,
                score: chunk.score,
                scope: chunk.projectId ? "project" : "global",
                doc: {
                    _id: doc._id,
                    title: doc.title,
                    summary: doc.summary,
                    tags: doc.tags,
                    sourceType: doc.sourceType,
                    topics: doc.topics ?? [],
                    domain: doc.domain,
                    clientName: doc.clientName,
                    phase: doc.phase,
                }
            };
        }).filter(Boolean); // remove nulls
    },
});
