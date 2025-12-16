import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { PlanSchema } from "../lib/zodSchemas";

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

    return {
      project,
      systemPrompt: skill?.content || "You are an expert planner.",
      existingPlans,
      latestClarification,
      knowledgeDocs,
    };
  },
});

// 2. DATA ACCESS
export const saveResult = internalMutation({
  args: {
    projectId: v.id("projects"),
    userRequest: v.string(),
    planData: v.any(), // PlanSchema
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    // Determine version
    const existing = await ctx.db
        .query("plans")
        .withIndex("by_project_phase", (q) =>
            q.eq("projectId", args.projectId).eq("phase", "planning")
        )
        .collect();
    
    const version = existing.length + 1;

    // Create new Draft Plan
    const planId = await ctx.db.insert("plans", {
      projectId: args.projectId,
      version,
      phase: "planning", // default for this agent
      isDraft: true,
      isActive: false,
      contentMarkdown: args.planData.contentMarkdown,
      reasoning: args.planData.reasoning,
      createdAt: Date.now(),
      createdBy: "agent",
    });

    await ctx.db.insert("conversations", {
      projectId: args.projectId,
      phase: "planning",
      agentRole: "planning_agent",
      messagesJson: JSON.stringify([
        { role: "user", content: args.userRequest },
        { role: "assistant", content: args.planData.contentMarkdown },
      ]),
      createdAt: Date.now(),
    });

    const ingestArtifact = (internal as unknown as { knowledge: { ingestArtifact: unknown } }).knowledge.ingestArtifact;

    await ctx.scheduler.runAfter(0, ingestArtifact, {
        projectId: args.projectId,
        sourceType: "plan",
        sourceRefId: planId,
        title: `Plan v${version}`,
        text: args.planData.contentMarkdown,
        summary: args.planData.reasoning || "Plan reasoning",
        tags: ["plan", "planning"],
        topics: [],
        phase: "planning",
        clientName: project?.clientName,
    });

    return planId;
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
        const { project, systemPrompt, existingPlans, latestClarification, knowledgeDocs: recentUploads } = await ctx.runQuery(internal.agents.planning.getContext, {
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

    const context = [
        `Project: ${project.name}`,
        `Client: ${project.clientName}`,
        `Project Details: ${JSON.stringify(project.details)}`,
        `Existing Plans Count: ${existingPlans.length}`,
        "",
        "Latest Clarification Summary:",
        clarificationSection,
        "",
        "Recently Uploaded Documents:",
        uploadedDocsSection,
        "",
        "Relevant Knowledge Snippets:",
        knowledgeSection,
        "",
        `User Request: ${args.userRequest}`,
    ].join("\n");

        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "info",
                message: "Calling model to generate plan draft.",
                stage: "llm_call",
            });
        }

        const result = await callChatWithSchema(PlanSchema, {
          systemPrompt,
          userPrompt: context,
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

        await ctx.runMutation(internal.agents.planning.saveResult, {
          projectId: args.projectId,
          userRequest: args.userRequest,
          planData: result,
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
