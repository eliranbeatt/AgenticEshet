import { v } from "convex/values";
import { action, mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { embedText, callChatWithSchema } from "./lib/openai";
import { chunkText } from "./lib/textChunker";
import { EnhancerSchema } from "./lib/zodSchemas";
import type { Doc } from "./_generated/dataModel";

const sourceTypeEnum = v.union(
  v.literal("doc_upload"),
  v.literal("plan"),
  v.literal("conversation"),
  v.literal("task"),
  v.literal("quest"),
  v.literal("quote"),
  v.literal("system_note")
);

type SourceType = "doc_upload" | "plan" | "conversation" | "task" | "quest" | "quote" | "system_note";
const scopeEnum = v.union(v.literal("project"), v.literal("global"), v.literal("both"));

// --- Mutations ---

export const createDoc = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    title: v.string(),
    storageId: v.string(),
    summary: v.string(),
    tags: v.array(v.string()),
    text: v.string(), // Full text to chunk
    sourceType: v.optional(sourceTypeEnum),
    sourceRefId: v.optional(v.string()),
    phase: v.optional(v.string()),
    clientName: v.optional(v.string()),
    topics: v.optional(v.array(v.string())),
    domain: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const docId = await ctx.db.insert("knowledgeDocs", {
      projectId: args.projectId,
      title: args.title,
      storageId: args.storageId,
      processingStatus: "processing", // We still need to chunk/embed
      sourceType: args.sourceType ?? "doc_upload",
      sourceRefId: args.sourceRefId,
      phase: args.phase,
      clientName: args.clientName,
      topics: args.topics ?? [],
      domain: args.domain,
      language: args.language,
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
    keyPoints: v.optional(v.array(v.string())),
    keywords: v.optional(v.array(v.string())),
    sourceType: sourceTypeEnum,
    sourceRefId: v.optional(v.string()),
    phase: v.optional(v.string()),
    clientName: v.optional(v.string()),
    topics: v.optional(v.array(v.string())),
    domain: v.optional(v.string()),
    language: v.optional(v.string()),
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
      keyPoints: args.keyPoints,
      keywords: args.keywords,
      sourceType: args.sourceType,
      sourceRefId: args.sourceRefId,
      phase: args.phase,
      clientName: args.clientName,
      topics: args.topics ?? [],
      domain: args.domain,
      language: args.language,
      createdAt: Date.now(),
    });
  },
});

