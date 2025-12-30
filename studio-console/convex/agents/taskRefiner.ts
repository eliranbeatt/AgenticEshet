import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { TaskRefinementSchema } from "../lib/zodSchemas";
import type { Doc, Id } from "../_generated/dataModel";

const FALLBACK_SYSTEM_PROMPT = [
    "You are a senior project planner and task optimizer.",
    "You refine existing tasks by clarifying descriptions, adding dependencies, and estimating time.",
    "Never create new tasks or rename tasks. Only improve the existing list.",
    "Default to the project's language unless explicitly instructed otherwise.",
].join("\n");

function isElementTaskKey(value?: string | null) {
    return Boolean(value && /^tsk_[a-f0-9]{8}$/.test(value));
}

function formatEstimateFromHours(hours?: number) {
    if (typeof hours !== "number" || !Number.isFinite(hours)) return undefined;
    const rounded = Math.max(0, hours);
    if (rounded === 0) return "";
    const trimmed = rounded % 1 === 0 ? `${rounded.toFixed(0)}` : `${rounded.toFixed(2)}`;
    return `${trimmed}h`;
}

function normalizeTempTaskId(raw: string | undefined) {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const upper = trimmed.toUpperCase();
    const withSuffix = upper.match(/^T\d+_\d+$/);
    if (withSuffix) return upper;
    const direct = upper.match(/^T(\d+)$/);
    if (direct) return `T${Number(direct[1])}`;

    const withSeparator = upper.match(/^T\s*[-_#:]?\s*(\d+)\s*$/);
    if (withSeparator) return `T${Number(withSeparator[1])}`;

    const numericOnly = upper.match(/^#?\s*(\d+)\s*$/);
    if (numericOnly) return `T${Number(numericOnly[1])}`;

    const embedded = upper.match(/(?:TASK|T)\s*[-_#:]?\s*(\d+)/);
    if (embedded) return `T${Number(embedded[1])}`;

    return upper;
}

function extractTempIds(raw: string): string[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const lowered = trimmed.toLowerCase();
    if (["none", "n/a", "na", "null", "[]"].includes(lowered)) return [];

    const cleaned = trimmed.replace(/[\[\]()]/g, " ");
    const matches = [...cleaned.matchAll(/(?:TASK|T)\s*[-_#:]?\s*(\d+)/gi)];
    if (matches.length > 0) {
        return [...new Set(matches.map((match) => `T${Number(match[1])}`))];
    }

    const normalized = normalizeTempTaskId(cleaned);
    return normalized ? [normalized] : [];
}

export const getContext = internalQuery({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);
        if (!project) throw new Error("Project not found");

        const tasks = await ctx.db
            .query("tasks")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const plans = await ctx.db
            .query("plans")
            .withIndex("by_project_phase", (q) =>
                q.eq("projectId", args.projectId).eq("phase", "planning")
            )
            .order("desc")
            .collect();

        const latestPlan = plans.find((plan) => plan.isActive) ?? null;

        const skill = await ctx.db
            .query("skills")
            .withIndex("by_name", (q) => q.eq("name", "task_refiner"))
            .first();

        return {
            project,
            tasks,
            latestPlan,
            systemPrompt: skill?.content || FALLBACK_SYSTEM_PROMPT,
        };
    },
});

export const applyRefinements = internalMutation({
    args: {
        updates: v.array(
            v.object({
                taskId: v.id("tasks"),
                description: v.optional(v.string()),
                estimatedHours: v.optional(v.number()),
                dependencies: v.optional(v.array(v.id("tasks"))),
                steps: v.optional(v.array(v.string())),
                subtasks: v.optional(v.array(v.object({ title: v.string(), done: v.boolean() }))),
            })
        ),
    },
    handler: async (ctx, args) => {
        const taskDocs = await Promise.all(args.updates.map((update) => ctx.db.get(update.taskId)));
        const tasks = taskDocs.filter(Boolean) as Doc<"tasks">[];
        if (tasks.length === 0) return { updated: 0 };

        const project = await ctx.db.get(tasks[0].projectId);
        if (project?.features?.elementsCanonical) {
            const draft = await ctx.db
                .query("revisions")
                .withIndex("by_project_tab_status", (q) =>
                    q.eq("projectId", tasks[0].projectId).eq("originTab", "Tasks").eq("status", "draft")
                )
                .order("desc")
                .first();
            if (!draft) return { updated: 0, skipped: true };

            const allTasks = await ctx.db
                .query("tasks")
                .withIndex("by_project", (q) => q.eq("projectId", tasks[0].projectId))
                .collect();
            const taskKeyById = new Map<string, string>();
            for (const task of allTasks) {
                if (isElementTaskKey(task.itemSubtaskId)) {
                    taskKeyById.set(String(task._id), task.itemSubtaskId);
                }
            }

            const elementIds = new Set<string>();
            for (const task of tasks) {
                if (task.itemId) elementIds.add(String(task.itemId));
            }

            const elementById = new Map<string, Doc<"projectItems">>();
            const snapshotByElementId = new Map<string, { snapshot: any; baseVersionId?: Id<"elementVersions"> }>();
            for (const elementId of elementIds) {
                const element = await ctx.db.get(elementId as Id<"projectItems">);
                if (!element) continue;
                elementById.set(elementId, element);
                const baseVersionId = element.activeVersionId ?? element.publishedVersionId;
                const version = baseVersionId ? await ctx.db.get(baseVersionId) : null;
                snapshotByElementId.set(elementId, { snapshot: version?.snapshot ?? null, baseVersionId: baseVersionId ?? undefined });
            }

            let updated = 0;
            for (const update of args.updates) {
                const task = tasks.find((row) => row._id === update.taskId);
                if (!task?.itemId || !isElementTaskKey(task.itemSubtaskId)) continue;
                const elementId = task.itemId;
                const element = elementById.get(String(elementId));
                if (!element) continue;
                const snapshotEntry = snapshotByElementId.get(String(elementId));
                const baseVersionId = snapshotEntry?.baseVersionId ?? element.activeVersionId ?? element.publishedVersionId;
                const snapshot = snapshotEntry?.snapshot as { tasks?: any[] } | null;
                const existingLine = snapshot?.tasks?.find((line) => line.taskKey === task.itemSubtaskId) ?? null;

                const dependencyIds = update.dependencies ?? task.dependencies ?? [];
                const dependencyKeys = dependencyIds
                    .map((depId) => taskKeyById.get(String(depId)))
                    .filter((key): key is string => Boolean(key));

                const nextLine = {
                    taskKey: task.itemSubtaskId,
                    title: existingLine?.title ?? task.title,
                    details: update.description ?? existingLine?.details ?? task.description ?? "",
                    bucketKey: existingLine?.bucketKey ?? "general",
                    taskType: existingLine?.taskType ?? "normal",
                    estimate: update.estimatedHours !== undefined
                        ? formatEstimateFromHours(update.estimatedHours)
                        : existingLine?.estimate,
                    dependencies: dependencyKeys.length ? dependencyKeys : existingLine?.dependencies ?? [],
                    usesMaterialKeys: existingLine?.usesMaterialKeys ?? [],
                    usesLaborKeys: existingLine?.usesLaborKeys ?? [],
                    materialKey: existingLine?.materialKey,
                };

                await ctx.runMutation(api.revisions.patchElement, {
                    revisionId: draft._id,
                    elementId,
                    baseVersionId,
                    patchOps: [{ op: "upsert_line", entity: "tasks", key: task.itemSubtaskId, value: nextLine }],
                });
                updated += 1;
            }

            return { updated, revisionId: draft._id };
        }

        let updated = 0;
        for (const update of args.updates) {
            const patch: Partial<Doc<"tasks">> = {};
            if (update.description) patch.description = update.description;
            if (update.dependencies) patch.dependencies = update.dependencies;
            if (update.steps) patch.steps = update.steps;
            if (update.subtasks) patch.subtasks = update.subtasks;
            if (typeof update.estimatedHours === "number" && Number.isFinite(update.estimatedHours)) {
                const hours = Math.max(0.25, update.estimatedHours);
                patch.estimatedDuration = hours * 60 * 60 * 1000;
                patch.estimatedMinutes = Math.round(hours * 60);
            }
            if (Object.keys(patch).length === 0) continue;
            await ctx.db.patch(update.taskId, { ...patch, updatedAt: Date.now() });
            updated += 1;
        }
        return { updated };
    },
});

async function executeRefinement(
    ctx: {
        runQuery: (ref: unknown, args: unknown) => Promise<unknown>;
        runAction: (ref: unknown, args: unknown) => Promise<unknown>;
        runMutation: (ref: unknown, args: unknown) => Promise<unknown>;
    },
    args: { projectId: Id<"projects">; thinkingMode?: boolean },
) {
    const settings = await ctx.runQuery(internal.settings.getAll, {});
    const model = (settings as { modelConfig?: Record<string, string> }).modelConfig?.tasks || "gpt-5.2";

    const { project, tasks, latestPlan, systemPrompt } = await ctx.runQuery(internal.agents.taskRefiner.getContext, {
        projectId: args.projectId,
    }) as {
        project: Doc<"projects">;
        tasks: Doc<"tasks">[];
        latestPlan: Doc<"plans"> | null;
        systemPrompt: string;
    };

    if (tasks.length === 0) {
        throw new Error("No tasks found to refine.");
    }

    const sortedTasks = [...tasks].sort((a, b) => {
        const aNumber = a.taskNumber ?? 0;
        const bNumber = b.taskNumber ?? 0;
        if (aNumber !== bNumber) return aNumber - bNumber;
        return a.title.localeCompare(b.title);
    });

    const tempIdByTaskId = new Map<Id<"tasks">, string>();
    const taskIdByTempId = new Map<string, Id<"tasks">>();
    const taskIdByTitle = new Map<string, Id<"tasks">>();
    const usedIds = new Set<string>();

    for (let i = 0; i < sortedTasks.length; i++) {
        const task = sortedTasks[i];
        const base = `T${task.taskNumber ?? i + 1}`;
        let tempId = base;
        let counter = 1;
        while (usedIds.has(tempId)) {
            counter += 1;
            tempId = `${base}_${counter}`;
        }
        usedIds.add(tempId);
        tempIdByTaskId.set(task._id, tempId);
        taskIdByTempId.set(tempId, task._id);
        taskIdByTitle.set(task.title.trim().toLowerCase(), task._id);
    }

    const taskLines = sortedTasks.map((task) => {
        const tempId = tempIdByTaskId.get(task._id) ?? "";
        const dependencyIds = (task.dependencies ?? [])
            .map((dep) => tempIdByTaskId.get(dep as Id<"tasks">) ?? "")
            .filter(Boolean);
        const estimateHours = task.estimatedDuration ? task.estimatedDuration / 3600000 : null;
        const subtasks = (task.subtasks ?? []).map((st) => `- ${st.title}`).join("\n");

        return [
            `${tempId}: ${task.title}`,
            `Status: ${task.status} | Category: ${task.category} | Priority: ${task.priority}`,
            `Description: ${task.description ?? "(none)"}`,
            `Estimate (hours): ${estimateHours ? estimateHours.toFixed(2) : "(none)"}`,
            `Dependencies: ${dependencyIds.length ? dependencyIds.join(", ") : "[]"}`,
            `Subtasks:\n${subtasks || "(none)"}`,
        ].join("\n");
    }).join("\n\n");

    const knowledgeDocs = await ctx.runAction(api.knowledge.dynamicSearch, {
        projectId: args.projectId,
        query: latestPlan?.contentMarkdown?.slice(0, 800) || project.details.notes || project.name,
        scope: "both",
        sourceTypes: ["plan", "task", "quest", "doc_upload"],
        limit: 6,
        agentRole: "tasks_refiner",
        includeSummaries: true,
    }) as Array<{ doc: { sourceType: string; title: string; summary?: string; keyPoints?: string[] }; text?: string }>;

    const knowledgeSummary = knowledgeDocs.length
        ? knowledgeDocs
            .map((entry) => {
                const base = (entry.doc.summary ?? entry.text?.slice(0, 200) ?? "").trim();
                const keyPoints = Array.isArray(entry.doc.keyPoints) && entry.doc.keyPoints.length > 0
                    ? ` Key points: ${entry.doc.keyPoints.slice(0, 6).join("; ")}`
                    : "";
                return `- [${entry.doc.sourceType}] ${entry.doc.title}: ${base}${keyPoints}`;
            })
            .join("\n")
        : "- No relevant knowledge documents found.";

    const userPrompt = [
        `Project: ${project.name}`,
        `Client: ${project.clientName}`,
        `Default language: ${project.defaultLanguage ?? "he"}`,
        "",
        "Plan (if available):",
        latestPlan?.contentMarkdown ?? "(no active plan)",
        "",
        "Knowledge snippets:",
        knowledgeSummary,
        "",
        "Existing tasks:",
        taskLines,
        "",
        "Task: Refine the existing tasks only.",
        "- Improve each task description so it is specific, actionable, and aligned with the plan.",
        "- Estimate time in hours for every task (be realistic).",
        "- Create logical dependencies between tasks using ONLY the provided IDs.",
        "- Add 2-6 concise subtasks for each task when it adds clarity.",
        "- Do NOT create new tasks or change task titles/status/category/priority.",
        "- Avoid dependency cycles and forward references.",
        "",
        "Return JSON ONLY and match this shape exactly:",
        `{"tasks":[{"id":"T1","description":"...","estimatedHours":1.5,"dependencies":["T0"],"steps":["..."],"subtasks":["..."]}],"logic":"optional"}`,
    ].join("\n");

    const result = await callChatWithSchema(TaskRefinementSchema, {
        model,
        systemPrompt,
        userPrompt,
        thinkingMode: args.thinkingMode,
        language: project.defaultLanguage === "en" ? "en" : "he",
    });

    const fallbackDependencies = new Map<Id<"tasks">, Id<"tasks">[]>();
    if (sortedTasks.length > 1) {
        for (let i = 1; i < sortedTasks.length; i++) {
            fallbackDependencies.set(sortedTasks[i]._id, [sortedTasks[i - 1]._id]);
        }
    }

    const updates: Array<{
        taskId: Id<"tasks">;
        description?: string;
        estimatedHours?: number;
        dependencies?: Id<"tasks">[];
        steps?: string[];
        subtasks?: Array<{ title: string; done: boolean }>;
    }> = [];

    let resolvedDependencies = 0;
    for (const task of result.tasks) {
        const normalizedId = normalizeTempTaskId(task.id);
        const taskId =
            (normalizedId ? taskIdByTempId.get(normalizedId) : undefined) ??
            taskIdByTempId.get(task.id.trim()) ??
            taskIdByTitle.get(task.id.trim().toLowerCase());

        if (!taskId) continue;

        const depIds: Id<"tasks">[] = [];
        for (const depRaw of task.dependencies ?? []) {
            const candidates = extractTempIds(depRaw);
            const expanded = candidates.length > 0 ? candidates : [depRaw];
            for (const candidate of expanded) {
                const depNormalized = normalizeTempTaskId(candidate);
                const depId =
                    (depNormalized ? taskIdByTempId.get(depNormalized) : undefined) ??
                    taskIdByTempId.get(candidate.trim()) ??
                    taskIdByTitle.get(candidate.trim().toLowerCase());
                if (depId && depId !== taskId && !depIds.includes(depId)) depIds.push(depId);
            }
        }

        resolvedDependencies += depIds.length;

        updates.push({
            taskId,
            description: task.description?.trim() || undefined,
            estimatedHours: task.estimatedHours,
            dependencies: depIds,
            steps: task.steps?.map((step) => step.trim()).filter(Boolean),
            subtasks: task.subtasks
                ?.map((title) => title.trim())
                .filter(Boolean)
                .map((title) => ({ title, done: false })),
        });
    }

    if (resolvedDependencies === 0 && fallbackDependencies.size > 0) {
        for (const update of updates) {
            if ((update.dependencies ?? []).length > 0) continue;
            const fallback = fallbackDependencies.get(update.taskId);
            if (fallback) update.dependencies = fallback;
        }
    }

    await ctx.runMutation(internal.agents.taskRefiner.applyRefinements, { updates });

    return { updated: updates.length };
}

export const runInBackground: ReturnType<typeof internalAction> = internalAction({
    args: {
        projectId: v.id("projects"),
        agentRunId: v.optional(v.id("agentRuns")),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        if (args.agentRunId) {
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: args.agentRunId,
                status: "running",
                stage: "llm_call",
            });
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: args.agentRunId,
                level: "info",
                message: "Refining tasks with dependencies and estimates.",
                stage: "llm_call",
            });
        }

        try {
            const result = await executeRefinement(ctx, {
                projectId: args.projectId,
                thinkingMode: args.thinkingMode,
            });
            if (args.agentRunId) {
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId: args.agentRunId,
                    status: "succeeded",
                    stage: "done",
                });
            }
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (args.agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: args.agentRunId,
                    level: "error",
                    message,
                    stage: "failed",
                });
                await ctx.runMutation(internal.agentRuns.setStatus, {
                    runId: args.agentRunId,
                    status: "failed",
                    stage: "failed",
                    error: message,
                });
            }
            throw error;
        }
    },
});

export const run = action({
    args: {
        projectId: v.id("projects"),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const agentRunId = await ctx.runMutation(internal.agentRuns.createRun, {
            projectId: args.projectId,
            agent: "task_refiner",
            stage: "queued",
            initialMessage: "Queued task refinement.",
        }) as Id<"agentRuns">;

        await ctx.scheduler.runAfter(0, internal.agents.taskRefiner.runInBackground, {
            projectId: args.projectId,
            agentRunId,
            thinkingMode: args.thinkingMode,
        });

        return { queued: true, runId: agentRunId };
    },
});
