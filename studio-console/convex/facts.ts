import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { callChatWithSchema } from "./lib/openai";
import { SYSTEM_PROMPT, buildUserPrompt } from "./lib/facts/prompts";
import { z } from "zod";
import { HIGH_RISK_KEYS } from "./lib/facts/registry";
import { reconcileOps } from "./lib/facts/reconcile";
import { Doc, Id } from "./_generated/dataModel";
import { patchBlocks } from "./lib/knowledgeBlocks/patch";
import { applyFactsToItems } from "./lib/facts/apply";

const FactOpSchema = z.object({
  op: z.enum(["ADD", "UPDATE", "CONFLICT", "NOTE"]),
  scope: z.object({
    type: z.enum(["project", "item"]),
    itemId: z.string().optional(),
  }),
  key: z.string(),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.object({ value: z.number(), unit: z.string() }),
    z.object({ min: z.number(), max: z.number() }),
    z.object({ iso: z.string() }),
    z.null(),
  ]),
  valueType: z.string(),
  evidence: z.object({
    quote: z.string(),
    startChar: z.number(),
    endChar: z.number(),
    sourceSection: z.enum(["STRUCTURED_QUESTIONS", "USER_ANSWERS", "FREE_CHAT", "AGENT_OUTPUT"]),
  }),
  confidence: z.number(),
  needsReview: z.boolean(),
  reason: z.string(),
});

const FactOpsResponseSchema = z.object({
  ops: z.array(FactOpSchema),
});

async function isFactsEnabled(
  ctx: { db: { get: (id: Id<"projects">) => Promise<Doc<"projects"> | null> } },
  projectId: Id<"projects">
) {
  const project = await ctx.db.get(projectId);
  return project?.features?.factsEnabled !== false;
}

export const parseTurnBundle = internalAction({
  args: {
    turnBundleId: v.id("turnBundles"),
  },
  handler: async (ctx, args) => {
    console.log("parseTurnBundle started for bundle", args.turnBundleId);
    const bundle = await ctx.runQuery(internal.facts.getBundle, { turnBundleId: args.turnBundleId });
    if (!bundle) throw new Error("Bundle not found");
    if (!(await isFactsEnabled(ctx, bundle.projectId))) {
      return { skipped: true };
    }

    const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
      projectId: bundle.projectId,
      agent: "facts.parse",
      stage: "start",
      initialMessage: `Parse facts for bundle ${args.turnBundleId}`,
    });

    await ctx.runMutation(internal.agentRuns.setStatus, {
      runId: agentRunId,
      status: "running",
      stage: "parsing",
    });

    const runId = await ctx.runMutation(internal.facts.createParseRun, {
      turnBundleId: args.turnBundleId,
    });

    try {
      const snapshot = await ctx.runQuery(internal.facts.getSnapshot, { 
        projectId: bundle.projectId,
        stage: bundle.stage 
      });

      const userPrompt = buildUserPrompt({
        bundleText: bundle.bundleText,
        snapshot: {
          items: snapshot.items,
          acceptedFacts: snapshot.acceptedFacts,
          highRiskKeys: HIGH_RISK_KEYS,
        },
      });

      const result = await callChatWithSchema(FactOpsResponseSchema, {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        model: "gpt-4o-mini",
      });

      const normalizedOps = result.ops.map((op) => {
        if (op.value !== null) return op;
        return {
          ...op,
          op: "NOTE",
          value: "unknown",
          valueType: "string",
        };
      });

      await ctx.runMutation(internal.facts.processParseResults, {
        runId,
        ops: normalizedOps,
      });
      console.log("parseTurnBundle completed successfully with ops:", result.ops.length);

      await ctx.runMutation(internal.agentRuns.appendEvent, {
        runId: agentRunId,
        level: "info",
        stage: "parsing",
        message: `LLM extracted ${result.ops.length} ops`,
      });

      await ctx.runMutation(internal.agentRuns.setStatus, {
        runId: agentRunId,
        status: "succeeded",
        stage: "done",
      });
    } catch (error: any) {
      console.error("parseTurnBundle failed:", error);
      await ctx.runMutation(internal.facts.failParseRun, {
        runId,
        error: error.message,
      });

      await ctx.runMutation(internal.agentRuns.setStatus, {
        runId: agentRunId,
        status: "failed",
        stage: "error",
        error: error?.message ?? "Unknown error",
      });
    }
  },
});

export const createParseRun = internalMutation({
  args: { turnBundleId: v.id("turnBundles") },
  handler: async (ctx, args) => {
    const bundle = await ctx.db.get(args.turnBundleId);
    if (!bundle) throw new Error("Bundle not found");
    
    return await ctx.db.insert("factParseRuns", {
      projectId: bundle.projectId,
      turnBundleId: args.turnBundleId,
      status: "running",
      model: "gpt-4o-mini",
      startedAt: Date.now(),
    });
  },
});

