import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { z } from "zod";
import { callChatWithSchema, embedText } from "./lib/openai";
import { buildUserPrompt, SYSTEM_PROMPT } from "./lib/factsV2/prompts";
import { internal, api } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { verifyEvidenceV2 } from "./lib/factsV2/verify";

const FactEvidenceSchema = z.object({
    quoteHe: z.string(),
    startChar: z.number().optional(),
    endChar: z.number().optional(),
    sourceSection: z.string().optional(),
    sourceKind: z.enum(["user", "doc", "agentOutput"]).optional(),
});

const FactAtomSchema = z.object({
    scopeType: z.enum(["project", "item"]).optional(),
    scope: z.enum(["project", "item"]).optional(),
    itemId: z.string().nullable().optional(),
    factTextHe: z.string(),
    category: z.string(),
    importance: z.number(),
    sourceTier: z.enum(["user_evidence", "hypothesis"]),
    confidence: z.number(),
    key: z.string().optional(),
    valueType: z.string().optional(),
    value: z.unknown().optional(),
    evidence: z.array(FactEvidenceSchema).optional(),
});

const FactAtomsResponseSchema = z.object({
    facts: z.array(FactAtomSchema),
});

const PROPOSED_CONTEXT_THRESHOLD = 0.85;
const AUTO_ACCEPT_THRESHOLD = 0.8;
const CHUNK_SIZE = 3000;
const CHUNK_OVERLAP = 250;

type ExtractedFact = z.infer<typeof FactAtomSchema> & {
    _chunkId: string;
    _chunkStart: number;
    _chunkEnd: number;
};

type ChunkSpec = { text: string; start: number; end: number };

async function sha256(text: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildRawChunks(text: string, chunkSize: number, overlap: number): ChunkSpec[] {
    if (!text) return [];
    const chunks: ChunkSpec[] = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(text.length, start + chunkSize);
        chunks.push({ text: text.slice(start, end), start, end });
        if (end >= text.length) break;
        start = Math.max(0, end - overlap);
    }
    return chunks;
}

function normalizeValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

async function isFactsEnabled(
    ctx: { db: { get: (id: Id<"projects">) => Promise<Doc<"projects"> | null> } },
    projectId: Id<"projects">
) {
    const project = await ctx.db.get(projectId);
    return project?.features?.factsEnabled !== false;
}

function formatLegacyFactValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        if ("value" in record && "unit" in record) {
            const entry = record as { value: number; unit: string };
            return `${entry.value} ${entry.unit}`.trim();
        }
        if ("iso" in record) {
            return String(record.iso);
        }
        if ("min" in record || "max" in record) {
            const min = record.min ?? "";
            const max = record.max ?? "";
            return `${min}-${max}`.replace(/^-/, "").replace(/-$/, "");
        }
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function inferCategoryFromKey(key?: string | null): string {
    if (!key) return "other";
    if (key.includes("constraints")) return "constraints";
    if (key.includes("dimensions")) return "dimensions";
    if (key.includes("materials")) return "materials";
    if (key.includes("logistics")) return "logistics";
    if (key.includes("timeline")) return "timeline";
    if (key.includes("budget")) return "budget";
    if (key.includes("preferences")) return "preferences";
    if (key.includes("risks")) return "risks";
    if (key.includes("stakeholders")) return "stakeholders";
    return "other";
}

type ItemRef = { id: Id<"projectItems">; name: string };

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9\u0590-\u05ff]+/i)
        .map((token) => token.trim())
        .filter(Boolean);
}

function resolveItemReference(mentionText: string, items: ItemRef[]) {
    const mention = mentionText.toLowerCase();
    const mentionTokens = new Set(tokenize(mentionText));
    let best: { item: ItemRef; score: number } | null = null;
    const candidates: Array<{ id: Id<"projectItems">; name: string; score: number }> = [];

    for (const item of items) {
        const nameLower = item.name.toLowerCase();
        let score = 0;
        if (mention.includes(nameLower)) {
            score = 1;
        } else {
            const itemTokens = tokenize(item.name);
            if (itemTokens.length > 0) {
                let matched = 0;
                for (const token of itemTokens) {
                    if (mentionTokens.has(token)) matched += 1;
                }
                score = matched / itemTokens.length;
            }
        }
        candidates.push({ id: item.id, name: item.name, score });
        if (!best || score > best.score) {
            best = { item, score };
        }
    }

    candidates.sort((a, b) => b.score - a.score);
    return {
        best: best ? { itemId: best.item.id, confidence: best.score } : null,
        candidates: candidates.slice(0, 3),
    };
}

function normalizeExtractedFact(fact: z.infer<typeof FactAtomSchema>): Omit<ExtractedFact, "_chunkId" | "_chunkStart" | "_chunkEnd"> {
    const scopeType = fact.scopeType ?? fact.scope;
    if (!scopeType) {
        throw new Error("Fact is missing scopeType");
    }
    return {
        ...fact,
        scopeType,
    };
}

export const getBundle = internalQuery({
    args: { turnBundleId: v.id("turnBundles") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.turnBundleId);
    },
});

export const getLatestRunByBundle = internalQuery({
    args: { turnBundleId: v.id("turnBundles") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("factExtractionRuns")
            .withIndex("by_bundle", (q) => q.eq("turnBundleId", args.turnBundleId))
            .order("desc")
            .first();
    },
});

