import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { embedText } from "./lib/openai";

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
        // 1. Chunk text (Naive splitting for now)
        const chunkSize = 1000;
        const chunks = [];
        for (let i = 0; i < args.text.length; i += chunkSize) {
            chunks.push(args.text.substring(i, i + chunkSize));
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

        // Fetch the texts (Convex vector search returns { _id, _score } usually, need to fetch doc?)
        // Actually Convex vector search can fetch content if configured or we fetch by ID.
        // Wait, 'vectorSearch' returns array of { _id, _score }. We need to map to content.
        
        // This is a bit tricky in action vs query. 
        // We can pass the IDs to a query to fetch the content.
        
        const chunkIds = results.map(r => r._id);
        if (chunkIds.length === 0) return [];

        const chunks = await ctx.runQuery(internal.knowledge.getChunks, { ids: chunkIds });
        return chunks.map((c, i) => ({ ...c, score: results[i]._score }));
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
