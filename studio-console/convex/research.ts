import { v } from "convex/values";
import {
    action,
    query,
    internalAction,
    internalMutation,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { performResearch } from "./lib/gemini";

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_RUNS_PER_USER_PER_DAY = 20;

function nowMs() {
    return Date.now();
}

function getCreatedBy(): string {
    // No auth wired in this repo today; keep a stable value.
    return "system";
}

export const createRun = internalMutation({
    args: {
        materialLineId: v.optional(v.id("materialLines")),
        projectId: v.optional(v.id("projects")),
        queryText: v.string(),
        currency: v.string(),
        unit: v.optional(v.string()),
        specs: v.optional(v.string()),
        location: v.optional(v.string()),
        language: v.optional(v.string()),
        createdBy: v.string(),
    },
    handler: async (ctx, args) => {
        const runId = await ctx.db.insert("researchRuns", {
            request: {
                queryText: args.queryText,
                canonicalItemId: undefined,
                qty: undefined,
                unit: args.unit,
                specs: args.specs,
                location: args.location,
                urgencyDate: undefined,
                currency: args.currency,
                language: args.language,
            },
            provider: "gemini_deep_research",
            status: "queued",
            interactionId: undefined,
            result: undefined,
            error: undefined,
            startedAt: nowMs(),
            finishedAt: undefined,
            cost: undefined,
            createdBy: args.createdBy,
            linked: {
                materialLineId: args.materialLineId,
                projectId: args.projectId,
            },
        });
        return runId;
    },
});

export const setRunStatus = internalMutation({
    args: {
        researchRunId: v.id("researchRuns"),
        status: v.union(
            v.literal("queued"),
            v.literal("running"),
            v.literal("completed"),
            v.literal("failed"),
            v.literal("cancelled")
        ),
        error: v.optional(v.string()),
        result: v.optional(
            v.object({
                reportMarkdown: v.string(),
                options: v.array(v.any()),
                citations: v.array(v.any()),
            })
        ),
        finishedAt: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.researchRunId, {
            status: args.status,
            error: args.error,
            result: args.result,
            finishedAt: args.finishedAt,
        });
    },
});

export const startOnlineResearch: ReturnType<typeof action> = action({
    args: {
        materialLineId: v.optional(v.id("materialLines")),
        projectId: v.optional(v.id("projects")),
        query: v.optional(v.string()),
        freeformQuery: v.optional(v.string()),
        currency: v.optional(v.string()),
        location: v.optional(v.string()),
        language: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const createdBy = getCreatedBy();
        const currency = args.currency ?? "ILS";

        const queryText = args.freeformQuery?.trim()
            ? args.freeformQuery.trim()
            : args.query?.trim()
                ? args.query.trim()
                : args.materialLineId
                    ? (await ctx.runQuery(api.buying.getMaterialLineContext, { materialLineId: args.materialLineId }))
                        ?.label
                    : undefined;

        if (!queryText) throw new Error("Missing query");

        // Cache: reuse a completed run for this materialLine with same query/currency if still fresh.
        if (args.materialLineId) {
            const recentRuns = await ctx.runQuery(api.research.listRuns, {
                materialLineId: args.materialLineId,
                limit: 10,
            });
            const fresh = recentRuns.find((r) =>
                r.status === "completed" &&
                r.request.queryText === queryText &&
                r.request.currency === currency &&
                (r.finishedAt ?? 0) > nowMs() - DEFAULT_TTL_MS
            );
            if (fresh) return { researchRunId: fresh._id, cached: true };
        }

        // Rate limit (best-effort): last 24h per createdBy.
        const since = nowMs() - 1000 * 60 * 60 * 24;
        const recentUserRuns = await ctx.runQuery(api.research.countRecentRunsByUser, {
            createdBy,
            since,
        });
        if (recentUserRuns >= MAX_RUNS_PER_USER_PER_DAY) {
            throw new Error("Daily research limit reached");
        }

        let unit: string | undefined;
        let projectId: Id<"projects"> | undefined = args.projectId;
        if (args.materialLineId) {
            const materialLine = await ctx.runQuery(api.buying.getMaterialLineContext, { materialLineId: args.materialLineId });
            unit = materialLine?.unit;
            projectId = materialLine?.projectId ?? projectId;
        }

        const researchRunId = await ctx.runMutation(internal.research.createRun, {
            materialLineId: args.materialLineId,
            projectId,
            queryText,
            currency,
            unit,
            specs: undefined,
            location: args.location,
            language: args.language,
            createdBy,
        });

        await ctx.scheduler.runAfter(0, internal.research.runResearch, { researchRunId });
        return { researchRunId, cached: false };
    },
});