export const createExtractionRun = internalMutation({
    args: { turnBundleId: v.id("turnBundles"), model: v.string() },
    handler: async (ctx, args) => {
        const bundle = await ctx.db.get(args.turnBundleId);
        if (!bundle) throw new Error("Bundle not found");
        return await ctx.db.insert("factExtractionRuns", {
            projectId: bundle.projectId,
            turnBundleId: args.turnBundleId,
            status: "running",
            model: args.model,
            startedAt: Date.now(),
            createdAt: Date.now(),
        });
    },
});

export const updateExtractionRun = internalMutation({
    args: {
        runId: v.id("factExtractionRuns"),
        status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed")),
        finishedAt: v.optional(v.number()),
        chunking: v.optional(v.object({
            chunks: v.number(),
            strategy: v.string(),
            chunkSize: v.number(),
            overlap: v.number(),
        })),
        stats: v.optional(v.object({
            factsProduced: v.number(),
            userFacts: v.number(),
            hypotheses: v.number(),
            exactDuplicates: v.number(),
            semanticCandidates: v.number(),
            contradictions: v.number(),
        })),
        error: v.optional(v.object({ message: v.string(), raw: v.optional(v.string()) })),
    },
    handler: async (ctx, args) => {
        const { runId, ...patch } = args;
        await ctx.db.patch(runId, { ...patch, finishedAt: args.finishedAt });
    },
});

export const incrementRunStats = internalMutation({
    args: {
        runId: v.id("factExtractionRuns"),
        exactDuplicates: v.optional(v.number()),
        semanticCandidates: v.optional(v.number()),
        contradictions: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run) return;
        const stats = run.stats ?? {
            factsProduced: 0,
            userFacts: 0,
            hypotheses: 0,
            exactDuplicates: 0,
            semanticCandidates: 0,
            contradictions: 0,
        };
        await ctx.db.patch(args.runId, {
            stats: {
                ...stats,
                exactDuplicates: stats.exactDuplicates + (args.exactDuplicates ?? 0),
                semanticCandidates: stats.semanticCandidates + (args.semanticCandidates ?? 0),
                contradictions: stats.contradictions + (args.contradictions ?? 0),
            },
        });
    },
});

export const getFactById = internalQuery({
    args: { factId: v.id("factAtoms") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.factId);
    },
});

export const getFactsByIds = internalQuery({
    args: { factIds: v.array(v.id("factAtoms")) },
    handler: async (ctx, args) => {
        const results: Doc<"factAtoms">[] = [];
        for (const id of args.factIds) {
            const fact = await ctx.db.get(id);
            if (fact) results.push(fact);
        }
        return results;
    },
});

export const getEmbeddingsByIds = internalQuery({
    args: { embeddingIds: v.array(v.id("factEmbeddings")) },
    handler: async (ctx, args) => {
        const results: Doc<"factEmbeddings">[] = [];
        for (const id of args.embeddingIds) {
            const embedding = await ctx.db.get(id);
            if (embedding) results.push(embedding);
        }
        return results;
    },
});

export const listFactsByScopeKey = internalQuery({
    args: {
        projectId: v.id("projects"),
        scopeType: v.union(v.literal("project"), v.literal("item")),
        itemId: v.optional(v.id("projectItems")),
        key: v.string(),
    },
    handler: async (ctx, args) => {
        const accepted = await ctx.db
            .query("factAtoms")
            .withIndex("by_project_scope_status", (q) =>
                q.eq("projectId", args.projectId)
                    .eq("scopeType", args.scopeType)
                    .eq("itemId", args.scopeType === "item" ? args.itemId ?? null : null)
                    .eq("status", "accepted")
            )
            .filter((q) => q.eq(q.field("key"), args.key))
            .collect();
        const proposed = await ctx.db
            .query("factAtoms")
            .withIndex("by_project_scope_status", (q) =>
                q.eq("projectId", args.projectId)
                    .eq("scopeType", args.scopeType)
                    .eq("itemId", args.scopeType === "item" ? args.itemId ?? null : null)
                    .eq("status", "proposed")
            )
            .filter((q) => q.eq(q.field("key"), args.key))
            .collect();
        return [...accepted, ...proposed];
    },
});

export const createFactIssue = internalMutation({
    args: {
        projectId: v.id("projects"),
        type: v.union(
            v.literal("contradiction"),
            v.literal("semantic_duplicate_suggestion"),
            v.literal("missing_item_link")
        ),
        severity: v.union(v.literal("info"), v.literal("warning"), v.literal("high")),
        factId: v.id("factAtoms"),
        relatedFactIds: v.optional(v.array(v.id("factAtoms"))),
        proposedAction: v.optional(v.string()),
        explanationHe: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("factIssues", {
            projectId: args.projectId,
            type: args.type,
            severity: args.severity,
            status: "open",
            factId: args.factId,
            relatedFactIds: args.relatedFactIds,
            proposedAction: args.proposedAction,
            explanationHe: args.explanationHe,
            createdAt: Date.now(),
        });
    },
});