export const getBundle = internalQuery({
  args: { turnBundleId: v.id("turnBundles") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.turnBundleId);
  },
});

export const getSnapshot = internalQuery({
  args: { projectId: v.id("projects"), stage: v.string() },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("projectItems")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
      .collect();
    
    const facts = await ctx.db
      .query("facts")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "accepted"))
      .collect();

    return {
      items: items.map(i => ({ id: i._id, name: i.name })),
      acceptedFacts: facts.map(f => ({ key: f.key, value: f.value })),
      highRiskKeys: HIGH_RISK_KEYS,
    };
  },
});

export const failParseRun = internalMutation({
  args: { runId: v.id("factParseRuns"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "failed",
      error: { message: args.error },
      finishedAt: Date.now(),
    });
  },
});

export const processParseResults = internalMutation({
  args: { 
    runId: v.id("factParseRuns"), 
    ops: v.any() // We trust the Zod validation from the action, but we should validate again or cast
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const stats = await reconcileOps(
      ctx,
      run.projectId,
      run.turnBundleId,
      args.runId,
      args.ops
    );

    await ctx.db.patch(args.runId, {
      status: "succeeded",
      finishedAt: Date.now(),
      stats,
    });

  },
});

export const acceptFact = mutation({
  args: { factId: v.id("facts") },
  handler: async (ctx, args) => {
    const fact = await ctx.db.get(args.factId);
    if (!fact) throw new Error("Fact not found");
    if (!(await isFactsEnabled(ctx, fact.projectId))) return { ok: true, skipped: true };
    
    let existingFact = null;
    if (fact.scopeType === "project") {
        existingFact = await ctx.db
            .query("facts")
            .withIndex("by_scope_key", (q) => 
                q.eq("projectId", fact.projectId)
                 .eq("scopeType", "project")
                 .eq("itemId", null)
                 .eq("key", fact.key)
            )
            .filter(q => q.eq(q.field("status"), "accepted"))
            .first();
    } else {
        if (fact.itemId) {
            existingFact = await ctx.db
                .query("facts")
                .withIndex("by_scope_key", (q) => 
                    q.eq("projectId", fact.projectId)
                     .eq("scopeType", "item")
                     .eq("itemId", fact.itemId)
                     .eq("key", fact.key)
            )
            .filter(q => q.eq(q.field("status"), "accepted"))
            .first();
        }
    }

    if (existingFact && existingFact._id !== fact._id) {
        await ctx.db.patch(existingFact._id, { status: "superseded" });
    }

    await ctx.db.patch(args.factId, { 
        status: "accepted", 
        needsReview: false,
        supersedesFactId: existingFact?._id 
    });

    await patchBlocks(ctx, fact.projectId, [{
        _id: fact._id,
        key: fact.key,
        value: fact.value,
        scopeType: fact.scopeType as "project" | "item",
        itemId: fact.itemId
    }]);

    await applyFactsToItems(ctx, fact.projectId, [{
        key: fact.key,
        value: fact.value,
        scopeType: fact.scopeType as "project" | "item",
        itemId: fact.itemId,
    }]);
  },
});

export const rejectFact = mutation({
  args: { factId: v.id("facts") },
  handler: async (ctx, args) => {
    const fact = await ctx.db.get(args.factId);
    if (!fact) throw new Error("Fact not found");
    if (!(await isFactsEnabled(ctx, fact.projectId))) return { ok: true, skipped: true };
    await ctx.db.patch(args.factId, { status: "rejected", needsReview: false });
  },
});

