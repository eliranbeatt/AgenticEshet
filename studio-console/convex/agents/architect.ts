import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { TaskBreakdownSchema } from "../lib/zodSchemas";
import { Id, type Doc } from "../_generated/dataModel";

// 1. DATA ACCESS
export const getContext: ReturnType<typeof internalQuery> = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const plans = await ctx.db
        .query("plans")
        .withIndex("by_project_phase", (q) =>
            q.eq("projectId", args.projectId).eq("phase", "planning")
        )
        .order("desc")
        .collect();
    
    const latestPlan = plans.find((plan) => plan.isActive);

    const quests = await ctx.db
        .query("quests")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

    const existingTasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

    const knowledgeDocs = await ctx.runQuery(internal.knowledge.getContextDocs, {
        projectId: args.projectId,
        limit: 3,
    });

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", "architect")) // We might need to seed this skill
      .first();

    return {
      project,
      latestPlan,
      quests,
      existingTasks,
      knowledgeDocs,
      systemPrompt: skill?.content || "You are a Senior Solutions Architect.",
    };
  },
});

export const saveTasks = internalMutation({
  args: {
    projectId: v.id("projects"),
    tasks: v.array(v.object({
        title: v.string(),
        description: v.string(),
        category: v.union(v.literal("Logistics"), v.literal("Creative"), v.literal("Finance"), v.literal("Admin"), v.literal("Studio")),
        priority: v.union(v.literal("High"), v.literal("Medium"), v.literal("Low")),
        questName: v.optional(v.union(v.string(), v.null())),
    })),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    const tasks = args.tasks.map((t) => ({
        ...t,
        questName: t.questName ?? undefined,
    }));

    const existingTasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
    const existingByTitle = new Map<string, { id: Id<"tasks">; source: string }>(
        existingTasks.map((task) => [task.title.trim().toLowerCase(), { id: task._id, source: task.source }])
    );

    const quests = await ctx.db
        .query("quests")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
    const questLookup = new Map(quests.map((quest) => [quest.title.trim().toLowerCase(), quest._id]));

    for (const t of tasks) {
        const normalizedTitle = t.title.trim().toLowerCase();
        const questId = t.questName ? questLookup.get(t.questName.trim().toLowerCase()) : undefined;
        const existingTask = existingByTitle.get(normalizedTitle);

        if (existingTask && existingTask.source === "agent") {
            await ctx.db.patch(existingTask.id, {
                description: t.description,
                category: t.category,
                priority: t.priority,
                questId,
                updatedAt: Date.now(),
            });
        } else if (!existingTask) {
            const newTaskId = await ctx.db.insert("tasks", {
                projectId: args.projectId,
                title: t.title,
                description: t.description,
                category: t.category,
                priority: t.priority,
                questId,
                status: "todo",
                source: "agent",
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            existingByTitle.set(normalizedTitle, { id: newTaskId, source: "agent" });
        }
    }

    const taskSnapshot = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

    const taskText = taskSnapshot
        .map((task) => `- ${task.title} [${task.status}] (${task.category}/${task.priority}) ${task.description || ""}`)
        .join("\n");

    await ctx.scheduler.runAfter(0, (internal as any).knowledge.ingestArtifact, {
        projectId: args.projectId,
        sourceType: "task",
        sourceRefId: `tasks-${Date.now()}`,
        title: `Task Snapshot ${new Date().toISOString()}`,
        text: taskText,
        summary: `Updated ${args.tasks.length} tasks from architect agent.`,
        tags: ["tasks", "architect"],
        topics: [],
        phase: "planning",
        clientName: project?.clientName,
    });
  },
});

// 2. AGENT ACTION
export const run: ReturnType<typeof action> = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const { project, latestPlan, systemPrompt, quests, existingTasks } = await ctx.runQuery(internal.agents.architect.getContext, {
      projectId: args.projectId,
    });

    const knowledgeDocs = await ctx.runAction(api.knowledge.dynamicSearch, {
        projectId: args.projectId,
        query: latestPlan ? latestPlan.contentMarkdown.slice(0, 800) : project.details.notes || project.name,
        scope: "both",
        sourceTypes: ["plan", "task", "quest", "doc_upload"],
        limit: 8,
        agentRole: "architect_agent",
        includeSummaries: true,
    });

    if (!latestPlan) {
        throw new Error("No active plan found. Approve a plan before generating tasks.");
    }

    const existingTaskSummary = existingTasks.length
        ? existingTasks
              .slice(0, 20)
              .map((task: Doc<"tasks">) => `- ${task.title} [${task.status}] (${task.category}/${task.priority})`)
              .join("\n")
        : "- No existing tasks found.";

    const knowledgeSummary = knowledgeDocs.length
        ? knowledgeDocs
              .map((doc: { doc: { sourceType: string; title: string; summary?: string }; text?: string }) => `- [${doc.doc.sourceType}] ${doc.doc.title}: ${doc.doc.summary ?? doc.text?.slice(0, 200)}`)
              .join("\n")
        : "- No knowledge documents available.";

    const userPrompt = `Project: ${project.name}
    
Plan Content:
${latestPlan.contentMarkdown}

Quests:
${quests.length ? quests.map((quest: Doc<"quests">) => `- ${quest.title}: ${quest.description || "No description"}`).join("\n") : "No quests defined. If necessary, supply questName field to indicate proposed grouping."}

Existing Tasks (for deduplication):
${existingTaskSummary}

Knowledge Documents:
${knowledgeSummary}

Task: Break down this plan into actionable, atomic tasks. Focus on the immediate next steps implied by the plan. When relevant, set the questName to one of the quests above so tasks can be grouped. Avoid duplicating tasks that already exist and update existing ones with refined descriptions if needed. Prioritize Hebrew wording that aligns with retrieved knowledge.`;

    const result = await callChatWithSchema(TaskBreakdownSchema, {
      systemPrompt,
      userPrompt,
    });

    // Normalize questName: Convex v.optional does not accept null, only undefined.
    const normalizedTasks = result.tasks.map((task) => {
        const questName = task.questName?.trim();
        return {
            ...task,
            questName: questName && questName.length > 0 ? questName : undefined,
        };
    });

    await ctx.runMutation(internal.agents.architect.saveTasks, {
      projectId: args.projectId,
      tasks: normalizedTasks,
    });

    return result;
  },
});