export const createOrUpdateGroup = internalMutation({
    args: {
        projectId: v.id("projects"),
        scopeType: v.union(v.literal("project"), v.literal("item")),
        itemId: v.optional(v.id("projectItems")),
        key: v.optional(v.string()),
        canonicalFactId: v.id("factAtoms"),
        memberFactIds: v.array(v.id("factAtoms")),
    },
    handler: async (ctx, args) => {
        const groups = await ctx.db
            .query("factGroups")
            .withIndex("by_project_scope", (q) =>
                q.eq("projectId", args.projectId)
                    .eq("scopeType", args.scopeType)
                    .eq("itemId", args.itemId ?? null)
            )
            .collect();
        const existing = groups.find((group) => (group.key ?? null) === (args.key ?? null));

        if (existing) {
            const existingMembers = new Set(existing.memberFactIds ?? []);
            args.memberFactIds.forEach((id) => existingMembers.add(id));
            await ctx.db.patch(existing._id, {
                canonicalFactId: args.canonicalFactId,
                memberFactIds: Array.from(existingMembers),
                updatedAt: Date.now(),
            });
            for (const memberId of existingMembers) {
                await ctx.db.patch(memberId, { groupId: existing._id, updatedAt: Date.now() });
            }
            return existing._id;
        }

        const groupId = await ctx.db.insert("factGroups", {
            projectId: args.projectId,
            scopeType: args.scopeType,
            itemId: args.itemId ?? null,
            key: args.key,
            canonicalFactId: args.canonicalFactId,
            memberFactIds: args.memberFactIds,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        for (const memberId of args.memberFactIds) {
            await ctx.db.patch(memberId, { groupId, updatedAt: Date.now() });
        }
        return groupId;
    },
});

export const processExtractedFacts = internalMutation({
    args: {
        runId: v.id("factExtractionRuns"),
        turnBundleId: v.id("turnBundles"),
        facts: v.array(v.any()),
    },
    handler: async (ctx, args) => {
        const run = await ctx.db.get(args.runId);
        if (!run) throw new Error("Run not found");
        const bundle = await ctx.db.get(args.turnBundleId);
        if (!bundle) throw new Error("Bundle not found");

        let factsProduced = 0;
        let userFacts = 0;
        let hypotheses = 0;
        let exactDuplicates = 0;
        const insertedFactIds: Id<"factAtoms">[] = [];
        const itemRefs = await ctx.db
            .query("projectItems")
            .withIndex("by_project_status", (q) => q.eq("projectId", bundle.projectId))
            .collect();
        const itemList: ItemRef[] = itemRefs.map((item) => ({
            id: item._id,
            name: item.name ?? item.title ?? "Untitled item",
        }));

        for (const fact of args.facts as ExtractedFact[]) {
            const evidenceList = Array.isArray(fact.evidence) ? fact.evidence : [];
            const sourceTier = fact.sourceTier === "hypothesis" ? "hypothesis" : "user_evidence";
            const chunkText = bundle.bundleText.slice(fact._chunkStart, fact._chunkEnd);

            const verifiedEvidence = evidenceList
                .map((entry) => {
                    const verification = verifyEvidenceV2({
                        bundleText: bundle.bundleText,
                        chunkText,
                        chunkStart: fact._chunkStart,
                        evidence: entry,
                    });
                    if (!verification.valid || !verification.correctedOffsets) {
                        return null;
                    }
                    return {
                        turnBundleId: args.turnBundleId,
                        quoteHe: entry.quoteHe,
                        startChar: verification.correctedOffsets.start,
                        endChar: verification.correctedOffsets.end,
                        sourceSection: entry.sourceSection ?? "unknown",
                        sourceKind: entry.sourceKind ?? "user",
                    };
                })
                .filter(Boolean) as Array<{
                    turnBundleId: Id<"turnBundles">;
                    quoteHe: string;
                    startChar: number;
                    endChar: number;
                    sourceSection: string;
                    sourceKind: "user" | "doc" | "agentOutput";
                }>;

            const effectiveSourceTier =
                sourceTier === "user_evidence" && verifiedEvidence.length === 0 ? "hypothesis" : sourceTier;

            const hasEvidence = verifiedEvidence.length > 0;
            const status =
                effectiveSourceTier === "hypothesis"
                    ? "hypothesis"
                    : fact.confidence >= AUTO_ACCEPT_THRESHOLD && hasEvidence
                        ? "accepted"
                        : "proposed";

            let scopeType = fact.scopeType ?? "project";
            let itemId = (fact.itemId as Id<"projectItems"> | null | undefined) ?? null;
            let missingItemIssue: { candidates: Array<{ id: Id<"projectItems">; name: string; score: number }> } | null = null;

            if (!itemId) {
                const resolution = resolveItemReference(fact.factTextHe, itemList);
                if (resolution.best && resolution.best.confidence >= 0.8) {
                    scopeType = "item";
                    itemId = resolution.best.itemId;
                } else if (resolution.candidates.length > 0) {
                    missingItemIssue = { candidates: resolution.candidates };
                }
            }

            const exactHash = await sha256([
                bundle.projectId,
                scopeType,
                itemId ?? "null",
                fact.key ?? "",
                fact.factTextHe.trim().toLowerCase(),
            ].join("|"));

            const existing = await ctx.db
                .query("factAtoms")
                .withIndex("by_exactHash", (q) =>
                    q.eq("projectId", bundle.projectId).eq("dedupe.exactHash", exactHash)
                )
                .filter((q) => q.neq(q.field("status"), "duplicate"))
                .first();

            if (existing) {
                exactDuplicates += 1;
                const mergedEvidence = [...(existing.evidence ?? [])];
                const existingKeys = new Set(
                    mergedEvidence.map((entry) => `${entry.turnBundleId}:${entry.startChar}:${entry.endChar}`)
                );
                for (const entry of verifiedEvidence) {
                    const key = `${entry.turnBundleId}:${entry.startChar}:${entry.endChar}`;
                    if (!existingKeys.has(key)) {
                        mergedEvidence.push(entry);
                        existingKeys.add(key);
                    }
                }
                await ctx.db.patch(existing._id, {
                    evidence: mergedEvidence,
                    updatedAt: Date.now(),
                });
            }

            const newFactId = await ctx.db.insert("factAtoms", {
                projectId: bundle.projectId,
                scopeType,
                itemId,
                factTextHe: fact.factTextHe,
                category: fact.category,
                importance: Math.min(5, Math.max(1, fact.importance || 1)),
                sourceTier: effectiveSourceTier,
                status: existing ? "duplicate" : status,
                confidence: Math.min(1, Math.max(0, fact.confidence)),
                key: fact.key,
                valueType: fact.valueType,
                value: fact.value,
                evidence: verifiedEvidence,
                createdFrom: {
                    turnBundleId: args.turnBundleId,
                    runId: args.runId,
                    chunkId: fact._chunkId,
                    sourceKind: verifiedEvidence.some((entry) => entry.sourceKind === "agentOutput") ? "agent" : "user",
                },
                dedupe: {
                    exactHash,
                    duplicateOfFactId: existing?._id,
                },
                groupId: undefined,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });

            factsProduced += 1;
            if (sourceTier === "user_evidence") {
                userFacts += 1;
            } else {
                hypotheses += 1;
            }

            if (!existing) {
                insertedFactIds.push(newFactId);
            }

            if (missingItemIssue && !existing) {
                const explanation = `Candidates: ${missingItemIssue.candidates
                    .map((candidate) => `${candidate.name} (${candidate.score.toFixed(2)})`)
                    .join(", ")}`;
                await ctx.db.insert("factIssues", {
                    projectId: bundle.projectId,
                    type: "missing_item_link",
                    severity: "info",
                    status: "open",
                    factId: newFactId,
                    relatedFactIds: [],
                    proposedAction: "askUserToPickItem",
                    explanationHe: explanation,
                    createdAt: Date.now(),
                });
            }
        }

        return { factsProduced, userFacts, hypotheses, exactDuplicates, insertedFactIds };
    },
});

export const extractTurnBundle = internalAction({
    args: { turnBundleId: v.id("turnBundles") },
    handler: async (ctx, args) => {
        const bundle = await ctx.runQuery(internal.factsV2.getBundle, {
            turnBundleId: args.turnBundleId,
        });
        if (!bundle) throw new Error("Bundle not found");

        const project = await ctx.runQuery(api.projects.getProject, {
            projectId: bundle.projectId,
        });
        if (project?.features?.factsEnabled === false) {
            return { skipped: true };
        }
        if (!project?.features?.factsV2) {
            return { skipped: true };
        }

        const existingRun = await ctx.runQuery(internal.factsV2.getLatestRunByBundle, {
            turnBundleId: args.turnBundleId,
        });
        if (existingRun?.status === "succeeded") {
            return { skipped: true };
        }

        const runId = await ctx.runMutation(internal.factsV2.createExtractionRun, {
            turnBundleId: args.turnBundleId,
            model: "gpt-5-mini",
        });

        try {
            const itemRefs = await ctx.runQuery(internal.items.getItemRefs, {
                projectId: bundle.projectId,
            });

            const acceptedFacts = await ctx.runQuery(internal.factsV2.listAcceptedFacts, {
                projectId: bundle.projectId,
            });

            const chunkSpecs = buildRawChunks(bundle.bundleText, CHUNK_SIZE, CHUNK_OVERLAP);
            const chunkList = chunkSpecs.length > 0 ? chunkSpecs : [{
                text: bundle.bundleText,
                start: 0,
                end: bundle.bundleText.length,
            }];

            await ctx.runMutation(internal.factsV2.updateExtractionRun, {
                runId,
                status: "running",
                chunking: {
                    chunks: chunkList.length,
                    strategy: "char",
                    chunkSize: CHUNK_SIZE,
                    overlap: CHUNK_OVERLAP,
                },
            });

            const extractedFacts: ExtractedFact[] = [];

            for (let index = 0; index < chunkList.length; index += 1) {
                const chunk = chunkList[index];
                const userPrompt = buildUserPrompt({
                    bundleText: chunk.text,
                    items: itemRefs,
                    acceptedFacts,
                });

                const result = await callChatWithSchema(FactAtomsResponseSchema, {
                    systemPrompt: SYSTEM_PROMPT,
                    userPrompt,
                    model: "gpt-5-mini",
                });

                const chunkId = `${index + 1}/${chunkList.length}`;
                for (const rawFact of result.facts) {
                    const fact = normalizeExtractedFact(rawFact);
                    extractedFacts.push({
                        ...fact,
                        _chunkId: chunkId,
                        _chunkStart: chunk.start,
                        _chunkEnd: chunk.end,
                    });
                }
            }

            const stats = await ctx.runMutation(internal.factsV2.processExtractedFacts, {
                runId,
                turnBundleId: args.turnBundleId,
                facts: extractedFacts,
            });

            await ctx.runMutation(internal.factsV2.updateExtractionRun, {
                runId,
                status: "succeeded",
                finishedAt: Date.now(),
                stats: {
                    factsProduced: stats.factsProduced,
                    userFacts: stats.userFacts,
                    hypotheses: stats.hypotheses,
                    exactDuplicates: stats.exactDuplicates,
                    semanticCandidates: 0,
                    contradictions: 0,
                },
            });

            for (const factId of stats.insertedFactIds) {
                await ctx.scheduler.runAfter(0, internal.factsV2.postProcessFact, {
                    factId,
                    runId,
                });
            }

            return { ok: true, runId };
        } catch (error: unknown) {
            await ctx.runMutation(internal.factsV2.updateExtractionRun, {
                runId,
                status: "failed",
                finishedAt: Date.now(),
                error: { message: error?.message ?? "Unknown error" },
            });
            throw error;
        }
    },
});

export const listAcceptedFacts = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const acceptedFacts = await ctx.db
            .query("factAtoms")
            .withIndex("by_project_scope_status", (q) =>
                q.eq("projectId", args.projectId)
                    .eq("scopeType", "project")
                    .eq("itemId", null)
                    .eq("status", "accepted")
            )
            .collect();
        const proposedFacts = await ctx.db
            .query("factAtoms")
            .withIndex("by_project_scope_status", (q) =>
                q.eq("projectId", args.projectId)
                    .eq("scopeType", "project")
                    .eq("itemId", null)
                    .eq("status", "proposed")
            )
            .filter((q) => q.gte(q.field("confidence"), PROPOSED_CONTEXT_THRESHOLD))
            .collect();

        const facts = [...acceptedFacts, ...proposedFacts];
        return facts.map((fact) => ({
            factTextHe: fact.factTextHe,
            scopeType: fact.scopeType,
            itemId: fact.itemId ?? null,
        }));
    },
});