export const insertChunks = mutation({
    args: {
        chunks: v.array(v.object({
            docId: v.id("knowledgeDocs"),
            projectId: v.optional(v.id("projects")),
            sourceType: sourceTypeEnum,
            clientName: v.optional(v.string()),
            topics: v.array(v.string()),
            domain: v.optional(v.string()),
            phase: v.optional(v.string()),
            createdAt: v.number(),
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
        const doc = await ctx.runQuery(internal.knowledge.getDocMetadata, { docId: args.docId });
        if (!doc) {
            throw new Error("Knowledge doc not found for embedding");
        }

        const chunks = chunkText(args.text);
        if (chunks.length === 0) {
            throw new Error("No text available for embedding");
        }

        // 2. Embed and prepare batch
        const now = Date.now();
        const chunkData = [];
        for (const chunkText of chunks) {
            const embedding = await embedText(chunkText);
            chunkData.push({
                docId: args.docId,
                projectId: doc.projectId ?? args.projectId,
                sourceType: doc.sourceType,
                clientName: doc.clientName,
                topics: Array.isArray(doc.topics) ? doc.topics : [],
                domain: doc.domain,
                phase: doc.phase,
                createdAt: now,
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
                if (!entry || entry.doc.processingStatus !== "ready") return null;
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
                        sourceType: entry.doc.sourceType,
                        topics: entry.doc.topics ?? [],
                        domain: entry.doc.domain,
                        clientName: entry.doc.clientName,
                    },
                };
            })
            .filter(Boolean);
    }
});

export const ingestArtifact = action({
    args: {
        projectId: v.optional(v.id("projects")),
        sourceType: sourceTypeEnum,
        sourceRefId: v.optional(v.string()),
        title: v.string(),
        text: v.string(),
        summary: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        topics: v.optional(v.array(v.string())),
        domain: v.optional(v.string()),
        clientName: v.optional(v.string()),
        phase: v.optional(v.string()),
        language: v.optional(v.string()),
        chunkSize: v.optional(v.number()),
        chunkOverlap: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const enrichment = await callChatWithSchema(EnhancerSchema, {
            systemPrompt: "Normalize and summarize the provided artifact text for downstream retrieval. Extract topics, domain, and client if visible.",
            userPrompt: args.text.slice(0, 12000),
        });

        const normalizedText = enrichment.normalizedText || args.text;
        const chunkSize = args.chunkSize ?? 1200;
        const chunkOverlap = args.chunkOverlap ?? 150;
        const chunkCreatedAt = Date.now();

        const docId = await ctx.runMutation(internal.knowledge.createDocRecord, {
            projectId: args.projectId,
            title: args.title,
            storageId: "manual-upload",
            summary: args.summary || enrichment.summary || "No summary provided",
            tags: args.tags || enrichment.suggestedTags || [],
            keyPoints: enrichment.keyPoints,
            keywords: enrichment.keywords,
            topics: args.topics ?? enrichment.topics ?? [],
            domain: args.domain ?? enrichment.domain,
            clientName: args.clientName ?? enrichment.clientName,
            language: args.language ?? enrichment.language,
            sourceType: args.sourceType as SourceType,
            sourceRefId: args.sourceRefId,
            phase: args.phase,
            status: "processing",
        });

        const chunks = chunkText(normalizedText, chunkSize, chunkOverlap);
        if (chunks.length === 0) {
            await ctx.runMutation(internal.knowledge.updateDocStatus, { docId, status: "failed" });
            throw new Error("No text available for embedding");
        }

        const chunkPayload = [];
        for (const chunk of chunks) {
            const embedding = await embedText(chunk);
            chunkPayload.push({
                docId,
                projectId: args.projectId,
                sourceType: args.sourceType as SourceType,
                clientName: args.clientName ?? enrichment.clientName,
                topics: args.topics ?? enrichment.topics ?? [],
                domain: args.domain ?? enrichment.domain,
                phase: args.phase,
                createdAt: chunkCreatedAt,
                text: chunk,
                embedding,
            });
        }

        await ctx.runMutation(internal.knowledge.insertChunks, { chunks: chunkPayload });
        await ctx.runMutation(internal.knowledge.updateDocStatus, { docId, status: "ready" });
        return docId;
    },
});

export const dynamicSearch = action({
    args: {
        projectId: v.optional(v.id("projects")),
        query: v.string(),
        limit: v.optional(v.number()),
        minScore: v.optional(v.number()),
        scope: v.optional(scopeEnum),
        sourceTypes: v.optional(v.array(sourceTypeEnum)),
        clientNames: v.optional(v.array(v.string())),
        domains: v.optional(v.array(v.string())),
        topics: v.optional(v.array(v.string())),
        phases: v.optional(v.array(v.string())),
        includeSummaries: v.optional(v.boolean()),
        returnChunks: v.optional(v.boolean()),
        agentRole: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 8;
        const minScore = args.minScore ?? 0;
        const scope = args.scope ?? "project";

        if ((scope === "project" || scope === "both") && !args.projectId) {
            throw new Error("projectId is required when scope is project or both");
        }

        const embedding = await embedText(args.query);
        const chunkResults: { _id: Doc<"knowledgeChunks">["_id"]; _score: number; scope: "project" | "global" }[] = [];

        const searchVectors = async (scopeLabel: "project" | "global") => {
            const vectorArgs: { vector: number[]; limit: number; filter?: (q: any) => any } = {
                vector: embedding,
                limit: limit * 3,
            };

            if (scopeLabel === "project" && args.projectId) {
                vectorArgs.filter = (q: any) => q.eq("projectId", args.projectId);
            }

            if (scopeLabel === "global") {
                // Allow all, we'll post-filter for global-only
            }

            const results = await ctx.vectorSearch("knowledgeChunks", "by_embedding", vectorArgs as any);
            results.forEach((res) => chunkResults.push({ ...res, scope: scopeLabel }));
        };

        if (scope === "project" || scope === "both") {
            await searchVectors("project");
        }
        if (scope === "global" || scope === "both") {
            await searchVectors("global");
        }

        const uniqueIds = Array.from(new Set(chunkResults.map((r) => r._id)));
        if (uniqueIds.length === 0) {
            await ctx.runMutation(internal.knowledge.logRetrieval, {
                projectId: args.projectId,
                agentRole: args.agentRole ?? "unknown",
                query: args.query,
                filtersJson: JSON.stringify({
                    sourceTypes: args.sourceTypes ?? [],
                    clientNames: args.clientNames ?? [],
                    domains: args.domains ?? [],
                    topics: args.topics ?? [],
                    phases: args.phases ?? [],
                }),
                scope,
                limit,
                minScore,
                resultCount: 0,
                createdAt: Date.now(),
            });
            return [];
        }

        const chunkEntries = await ctx.runQuery(internal.knowledge.getChunksWithDocs, { ids: uniqueIds });
        const entryMap = new Map(chunkEntries.map((entry) => [entry.chunk._id, entry]));

        const filtered = chunkResults
            .map((result) => {
                const entry = entryMap.get(result._id);
                if (!entry) return null;
                if (entry.doc.processingStatus !== "ready") return null;

                // Scope filter for global-only requests
                if (result.scope === "global" && entry.chunk.projectId) {
                    return null;
                }
                if (result.scope === "project" && args.projectId && entry.chunk.projectId && entry.chunk.projectId !== args.projectId) {
                    return null;
                }

                if (args.sourceTypes && args.sourceTypes.length > 0 && !args.sourceTypes.includes(entry.doc.sourceType as SourceType)) {
                    return null;
                }
                if (args.clientNames && args.clientNames.length > 0) {
                    if (!entry.doc.clientName || !args.clientNames.includes(entry.doc.clientName)) return null;
                }
                if (args.domains && args.domains.length > 0) {
                    if (!entry.doc.domain || !args.domains.includes(entry.doc.domain)) return null;
                }
                if (args.phases && args.phases.length > 0) {
                    if (!entry.doc.phase || !args.phases.includes(entry.doc.phase)) return null;
                }
                if (args.topics && args.topics.length > 0) {
                    const topicMatch = (entry.doc.topics || []).some((topic) =>
                        args.topics?.some((filter) => topic.toLowerCase().includes(filter.toLowerCase()))
                    );
                    if (!topicMatch) return null;
                }

                if (result._score < minScore) return null;

                return { result, entry };
            })
            .filter(Boolean) as { result: { _id: any; _score: number; scope: "project" | "global" }; entry: { chunk: Doc<"knowledgeChunks">; doc: Doc<"knowledgeDocs"> } }[];

        const deduped = Array.from(
            new Map(filtered.map((row) => [row.entry.chunk._id, row])).values()
        ).sort((a, b) => b.result._score - a.result._score)
         .slice(0, limit);

        await ctx.runMutation(internal.knowledge.logRetrieval, {
            projectId: args.projectId,
            agentRole: args.agentRole ?? "unknown",
            query: args.query,
            filtersJson: JSON.stringify({
                sourceTypes: args.sourceTypes ?? [],
                clientNames: args.clientNames ?? [],
                domains: args.domains ?? [],
                topics: args.topics ?? [],
                phases: args.phases ?? [],
            }),
            scope,
            limit,
            minScore,
            resultCount: deduped.length,
            createdAt: Date.now(),
        });

        return deduped.map(({ entry, result }) => ({
            chunkId: entry.chunk._id,
            docId: entry.chunk.docId,
            score: result._score,
            text: args.returnChunks === false ? undefined : entry.chunk.text,
            scope: result.scope,
            doc: {
                _id: entry.doc._id,
                title: entry.doc.title,
                summary: args.includeSummaries === false ? undefined : entry.doc.summary,
                tags: entry.doc.tags,
                sourceType: entry.doc.sourceType,
                topics: entry.doc.topics ?? [],
                domain: entry.doc.domain,
                clientName: entry.doc.clientName,
                phase: entry.doc.phase,
            },
        }));
    },
});

export const logRetrieval = internalMutation({
    args: {
        projectId: v.optional(v.id("projects")),
        agentRole: v.string(),
        query: v.string(),
        filtersJson: v.string(),
        scope: v.string(),
        limit: v.number(),
        minScore: v.optional(v.number()),
        resultCount: v.number(),
        createdAt: v.number(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("retrievalLogs", {
            projectId: args.projectId,
            agentRole: args.agentRole,
            query: args.query,
            filtersJson: args.filtersJson,
            scope: args.scope,
            limit: args.limit,
            minScore: args.minScore,
            resultCount: args.resultCount,
            createdAt: args.createdAt,
        });
    },
});

// --- Queries ---

export const listDocs = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.db.query("knowledgeDocs").withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect();
    }
});

