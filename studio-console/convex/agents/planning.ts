import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { PlanSchema } from "../lib/zodSchemas";

// 1. DATA ACCESS
export const getContext = internalQuery({
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
        limit: 3,
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

    await ctx.scheduler.runAfter(0, internal.knowledge.ingestArtifact, {
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

// 3. AGENT ACTION
export const run = action({
  args: {
    projectId: v.id("projects"),
    userRequest: v.string(), // e.g. "Create initial plan" or "Refine timeline"
  },
  handler: async (ctx, args) => {
    const { project, systemPrompt, existingPlans, latestClarification } = await ctx.runQuery(internal.agents.planning.getContext, {
      projectId: args.projectId,
    });

    const knowledgeDocs = await ctx.runAction(internal.knowledge.dynamicSearch, {
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

    const knowledgeSection = knowledgeDocs.length
        ? knowledgeDocs
              .map((doc) => `- [${doc.doc.sourceType}] ${doc.doc.title}: ${doc.doc.summary ?? doc.text?.slice(0, 200)}`)
              .join("\n")
        : "No knowledge documents available.";

    const context = [
        `Project: ${project.name}`,
        `Client: ${project.clientName}`,
        `Project Details: ${JSON.stringify(project.details)}`,
        `Existing Plans Count: ${existingPlans.length}`,
        "",
        "Latest Clarification Summary:",
        clarificationSection,
        "",
        "Relevant Knowledge Snippets:",
        knowledgeSection,
        "",
        `User Request: ${args.userRequest}`,
    ].join("\n");

    const result = await callChatWithSchema(PlanSchema, {
      systemPrompt,
      userPrompt: context,
    });

    await ctx.runMutation(internal.agents.planning.saveResult, {
      projectId: args.projectId,
      userRequest: args.userRequest,
      planData: result,
    });

    return result;
  },
});
