"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { DragEndEvent } from "@dnd-kit/core";
import { TaskModal } from "./_components/TaskModal";
import { ChangeSetReviewBanner } from "../_components/changesets/ChangeSetReviewBanner";
import {
    TaskFilterField,
    TaskSortField,
    TaskSortOrder,
    useFilteredSortedTasks,
} from "./taskViewShared";
import { useSharedTaskUpdateAction } from "./useSharedTaskUpdate";
import { TasksKanban } from "./_components/TasksKanban";
import TasksGantt from "./_components/TasksGantt";
import { TasksByCategory } from "./_components/TasksByCategory";
import { TasksByElement } from "./_components/TasksByElement";
import { LayoutGrid, GanttChartSquare, Layers, Box, Settings, Trello, RefreshCw } from "lucide-react";
import { TaskControlsBar } from "./_components/TaskControlsBar";
import { TrelloConfigModal } from "./_components/TrelloConfigModal";

// Re-using types from TasksKanban or defining here
type UpdateTaskInput = {
    taskId: Id<"tasks">;
    title?: string;
    description?: string;
    status?: Doc<"tasks">["status"];
    category?: Doc<"tasks">["category"];
    priority?: Doc<"tasks">["priority"];
    accountingSectionId?: Id<"sections">;
    accountingLineType?: "material" | "work";
    accountingLineId?: Id<"materialLines"> | Id<"workLines">;
    itemId?: Id<"projectItems">;
    itemSubtaskId?: string;
};

type DeleteTaskInput = {
    taskId: Id<"tasks">;
};

type AccountingSectionRow = {
    section: Doc<"sections">;
    materials: Doc<"materialLines">[];
    work: Doc<"workLines">[];
};

type AgentRun = {
    status: "queued" | "running" | "succeeded" | "failed";
};

type ViewMode = "kanban" | "gantt" | "studio" | "elements";

