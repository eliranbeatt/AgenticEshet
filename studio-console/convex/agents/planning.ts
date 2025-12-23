import { v } from "convex/values";
import { action, internalAction, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { ChangeSetSchema } from "../lib/zodSchemas";
import {
  changeSetSchemaText,
  chatRules,
  extractGuardrails,
  planningPrompt,
  sharedContextContract,
} from "../prompts/itemsPromptPack";

// 1. DATA ACCESS
export const getContext: ReturnType<typeof internalQuery> = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", "planning"))
      .first();

    // Get existing plans to provide context on previous versions?
    const existingPlans = await ctx.db
      .query("plans")
      .withIndex("by_project_phase", (q) =>
        q.eq("projectId", args.projectId).eq("phase", "planning")
      )
      .order("desc")
      .collect();

    const latestClarification = await ctx.db
      .query("plans")
      .withIndex("by_project_phase", (q) =>
        q.eq("projectId", args.projectId).eq("phase", "clarification")
      )
      .order("desc")
      .first();

    const knowledgeDocs = await ctx.runQuery(internal.knowledge.getContextDocs, {
      projectId: args.projectId,
      limit: 8,
      sourceTypes: ["doc_upload"],
    });

    const items = await ctx.db
      .query("projectItems")
      .withIndex("by_project_parent_sort", (q) => q.eq("projectId", args.projectId))
      .collect();

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const materialLines = await ctx.db
      .query("materialLines")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const workLines = await ctx.db
      .query("workLines")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const accountingLines = await ctx.db
      .query("accountingLines")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    return {
      project,
      systemPrompt:
        skill?.content ||
        [sharedContextContract, extractGuardrails, chatRules, changeSetSchemaText, planningPrompt].join("\n\n"),
      existingPlans,
      latestClarification,
      knowledgeDocs,
      items,
      tasks,
      materialLines,
      workLines,
      accountingLines,
    };
  },
});

