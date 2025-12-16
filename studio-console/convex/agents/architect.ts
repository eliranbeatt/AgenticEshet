import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
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

    const sections = await ctx.db
        .query("sections")
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
      sections,
      materialLines,
      workLines,
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
        accountingSectionName: v.optional(v.union(v.string(), v.null())),
        accountingItemLabel: v.optional(v.union(v.string(), v.null())),
        accountingItemType: v.optional(v.union(v.literal("material"), v.literal("work"), v.null())),
        dependencies: v.optional(v.array(v.number())),
        estimatedHours: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    const tasks = args.tasks.map((t) => ({
        ...t,
        accountingSectionName: t.accountingSectionName ?? undefined,
        accountingItemLabel: t.accountingItemLabel ?? undefined,
        accountingItemType: t.accountingItemType ?? undefined,
        estimatedDuration: t.estimatedHours ? t.estimatedHours * 60 * 60 * 1000 : undefined,
    }));

    const existingTasks = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
    
    let maxTaskNumber = 0;
    for (const t of existingTasks) {
        if (t.taskNumber && t.taskNumber > maxTaskNumber) maxTaskNumber = t.taskNumber;
    }
    let currentTaskNumber = maxTaskNumber;

    const existingByTitle = new Map<string, { id: Id<"tasks">; source: string }>(
        existingTasks.map((task) => [task.title.trim().toLowerCase(), { id: task._id, source: task.source }])
    );

    const sections = await ctx.db
        .query("sections")
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

    const normalizeKey = (value: string) => value.trim().toLowerCase();

    const sectionNameCounts = new Map<string, number>();
    for (const section of sections) {
        const nameKey = normalizeKey(section.name);
        sectionNameCounts.set(nameKey, (sectionNameCounts.get(nameKey) ?? 0) + 1);
    }

    const sectionLookup = new Map<string, Id<"sections">>();
    const sectionNameLookupUnique = new Map<string, Id<"sections">>();
    for (const section of sections) {
        const display = `[${section.group}] ${section.name}`;
        sectionLookup.set(normalizeKey(display), section._id);
        const nameKey = normalizeKey(section.name);
        if ((sectionNameCounts.get(nameKey) ?? 0) === 1) {
            sectionNameLookupUnique.set(nameKey, section._id);
        }
    }

    const materialsBySection = new Map<Id<"sections">, Map<string, Id<"materialLines">>>();
    for (const line of materialLines) {
        const sectionId = line.sectionId as Id<"sections">;
        if (!materialsBySection.has(sectionId)) materialsBySection.set(sectionId, new Map());
        materialsBySection.get(sectionId)!.set(normalizeKey(line.label), line._id);
    }

    const workBySection = new Map<Id<"sections">, Map<string, Id<"workLines">>>();
    for (const line of workLines) {
        const sectionId = line.sectionId as Id<"sections">;
        if (!workBySection.has(sectionId)) workBySection.set(sectionId, new Map());
        workBySection.get(sectionId)!.set(normalizeKey(line.role), line._id);
    }

    const resolveSectionId = (raw?: string) => {
        if (!raw) return undefined;
        const key = normalizeKey(raw);
        return sectionLookup.get(key) ?? sectionNameLookupUnique.get(key);
    };

    const batchIndexToId = new Map<number, Id<"tasks">>();

    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const normalizedTitle = t.title.trim().toLowerCase();
        const sectionId = resolveSectionId(t.accountingSectionName);

        let accountingLineType: "material" | "work" | undefined;
        let accountingLineId: Id<"materialLines"> | Id<"workLines"> | undefined;
        if (sectionId && t.accountingItemType && t.accountingItemLabel) {
            const itemKey = normalizeKey(t.accountingItemLabel);
            if (t.accountingItemType === "material") {
                accountingLineId = materialsBySection.get(sectionId)?.get(itemKey);
                accountingLineType = accountingLineId ? "material" : undefined;
            } else if (t.accountingItemType === "work") {
                accountingLineId = workBySection.get(sectionId)?.get(itemKey);
                accountingLineType = accountingLineId ? "work" : undefined;
            }
        }
        const existingTask = existingByTitle.get(normalizedTitle);
        let taskId: Id<"tasks">;

        if (existingTask && existingTask.source === "agent") {
            taskId = existingTask.id;
            await ctx.db.patch(taskId, {
                description: t.description,
                category: t.category,
                priority: t.priority,
                accountingSectionId: sectionId,
                accountingLineType,
                accountingLineId,
                updatedAt: Date.now(),
            });
            if (!existingTasks.find(et => et._id === taskId)?.taskNumber) {
                 currentTaskNumber++;
                 await ctx.db.patch(taskId, { taskNumber: currentTaskNumber });
            }
        } else if (!existingTask) {
            currentTaskNumber++;
            taskId = await ctx.db.insert("tasks", {
                projectId: args.projectId,
                title: t.title,
                description: t.description,
                category: t.category,
                priority: t.priority,
                accountingLineId,
                status: "todo",
                source: "agent",
                taskNumber: currentTaskNumber,
                estimatedDuration: t.estimatedDuration,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            }); createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            existingByTitle.set(normalizedTitle, { id: taskId, source: "agent" });
        } else {
            taskId = existingTask.id;
        }
        batchIndexToId.set(i + 1, taskId);
    }

    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (t.dependencies && t.dependencies.length > 0) {
            const taskId = batchIndexToId.get(i + 1);
            if (taskId) {
                const depIds: Id<"tasks">[] = [];
                for (const depIndex of t.dependencies) {
                    const depId = batchIndexToId.get(depIndex);
                    if (depId) depIds.push(depId);
                }
                if (depIds.length > 0) {
                    await ctx.db.patch(taskId, { dependencies: depIds });
                }
            }
        }
    }

    const taskSnapshot = await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

    const taskText = taskSnapshot
        .map((task) => `- ${task.title} [${task.status}] (${task.category}/${task.priority}) ${task.description || ""}`)
        .join("\n");

    await ctx.scheduler.runAfter(0, internal.knowledge.ingestArtifact, {
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
export const runInBackground = internalAction({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const { project, latestPlan, systemPrompt, sections, materialLines, workLines, existingTasks } = await ctx.runQuery(internal.agents.architect.getContext, {
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
              .map((entry: { doc: { sourceType: string; title: string; summary?: string; keyPoints?: string[] }; text?: string }) => {
                  const keyPoints = Array.isArray(entry.doc.keyPoints) && entry.doc.keyPoints.length > 0
                      ? ` Key points: ${entry.doc.keyPoints.slice(0, 6).join("; ")}`
                      : "";
                  const base = (entry.doc.summary ?? entry.text?.slice(0, 200) ?? "").trim();
                  return `- [${entry.doc.sourceType}] ${entry.doc.title}: ${base}${keyPoints}`;
              })
              .join("\n")
        : "- No relevant knowledge documents found.";

    const materialBySection = new Map<string, string[]>();
    for (const line of materialLines) {
        const sectionId = line.sectionId;
        if (!materialBySection.has(sectionId)) materialBySection.set(sectionId, []);
        materialBySection.get(sectionId)!.push(line.label);
    }

    const workBySection = new Map<string, string[]>();
    for (const line of workLines) {
        const sectionId = line.sectionId;
        if (!workBySection.has(sectionId)) workBySection.set(sectionId, []);
        workBySection.get(sectionId)!.push(line.role);
    }

    const accountingSummary = sections.length
        ? sections
              .slice(0, 40)
              .map((section: Doc<"sections">) => {
                  const sectionLabel = `[${section.group}] ${section.name}`;
                  const materials = materialBySection.get(section._id) ?? [];
                  const work = workBySection.get(section._id) ?? [];
                  const materialsText = materials.length ? `Materials: ${materials.slice(0, 6).join(", ")}` : "Materials: (none)";
                  const workText = work.length ? `Work: ${work.slice(0, 6).join(", ")}` : "Work: (none)";
                  return `- ${sectionLabel}\n  ${materialsText}\n  ${workText}`;
              })
              .join("\n")
        : "- No accounting sections found. If a task cannot be linked, set accountingSectionName to null.";

    const userPrompt = `Project: ${project.name}
    
Plan Content:
${latestPlan.contentMarkdown}

Accounting Sections (use the section label exactly when linking tasks):
${accountingSummary}

Existing Tasks (for deduplication):
${existingTaskSummary}

Knowledge Documents:
${knowledgeSummary}

Task: Break down this plan into actionable, atomic tasks. Focus on the immediate next steps implied by the plan.

Dependencies (critical):
- Assign dependencies for each task using the 1-based index of tasks in your own output list.
- A dependency means: this task cannot start until the dependency task is DONE.
- Only reference earlier tasks (dependencies must be < current task index). If you realize an ordering issue, reorder tasks so dependencies point backwards.
- Use [] when a task can start immediately.

Dependency test checklist (do this before answering):
1) For each task, ask: does it require an approved plan, selected vendor, booked date/location, completed asset list, or delivered inputs from another task? If yes, add that prerequisite task index.
2) Ensure there are no cycles and no forward references.
3) Ensure at least some tasks have dependencies if the plan implies sequencing.

When relevant, set accountingSectionName to one of the Accounting Sections above so tasks can be grouped and auto-linked. If a specific accounting item applies, set accountingItemType ("material" or "work") and accountingItemLabel exactly as shown in that section list; otherwise set them to null. Avoid duplicating tasks that already exist and update existing ones with refined descriptions if needed. Prioritize Hebrew wording that aligns with retrieved knowledge.`;

    const result = await callChatWithSchema(TaskBreakdownSchema, {
      systemPrompt,
      userPrompt,
    });

    const normalizedTasks = result.tasks.map((task) => {
        const accountingSectionName = task.accountingSectionName?.trim();
        const accountingItemLabel = task.accountingItemLabel?.trim();
        return {
            ...task,
            accountingSectionName: accountingSectionName && accountingSectionName.length > 0 ? accountingSectionName : undefined,
            accountingItemLabel: accountingItemLabel && accountingItemLabel.length > 0 ? accountingItemLabel : undefined,
            accountingItemType: task.accountingItemType ?? undefined,
        };
    });

    await ctx.runMutation(internal.agents.architect.saveTasks, {
      projectId: args.projectId,
      tasks: normalizedTasks,
    });

    return result;
  },
});

export const run: ReturnType<typeof action> = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(0, internal.agents.architect.runInBackground, {
        projectId: args.projectId,
    });

    return { queued: true };
  },
});