const SimilarityJudgeSchema = z.object({
    relation: z.enum(["entails", "compatible", "contradicts", "unrelated"]),
    confidence: z.number(),
});

export const getFactsContext = internalAction({
    args: {
        projectId: v.id("projects"),
        scopeType: v.union(v.literal("project"), v.literal("item"), v.literal("multiItem")),
        itemIds: v.optional(v.array(v.id("projectItems"))),
        queryText: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = Math.max(5, Math.min(args.limit ?? 30, 80));
        const scopeItemIds = args.itemIds ?? [];
        const includeProjectFacts = true;

        const isEligible = (fact: Doc<"factAtoms">) => {
            if (fact.status === "duplicate" || fact.status === "rejected" || fact.status === "hypothesis") {
                return false;
            }
            if (fact.status === "proposed" && fact.confidence < PROPOSED_CONTEXT_THRESHOLD) {
                return false;
            }
            if (args.scopeType === "project") {
                return fact.scopeType === "project";
            }
            if (args.scopeType === "item") {
                if (fact.scopeType === "project") return includeProjectFacts;
                return scopeItemIds.length === 0 ? false : scopeItemIds.includes(fact.itemId as Id<"projectItems">);
            }
            if (args.scopeType === "multiItem") {
                if (fact.scopeType === "project") return includeProjectFacts;
                return scopeItemIds.includes(fact.itemId as Id<"projectItems">);
            }
            return false;
        };

        const facts: Doc<"factAtoms">[] = [];
        if (args.queryText) {
            const embedding = await embedText(args.queryText);
            const neighbors = await ctx.vectorSearch("factEmbeddings", "by_embedding", {
                vector: embedding,
                limit: limit * 3,
                filter: (q) => q.eq("projectId", args.projectId),
            });
            const embeddingDocs = await ctx.runQuery(internal.factsV2.getEmbeddingsByIds, {
                embeddingIds: neighbors.map((n) => n._id),
            });
            const factIds = embeddingDocs.map((doc) => doc.factId);
            const candidateFacts = await ctx.runQuery(internal.factsV2.getFactsByIds, { factIds });
            const scoredFacts = candidateFacts
                .map((fact) => ({
                    fact,
                    score: neighbors.find((n) => embeddingDocs.find((doc) => doc.factId === fact._id)?._id === n._id)?._score ?? 0,
                }))
                .filter((entry) => isEligible(entry.fact))
                .sort((a, b) => b.score - a.score || b.fact.importance - a.fact.importance || b.fact.createdAt - a.fact.createdAt)
                .slice(0, limit);
            facts.push(...scoredFacts.map((entry) => entry.fact));
        } else {
            const accepted = await ctx.db
                .query("factAtoms")
                .withIndex("by_project_scope_status", (q) =>
                    q.eq("projectId", args.projectId)
                        .eq("scopeType", "project")
                        .eq("itemId", null)
                        .eq("status", "accepted")
                )
                .collect();
            const proposed = await ctx.db
                .query("factAtoms")
                .withIndex("by_project_scope_status", (q) =>
                    q.eq("projectId", args.projectId)
                        .eq("scopeType", "project")
                        .eq("itemId", null)
                        .eq("status", "proposed")
                )
                .filter((q) => q.gte(q.field("confidence"), PROPOSED_CONTEXT_THRESHOLD))
                .collect();
            const combined = [...accepted, ...proposed].filter((fact) => isEligible(fact));
            combined.sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt);
            facts.push(...combined.slice(0, limit));
        }

        const bullets = facts.map((fact) => `- ${fact.factTextHe}`).join("\n");
        return {
            bullets: bullets || "(none)",
            facts: facts.map((fact) => ({
                _id: fact._id,
                factTextHe: fact.factTextHe,
                status: fact.status,
                confidence: fact.confidence,
                importance: fact.importance,
                scopeType: fact.scopeType,
                itemId: fact.itemId ?? null,
            })),
        };
    },
});