export const runInBackground: ReturnType<typeof internalAction> = internalAction({
  args: {
    projectId: v.id("projects"),
    userRequest: v.string(),
    agentRunId: v.optional(v.id("agentRuns")),
    thinkingMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const agentRunId = args.agentRunId;

    // Fetch model configuration
    const settings = await ctx.runQuery(internal.settings.getAll);
    const model = settings.modelConfig?.planning || "gpt-5.2";

    if (agentRunId) {
      await ctx.runMutation(internal.agentRuns.setStatus, {
        runId: agentRunId,
        status: "running",
        stage: "loading_context",
      });
      await ctx.runMutation(internal.agentRuns.appendEvent, {
        runId: agentRunId,
        level: "info",
        message: "Loading project context for planning.",
        stage: "loading_context",
      });
    }

    try {
      const {
        project,
        systemPrompt,
        existingPlans,
        latestClarification,
        knowledgeDocs: recentUploads,
        items,
        tasks,
        materialLines,
        workLines,
        accountingLines,
      } = await ctx.runQuery(internal.agents.planning.getContext, {
        projectId: args.projectId,
      });

      if (agentRunId) {
        await ctx.runMutation(internal.agentRuns.appendEvent, {
          runId: agentRunId,
          level: "info",
          message: "Searching knowledge base for planning context.",
          stage: "knowledge_search",
        });
      }

      const knowledgeResults = await ctx.runAction(api.knowledge.dynamicSearch, {
        projectId: args.projectId,
        query: [args.userRequest, project.details.notes || "", project.clientName].join("\n"),
        scope: "both",
        sourceTypes: ["plan", "doc_upload", "conversation"],
        limit: 8,
        agentRole: "planning_agent",
        includeSummaries: true,
      });

      const clarificationSection = latestClarification
        ? latestClarification.contentMarkdown.slice(0, 1200)
        : "No clarification summary recorded.";

      const uploadedDocsSection = recentUploads && recentUploads.length > 0
        ? recentUploads
          .map((doc: { title: string; summary?: string; keyPoints?: string[] }) => {
            const keyPoints = Array.isArray(doc.keyPoints) && doc.keyPoints.length > 0
              ? ` Key points: ${doc.keyPoints.slice(0, 6).join("; ")}`
              : "";
            return `- [doc_upload] ${doc.title}: ${(doc.summary ?? "").slice(0, 400)}${keyPoints}`;
          })
          .join("\n")
        : "No uploaded documents ready yet.";

      const knowledgeSection = knowledgeResults.length
        ? knowledgeResults
          .map((entry: { doc: { sourceType: string; title: string; summary?: string; keyPoints?: string[] }; text?: string }) => {
            const keyPoints = Array.isArray(entry.doc.keyPoints) && entry.doc.keyPoints.length > 0
              ? ` Key points: ${entry.doc.keyPoints.slice(0, 6).join("; ")}`
              : "";
            const base = (entry.doc.summary ?? entry.text?.slice(0, 200) ?? "").trim();
            return `- [${entry.doc.sourceType}] ${entry.doc.title}: ${base}${keyPoints}`;
          })
          .join("\n")
        : "No relevant knowledge documents found.";

      const context = {
        mode: "EXTRACT",
        phase: "planning",
        actor: { userName: "user", studioName: "studio" },
        project: {
          id: project._id,
          name: project.name,
          clientName: project.clientName,
          defaultLanguage: project.defaultLanguage ?? "he",
          budgetTier: project.budgetTier ?? "unknown",
          projectTypes: project.projectTypes ?? [],
          details: project.details,
          overview: project.overview,
          features: project.features ?? {},
        },
        selection: {
          selectedItemIds: [],
          selectedConceptIds: [],
          selectedTaskIds: [],
        },
        items,
        tasks,
        accounting: {
          materialLines,
          workLines,
          accountingLines,
        },
        quotes: [],
        concepts: [],
        knowledge: {
          attachedDocs: recentUploads ?? [],
          pastProjects: [],
          retrievedSnippets: knowledgeResults.map((entry: { doc: { _id: string; title: string }; text?: string; tags?: string[] }) => ({
            sourceId: entry.doc._id,
            text: entry.text ?? "",
            tags: entry.tags ?? [],
          })),
        },
        settings: {
          currencyDefault: project.currency ?? "ILS",
          tax: { vatRate: project.vatRate ?? 0, pricesIncludeVat: project.pricesIncludeVat ?? false },
          pricingModel: {
            overheadOnExpensesPct: 0.15,
            overheadOnOwnerTimePct: 0.3,
            profitPct: 0.1,
          },
        },
        ui: {
          capabilities: {
            supportsChangeSets: true,
            supportsLocks: true,
            supportsDeepResearchTool: true,
          },
        },
        clarificationSummary: clarificationSection,
        userRequest: args.userRequest,
        existingPlansCount: existingPlans.length,
        recentUploads: uploadedDocsSection,
        knowledgeSection,
      };

      if (agentRunId) {
        await ctx.runMutation(internal.agentRuns.appendEvent, {
          runId: agentRunId,
          level: "info",
          message: "Calling model to generate plan draft.",
          stage: "llm_call",
        });
      }

      const result = await callChatWithSchema(ChangeSetSchema, {
        model,
        systemPrompt,
        userPrompt: JSON.stringify(context),
        thinkingMode: args.thinkingMode,
      });

      if (agentRunId) {
        await ctx.runMutation(internal.agentRuns.appendEvent, {
          runId: agentRunId,
          level: "info",
          message: "Saving plan draft.",
          stage: "persisting",
        });
      }

      await ctx.runAction(api.changeSets.createFromAgentOutput, {
        agentOutput: result,
      });

      if (agentRunId) {
        await ctx.runMutation(internal.agentRuns.setStatus, {
          runId: agentRunId,
          status: "succeeded",
          stage: "done",
        });
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (agentRunId) {
        await ctx.runMutation(internal.agentRuns.appendEvent, {
          runId: agentRunId,
          level: "error",
          message,
          stage: "failed",
        });
        await ctx.runMutation(internal.agentRuns.setStatus, {
          runId: agentRunId,
          status: "failed",
          stage: "failed",
          error: message,
        });
      }
      throw error;
    }
  },
});

// 3. AGENT ACTION
export const run: ReturnType<typeof action> = action({
  args: {
    projectId: v.id("projects"),
    userRequest: v.string(), // e.g. "Create initial plan" or "Refine timeline"
    thinkingMode: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.agents.planning.getContext, { projectId: args.projectId });

    const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
      projectId: args.projectId,
      agent: "planning",
      stage: "queued",
      initialMessage: "Queued plan generation.",
    });

    await ctx.scheduler.runAfter(0, internal.agents.planning.runInBackground, {
      projectId: args.projectId,
      userRequest: args.userRequest,
      agentRunId,
      thinkingMode: args.thinkingMode,
    });

    return { queued: true, runId: agentRunId };
  },
});
