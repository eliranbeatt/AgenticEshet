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

export const saveTasks = internalMutation({
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

        const items: Doc<"projectItems">[] = [];
        for (const status of ["draft", "approved", "archived"] as const) {
            const batch = await ctx.db
                .query("projectItems")
                .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId).eq("status", status))
                .collect();
            items.push(...batch);
        }

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

        const itemTitleCounts = new Map<string, number>();
        for (const item of items) {
            const key = normalizeKey(item.title);
            itemTitleCounts.set(key, (itemTitleCounts.get(key) ?? 0) + 1);
        }

        const itemTitleLookupUnique = new Map<string, Id<"projectItems">>();
        for (const item of items) {
            const key = normalizeKey(item.title);
            if ((itemTitleCounts.get(key) ?? 0) === 1) {
                itemTitleLookupUnique.set(key, item._id);
            }
        }

        const resolveSectionId = (raw?: string) => {
            if (!raw) return undefined;
            const key = normalizeKey(raw);
            let match = sectionLookup.get(key) ?? sectionNameLookupUnique.get(key);

            if (!match) {
                // Fuzzy fallback: check if raw is contained in any section label or vice versa
                // e.g. "paint" matches "[Studio Elements] Paint"
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
            let match = itemTitleLookupUnique.get(key);
            if (!match) {
                for (const [titleKey, itemId] of itemTitleLookupUnique.entries()) {
                    if (titleKey.includes(key) || key.includes(titleKey)) {
                        match = itemId;
                        break;
                    }
                }
            }
            return match;
        };

        const normalizeTempTaskId = (raw: string | undefined) => {
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
        };

        const tempIdToDbId = new Map<string, Id<"tasks">>();

        for (let i = 0; i < tasks.length; i++) {
            const t = tasks[i];
            const normalizedTitle = t.title.trim().toLowerCase();
            const sectionId = resolveSectionId(t.accountingSectionName);
            const itemId = resolveItemId(t.itemTitle ?? undefined);

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
                const patch: Partial<Doc<"tasks">> = {
                    description: t.description,
                    category: t.category,
                    priority: t.priority,
                    accountingSectionId: sectionId,
                    accountingLineType,
                    accountingLineId,
                    estimatedDuration: t.estimatedDuration,
                };
                if (itemId) {
                    patch.itemId = itemId;
                }
                await ctx.db.patch(taskId, {
                    ...patch,
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
                    itemId,
                    accountingLineId,
                    status: "todo",
                    source: "agent",
                    taskNumber: currentTaskNumber,
                    estimatedDuration: t.estimatedDuration,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
                existingByTitle.set(normalizedTitle, { id: taskId, source: "agent" });
            } else {
                taskId = existingTask.id;
            }

            const normalizedTempId = normalizeTempTaskId(t.id);
            if (normalizedTempId) tempIdToDbId.set(normalizedTempId, taskId);
            if (t.id) tempIdToDbId.set(t.id.trim(), taskId);
        }

        for (let i = 0; i < tasks.length; i++) {
            const t = tasks[i];
            let currentDbId: Id<"tasks"> | undefined;
            if (t.id) {
                currentDbId =
                    tempIdToDbId.get(normalizeTempTaskId(t.id) ?? t.id.trim()) ??
                    tempIdToDbId.get(t.id.trim());
            }
            // Fallback (though schema requires ID)
            if (!currentDbId) {
                // Try to find it by re-resolving title if needed, or skip
                const existing = existingByTitle.get(t.title.trim().toLowerCase());
                if (existing) currentDbId = existing.id;
            }

            if (!currentDbId) continue;

            const depIds: Id<"tasks">[] = [];
            const desiredDependencies = t.dependencies ?? [];
            for (const depStringIdRaw of desiredDependencies) {
                const depStringId = depStringIdRaw.trim();
                if (!depStringId) continue;

                const candidates = [
                    depStringId,
                    depStringId.toUpperCase(),
                    normalizeTempTaskId(depStringId),
                ].filter((c): c is string => Boolean(c));

                let depDbId: Id<"tasks"> | undefined;
                for (const candidate of candidates) {
                    depDbId = tempIdToDbId.get(candidate);
                    if (depDbId) break;
                }

                // Fallback: if ID invalid, try matching by Title
                // (handles cases where LLM mistakenly uses Title as dependency ID)
                if (!depDbId) {
                    const existing = existingByTitle.get(depStringId.toLowerCase());
                    if (existing) depDbId = existing.id;
                }

                if (depDbId && depDbId !== currentDbId && !depIds.includes(depDbId)) depIds.push(depDbId);
            }

            await ctx.db.patch(currentDbId, { dependencies: depIds });
        }

        const taskSnapshot = await ctx.db
            .query("tasks")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();

        const taskText = taskSnapshot
            .map((task) => `- ${task.title} [${task.status}] (${task.category}/${task.priority}) ${task.description || ""}`)
            .join("\n");

        // Ingest task snapshot into knowledge base using public API
        await ctx.runAction(api.knowledge.ingestArtifact, {
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

            await ctx.runMutation(internal.agents.architect.saveTasks, {
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