export const postProcessFact = internalAction({
    args: { factId: v.id("factAtoms"), runId: v.id("factExtractionRuns") },
    handler: async (ctx, args) => {
        const fact = await ctx.runQuery(internal.factsV2.getFactById, { factId: args.factId });
        if (!fact || fact.status === "duplicate" || fact.status === "rejected") return;

        const embedding = await embedText(fact.factTextHe);
        await ctx.runMutation(internal.factsV2.insertEmbedding, {
            projectId: fact.projectId,
            factId: fact._id,
            vector: embedding,
            model: "text-embedding-3-large",
        });

        const neighbors = await ctx.vectorSearch("factEmbeddings", "by_embedding", {
            vector: embedding,
            limit: 8,
            filter: (q) => q.eq("projectId", fact.projectId),
        });

        const embeddingIds = neighbors.map((n) => n._id);
        const embeddingDocs = await ctx.runQuery(internal.factsV2.getEmbeddingsByIds, {
            embeddingIds,
        });
        const neighborIds = embeddingDocs.map((doc) => doc.factId).filter((id) => id !== fact._id);
        if (neighborIds.length === 0) return;

        const neighborFacts = await ctx.runQuery(internal.factsV2.getFactsByIds, {
            factIds: neighborIds,
        });

        let semanticCandidates = 0;
        let contradictions = 0;

        if (fact.key && fact.value !== undefined) {
            const sameKeyFacts = await ctx.runQuery(internal.factsV2.listFactsByScopeKey, {
                projectId: fact.projectId,
                scopeType: fact.scopeType,
                itemId: fact.itemId ?? undefined,
                key: fact.key,
            });
            for (const existing of sameKeyFacts) {
                if (existing._id === fact._id) continue;
                const valueA = normalizeValue(fact.value);
                const valueB = normalizeValue(existing.value);
                if (valueA && valueB && valueA !== valueB) {
                    await ctx.runMutation(internal.factsV2.createFactIssue, {
                        projectId: fact.projectId,
                        type: "contradiction",
                        severity: "warning",
                        factId: fact._id,
                        relatedFactIds: [existing._id],
                        proposedAction: "keepBoth",
                        explanationHe: "Conflicting values for the same key.",
                    });
                    contradictions += 1;
                }
            }
        }

        for (const neighbor of neighborFacts) {
            if (neighbor.status === "duplicate") continue;
            if (neighbor.scopeType !== fact.scopeType) continue;
            if ((neighbor.itemId ?? null) !== (fact.itemId ?? null)) continue;
            if ((neighbor.key ?? null) !== (fact.key ?? null)) continue;

            const embeddingEntry = embeddingDocs.find((doc) => doc.factId === neighbor._id);
            const score = neighbors.find((n) => n._id === embeddingEntry?._id)?._score ?? 0;
            if (score >= 0.9) {
                const canonical = neighbor.createdAt <= fact.createdAt ? neighbor : fact;
                await ctx.runMutation(internal.factsV2.createOrUpdateGroup, {
                    projectId: fact.projectId,
                    scopeType: fact.scopeType,
                    itemId: fact.itemId ?? undefined,
                    key: fact.key,
                    canonicalFactId: canonical._id,
                    memberFactIds: [fact._id, neighbor._id],
                });
                semanticCandidates += 1;
            } else if (score >= 0.82) {
                await ctx.runMutation(internal.factsV2.createFactIssue, {
                    projectId: fact.projectId,
                    type: "semantic_duplicate_suggestion",
                    severity: "info",
                    factId: fact._id,
                    relatedFactIds: [neighbor._id],
                    proposedAction: "createGroup",
                    explanationHe: "Possible near-duplicate fact.",
                });
                semanticCandidates += 1;
            }

            if (score >= 0.82) {
                const judgePrompt = [
                    "Compare two Hebrew facts and classify their relation:",
                    "Return one of: entails, compatible, contradicts, unrelated.",
                    "",
                    `Fact A: ${fact.factTextHe}`,
                    `Fact B: ${neighbor.factTextHe}`,
                ].join("\n");

                const judge = await callChatWithSchema(SimilarityJudgeSchema, {
                    systemPrompt: "You are a strict semantic judge.",
                    userPrompt: judgePrompt,
                    model: "gpt-5-mini",
                });

                if (judge.relation === "contradicts" && judge.confidence >= 0.7) {
                    await ctx.runMutation(internal.factsV2.createFactIssue, {
                        projectId: fact.projectId,
                        type: "contradiction",
                        severity: "warning",
                        factId: fact._id,
                        relatedFactIds: [neighbor._id],
                        proposedAction: "keepBoth",
                        explanationHe: "Possible semantic contradiction.",
                    });
                    contradictions += 1;
                }
            }
        }

        if (semanticCandidates || contradictions) {
            await ctx.runMutation(internal.factsV2.incrementRunStats, {
                runId: args.runId,
                semanticCandidates,
                contradictions,
            });
        }
    },
});