export const getDocDetail = query({
    args: { docId: v.id("knowledgeDocs") },
    handler: async (ctx, args) => {
        const doc = await ctx.db.get(args.docId);
        if (!doc) {
            return null;
        }

        let downloadUrl: string | null = null;
        if (doc.storageId && doc.storageId !== "manual-upload" && !doc.storageId.startsWith("http")) {
            try {
                // Only attempt if it looks like a valid storage ID (not a URL, not a placeholder)
                downloadUrl = await ctx.storage.getUrl(doc.storageId);
            } catch (error) {
                console.error("Failed to generate download URL for doc:", doc._id, error);
            }
        }

        return {
            _id: doc._id,
            title: doc.title,
            summary: doc.summary,
            tags: doc.tags,
            keyPoints: doc.keyPoints ?? [],
            keywords: doc.keywords ?? [],
            sourceType: doc.sourceType,
            sourceRefId: doc.sourceRefId,
            phase: doc.phase,
            clientName: doc.clientName,
            topics: doc.topics ?? [],
            domain: doc.domain,
            language: doc.language,
            processingStatus: doc.processingStatus,
            downloadUrl,
            createdAt: doc.createdAt,
        };
    },
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

export const getDocMetadata = internalQuery({
    args: { docId: v.id("knowledgeDocs") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.docId);
    },
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
        sourceTypes: v.optional(v.array(sourceTypeEnum)),
        includeGlobal: v.optional(v.boolean()),
        topics: v.optional(v.array(v.string())),
        clientNames: v.optional(v.array(v.string())),
        domains: v.optional(v.array(v.string())),
        phases: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const projectDocs = await ctx.db
            .query("knowledgeDocs")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .take(args.limit * 3);

        const globalDocs = args.includeGlobal
            ? await ctx.db.query("knowledgeDocs").order("desc").take(args.limit * 3)
            : [];

        const docs = [...projectDocs, ...globalDocs.filter((doc) => !doc.projectId)];

        const readyDocs = docs.filter((doc) => doc.processingStatus === "ready");

        const filteredBySource = args.sourceTypes && args.sourceTypes.length > 0
            ? readyDocs.filter((doc) => args.sourceTypes?.includes(doc.sourceType as SourceType))
            : readyDocs;

        const filteredByTags = args.tagFilter && args.tagFilter.length > 0
            ? filteredBySource.filter((doc) =>
                  doc.tags.some((tag) => args.tagFilter?.some((filter) => tag.toLowerCase().includes(filter.toLowerCase())))
              )
            : filteredBySource;

        const filteredByTopics = args.topics && args.topics.length > 0
            ? filteredByTags.filter((doc) =>
                  doc.topics?.some((topic) =>
                      args.topics?.some((filter) => topic.toLowerCase().includes(filter.toLowerCase()))
                  )
              )
            : filteredByTags;

        const filteredByClient = args.clientNames && args.clientNames.length > 0
            ? filteredByTopics.filter((doc) => doc.clientName && args.clientNames?.includes(doc.clientName))
            : filteredByTopics;

        const filteredByDomain = args.domains && args.domains.length > 0
            ? filteredByClient.filter((doc) => doc.domain && args.domains?.includes(doc.domain))
            : filteredByClient;

        const filteredByPhase = args.phases && args.phases.length > 0
            ? filteredByDomain.filter((doc) => doc.phase && args.phases?.includes(doc.phase))
            : filteredByDomain;

        return filteredByPhase.slice(0, args.limit).map((doc) => ({
            _id: doc._id,
            title: doc.title,
            summary: doc.summary,
            tags: doc.tags,
            sourceType: doc.sourceType,
            topics: doc.topics ?? [],
            domain: doc.domain,
            clientName: doc.clientName,
            phase: doc.phase,
        }));
    },
});

export const findBySourceRef = internalQuery({
    args: {
        sourceRefId: v.string(),
        sourceType: sourceTypeEnum,
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("knowledgeDocs")
            .filter((q) => q.and(q.eq(q.field("sourceRefId"), args.sourceRefId), q.eq(q.field("sourceType"), args.sourceType)))
            .collect();
    },
});
