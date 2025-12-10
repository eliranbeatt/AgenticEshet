import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { TaskBreakdownSchema } from "../lib/zodSchemas";
import { Id } from "../_generated/dataModel";

// 1. DATA ACCESS
export const getContext = internalQuery({
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

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_name", (q) => q.eq("name", "architect")) // We might need to seed this skill
      .first();

    return {
      project,
      latestPlan,
      quests,
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
        questName: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
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

    for (const t of args.tasks) {
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
  },
});

// 2. AGENT ACTION
export const run = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const { project, latestPlan, systemPrompt, quests } = await ctx.runQuery(internal.agents.architect.getContext, {
      projectId: args.projectId,
    });

    if (!latestPlan) {
        throw new Error("No active plan found. Approve a plan before generating tasks.");
    }

    const userPrompt = `Project: ${project.name}
    
Plan Content:
${latestPlan.contentMarkdown}

Quests:
${quests.length ? quests.map((quest) => `- ${quest.title}: ${quest.description || "No description"}`).join("\n") : "No quests defined. If necessary, supply questName field to indicate proposed grouping."}

Task: Break down this plan into actionable, atomic tasks. Focus on the immediate next steps implied by the plan. When relevant, set the questName to one of the quests above so tasks can be grouped. Avoid duplicating tasks that already exist and update existing ones with refined descriptions if needed.`;

    const result = await callChatWithSchema(TaskBreakdownSchema, {
      systemPrompt,
      userPrompt,
    });

    await ctx.runMutation(internal.agents.architect.saveTasks, {
      projectId: args.projectId,
      tasks: result.tasks,
    });

    return result;
  },
});