export const insertEmbedding = internalMutation({
    args: {
        projectId: v.id("projects"),
        factId: v.id("factAtoms"),
        vector: v.array(v.float64()),
        model: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("factEmbeddings", {
            projectId: args.projectId,
            factId: args.factId,
            vector: args.vector,
            model: args.model,
            createdAt: Date.now(),
        });
    },
});

export const listFacts = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        if (!(await isFactsEnabled(ctx, args.projectId))) return [];
        const facts = await ctx.db
            .query("factAtoms")
            .filter((q) => q.eq(q.field("projectId"), args.projectId))
            .collect();
        return facts.sort((a, b) => b.createdAt - a.createdAt);
    },
});

export const listIssues = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        if (!(await isFactsEnabled(ctx, args.projectId))) return [];
        const issues = await ctx.db
            .query("factIssues")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "open"))
            .collect();
        issues.sort((a, b) => b.createdAt - a.createdAt);
        return issues;
    },
});

export const listExtractionRuns = query({
    args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        if (!(await isFactsEnabled(ctx, args.projectId))) return [];
        const limit = Math.max(1, Math.min(args.limit ?? 10, 50));
        return await ctx.db
            .query("factExtractionRuns")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .take(limit);
    },
});

export const acceptFact = mutation({
    args: { factId: v.id("factAtoms") },
    handler: async (ctx, args) => {
        const fact = await ctx.db.get(args.factId);
        if (!fact) throw new Error("Fact not found");
        if (!(await isFactsEnabled(ctx, fact.projectId))) return { ok: true, skipped: true };
        await ctx.db.patch(args.factId, { status: "accepted", updatedAt: Date.now() });
        return { ok: true };
    },
});

