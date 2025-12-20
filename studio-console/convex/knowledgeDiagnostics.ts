import { v } from "convex/values";
import { action, query, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { embedText } from "./lib/openai";

/**
 * RAG DIAGNOSTIC TOOLS
 *
 * These tools help diagnose why RAG retrieval is not working.
 * Based on the analysis, the primary issues are:
 *
 * 1. Agent-driven ingestion is broken (ingestArtifact is internalAction)
 * 2. Documents may not be reaching "ready" status
 * 3. Embeddings may not be generated correctly
 * 4. Filtering may be too aggressive
 */

// ═══════════════════════════════════════════════════════════
// HEALTH PANEL - Overview of RAG System Status
// ═══════════════════════════════════════════════════════════

export const getHealthStatus = query({
    args: {
        projectId: v.optional(v.id("projects")),
    },
    handler: async (ctx, args) => {
        // Count docs by status
        const allDocs = await ctx.db.query("knowledgeDocs").collect();
        const projectDocs = args.projectId
            ? allDocs.filter(doc => doc.projectId === args.projectId)
            : allDocs;

        const docsByStatus = {
            uploaded: projectDocs.filter(d => d.processingStatus === "uploaded").length,
            processing: projectDocs.filter(d => d.processingStatus === "processing").length,
            ready: projectDocs.filter(d => d.processingStatus === "ready").length,
            failed: projectDocs.filter(d => d.processingStatus === "failed").length,
        };

        const docsBySourceType = projectDocs.reduce((acc, doc) => {
            const sourceType = doc.sourceType || "unknown";
            acc[sourceType] = (acc[sourceType] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        // Count chunks
        const allChunks = await ctx.db.query("knowledgeChunks").collect();
        const projectChunks = args.projectId
            ? allChunks.filter(chunk => chunk.projectId === args.projectId)
            : allChunks;

        const chunksByProject = projectChunks.length;
        const chunksWithEmbeddings = projectChunks.filter(chunk =>
            chunk.embedding && chunk.embedding.length === 1536
        ).length;

        // Recent retrieval logs
        const retrievalLogs = await ctx.db
            .query("retrievalLogs")
            .order("desc")
            .take(20);

        const filteredLogs = args.projectId
            ? retrievalLogs.filter(log => log.projectId === args.projectId)
            : retrievalLogs;

        return {
            summary: {
                totalDocs: projectDocs.length,
                totalChunks: chunksByProject,
                chunksWithValidEmbeddings: chunksWithEmbeddings,
                embeddingCoverage: chunksByProject > 0
                    ? (chunksWithValidEmbeddings / chunksByProject * 100).toFixed(1) + "%"
                    : "0%",
            },
            docsByStatus,
            docsBySourceType,
            recentRetrievals: filteredLogs.map(log => ({
                query: log.query.slice(0, 100),
                scope: log.scope,
                resultCount: log.resultCount,
                agentRole: log.agentRole,
                filters: log.filtersJson,
                timestamp: new Date(log.createdAt).toISOString(),
            })),
            warnings: [
                docsByStatus.processing > 5 ? `⚠️ ${docsByStatus.processing} docs stuck in 'processing' state` : null,
                docsByStatus.failed > 0 ? `❌ ${docsByStatus.failed} docs failed to process` : null,
                chunksWithEmbeddings < chunksByProject * 0.9 ? `⚠️ Only ${chunksWithEmbeddings}/${chunksByProject} chunks have valid embeddings` : null,
                filteredLogs.filter(log => log.resultCount === 0).length > 10
                    ? `⚠️ ${filteredLogs.filter(log => log.resultCount === 0).length}/20 recent searches returned zero results`
                    : null,
            ].filter(Boolean),
        };
    },
});

// ═══════════════════════════════════════════════════════════
// DETAILED DIAGNOSTIC - Debug a specific search
// ═══════════════════════════════════════════════════════════

export const debugSearch = action({
    args: {
        projectId: v.optional(v.id("projects")),
        query: v.string(),
        sourceTypes: v.optional(v.array(v.string())),
        scope: v.optional(v.union(v.literal("project"), v.literal("global"), v.literal("both"))),
    },
    handler: async (ctx, args) => {
        const scope = args.scope || "project";

        // 1. Generate embedding
        const queryEmbedding = await embedText(args.query);

        // 2. Perform raw vector search (no filters)
        const rawResults = await ctx.vectorSearch("knowledgeChunks", "by_embedding", {
            vector: queryEmbedding,
            limit: 100,
        });

        // 3. Perform filtered vector search (with project filter)
        const filteredResults = args.projectId && scope === "project"
            ? await ctx.vectorSearch("knowledgeChunks", "by_embedding", {
                vector: queryEmbedding,
                limit: 100,
                filter: (q) => q.eq("projectId", args.projectId),
            })
            : rawResults;

        // 4. Get chunk and doc details
        const chunkIds = filteredResults.slice(0, 10).map(r => r._id);
        const chunkEntries = await ctx.runQuery(internal.knowledge.getChunksWithDocs, { ids: chunkIds });

        // 5. Analyze doc statuses
        const docStatuses = chunkEntries.map(entry => ({
            docId: entry.doc._id,
            status: entry.doc.processingStatus,
            sourceType: entry.doc.sourceType,
            projectId: entry.doc.projectId,
            score: filteredResults.find(r => r._id === entry.chunk._id)?._score || 0,
        }));

        const readyCount = docStatuses.filter(d => d.status === "ready").length;
        const processingCount = docStatuses.filter(d => d.status === "processing").length;
        const failedCount = docStatuses.filter(d => d.status === "failed").length;

        // 6. Get min/max scores
        const scores = filteredResults.map(r => r._score);
        const minScore = Math.min(...scores);
        const maxScore = Math.max(...scores);

        return {
            queryInfo: {
                queryText: args.query,
                embeddingLength: queryEmbedding.length,
                isValidEmbedding: queryEmbedding.length === 1536,
            },
            vectorSearchResults: {
                rawHitCount: rawResults.length,
                filteredHitCount: filteredResults.length,
                filterEffect: rawResults.length - filteredResults.length,
                minScore,
                maxScore,
                avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
            },
            docStatusBreakdown: {
                ready: readyCount,
                processing: processingCount,
                failed: failedCount,
                total: docStatuses.length,
            },
            topResults: docStatuses.slice(0, 10).map((doc, idx) => ({
                rank: idx + 1,
                docId: doc.docId,
                status: doc.status,
                sourceType: doc.sourceType,
                score: doc.score.toFixed(4),
                projectMatch: doc.projectId === args.projectId,
            })),
            diagnosis: {
                issues: [
                    filteredResults.length === 0 ? "❌ No chunks found in vector search" : null,
                    readyCount === 0 && filteredResults.length > 0 ? "❌ Chunks found but no docs are 'ready'" : null,
                    processingCount > 0 ? `⚠️ ${processingCount} docs still processing` : null,
                    failedCount > 0 ? `❌ ${failedCount} docs failed to process` : null,
                    queryEmbedding.length !== 1536 ? "❌ Query embedding has wrong dimensions" : null,
                ].filter(Boolean),
                recommendations: [
                    processingCount > 0 ? "Check why docs are stuck in 'processing' - likely embedding generation failed" : null,
                    failedCount > 0 ? "Investigate failed docs - check error logs" : null,
                    filteredResults.length === 0 && rawResults.length > 0 ? "Project filter is too restrictive - no chunks match projectId" : null,
                    filteredResults.length === 0 && rawResults.length === 0 ? "No chunks exist in database - ingestion pipeline is broken" : null,
                ].filter(Boolean),
            },
        };
    },
});

// ═══════════════════════════════════════════════════════════
// INGESTION DIAGNOSTICS - Check if ingestion is working
// ═══════════════════════════════════════════════════════════

export const testIngestion = internalAction({
    args: {
        projectId: v.id("projects"),
        testText: v.string(),
    },
    handler: async (ctx, args) => {
        // This tests the INTERNAL ingestion path
        // We can call this from a public action wrapper

        try {
            const docId = await ctx.runAction(internal.knowledge.ingestArtifact, {
                projectId: args.projectId,
                sourceType: "system_note",
                title: "RAG Diagnostic Test Document",
                text: args.testText,
                summary: "Test document to verify RAG ingestion is working",
                tags: ["diagnostic", "test"],
                domain: "testing",
            });

            // Wait a bit for embedding generation
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check if doc is ready
            const doc = await ctx.runQuery(internal.knowledge.getDocMetadata, { docId });

            return {
                success: true,
                docId,
                status: doc?.processingStatus || "not_found",
                isReady: doc?.processingStatus === "ready",
                message: doc?.processingStatus === "ready"
                    ? "✅ Ingestion working - document reached 'ready' status"
                    : `⚠️ Document created but status is '${doc?.processingStatus}'`,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                message: "❌ Ingestion failed - ingestArtifact cannot be called",
            };
        }
    },
});

// Public wrapper for testIngestion
export const runIngestionTest = action({
    args: {
        projectId: v.id("projects"),
    },
    handler: async (ctx, args) => {
        const testText = `
This is a test document created at ${new Date().toISOString()}.
It contains sample text to verify that the RAG ingestion pipeline is working correctly.
If you can retrieve this document via vector search, then ingestion is functioning.
        `.trim();

        return await ctx.runAction(internal.knowledgeDiagnostics.testIngestion, {
            projectId: args.projectId,
            testText,
        });
    },
});

// ═══════════════════════════════════════════════════════════
// FIX STUCK DOCUMENTS - Retry embedding generation
// ═══════════════════════════════════════════════════════════

export const fixStuckDocuments = action({
    args: {
        projectId: v.optional(v.id("projects")),
        dryRun: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const dryRun = args.dryRun ?? true;

        // Find all docs stuck in "processing"
        const allDocs = await ctx.runQuery(internal.knowledge.listDocsForNormalization, {});
        const stuckDocs = allDocs.filter(doc => {
            // Filter by project if provided
            if (args.projectId && doc.projectId !== args.projectId) return false;
            // Find processing docs (status check would require different query)
            return true; // We'd need to fetch full docs to check status
        });

        if (dryRun) {
            return {
                dryRun: true,
                message: "Dry run - no changes made",
                docsFound: stuckDocs.length,
                action: "Would retry embedding generation for stuck docs",
            };
        }

        // In production, we'd retry embedding generation here
        // But this requires access to the original text, which may not be stored

        return {
            dryRun: false,
            message: "Fix implementation pending",
            docsProcessed: 0,
        };
    },
});
