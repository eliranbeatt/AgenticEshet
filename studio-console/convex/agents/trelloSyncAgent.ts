import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { TrelloOp, TrelloSyncPlan } from "../lib/trelloTypes";

const STATUS_LIST_NAMES: Record<string, string> = {
    todo: "To Do",
    in_progress: "In Progress",
    blocked: "Blocked",
    done: "Done",
};

const ESTIMATE_FIELD_NAME = "Estimate (hours)";
const SYNC_VERSION = 2;

type TaskDoc = Doc<"tasks"> & {
    workstream?: string;
    isManagement?: boolean;
    steps?: string[];
    subtasks?: Array<{ title: string; done: boolean }>;
    estimatedMinutes?: number | null;
    estimatedDuration?: number | null;
    startDate?: number | null;
    endDate?: number | null;
    assignee?: string | null;
};

type TrelloMappingDoc = Doc<"trelloMappings"> & {
    taskId: string;
    trelloCardId: string;
    trelloListId: string;
    contentHash: string;
};

function isTrelloId(value: string) {
    return /^[0-9a-f]{24}$/i.test(value);
}

function toIso(millis?: number | null) {
    if (!millis) return null;
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function safeVarFragment(raw: string) {
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return cleaned || "x";
}

function fnv1aHash(input: string) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildContentHash(task: TaskDoc) {
    const payload = {
        syncVersion: SYNC_VERSION,
        title: task.title ?? "",
        description: task.description ?? "",
        status: task.status ?? "",
        category: task.category ?? "",
        priority: task.priority ?? "",
        workstream: task.workstream ?? null,
        isManagement: task.isManagement ?? false,
        steps: task.steps ?? [],
        subtasks: (task.subtasks ?? []).map((item) => ({
            title: item.title ?? "",
            done: !!item.done,
        })),
        estimatedMinutes: task.estimatedMinutes ?? null,
        estimatedDuration: task.estimatedDuration ?? null,
        startDate: task.startDate ?? null,
        endDate: task.endDate ?? null,
        assignee: task.assignee ?? null,
    };

    return fnv1aHash(JSON.stringify(payload));
}

function estimateHours(task: TaskDoc) {
    if (typeof task.estimatedMinutes === "number" && Number.isFinite(task.estimatedMinutes)) {
        return Math.round((task.estimatedMinutes / 60) * 100) / 100;
    }
    if (typeof task.estimatedDuration === "number" && Number.isFinite(task.estimatedDuration)) {
        return Math.round((task.estimatedDuration / 3600000) * 100) / 100;
    }
    return null;
}

function buildLabelSpecs(task: TaskDoc) {
    const labels: Array<{ name: string; color?: string | null }> = [];

    if (task.category) labels.push({ name: `Category: ${task.category}`, color: "blue" });

    if (task.priority) {
        const priorityColor = task.priority === "High" ? "red" : task.priority === "Medium" ? "orange" : "green";
        labels.push({ name: `Priority: ${task.priority}`, color: priorityColor });
    }

    if (task.workstream) labels.push({ name: `Workstream: ${task.workstream}`, color: "purple" });
    if (task.isManagement) labels.push({ name: "Management", color: "black" });

    return labels;
}

export const generateTrelloSyncPlan = internalAction({
    args: {
        projectId: v.id("projects"),
        tasks: v.array(v.any()),
        trelloMappings: v.array(v.any()),
        trelloContext: v.object({
            boardId: v.string(),
            listsByStatus: v.optional(v.any()),
            labelsByName: v.optional(v.any()),
            customFieldsByName: v.optional(v.any()),
            memberIdByAssignee: v.optional(v.any()),
        }),
        config: v.optional(v.any()),
    },
    handler: async (_ctx, args) => {
        const tasks = args.tasks as TaskDoc[];
        const mappings = (args.trelloMappings as TrelloMappingDoc[]) ?? [];
        const mappingByTask = new Map(mappings.map((mapping) => [mapping.taskId, mapping]));

        const ensureOps: TrelloOp[] = [];
        const cardOps: TrelloOp[] = [];
        const checklistOps: TrelloOp[] = [];
        const customFieldOps: TrelloOp[] = [];
        const mappingUpserts: TrelloSyncPlan["mappingUpserts"] = [];
        const warnings: string[] = [];

        const listVars = new Map<string, string>();
        const labelVars = new Map<string, string>();
        const labelsToEnsure = new Map<string, { name: string; color?: string | null }>();
        const listsByStatus = (args.trelloContext.listsByStatus ?? {}) as Record<
            string,
            { id?: string; name?: string }
        >;
        const labelsByName = (args.trelloContext.labelsByName ?? {}) as Record<string, { id: string }>;
        const customFieldsByName = (args.trelloContext.customFieldsByName ?? {}) as Record<
            string,
            { id: string; type: string }
        >;

        const statusListOverrides = (args.config?.listNames ?? {}) as Record<string, string>;

        const needsEstimateField = tasks.some((task) => estimateHours(task) !== null);
        const estimateField = customFieldsByName[ESTIMATE_FIELD_NAME];
        const estimateFieldIdOrVar = estimateField?.id ? estimateField.id : "$cf.estimate_hours";

        if (needsEstimateField && !estimateField?.id) {
            ensureOps.push({
                opId: "cf_estimate_hours",
                op: "ENSURE_CUSTOM_FIELD",
                boardId: args.trelloContext.boardId,
                field: {
                    name: ESTIMATE_FIELD_NAME,
                    type: "number",
                    pos: "top",
                    displayOnCardFront: true,
                },
                setVar: "cf.estimate_hours",
            });
        }

        function resolveListRef(status: string) {
            const fromContext = listsByStatus[status]?.id;
            if (fromContext) return fromContext;

            const fromConfig = statusListOverrides[status];
            if (fromConfig && isTrelloId(fromConfig)) return fromConfig;

            const desiredName = fromConfig || STATUS_LIST_NAMES[status] || status;
            if (!listVars.has(status)) {
                const varName = `list.${safeVarFragment(status)}`;
                listVars.set(status, `$${varName}`);
                ensureOps.push({
                    opId: `list_${safeVarFragment(status)}`,
                    op: "ENSURE_LIST",
                    boardId: args.trelloContext.boardId,
                    list: { name: desiredName },
                    setVar: varName,
                });
            }

            return listVars.get(status) as string;
        }

        for (const task of tasks) {
            const labels = buildLabelSpecs(task);
            for (const label of labels) {
                if (!labelsByName[label.name]) {
                    labelsToEnsure.set(label.name, label);
                }
            }
        }

        for (const label of labelsToEnsure.values()) {
            const slug = safeVarFragment(label.name);
            if (labelVars.has(label.name)) continue;
            labelVars.set(label.name, `$label.${slug}`);
            ensureOps.push({
                opId: `label_${slug}`,
                op: "ENSURE_LABEL",
                boardId: args.trelloContext.boardId,
                label: {
                    name: label.name,
                    color: label.color ?? null,
                },
                setVar: `label.${slug}`,
            });
        }

        for (const task of tasks) {
            const mapping = mappingByTask.get(task._id);
            const contentHash = buildContentHash(task);

            const listIdRef = resolveListRef(task.status);

            const labelSpecs = buildLabelSpecs(task);
            const labelIds = labelSpecs
                .map((label) => labelsByName[label.name]?.id ?? labelVars.get(label.name))
                .filter((value): value is string => !!value);

            const start = toIso(task.startDate ?? null);
            const due = toIso(task.endDate ?? null);

            const cardVar = `card.${task._id}`;
            const cardOpId = `card_${safeVarFragment(task._id)}`;

            const cardOp: TrelloOp = {
                opId: cardOpId,
                op: "UPSERT_CARD",
                taskId: task._id,
                boardId: args.trelloContext.boardId,
                listId: listIdRef,
                card: {
                    id: mapping?.trelloCardId,
                    name: task.title,
                    desc: task.description ?? "",
                    start,
                    due,
                    labelIds: labelIds.length ? labelIds : undefined,
                },
                mode: "create_or_update",
                setVar: cardVar,
                contentHash,
            };

            cardOps.push(cardOp);

            mappingUpserts.push({
                taskId: task._id,
                trelloCardIdVarOrValue: `$${cardVar}`,
                trelloListIdVarOrValue: listIdRef,
                contentHash,
            });

            if (task.assignee) {
                const memberId = args.trelloContext.memberIdByAssignee?.[task.assignee];
                if (!memberId) {
                    warnings.push(
                        `Missing Trello member mapping for assignee "${task.assignee}" (task ${task._id}); skipping assignment.`
                    );
                }
            }

            const steps = (task.steps ?? []).filter((step) => step && step.trim().length > 0);
            if (steps.length) {
                const checklistVar = `chk.steps.${task._id}`;
                checklistOps.push({
                    opId: `chk_steps_${safeVarFragment(task._id)}`,
                    op: "ENSURE_CHECKLIST_ON_CARD",
                    cardId: `$${cardVar}`,
                    checklist: { name: "Steps" },
                    setVar: checklistVar,
                });
                checklistOps.push({
                    opId: `chk_steps_items_${safeVarFragment(task._id)}`,
                    op: "UPSERT_CHECKITEMS",
                    cardId: `$${cardVar}`,
                    checklistId: `$${checklistVar}`,
                    items: steps.map((name) => ({ name })),
                    mode: "merge_by_name",
                });
            }

            const subtasks = (task.subtasks ?? []).filter((item) => item && item.title);
            if (subtasks.length) {
                const checklistVar = `chk.subtasks.${task._id}`;
                checklistOps.push({
                    opId: `chk_subtasks_${safeVarFragment(task._id)}`,
                    op: "ENSURE_CHECKLIST_ON_CARD",
                    cardId: `$${cardVar}`,
                    checklist: { name: "Subtasks" },
                    setVar: checklistVar,
                });
                checklistOps.push({
                    opId: `chk_subtasks_items_${safeVarFragment(task._id)}`,
                    op: "UPSERT_CHECKITEMS",
                    cardId: `$${cardVar}`,
                    checklistId: `$${checklistVar}`,
                    items: subtasks.map((item) => ({ name: item.title, checked: item.done })),
                    mode: "merge_by_name",
                });
            }

            const estimate = estimateHours(task);
            if (estimate !== null) {
                customFieldOps.push({
                    opId: `cf_estimate_${safeVarFragment(task._id)}`,
                    op: "SET_CUSTOM_FIELD_NUMBER",
                    cardId: `$${cardVar}`,
                    customFieldId: estimateFieldIdOrVar,
                    value: estimate,
                });
            }
        }

        const operations = [...ensureOps, ...cardOps, ...checklistOps, ...customFieldOps];

        return {
            planVersion: "1.0",
            context: {
                projectId: args.projectId,
                targetBoardId: args.trelloContext.boardId,
            },
            warnings: warnings.length ? warnings : undefined,
            operations,
            mappingUpserts,
        };
    },
});