export const rejectFact = mutation({
    args: { factId: v.id("factAtoms") },
    handler: async (ctx, args) => {
        const fact = await ctx.db.get(args.factId);
        if (!fact) throw new Error("Fact not found");
        if (!(await isFactsEnabled(ctx, fact.projectId))) return { ok: true, skipped: true };
        await ctx.db.patch(args.factId, { status: "rejected", updatedAt: Date.now() });
        return { ok: true };
    },
});

export const updateFactTextInternal = internalMutation({
    args: { factId: v.id("factAtoms"), factTextHe: v.string() },
    handler: async (ctx, args) => {
        const fact = await ctx.db.get(args.factId);
        if (!fact) throw new Error("Fact not found");
        if (!(await isFactsEnabled(ctx, fact.projectId))) return { projectId: fact.projectId, factTextHe: fact.factTextHe };
        const factTextHe = args.factTextHe.trim();
        if (!factTextHe) throw new Error("Fact text is required");

        const exactHash = await sha256([
            fact.projectId,
            fact.scopeType,
            fact.itemId ?? "null",
            fact.key ?? "",
            factTextHe.toLowerCase(),
        ].join("|"));

        await ctx.db.patch(args.factId, {
            factTextHe,
            dedupe: { ...fact.dedupe, exactHash },
            updatedAt: Date.now(),
        });

        const embeddings = await ctx.db
            .query("factEmbeddings")
            .withIndex("by_project_fact", (q) => q.eq("projectId", fact.projectId).eq("factId", fact._id))
            .collect();
        for (const embedding of embeddings) {
            await ctx.db.delete(embedding._id);
        }

        return { projectId: fact.projectId, factTextHe };
    },
});

export const updateFactText = action({
    args: { factId: v.id("factAtoms"), factTextHe: v.string() },
    handler: async (ctx, args) => {
        const fact = await ctx.runQuery(internal.factsV2.getFactById, { factId: args.factId });
        if (!fact) throw new Error("Fact not found");
        if (!(await isFactsEnabled(ctx, fact.projectId))) return { ok: true, skipped: true };
        const { projectId, factTextHe } = await ctx.runMutation(internal.factsV2.updateFactTextInternal, {
            factId: args.factId,
            factTextHe: args.factTextHe,
        });
        const embedding = await embedText(factTextHe);
        await ctx.runMutation(internal.factsV2.insertEmbedding, {
            projectId,
            factId: args.factId,
            vector: embedding,
            model: "text-embedding-3-large",
        });
        return { ok: true };
    },
});

export const deleteFact = mutation({
    args: { factId: v.id("factAtoms") },
    handler: async (ctx, args) => {
        const fact = await ctx.db.get(args.factId);
        if (!fact) throw new Error("Fact not found");
        if (!(await isFactsEnabled(ctx, fact.projectId))) return { ok: true, skipped: true };

        const embeddings = await ctx.db
            .query("factEmbeddings")
            .withIndex("by_project_fact", (q) => q.eq("projectId", fact.projectId).eq("factId", fact._id))
            .collect();
        for (const embedding of embeddings) {
            await ctx.db.delete(embedding._id);
        }

        const issues = await ctx.db
            .query("factIssues")
            .withIndex("by_fact", (q) => q.eq("factId", fact._id))
            .collect();
        for (const issue of issues) {
            await ctx.db.delete(issue._id);
        }

        if (fact.groupId) {
            const group = await ctx.db.get(fact.groupId);
            if (group) {
                const memberFactIds = (group.memberFactIds ?? []).filter((id) => id !== fact._id);
                if (memberFactIds.length === 0) {
                    await ctx.db.delete(group._id);
                } else {
                    const canonicalFactId =
                        group.canonicalFactId === fact._id ? memberFactIds[0] : group.canonicalFactId;
                    await ctx.db.patch(group._id, {
                        canonicalFactId,
                        memberFactIds,
                        updatedAt: Date.now(),
                    });
                }
            }
        }

        await ctx.db.delete(args.factId);
        return { ok: true };
    },
});