export const acceptPendingFacts = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await isFactsEnabled(ctx, args.projectId))) return { accepted: 0, skipped: true };
    const pendingFacts = await ctx.db
      .query("facts")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "proposed"))
      .collect();

    if (pendingFacts.length === 0) return { accepted: 0 };

    const acceptedFactsForPatch: Array<{
      _id: Id<"facts">;
      key: string;
      value: any;
      scopeType: "project" | "item";
      itemId?: Id<"projectItems"> | null;
    }> = [];

    for (const fact of pendingFacts) {
      let existingFact: Doc<"facts"> | null = null;
      if (fact.scopeType === "project") {
        existingFact = await ctx.db
          .query("facts")
          .withIndex("by_scope_key", (q) =>
            q.eq("projectId", fact.projectId)
              .eq("scopeType", "project")
              .eq("itemId", null)
              .eq("key", fact.key)
          )
          .filter((q) => q.eq(q.field("status"), "accepted"))
          .first();
      } else if (fact.itemId) {
        existingFact = await ctx.db
          .query("facts")
          .withIndex("by_scope_key", (q) =>
            q.eq("projectId", fact.projectId)
              .eq("scopeType", "item")
              .eq("itemId", fact.itemId)
              .eq("key", fact.key)
          )
          .filter((q) => q.eq(q.field("status"), "accepted"))
          .first();
      }

      if (existingFact && existingFact._id !== fact._id) {
        await ctx.db.patch(existingFact._id, { status: "superseded" });
      }

      await ctx.db.patch(fact._id, {
        status: "accepted",
        needsReview: false,
        supersedesFactId: existingFact?._id,
      });

      acceptedFactsForPatch.push({
        _id: fact._id,
        key: fact.key,
        value: fact.value,
        scopeType: fact.scopeType as "project" | "item",
        itemId: fact.itemId,
      });
    }

    if (acceptedFactsForPatch.length > 0) {
      await patchBlocks(ctx, args.projectId, acceptedFactsForPatch);
      await applyFactsToItems(ctx, args.projectId, acceptedFactsForPatch);
    }

    return { accepted: acceptedFactsForPatch.length };
  },
});

export const listFacts = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await isFactsEnabled(ctx, args.projectId))) return [];
    const facts = await ctx.db
      .query("facts")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
      .collect();
    
    // Sort by createdAt desc
    return facts.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listBlocks = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await isFactsEnabled(ctx, args.projectId))) return [];
    const blocks = await ctx.db
      .query("knowledgeBlocks")
      .withIndex("by_scope_block", (q) => q.eq("projectId", args.projectId))
      .collect();
    return blocks;
  },
});

export const rebuildBlocks = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await isFactsEnabled(ctx, args.projectId))) return { blocksRebuilt: false, factsUsed: 0, skipped: true };
    const acceptedFacts = await ctx.db
      .query("facts")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "accepted")
      )
      .collect();

    const existingBlocks = await ctx.db
      .query("knowledgeBlocks")
      .withIndex("by_scope_block", (q) => q.eq("projectId", args.projectId))
      .collect();

    for (const block of existingBlocks) {
      await ctx.db.delete(block._id);
    }

    if (acceptedFacts.length > 0) {
      await patchBlocks(
        ctx,
        args.projectId,
        acceptedFacts.map((fact) => ({
          _id: fact._id,
          key: fact.key,
          value: fact.value,
          scopeType: fact.scopeType,
          itemId: fact.itemId,
        }))
      );
    }

    return { blocksRebuilt: true, factsUsed: acceptedFacts.length };
  },
});

export const resolveConflict = mutation({
  args: { 
    projectId: v.id("projects"),
    scopeType: v.union(v.literal("project"), v.literal("item")),
    itemId: v.optional(v.id("projectItems")),
    key: v.string(),
    chosenFactId: v.id("facts")
  },
  handler: async (ctx, args) => {
    if (!(await isFactsEnabled(ctx, args.projectId))) return { ok: true, skipped: true };
    // 1. Get all facts for this key
    let facts = [];
    if (args.scopeType === "project") {
        facts = await ctx.db
            .query("facts")
            .withIndex("by_scope_key", (q) => 
                q.eq("projectId", args.projectId)
                 .eq("scopeType", "project")
                 .eq("itemId", null)
                 .eq("key", args.key)
            )
            .collect();
    } else {
        if (!args.itemId) throw new Error("Item ID required for item scope");
        facts = await ctx.db
            .query("facts")
            .withIndex("by_scope_key", (q) => 
                q.eq("projectId", args.projectId)
                 .eq("scopeType", "item")
                 .eq("itemId", args.itemId)
                 .eq("key", args.key)
            )
            .collect();
    }

    // 2. Update statuses
    for (const fact of facts) {
        if (fact._id === args.chosenFactId) {
            await ctx.db.patch(fact._id, { status: "accepted", needsReview: false });
        } else if (fact.status === "accepted" || fact.status === "conflict") {
            await ctx.db.patch(fact._id, { status: "superseded" });
        }
    }

    const chosenFact = facts.find((fact) => fact._id === args.chosenFactId);
    if (chosenFact) {
        await patchBlocks(ctx, chosenFact.projectId, [{
            _id: chosenFact._id,
            key: chosenFact.key,
            value: chosenFact.value,
            scopeType: chosenFact.scopeType as "project" | "item",
            itemId: chosenFact.itemId
        }]);

        await applyFactsToItems(ctx, chosenFact.projectId, [{
            key: chosenFact.key,
            value: chosenFact.value,
            scopeType: chosenFact.scopeType as "project" | "item",
            itemId: chosenFact.itemId,
        }]);
    }
  },
});