export default function TasksPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    const project = useQuery(api.projects.getProject, { projectId });
    const tasks = useQuery(api.tasks.listByProject, { projectId }) as Array<Doc<"tasks">> | undefined;
    const accountingData = useQuery(api.accounting.getProjectAccounting, { projectId });
    const itemsData = useQuery(api.items.listSidebarTree, { projectId, includeDrafts: true });
    const taskRefinerRuns = useQuery(api.agentRuns.listByProject, {
        projectId,
        agent: "task_refiner",
        limit: 1,
    }) as AgentRun[] | undefined;
    const runArchitect = useAction(api.agents.architect.run);
    const runTaskRefiner = useAction(api.agents.taskRefiner.run);
    const updateTask = useMutation(api.tasks.updateTask);
    const applySharedUpdate = useSharedTaskUpdateAction();
    const createTask = useMutation(api.tasks.createTask);
    const deleteTask = useMutation(api.tasks.deleteTask);
    const clearTasks = useMutation(api.tasks.clearTasks);
    const ensureTaskNumbers = useMutation(api.tasks.ensureTaskNumbers);
    const createDraft = useMutation(api.revisions.createDraft);
    const approveDraft = useMutation(api.revisions.approve);
    const discardDraft = useMutation(api.revisions.discardDraft);
    const patchElement = useMutation(api.revisions.patchElement);
    const syncTrello = useAction(api.trelloActions.sync);

    const [isGenerating, setIsGenerating] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const [newTaskTitle, setNewTaskTitle] = useState("");
    const [filterField, setFilterField] = useState<TaskFilterField>("none");
    const [filterValue, setFilterValue] = useState<string>("");
    const [sortField, setSortField] = useState<TaskSortField>("updatedAt");
    const [sortOrder, setSortOrder] = useState<TaskSortOrder>("desc");
    const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [draftRevisionId, setDraftRevisionId] = useState<Id<"revisions"> | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>("kanban");

    const [showTrelloConfig, setShowTrelloConfig] = useState(false);
    const [isSyncingTrello, setIsSyncingTrello] = useState(false);

    const refinerStatus = taskRefinerRuns?.[0]?.status;
    const isRefinerActive = refinerStatus === "queued" || refinerStatus === "running";
    const isRefiningActive = isRefining || isRefinerActive;

    useEffect(() => {
        if (!tasks) return;
        if (tasks.length === 0) return;
        if (tasks.every((t: Doc<"tasks">) => !!t.taskNumber)) return;

        void ensureTaskNumbers({ projectId });
    }, [tasks, ensureTaskNumbers, projectId]);

    const accountingSections = useMemo<AccountingSectionRow[]>(() => {
        if (!accountingData?.sections) return [];
        return accountingData.sections as unknown as AccountingSectionRow[];
    }, [accountingData?.sections]);

    const items = useMemo(() => itemsData?.items ?? [], [itemsData?.items]);
    const elementsById = useMemo(() => new Map(items.map((item) => [String(item._id), item])), [items]);
    const elementsCanonical = project?.features?.elementsCanonical ?? false;
    const existingDraft = useQuery(
        api.revisions.getDraft,
        elementsCanonical ? { projectId, originTab: "Tasks" } : "skip"
    );
    const allowInlineEdits = !elementsCanonical || editMode;
    const draftOnlyMode = elementsCanonical && editMode;

    const sectionLabelById = useMemo(() => {
        const map = new Map<string, string>();
        for (const row of accountingSections) {
            map.set(row.section._id, `[${row.section.group}] ${row.section.name}`);
        }
        return map;
    }, [accountingSections]);

    const accountingItemById = useMemo(() => {
        const map = new Map<string, { label: string; type: "material" | "work"; sectionId: Id<"sections"> }>();
        for (const row of accountingSections) {
            for (const material of row.materials) {
                map.set(material._id, { label: material.label, type: "material", sectionId: row.section._id });
            }
            for (const work of row.work) {
                map.set(work._id, { label: work.role, type: "work", sectionId: row.section._id });
            }
        }
        return map;
    }, [accountingSections]);

    const taskNumberById = useMemo(() => {
        const map = new Map<Id<"tasks">, number>();
        if (tasks) {
            for (const t of tasks) {
                if (t.taskNumber) map.set(t._id, t.taskNumber);
            }
        }
        return map;
    }, [tasks]);

    const selectedTask = useMemo(() => {
        if (!tasks || !selectedTaskId) return null;
        return tasks.find((t) => t._id === selectedTaskId) ?? null;
    }, [selectedTaskId, tasks]);

    const taskKeyById = useMemo(() => {
        const map = new Map<string, string>();
        (tasks ?? []).forEach((task) => {
            if (task.itemSubtaskId && /^tsk_[a-f0-9]{8}$/.test(task.itemSubtaskId)) {
                map.set(String(task._id), task.itemSubtaskId);
            }
        });
        return map;
    }, [tasks]);

    const createTaskKey = () => {
        const suffix = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
        return `tsk_${suffix}`;
    };

    const isElementTaskKey = (value?: string | null) => Boolean(value && /^tsk_[a-f0-9]{8}$/.test(value));

    const buildTaskValue = (task: Doc<"tasks">) => {
        const taskKey = isElementTaskKey(task.itemSubtaskId) ? task.itemSubtaskId : createTaskKey();
        const dependencies = (task.dependencies ?? [])
            .map((id) => taskKeyById.get(String(id)))
            .filter((key): key is string => Boolean(key));
        return {
            taskKey,
            title: task.title,
            details: task.description ?? "",
            bucketKey: "general",
            taskType: "normal",
            estimate: "",
            dependencies,
            usesMaterialKeys: [],
            usesLaborKeys: [],
        };
    };

    const applyTaskPatch = async (task: Doc<"tasks">, updates: Partial<UpdateTaskInput>) => {
        if (!editMode || !draftRevisionId) return;
        const hasItemId = Object.prototype.hasOwnProperty.call(updates, "itemId");
        const hasItemSubtaskId = Object.prototype.hasOwnProperty.call(updates, "itemSubtaskId");
        const previousElementId = task.itemId;
        const nextElementId = hasItemId ? updates.itemId : task.itemId;
        const previousTaskKey = isElementTaskKey(task.itemSubtaskId) ? task.itemSubtaskId : undefined;
        const rawNextTaskKey = hasItemSubtaskId ? updates.itemSubtaskId : task.itemSubtaskId;
        const nextTaskKey = isElementTaskKey(rawNextTaskKey) ? rawNextTaskKey : undefined;

        if (previousElementId && previousElementId !== nextElementId && previousTaskKey) {
            const previousElement = elementsById.get(String(previousElementId));
            const baseVersionId = previousElement?.publishedVersionId ?? undefined;
            await patchElement({
                revisionId: draftRevisionId,
                elementId: previousElementId,
                baseVersionId,
                patchOps: [{ op: "remove_line", entity: "tasks", key: previousTaskKey, reason: "Moved task to another element" }],
            });
        }

        if (previousElementId && hasItemId && !nextElementId && previousTaskKey) {
            const previousElement = elementsById.get(String(previousElementId));
            const baseVersionId = previousElement?.publishedVersionId ?? undefined;
            await patchElement({
                revisionId: draftRevisionId,
                elementId: previousElementId,
                baseVersionId,
                patchOps: [{ op: "remove_line", entity: "tasks", key: previousTaskKey, reason: "Unlinked task from element" }],
            });
        }

        if (!nextElementId) return;
        if (!nextTaskKey) return;
        const element = elementsById.get(String(nextElementId));
        const baseVersionId = element?.publishedVersionId ?? undefined;
        const nextTask: Doc<"tasks"> = {
            ...task,
            ...updates,
            itemId: nextElementId,
            itemSubtaskId: nextTaskKey,
        };
        const value = buildTaskValue(nextTask);
        await patchElement({
            revisionId: draftRevisionId,
            elementId: nextElementId,
            baseVersionId,
            patchOps: [{ op: "upsert_line", entity: "tasks", key: value.taskKey, value }],
        });
    };

    const toggleEditMode = async () => {
        if (!elementsCanonical) return;
        if (!editMode) {
            if (existingDraft?._id) {
                setDraftRevisionId(existingDraft._id);
                setEditMode(true);
                return;
            }
            const result = await createDraft({
                projectId,
                originTab: "Tasks",
                actionType: "manual_edit",
                createdBy: "user",
            });
            setDraftRevisionId(result.revisionId);
            setEditMode(true);
            return;
        }
        setEditMode(false);
    };

    const handleApprove = async () => {
        if (!draftRevisionId) return;
        await approveDraft({ revisionId: draftRevisionId, approvedBy: "user" });
        setDraftRevisionId(null);
        setEditMode(false);
    };

    const handleDiscard = async () => {
        if (!draftRevisionId) return;
        await discardDraft({ revisionId: draftRevisionId });
        setDraftRevisionId(null);
        setEditMode(false);
    };

    const { filteredTasks, sortedTasks, tasksByStatus } = useFilteredSortedTasks({
        tasks,
        filterField,
        filterValue,
        sortField,
        sortOrder,
        sectionLabelById,
    });

    const handleAutoGenerate = async () => {
        if (draftOnlyMode) {
            alert("Auto-generation is disabled while editing a draft. Approve or discard the draft first.");
            return;
        }
        setIsGenerating(true);
        try {
            await runArchitect({ projectId });
            alert("Task generation started in the background. New tasks will appear shortly.");
        } catch (err) {
            console.error(err);
            alert("Failed to generate tasks. Make sure a plan exists.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleRegenerate = async () => {
        if (!confirm("Are you sure you want to delete all tasks and regenerate them? This cannot be undone.")) return;
        if (draftOnlyMode) {
            alert("Regeneration is disabled while editing a draft. Approve or discard the draft first.");
            return;
        }
        setIsGenerating(true);
        try {
            await clearTasks({ projectId });
            await runArchitect({ projectId });
            alert("Tasks cleared and regeneration started. New tasks will appear shortly.");
        } catch (err) {
            console.error(err);
            alert("Failed to regenerate tasks.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleRefineTasks = async () => {
        if (draftOnlyMode) {
            alert("Refinement is disabled while editing a draft. Approve or discard the draft first.");
            return;
        }
        if (!tasks || tasks.length === 0) {
            alert("No tasks to refine. Generate tasks first.");
            return;
        }
        setIsRefining(true);
        try {
            await runTaskRefiner({ projectId });
            alert("Task refinement started. Updates will appear shortly.");
        } catch (err) {
            console.error(err);
            alert("Failed to refine tasks.");
        } finally {
            setIsRefining(false);
        }
    };

    const handleCreateManual = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskTitle.trim()) return;
        if (!allowInlineEdits || draftOnlyMode) {
            alert("Enable draft editing to add tasks.");
            return;
        }

        await createTask({
            projectId,
            title: newTaskTitle,
            status: "todo",
            category: "Studio",
            priority: "Medium",
        });
        setNewTaskTitle("");
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const taskId = event.active.data.current?.taskId as Id<"tasks"> | undefined;
        const nextStatus = event.over?.id as Doc<"tasks">["status"] | undefined;
        if (!taskId || !nextStatus) return;
        if (!allowInlineEdits || draftOnlyMode) return;
        const task = tasks?.find((t: Doc<"tasks">) => t._id === taskId);
        if (!task || task.status === nextStatus) return;
        await applySharedUpdate({ taskId, status: nextStatus });
    };

    const handleTaskUpdate = async (input: UpdateTaskInput) => {
        if (!allowInlineEdits) {
            alert("Enable draft editing to change tasks.");
            return;
        }
        const task = tasks?.find((t: Doc<"tasks">) => t._id === input.taskId);
        if (!task) return;
        const hasItemId = Object.prototype.hasOwnProperty.call(input, "itemId");
        const nextElementId = hasItemId ? input.itemId : task.itemId;
        let nextTaskKey = isElementTaskKey(task.itemSubtaskId) ? task.itemSubtaskId : undefined;
        if (Object.prototype.hasOwnProperty.call(input, "itemSubtaskId")) {
            nextTaskKey = isElementTaskKey(input.itemSubtaskId) ? input.itemSubtaskId : undefined;
        }
        const updates: UpdateTaskInput = { ...input };
        if (editMode && draftRevisionId && nextElementId && !nextTaskKey) {
            nextTaskKey = createTaskKey();
            updates.itemSubtaskId = nextTaskKey;
        }
        if (draftOnlyMode) {
            await applyTaskPatch(task, updates);
            return;
        }
        await updateTask(updates);
    };

    const handleTaskDelete = async (input: DeleteTaskInput) => {
        if (!allowInlineEdits) {
            alert("Enable draft editing to delete tasks.");
            return;
        }
        const task = tasks?.find((t: Doc<"tasks">) => t._id === input.taskId);
        if (draftOnlyMode) {
            if (draftRevisionId && task?.itemId && isElementTaskKey(task.itemSubtaskId)) {
                const element = elementsById.get(String(task.itemId));
                const baseVersionId = element?.publishedVersionId ?? undefined;
                await patchElement({
                    revisionId: draftRevisionId,
                    elementId: task.itemId,
                    baseVersionId,
                    patchOps: [{ op: "remove_line", entity: "tasks", key: task.itemSubtaskId, reason: "User deleted task" }],
                });
            } else {
                alert("Draft deletes require a linked element task.");
            }
            return;
        }
        await deleteTask(input);
    };

    const renderView = () => {
        const commonProps = {
            tasks: sortedTasks ?? [], // Pass filtered and sorted tasks
            onOpenTask: (id: Id<"tasks">) => setSelectedTaskId(id),
            onUpdate: handleTaskUpdate,
            onDelete: handleTaskDelete,
            sections: accountingSections,
            items: items,
            sectionLabelById: sectionLabelById,
            accountingItemById: accountingItemById,
            taskNumberById: taskNumberById,
            allowInlineEdits: allowInlineEdits,
            draftOnlyMode: draftOnlyMode,
        };

        if (viewMode === "kanban") {
            return (
                <TasksKanban
                    {...commonProps}
                    tasksByStatus={tasksByStatus}
                    onDragEnd={handleDragEnd}
                />
            );
        }
        if (viewMode === "gantt") {
            // Gantt might need its own data fetching or just rendering
            return <TasksGantt />;
        }
        if (viewMode === "studio") {
            return <TasksByCategory {...commonProps} />;
        }
        if (viewMode === "elements") {
            return <TasksByElement {...commonProps} />;
        }
        return null;
    };

    const handleTrelloSync = async () => {
        setIsSyncingTrello(true);
        try {
            const res = await syncTrello({ projectId });
            const errors = res.errors.length > 0 ? `\nErrors: ${res.errors.length}` : "";
            alert(`Trello Sync Complete: ${res.syncedCount} tasks synced, ${res.archivedCount} archived.${errors}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            alert("Trello Sync Failed: " + msg);
        } finally {
            setIsSyncingTrello(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 h-full">
            <ChangeSetReviewBanner projectId={projectId} phase="tasks" />
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        <button
                            onClick={() => setViewMode("kanban")}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition ${viewMode === "kanban" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                        >
                            <LayoutGrid className="w-4 h-4" />
                            Kanban
                        </button>
                        <button
                            onClick={() => setViewMode("gantt")}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition ${viewMode === "gantt" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                        >
                            <GanttChartSquare className="w-4 h-4" />
                            Gantt
                        </button>
                        <button
                            onClick={() => setViewMode("studio")}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition ${viewMode === "studio" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                        >
                            <Layers className="w-4 h-4" />
                            Studio
                        </button>
                        <button
                            onClick={() => setViewMode("elements")}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition ${viewMode === "elements" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
                        >
                            <Box className="w-4 h-4" />
                            Elements
                        </button>
                    </div>

                    {/* Right side controls */}
                    <div className="flex items-center gap-2">
                        {elementsCanonical && (
                            <div className="flex items-center gap-2 text-sm mr-4">
                                <button
                                    onClick={() => void toggleEditMode()}
                                    className={`text-xs font-semibold px-3 py-1 rounded ${editMode ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-700"}`}
                                >
                                    {editMode ? "Draft editing on" : "Edit tasks"}
                                </button>
                                {editMode && (
                                    <>
                                        <button
                                            onClick={() => void handleApprove()}
                                            className="text-xs font-semibold px-3 py-1 rounded bg-green-600 text-white"
                                        >
                                            Approve
                                        </button>
                                        <button
                                            onClick={() => void handleDiscard()}
                                            className="text-xs font-semibold px-3 py-1 rounded bg-gray-200 text-gray-700"
                                        >
                                            Discard
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                        <form onSubmit={handleCreateManual} className="flex gap-2 min-w-[200px]">
                            <input
                                type="text"
                                placeholder="Add quick task..."
                                className="flex-1 border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100"
                                value={newTaskTitle}
                                onChange={(e) => setNewTaskTitle(e.target.value)}
                                disabled={!allowInlineEdits || draftOnlyMode}
                            />
                            <button
                                type="submit"
                                className="bg-white border hover:bg-gray-50 text-gray-700 px-3 py-2 rounded text-sm font-medium disabled:opacity-50"
                                disabled={!allowInlineEdits || draftOnlyMode}
                            >
                                Add
                            </button>
                        </form>
                        <button
                            onClick={handleAutoGenerate}
                            disabled={isGenerating || isRefiningActive || draftOnlyMode}
                            className="bg-purple-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50"
                            title="Auto-Generate from Plan"
                        >
                            {isGenerating ? "..." : "Auto-Gen"}
                        </button>

                        <div className="h-6 w-px bg-gray-300 mx-1" />

                        <button
                            onClick={handleTrelloSync}
                            disabled={isSyncingTrello}
                            className="flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            title="Sync to Trello"
                        >
                            {isSyncingTrello ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                                <Trello className="w-4 h-4" />
                            )}
                            <span className="hidden xl:inline">Sync Trello</span>
                        </button>

                        <button
                            onClick={() => setShowTrelloConfig(true)}
                            className="text-gray-500 hover:text-gray-700 p-2 rounded hover:bg-gray-100"
                            title="Trello Configuration"
                        >
                            <Settings className="w-5 h-5" />
                        </button>

                        <button
                            onClick={handleRefineTasks}
                            disabled={isRefiningActive || isGenerating || draftOnlyMode}
                            className={`bg-blue-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 ${isRefiningActive ? "animate-pulse" : ""
                                }`}
                            title="Refine Tasks (Deps + Estimates)"
                        >
                            {isRefiningActive ? "..." : "Refine"}
                        </button>
                    </div>
                </div>
            </div>

            <TaskControlsBar
                sections={accountingSections.map((row) => row.section)}
                items={items}
                tasks={tasks ?? []}
                filterField={filterField}
                filterValue={filterValue}
                onChangeFilterField={(next) => {
                    setFilterField(next);
                    setFilterValue("");
                }}
                onChangeFilterValue={setFilterValue}
                sortField={sortField}
                sortOrder={sortOrder}
                onChangeSortField={setSortField}
                onChangeSortOrder={setSortOrder}
                totalTasks={tasks?.length ?? 0}
            />

            <div className="flex-1 min-h-0">
                {renderView()}
            </div>

            {selectedTask && (
                <TaskModal
                    key={selectedTask._id}
                    projectId={projectId}
                    task={selectedTask}
                    onClose={() => setSelectedTaskId(null)}
                    elementsCanonical={elementsCanonical}
                    draftRevisionId={draftRevisionId}
                    elementsById={elementsById}
                />
            )}

            {showTrelloConfig && (
                <TrelloConfigModal
                    projectId={projectId}
                    onClose={() => setShowTrelloConfig(false)}
                />
            )}
        </div>
    );
}