export const resolveIssue = mutation({
    args: { issueId: v.id("factIssues"), resolution: v.union(v.literal("resolved"), v.literal("dismissed")) },
    handler: async (ctx, args) => {
        const issue = await ctx.db.get(args.issueId);
        if (!issue) throw new Error("Issue not found");
        if (!(await isFactsEnabled(ctx, issue.projectId))) return { ok: true, skipped: true };
        await ctx.db.patch(args.issueId, {
            status: args.resolution,
            resolvedAt: Date.now(),
            resolvedByUserId: "user",
        });
        return { ok: true };
    },
});

export const assignItem = mutation({
    args: { factId: v.id("factAtoms"), itemId: v.id("projectItems") },
    handler: async (ctx, args) => {
        const fact = await ctx.db.get(args.factId);
        if (!fact) throw new Error("Fact not found");
        if (!(await isFactsEnabled(ctx, fact.projectId))) return { ok: true, skipped: true };
        await ctx.db.patch(args.factId, {
            scopeType: "item",
            itemId: args.itemId,
            updatedAt: Date.now(),
        });
        return { ok: true };
    },
});

export const backfillLegacyFactsInternal = internalMutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const legacyFacts = await ctx.db
            .query("facts")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
            .collect();
        if (legacyFacts.length === 0) return { inserted: 0 };

        const bundles = await ctx.db
            .query("turnBundles")
            .withIndex("by_project_createdAt", (q) => q.eq("projectId", args.projectId))
            .collect();
        const fallbackBundleId = bundles[0]?._id;

        const runByBundle = new Map<string, Id<"factExtractionRuns">>();

        const ensureRun = async (turnBundleId: Id<"turnBundles">) => {
            const key = String(turnBundleId);
            if (runByBundle.has(key)) return runByBundle.get(key)!;
            const runId = await ctx.db.insert("factExtractionRuns", {
                projectId: args.projectId,
                turnBundleId,
                status: "succeeded",
                model: "legacy-backfill",
                startedAt: Date.now(),
                finishedAt: Date.now(),
                createdAt: Date.now(),
                stats: {
                    factsProduced: 0,
                    userFacts: 0,
                    hypotheses: 0,
                    exactDuplicates: 0,
                    semanticCandidates: 0,
                    contradictions: 0,
                },
            });
            runByBundle.set(key, runId);
            return runId;
        };

        let inserted = 0;

        for (const fact of legacyFacts) {
            const turnBundleId = fact.evidence?.turnBundleId ?? fallbackBundleId;
            if (!turnBundleId) continue;

            const runId = await ensureRun(turnBundleId);
            const valueText = formatLegacyFactValue(fact.value);
            const factTextHe = valueText ? `${fact.key}: ${valueText}` : fact.key;
            const category = inferCategoryFromKey(fact.key);
            const sourceTier = fact.evidence ? "user_evidence" : "hypothesis";
            const status =
                sourceTier === "hypothesis"
                    ? "hypothesis"
                    : fact.status === "accepted"
                        ? "accepted"
                        : fact.status === "rejected"
                            ? "rejected"
                            : "proposed";

            const exactHash = await sha256([
                args.projectId,
                fact.scopeType,
                fact.itemId ?? "null",
                fact.key,
                factTextHe.trim().toLowerCase(),
            ].join("|"));

            const newFactId = await ctx.db.insert("factAtoms", {
                projectId: args.projectId,
                scopeType: fact.scopeType,
                itemId: fact.itemId ?? null,
                factTextHe,
                category,
                importance: 3,
                sourceTier,
                status,
                confidence: fact.confidence ?? 0.5,
                key: fact.key,
                valueType: fact.valueType,
                value: fact.value,
                evidence: fact.evidence
                    ? [
                        {
                            turnBundleId,
                            quoteHe: fact.evidence.quote,
                            startChar: fact.evidence.startChar,
                            endChar: fact.evidence.endChar,
                            sourceSection: fact.evidence.sourceSection,
                            sourceKind: fact.sourceKind === "agent" ? "agentOutput" : "user",
                        },
                    ]
                    : [],
                createdFrom: {
                    turnBundleId,
                    runId,
                    sourceKind: fact.sourceKind === "agent" ? "agent" : "user",
                },
                dedupe: { exactHash },
                groupId: undefined,
                createdAt: fact.createdAt ?? Date.now(),
                updatedAt: Date.now(),
            });

            await ctx.runMutation(internal.factsPipeline.upsertFactFromAtom, {
                factAtomId: newFactId,
            });

            if (fact.status === "conflict") {
                await ctx.db.insert("factIssues", {
                    projectId: args.projectId,
                    type: "contradiction",
                    severity: "warning",
                    status: "open",
                    factId: newFactId,
                    relatedFactIds: [],
                    proposedAction: "keepBoth",
                    explanationHe: "Legacy conflict imported.",
                    createdAt: Date.now(),
                });
            }

            inserted += 1;
        }

        return { inserted };
    },
});

export const backfillLegacyFacts = mutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        return await ctx.runMutation(internal.factsV2.backfillLegacyFactsInternal, {
            projectId: args.projectId,
        });
    },
});

export const enableFactsV2ForProject = mutation({
    args: { projectId: v.id("projects"), backfill: v.optional(v.boolean()) },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");
        const features = project.features ?? {};
        await ctx.db.patch(args.projectId, {
            features: {
                ...features,
                factsV2: true,
            },
        });

        if (args.backfill ?? true) {
            await ctx.runMutation(internal.factsV2.backfillLegacyFactsInternal, {
                projectId: args.projectId,
            });
        }

        return { ok: true };
    },
});