export const cancelOnlineResearch: ReturnType<typeof action> = action({
    args: { researchRunId: v.id("researchRuns") },
    handler: async (ctx, args) => {
        const run = await ctx.runQuery(api.research.getRun, { researchRunId: args.researchRunId });
        if (!run) throw new Error("Run not found");
        if (run.status === "completed" || run.status === "failed") return;

        await ctx.runMutation(internal.research.setRunStatus, {
            researchRunId: args.researchRunId,
            status: "cancelled",
            finishedAt: nowMs(),
        });
    },
});

export const runResearch = internalAction({
    args: { researchRunId: v.id("researchRuns") },
    handler: async (ctx, args) => {
        const run = await ctx.runQuery(api.research.getRun, { researchRunId: args.researchRunId });
        if (!run) return;
        if (run.status === "cancelled") return;

        await ctx.runMutation(internal.research.setRunStatus, {
            researchRunId: args.researchRunId,
            status: "running",
        });

        try {
            const research = await performResearch({
                queryText: run.request.queryText,
                currency: run.request.currency,
                unit: run.request.unit,
                location: run.request.location,
                maxOptions: 5,
            });

            let canonicalItemId: Id<"canonicalItems"> | undefined;
            if (run.linked.materialLineId) {
                const materialLine = await ctx.runQuery(api.buying.getMaterialLineContext, {
                    materialLineId: run.linked.materialLineId,
                });
                if (materialLine?.label) {
                    canonicalItemId = await ctx.runMutation(api.prices.normalizeItemName, {
                        raw: materialLine.label,
                    });
                }
            }

            const options = research.options.map((opt) => ({
                vendorName: opt.vendorName,
                vendorUrl: opt.vendorUrl,
                priceMin: opt.price?.min,
                priceMax: opt.price?.max,
                unit: opt.price?.unit ?? run.request.unit ?? "unit",
                leadTimeDays: opt.leadTimeDays,
                notes: opt.notes,
                confidence: opt.confidence,
            }));

            const citations = research.citations.map((c) => ({
                title: c.title,
                url: c.url,
                snippet: c.snippet,
            }));

            await ctx.runMutation(internal.research.setRunStatus, {
                researchRunId: args.researchRunId,
                status: "completed",
                finishedAt: nowMs(),
                result: {
                    reportMarkdown: research.reportMarkdown,
                    options: research.options,
                    citations: research.citations,
                },
            });

            if (run.linked.materialLineId && canonicalItemId) {
                await ctx.runMutation(internal.buying.saveSuggestions, {
                    materialLineId: run.linked.materialLineId,
                    canonicalItemId,
                    source: "research",
                    summary: research.summary,
                    options,
                    citations,
                });
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            await ctx.runMutation(internal.research.setRunStatus, {
                researchRunId: args.researchRunId,
                status: "failed",
                error: message,
                finishedAt: nowMs(),
            });
        }
    },
});

export const getRun = query({
    args: { researchRunId: v.id("researchRuns") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.researchRunId);
    },
});

export const listRuns = query({
    args: {
        materialLineId: v.optional(v.id("materialLines")),
        projectId: v.optional(v.id("projects")),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 20;

        if (args.materialLineId) {
            return await ctx.db
                .query("researchRuns")
                .withIndex("by_linked_materialLine_createdAt", (q) =>
                    q.eq("linked.materialLineId", args.materialLineId)
                )
                .order("desc")
                .take(limit);
        }

        if (args.projectId) {
            const recent = await ctx.db
                .query("researchRuns")
                .withIndex("by_status_startedAt", (q) => q.eq("status", "completed"))
                .order("desc")
                .take(100);
            return recent.filter((r) => r.linked.projectId === args.projectId).slice(0, limit);
        }

        return await ctx.db
            .query("researchRuns")
            .withIndex("by_status_startedAt", (q) => q.eq("status", "completed"))
            .order("desc")
            .take(limit);
    },
});

export const countRecentRunsByUser = query({
    args: { createdBy: v.string(), since: v.number() },
    handler: async (ctx, args) => {
        const runs = await ctx.db
            .query("researchRuns")
            .withIndex("by_createdBy_startedAt", (q) => q.eq("createdBy", args.createdBy))
            .order("desc")
            .take(200);
        return runs.filter((r) => r.startedAt >= args.since).length;
    },
});

