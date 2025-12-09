import { v } from "convex/values";
import { action, mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { embedText } from "./lib/openai";
import { chunkText } from "./lib/textChunker";
import type { Doc } from "./_generated/dataModel";

// --- Mutations ---

export const createDoc = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    title: v.string(),
    storageId: v.string(),
    summary: v.string(),
    tags: v.array(v.string()),
    text: v.string(), // Full text to chunk
  },
  handler: async (ctx, args) => {
    const docId = await ctx.db.insert("knowledgeDocs", {
      projectId: args.projectId,
      title: args.title,
      storageId: args.storageId,
      processingStatus: "processing", // We still need to chunk/embed
      summary: args.summary,
      tags: args.tags,
      createdAt: Date.now(),
    });

    // Schedule embedding
    await ctx.scheduler.runAfter(0, internal.knowledge.generateEmbeddings, { 
        docId, 
        text: args.text,
        projectId: args.projectId 
    });

    return docId;
  },
});

export const createDocRecord = internalMutation({
  args: {
    projectId: v.optional(v.id("projects")),
    title: v.string(),
    storageId: v.string(),
    summary: v.string(),
    tags: v.array(v.string()),
    status: v.union(
        v.literal("uploaded"),
        v.literal("processing"),
        v.literal("ready"),
        v.literal("failed")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("knowledgeDocs", {
      projectId: args.projectId,
      title: args.title,
      storageId: args.storageId,
      processingStatus: args.status,
      summary: args.summary,
      tags: args.tags,
      createdAt: Date.now(),
    });
  },
});

export const insertChunks = mutation({
    args: {
        chunks: v.array(v.object({
            docId: v.id("knowledgeDocs"),
            projectId: v.optional(v.id("projects")),
            text: v.string(),
            embedding: v.array(v.float64()),
        }))
    },
    handler: async (ctx, args) => {
        for (const chunk of args.chunks) {
            await ctx.db.insert("knowledgeChunks", chunk);
        }
    }
});

export const updateDocStatus = mutation({
    args: { docId: v.id("knowledgeDocs"), status: v.union(v.literal("ready"), v.literal("failed")) },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.docId, { processingStatus: args.status });
    }
});

// --- Actions ---

export const generateEmbeddings = action({
  args: { 
    docId: v.id("knowledgeDocs"), 
    text: v.string(),
    projectId: v.optional(v.id("projects"))
  },
  handler: async (ctx, args) => {
    try {
        const chunks = chunkText(args.text);
        if (chunks.length === 0) {
            throw new Error("No text available for embedding");
        }

        // 2. Embed and prepare batch
        const chunkData = [];
        for (const chunkText of chunks) {
            const embedding = await embedText(chunkText);
            chunkData.push({
                docId: args.docId,
                projectId: args.projectId,
                text: chunkText,
                embedding,
            });
        }

        // 3. Save
        await ctx.runMutation(internal.knowledge.insertChunks, { chunks: chunkData });
        await ctx.runMutation(internal.knowledge.updateDocStatus, { docId: args.docId, status: "ready" });

    } catch (err) {
        console.error("Embedding failed", err);
        await ctx.runMutation(internal.knowledge.updateDocStatus, { docId: args.docId, status: "failed" });
    }
  },
});

export const search = action({
    args: {
        projectId: v.id("projects"),
        query: v.string(),
    },
    handler: async (ctx, args) => {
        const embedding = await embedText(args.query);
        
        const results = await ctx.vectorSearch("knowledgeChunks", "by_embedding", {
            vector: embedding,
            limit: 5,
            filter: (q) => q.eq("projectId", args.projectId),
        });

        const chunkIds = results.map((r) => r._id);
        if (chunkIds.length === 0) return [];

        const chunkEntries = await ctx.runQuery(internal.knowledge.getChunksWithDocs, { ids: chunkIds });
        const entryMap = new Map(chunkEntries.map((entry) => [entry.chunk._id, entry]));

        return results
            .map((result) => {
                const entry = entryMap.get(result._id);
                if (!entry) return null;
                return {
                    chunkId: entry.chunk._id,
                    docId: entry.chunk.docId,
                    text: entry.chunk.text,
                    score: result._score,
                    doc: {
                        _id: entry.doc._id,
                        title: entry.doc.title,
                        summary: entry.doc.summary,
                        tags: entry.doc.tags,
                    },
                };
            })
            .filter(Boolean);
    }
});

// --- Queries ---

export const listDocs = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db.query("knowledgeDocs").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
    }
});

export const getChunks = query({
    args: { ids: v.array(v.id("knowledgeChunks")) },
    handler: async (ctx, args) => {
        const chunks = [];
        for (const id of args.ids) {
            const chunk = await ctx.db.get(id);
            if (chunk) chunks.push(chunk);
        }
        return chunks;
    }
});

export const getChunksWithDocs = internalQuery({
    args: { ids: v.array(v.id("knowledgeChunks")) },
    handler: async (ctx, args) => {
        const result: { chunk: Doc<"knowledgeChunks">; doc: Doc<"knowledgeDocs"> }[] = [];
        for (const id of args.ids) {
            const chunk = await ctx.db.get(id);
            if (!chunk) continue;
            const doc = await ctx.db.get(chunk.docId);
            if (!doc) continue;
            result.push({ chunk, doc });
        }
        return result;
    }
});

export const getContextDocs = internalQuery({
    args: {
        projectId: v.id("projects"),
        limit: v.number(),
        tagFilter: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const docs = await ctx.db
            .query("knowledgeDocs")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .take(args.limit * 3);

        const readyDocs = docs.filter((doc) => doc.processingStatus === "ready");

        const filtered = args.tagFilter && args.tagFilter.length > 0
            ? readyDocs.filter((doc) =>
                  doc.tags.some((tag) => args.tagFilter?.some((filter) => tag.toLowerCase().includes(filter.toLowerCase())))
              )
            : readyDocs;

        return filtered.slice(0, args.limit).map((doc) => ({
            _id: doc._id,
            title: doc.title,
            summary: doc.summary,
            tags: doc.tags,
        }));
    },
});
