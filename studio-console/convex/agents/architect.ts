import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { callChatWithSchema } from "../lib/openai";
import { TaskBreakdownSchema } from "../lib/zodSchemas";
import { Id, type Doc } from "../_generated/dataModel";
import { queueTaskGeneration } from "../lib/architectTaskGeneration";

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

        const items: Doc<"projectItems">[] = [];
        for (const status of ["draft", "approved", "archived"] as const) {
            const batch = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", status))
                .collect();
            items.push(...batch);
        }

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
            items,
            knowledgeDocs,
            systemPrompt: skill?.content || "You are a Senior Solutions Architect.",
        };
    },
});

export const createChangeSet = internalMutation({
    args: {
        projectId: v.id("projects"),
        tasks: v.array(v.object({
            id: v.string(),
            title: v.string(),
            description: v.string(),
            category: v.union(v.literal("Logistics"), v.literal("Creative"), v.literal("Finance"), v.literal("Admin"), v.literal("Studio")),
            priority: v.union(v.literal("High"), v.literal("Medium"), v.literal("Low")),
            itemTitle: v.optional(v.union(v.string(), v.null())),
            accountingSectionName: v.optional(v.union(v.string(), v.null())),
            accountingItemLabel: v.optional(v.union(v.string(), v.null())),
            accountingItemType: v.optional(v.union(v.literal("material"), v.literal("work"), v.null())),
            dependencies: v.array(v.string()),
            estimatedHours: v.number(),
            questName: v.optional(v.string()),
        })),
    },
    handler: async (ctx, args) => {
        const project = await ctx.db.get(args.projectId);

        // Helper functions for matching
        function normalizeKey(value: string) {
            return value.trim().toLowerCase();
        }

        function normalizeTempTaskId(raw: string | undefined): string | null {
            if (!raw) return null;
            const trimmed = raw.trim();
            if (!trimmed) return null;

            const upper = trimmed.toUpperCase();
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

        const tasks = args.tasks.map((t) => ({
            ...t,
            accountingSectionName: t.accountingSectionName ?? undefined,
            accountingItemLabel: t.accountingItemLabel ?? undefined,
            accountingItemType: t.accountingItemType ?? undefined,
            estimatedDuration: t.estimatedHours ? t.estimatedHours * 60 * 60 * 1000 : undefined,
            questName: t.questName ?? undefined,
        }));

        const existingTasks = await ctx.db
            .query("tasks")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const existingByTitle = new Map<string, { id: Id<"tasks">; source: string }>(
            existingTasks.map((task) => [task.title.trim().toLowerCase(), { id: task._id, source: task.source }])
        );

        const sections = await ctx.db
            .query("sections")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        // Section & Item Resolution
        const sectionLookup = new Map<string, Id<"sections">>();
        for (const section of sections) {
            const display = `[${section.group}] ${section.name}`;
            sectionLookup.set(normalizeKey(display), section._id);
            sectionLookup.set(normalizeKey(section.name), section._id);
        }

        // Item Resolution
        const items = new Map<string, Id<"projectItems">>();
        const projectItems = await ctx.db
            .query("projectItems")
            .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", "approved"))
            .collect();
        for (const item of projectItems) {
            items.set(normalizeKey(item.title), item._id);
        }

        const resolveSectionId = (raw?: string) => {
            if (!raw) return undefined;
            const key = normalizeKey(raw);
            let match = sectionLookup.get(key);
            if (!match) {
                for (const [sKey, sId] of sectionLookup.entries()) {
                    if (sKey.includes(key) || key.includes(sKey)) {
                        match = sId;
                        break;
                    }
                }
            }
            return match;
        };

        const resolveItemId = (raw?: string) => {
            if (!raw) return undefined;
            const key = normalizeKey(raw);
            let match = items.get(key);
            if (!match) {
                for (const [iKey, iId] of items.entries()) {
                    if (iKey.includes(key) || key.includes(iKey)) {
                        match = iId;
                        break;
                    }
                }
            }
            return match;
        };

        const taskOps: any[] = [];
        const dependencyOps: any[] = [];

        // Create ChangeSet
        const changeSetId = await ctx.db.insert("itemChangeSets", {
            projectId: args.projectId,
            phase: "planning",
            agentName: "architect",
            status: "pending",
            title: `Architect Task Generation ${new Date().toISOString()}`,
            createdAt: Date.now(),
            basedOnBulletIds: [],
            basedOnApprovedSnapshotId: undefined,
            conflictsReferenced: [],
        });

        const tempIdToRef = new Map<string, string>(); // tempId -> tempId (identity for now)

        for (const t of tasks) {
            const normalizedTitle = t.title.trim().toLowerCase();
            const sectionId = resolveSectionId(t.accountingSectionName);
            const itemId = resolveItemId(t.itemTitle ?? undefined);
            const normalizedTempId = normalizeTempTaskId(t.id) ?? `T-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            // Map t.id to this normalizedTempId for dependency resolution
            if (t.id) tempIdToRef.set(t.id.trim(), normalizedTempId);
            if (normalizedTempId) tempIdToRef.set(normalizedTempId, normalizedTempId);

            const existingTask = existingByTitle.get(normalizedTitle);

            const tags = ["agent-architect"];
            if (t.questName) tags.push(`Quest:${t.questName}`);

            const payload = {
                tempId: normalizedTempId,
                itemRef: { itemId: itemId ?? null, itemTempId: null },
                title: t.title,
                description: t.description,
                status: "todo",
                category: t.category,
                priority: t.priority,
                tags,
                durationHours: t.estimatedHours,
                // Extra fields for logic not strictly in ChangeSet schema but might be needed
                // accountingSectionId: sectionId, 
                // We'll need to rely on the applier to handle these if we add them to schema or packed usage
            };

            if (existingTask) {
                // Patch
                taskOps.push({
                    projectId: args.projectId,
                    changeSetId,
                    entityType: "task",
                    opType: "patch",
                    targetId: existingTask.id,
                    payloadJson: JSON.stringify({
                        taskId: existingTask.id,
                        patch: {
                            description: t.description,
                            category: t.category,
                            priority: t.priority,
                            durationHours: t.estimatedHours,
                            tags
                        }
                    }),
                    createdAt: Date.now(),
                });
            } else {
                // Create
                taskOps.push({
                    projectId: args.projectId,
                    changeSetId,
                    entityType: "task",
                    opType: "create",
                    tempId: normalizedTempId,
                    payloadJson: JSON.stringify(payload),
                    createdAt: Date.now(),
                });
            }
        }

        // Dependencies
        for (const t of tasks) {
            const normalizedTempId = tempIdToRef.get(t.id.trim());
            if (!normalizedTempId) continue;

            for (const depRaw of t.dependencies) {
                const depTempId = tempIdToRef.get(depRaw.trim()) || normalizeTempTaskId(depRaw);
                // If it maps to a tempId in this set, link it
                if (depTempId) {
                    dependencyOps.push({
                        projectId: args.projectId,
                        changeSetId,
                        entityType: "dependency",
                        opType: "create",
                        payloadJson: JSON.stringify({
                            fromTaskRef: { taskTempId: depTempId },
                            toTaskRef: { taskTempId: normalizedTempId },
                            type: "finish_to_start",
                            lagHours: 0
                        }),
                        createdAt: Date.now(),
                    });
                } else {
                    // Try to match existing task by title? 
                    // For now, simpler to just skip if not found in batch or explicit ID
                }
            }
        }

        for (const op of taskOps) await ctx.db.insert("itemChangeSetOps", op);
        for (const op of dependencyOps) await ctx.db.insert("itemChangeSetOps", op);

        // Update changeset counts
        await ctx.db.patch(changeSetId, {
            counts: {
                tasks: taskOps.length,
                dependencies: dependencyOps.length
            }
        });
    },
});

// 2. AGENT ACTION
export const runInBackground: ReturnType<typeof internalAction> = internalAction({
    args: {
        projectId: v.id("projects"),
        agentRunId: v.optional(v.id("agentRuns")),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const agentRunId = args.agentRunId;

        // Fetch model configuration
        const settings = await ctx.runQuery(internal.settings.getAll);
        const model = settings.modelConfig?.tasks || "gpt-5.2";

        if (agentRunId) {
            await ctx.runMutation(internal.agentRuns.setStatus, {
                runId: agentRunId,
                status: "running",
                stage: "loading_context",
            });
            await ctx.runMutation(internal.agentRuns.appendEvent, {
                runId: agentRunId,
                level: "info",
                message: "Loading project context and plan.",
                stage: "loading_context",
            });
        }

        try {
            const { project, latestPlan, systemPrompt, sections, materialLines, workLines, existingTasks, items } = await ctx.runQuery(internal.agents.architect.getContext, {
                projectId: args.projectId,
            });

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: "Searching knowledge base for relevant context.",
                    stage: "knowledge_search",
                });
            }

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

            const itemsSummary = items.length
                ? items
                    .filter((item: Doc<"projectItems">) => item.status !== "archived")
                    .map((item: Doc<"projectItems">) => `- ${item.title} (${item.typeKey})`)
                    .join("\n")
                : "- No project items found. If a task cannot be linked, set itemTitle to null.";

            const userPrompt = `Project: ${project.name}
    
Plan Content:
${latestPlan.contentMarkdown}

Project Items (use exact titles when linking tasks via itemTitle):
${itemsSummary}

Accounting Sections (IMPORTANT: Use the exact label format "[Group] Name" when linking tasks):
${accountingSummary}

Existing Tasks (for deduplication):
${existingTaskSummary}

Knowledge Documents:
${knowledgeSummary}

Task: Break down this plan into actionable, atomic tasks. Focus on the immediate next steps implied by the plan.

REQUIRED: Dependencies & Estimations
1. **Dependencies**: 
   - You MUST assign a unique string 'id' (e.g. "T1", "T2", "T3") to EACH task you generate in this list.
   - Use these IDs in the 'dependencies' array to link tasks.
   - Example: If Task B depends on Task A, and Task A has id="T1", then Task B should have dependencies=["T1"].
   - A task cannot start until its dependencies are DONE. 
   - Use '[]' if it can start immediately. 
   - Reference ONLY tasks defined in this list (no forward references, no IDs from outside this list).
2. **Estimation**: You MUST provide 'estimatedHours' for every task. Be realistic. 
   - 1 hour = minor task
   - 4 hours = half day
   - 8 hours = full day
   - 40 hours = full week
   - This is critical for the Gantt chart.
3. **Accounting Linking**:
   - Try to link every task to an Accounting Section if possible. 
   - Use the exact string from the "Accounting Sections" list or a close match (e.g. "[Studio Elements] Paint").
   - If a specific material or work role applies, include it.
4. **Item Linking (preferred)**:
   - When possible, set itemTitle to the matching Project Item title (exact match preferred).
   - If no item is relevant, set itemTitle to null.

5. **Categories & Priorities (CRITICAL)**:
   - You MUST use exactly one of these categories: "Logistics", "Creative", "Finance", "Admin", "Studio".
   - You MUST use exactly one of these priorities: "High", "Medium", "Low".

6. **Quests (Grouping)**:
   - Group related tasks into "Quests" using the 'questName' field.
   - A Quest is a high-level objective or phase, e.g., "Venue Setup", "Catering", "Marketing Campaign".
   - Tasks within the same quest should share the same 'questName'.
   - If a task doesn't belong to a specific group, leave 'questName' undefined.

Dependency test checklist (do this before answering):
1) For each task, check if it relies on a previous task completing. Link it explicitly using definitions.
2) Ensure there are no cycles and no forward references.
3) Ensure at least some tasks have dependencies if the plan implies sequencing.
4) Verify all dependency IDs exist in your generated list.

When relevant, set accountingSectionName to one of the Accounting Sections above so tasks can be grouped and auto-linked. If a specific accounting item applies, set accountingItemType ("material" or "work") and accountingItemLabel exactly as shown in that section list; otherwise set them to null. Avoid duplicating tasks that already exist and update existing ones with refined descriptions if needed. Prioritize Hebrew wording that aligns with retrieved knowledge. Provide a 'logic' string explaining your reasoning before listing the tasks.`;

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: "Calling model to break down plan into tasks.",
                    stage: "llm_call",
                });
            }

            const result = await callChatWithSchema(TaskBreakdownSchema, {
                model,
                systemPrompt,
                userPrompt,
                thinkingMode: args.thinkingMode,
            });

            const normalizedTasks = result.tasks.map((task) => {
                const accountingSectionName = task.accountingSectionName?.trim();
                const accountingItemLabel = task.accountingItemLabel?.trim();
                const itemTitle = task.itemTitle?.trim();
                return {
                    ...task,
                    accountingSectionName: accountingSectionName && accountingSectionName.length > 0 ? accountingSectionName : undefined,
                    accountingItemLabel: accountingItemLabel && accountingItemLabel.length > 0 ? accountingItemLabel : undefined,
                    accountingItemType: task.accountingItemType ?? undefined,
                    itemTitle: itemTitle && itemTitle.length > 0 ? itemTitle : undefined,
                };
            });

            if (agentRunId) {
                await ctx.runMutation(internal.agentRuns.appendEvent, {
                    runId: agentRunId,
                    level: "info",
                    message: `Saving ${normalizedTasks.length} tasks to the database.`,
                    stage: "persisting",
                });
            }

            await ctx.runMutation(internal.agents.architect.createChangeSet, {
                projectId: args.projectId,
                tasks: normalizedTasks,
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

export const run: ReturnType<typeof action> = action({
    args: {
        projectId: v.id("projects"),
        thinkingMode: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        return await queueTaskGeneration(ctx, args.projectId, args.thinkingMode);
    },
});
