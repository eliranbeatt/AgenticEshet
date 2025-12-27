"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
    DndContext,
    DragEndEvent,
    DragStartEvent,
    PointerSensor,
    useSensor,
    useSensors,
    useDroppable,
    useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { TaskModal } from "./_components/TaskModal";
import { ChangeSetReviewBanner } from "../_components/changesets/ChangeSetReviewBanner";

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

type FilterField = "none" | "section" | "item" | "priority" | "category" | "status" | "source";
type SortField = "updatedAt" | "createdAt" | "priority" | "title" | "category" | "section";
type SortOrder = "asc" | "desc";

type AccountingSectionRow = {
    section: Doc<"sections">;
    materials: Doc<"materialLines">[];
    work: Doc<"workLines">[];
};

type AgentRun = {
    status: "queued" | "running" | "succeeded" | "failed";
};

const columns: { id: Doc<"tasks">["status"]; title: string; color: string }[] = [
    { id: "todo", title: "To Do", color: "bg-gray-100" },
    { id: "in_progress", title: "In Progress", color: "bg-blue-50" },
    { id: "blocked", title: "Blocked", color: "bg-red-50" },
    { id: "done", title: "Done", color: "bg-green-50" },
];

const categoryOptions: Doc<"tasks">["category"][] = ["Logistics", "Creative", "Finance", "Admin", "Studio"];
const priorityOptions: Doc<"tasks">["priority"][] = ["High", "Medium", "Low"];

export default function TasksPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

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
    const createTask = useMutation(api.tasks.createTask);
    const deleteTask = useMutation(api.tasks.deleteTask);
    const clearTasks = useMutation(api.tasks.clearTasks);
    const ensureTaskNumbers = useMutation(api.tasks.ensureTaskNumbers);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
    const [isGenerating, setIsGenerating] = useState(false);
    const [isRefining, setIsRefining] = useState(false);
    const [newTaskTitle, setNewTaskTitle] = useState("");
    const [filterField, setFilterField] = useState<FilterField>("none");
    const [filterValue, setFilterValue] = useState<string>("");
    const [sortField, setSortField] = useState<SortField>("updatedAt");
    const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
    const [activeTaskId, setActiveTaskId] = useState<Id<"tasks"> | null>(null);
    const [selectedTaskId, setSelectedTaskId] = useState<Id<"tasks"> | null>(null);

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

    const filteredTasks = useMemo(() => {
        if (!tasks) return null;
        if (filterField === "none" || !filterValue) return tasks;

        if (filterField === "section") {
            if (filterValue === "unassigned") return tasks.filter((task: Doc<"tasks">) => !task.accountingSectionId);
            return tasks.filter((task: Doc<"tasks">) => task.accountingSectionId === filterValue);
        }

        if (filterField === "item") {
            if (filterValue === "unassigned") return tasks.filter((task: Doc<"tasks">) => !task.itemId);
            return tasks.filter((task: Doc<"tasks">) => task.itemId === filterValue);
        }

        if (filterField === "priority") return tasks.filter((task: Doc<"tasks">) => task.priority === filterValue);
        if (filterField === "category") return tasks.filter((task: Doc<"tasks">) => task.category === filterValue);
        if (filterField === "status") return tasks.filter((task: Doc<"tasks">) => task.status === filterValue);
        if (filterField === "source") return tasks.filter((task: Doc<"tasks">) => task.source === filterValue);

        return tasks;
    }, [tasks, filterField, filterValue]);

    const sortedTasks = useMemo(() => {
        if (!filteredTasks) return null;

        const priorityRank: Record<Doc<"tasks">["priority"], number> = {
            High: 3,
            Medium: 2,
            Low: 1,
        };

        const factor = sortOrder === "asc" ? 1 : -1;
        const sorted = [...filteredTasks];
        sorted.sort((a, b) => {
            if (sortField === "priority") return (priorityRank[a.priority] - priorityRank[b.priority]) * factor;
            if (sortField === "title") return a.title.localeCompare(b.title) * factor;
            if (sortField === "category") return a.category.localeCompare(b.category) * factor;
            if (sortField === "createdAt") return ((a.createdAt ?? 0) - (b.createdAt ?? 0)) * factor;
            if (sortField === "updatedAt") return (a.updatedAt - b.updatedAt) * factor;
            if (sortField === "section") {
                const aLabel = a.accountingSectionId ? (sectionLabelById.get(a.accountingSectionId) ?? "") : "";
                const bLabel = b.accountingSectionId ? (sectionLabelById.get(b.accountingSectionId) ?? "") : "";
                return aLabel.localeCompare(bLabel) * factor;
            }
            return 0;
        });

        return sorted;
    }, [filteredTasks, sortField, sortOrder, sectionLabelById]);

    const tasksByStatus = useMemo(() => {
        const grouped: Record<Doc<"tasks">["status"], Doc<"tasks">[]> = {
            todo: [],
            in_progress: [],
            blocked: [],
            done: [],
        };
        (sortedTasks ?? []).forEach((task: Doc<"tasks">) => {
            grouped[task.status].push(task);
        });
        return grouped;
    }, [sortedTasks]);

    const handleAutoGenerate = async () => {
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

        await createTask({
            projectId,
            title: newTaskTitle,
            status: "todo",
            category: "Studio",
            priority: "Medium",
        });
        setNewTaskTitle("");
    };

    const handleDragStart = (event: DragStartEvent) => {
        const taskId = event.active.data.current?.taskId as Id<"tasks"> | undefined;
        setActiveTaskId(taskId ?? null);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const taskId = event.active.data.current?.taskId as Id<"tasks"> | undefined;
        const nextStatus = event.over?.id as Doc<"tasks">["status"] | undefined;
        setActiveTaskId(null);
        if (!taskId || !nextStatus) return;
        const task = tasks?.find((t: Doc<"tasks">) => t._id === taskId);
        if (!task || task.status === nextStatus) return;
        await updateTask({ taskId, status: nextStatus });
    };

    return (
        <div className="flex flex-col gap-6">
            <ChangeSetReviewBanner projectId={projectId} phase="tasks" />
            <div className="flex justify-between items-center flex-wrap gap-4">
                <form onSubmit={handleCreateManual} className="flex gap-2 w-full md:w-1/3 min-w-[260px]">
                    <input
                        type="text"
                        placeholder="Add quick task..."
                        className="flex-1 border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                    />
                    <button
                        type="submit"
                        className="bg-white border hover:bg-gray-50 text-gray-700 px-3 py-2 rounded text-sm font-medium"
                    >
                        Add
                    </button>
                </form>

                <button
                    onClick={handleAutoGenerate}
                    disabled={isGenerating || isRefiningActive}
                    className="bg-purple-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                >
                    {isGenerating ? "Thinking..." : "Auto-Generate from Plan"}
                </button>

                <button
                    onClick={handleRefineTasks}
                    disabled={isRefiningActive || isGenerating}
                    className={`bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 ${
                        isRefiningActive ? "animate-pulse" : ""
                    }`}
                >
                    {isRefiningActive ? "Refining..." : "Refine Tasks (Deps + Estimates)"}
                </button>

                <button
                    onClick={handleRegenerate}
                    disabled={isGenerating || isRefiningActive}
                    className="bg-red-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                >
                    {isGenerating ? "Thinking..." : "Regenerate (Clear & New)"}
                </button>
            </div>

            <TaskControlsBar
                sections={accountingSections.map((row) => row.section)}
                items={items}
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

            <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <div className="flex-1 overflow-x-auto">
                    <div className="flex gap-4 h-full min-w-max">
                        {columns.map((col) => (
                            <KanbanColumn
                                key={col.id}
                                column={col}
                                tasks={tasksByStatus[col.id]}
                                activeTaskId={activeTaskId}
                                onOpenTask={(taskId) => setSelectedTaskId(taskId)}
                                onUpdate={async (input) => {
                                    await updateTask(input);
                                }}
                                onDelete={async (input) => {
                                    await deleteTask(input);
                                }}
                                sections={accountingSections}
                                items={items}
                                sectionLabelById={sectionLabelById}
                                accountingItemById={accountingItemById}
                                taskNumberById={taskNumberById}
                            />
                        ))}
                    </div>
                </div>
            </DndContext>

            <SectionTaskPanel
                sections={accountingSections.map((row) => row.section)}
                tasks={tasks ?? []}
                sectionLabelById={sectionLabelById}
            />

            {selectedTask && (
                <TaskModal
                    key={selectedTask._id}
                    projectId={projectId}
                    task={selectedTask}
                    onClose={() => setSelectedTaskId(null)}
                />
            )}
        </div>
    );
}

function KanbanColumn({
    column,
    tasks,
    onOpenTask,
    onUpdate,
    onDelete,
    sections,
    items,
    sectionLabelById,
    accountingItemById,
    activeTaskId,
    taskNumberById,
}: {
    column: (typeof columns)[number];
    tasks: Doc<"tasks">[];
    onOpenTask: (taskId: Id<"tasks">) => void;
    onUpdate: (input: UpdateTaskInput) => Promise<void>;
    onDelete: (input: DeleteTaskInput) => Promise<void>;
    sections: AccountingSectionRow[];
    items: Array<Doc<"projectItems">>;
    sectionLabelById: Map<string, string>;
    accountingItemById: Map<string, { label: string; type: "material" | "work"; sectionId: Id<"sections"> }>;
    activeTaskId: Id<"tasks"> | null;
    taskNumberById: Map<Id<"tasks">, number>;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: column.id });
    return (
        <div
            ref={setNodeRef}
            className={`w-80 flex flex-col rounded-lg ${column.color} p-4 transition ${isOver ? "ring-2 ring-purple-400" : ""}`}
        >
            <h3 className="font-bold text-gray-700 mb-4 uppercase text-xs flex justify-between">
                {column.title}
                <span className="bg-white px-2 rounded-full text-gray-500">{tasks.length}</span>
            </h3>
            <div className="flex-1 overflow-y-auto space-y-3">
                {tasks.map((task) => (
                    <TaskCard
                        key={task._id}
                        task={task}
                        sections={sections}
                        items={items}
                        sectionLabelById={sectionLabelById}
                        accountingItemById={accountingItemById}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        onOpen={() => onOpenTask(task._id)}
                        isDragging={activeTaskId === task._id}
                        taskNumberById={taskNumberById}
                    />
                ))}
            </div>
        </div>
    );
}

function TaskCard({
    task,
    sections,
    items,
    sectionLabelById,
    accountingItemById,
    onUpdate,
    onDelete,
    onOpen,
    isDragging,
    taskNumberById,
}: {
    task: Doc<"tasks">;
    sections: AccountingSectionRow[];
    items: Array<Doc<"projectItems">>;
    sectionLabelById: Map<string, string>;
    accountingItemById: Map<string, { label: string; type: "material" | "work"; sectionId: Id<"sections"> }>;
    onUpdate: (input: UpdateTaskInput) => Promise<void>;
    onDelete: (input: DeleteTaskInput) => Promise<void>;
    onOpen: () => void;
    isDragging: boolean;
    taskNumberById: Map<Id<"tasks">, number>;
}) {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: task._id,
        data: { taskId: task._id },
    });
    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
    };

    const sectionLabel = task.accountingSectionId ? sectionLabelById.get(task.accountingSectionId) : null;
    const accountingItem = task.accountingLineId ? accountingItemById.get(task.accountingLineId) : null;
    const itemLabel = task.itemId ? items.find((item) => item._id === task.itemId)?.title ?? null : null;
    const accountingChipLabel = (() => {
        if (sectionLabel && accountingItem) return `Accounting: ${sectionLabel} / ${accountingItem.label}`;
        if (sectionLabel) return `Accounting: ${sectionLabel}`;
        return "Unassigned";
    })();

    const sectionOptions = (() => {
        const options = sections.map((row) => ({ label: `[${row.section.group}] ${row.section.name}`, value: row.section._id }));
        if (task.accountingSectionId && !options.some((option) => option.value === task.accountingSectionId)) {
            options.unshift({ label: "(Unknown section)", value: task.accountingSectionId });
        }
        return options;
    })();
    const itemOptions = (() => {
        if (!task.accountingSectionId) return [];
        const row = sections.find((s) => s.section._id === task.accountingSectionId);
        if (!row) return [];
        const options: Array<{ label: string; value: string }> = [];
        for (const material of row.materials) {
            options.push({ label: `Material: ${material.label}`, value: `material:${material._id}` });
        }
        for (const work of row.work) {
            options.push({ label: `Work: ${work.role}`, value: `work:${work._id}` });
        }
        return options;
    })();

    const itemValue = task.accountingLineId && task.accountingLineType ? `${task.accountingLineType}:${task.accountingLineId}` : "";
    const itemLinkOptions = items.map((item) => ({ label: item.title, value: item._id }));

    const dependencyText = task.dependencies && task.dependencies.length > 0
        ? "Requires: " + task.dependencies.map(id => "#" + (taskNumberById.get(id) ?? "?")).join(", ")
        : null;

    const durationText = task.estimatedDuration
        ? task.estimatedDuration >= 86400000
            ? `${(task.estimatedDuration / 86400000).toFixed(1)} days`
            : `${(task.estimatedDuration / 3600000).toFixed(1)} hours`
        : typeof task.estimatedMinutes === "number"
            ? `${(task.estimatedMinutes / 60).toFixed(1)} hours`
            : null;

    return (
        <div ref={setNodeRef} style={style} className="bg-white p-3 rounded shadow-sm border hover:shadow-md transition group relative">
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                    {task.taskNumber && <span className="text-xs font-mono text-gray-500">#{task.taskNumber}</span>}
                    <span
                        className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${
                            task.category === "Creative"
                                ? "bg-pink-50 text-pink-700 border-pink-200"
                                : task.category === "Logistics"
                                ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                : "bg-gray-50 text-gray-600 border-gray-200"
                        }`}
                    >
                        {task.category}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="text-xs text-blue-600 hover:text-blue-800"
                        onClick={onOpen}
                    >
                        Edit
                    </button>
                    <button
                        type="button"
                        className="text-gray-400 hover:text-gray-700"
                        {...listeners}
                        {...attributes}
                        aria-label="Drag task"
                    >
                        <GripVertical className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <p className="text-sm font-medium text-gray-800 mb-1">{task.title}</p>
            <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 mb-2">
                <span className="px-2 py-0.5 rounded-full bg-gray-100">{task.priority} priority</span>
                {durationText && <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{durationText}</span>}
                <span className="px-2 py-0.5 rounded-full bg-gray-100">{task.source === "agent" ? "AI generated" : "User task"}</span>
                <span className="px-2 py-0.5 rounded-full bg-gray-50">
                    {accountingChipLabel}
                </span>
                {itemLabel && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                        Element: {itemLabel}
                    </span>
                )}
            </div>
            {dependencyText && (
                <p className="text-[11px] text-gray-500 mb-2">
                    {dependencyText}
                </p>
            )}

            <div className="space-y-2 text-xs">
                <InlineSelect
                    label="Category"
                    value={task.category}
                    options={categoryOptions}
                    onChange={(value) => onUpdate({ taskId: task._id, category: value as Doc<"tasks">["category"] })}
                />
                <InlineSelect
                    label="Priority"
                    value={task.priority}
                    options={priorityOptions}
                    onChange={(value) => onUpdate({ taskId: task._id, priority: value as Doc<"tasks">["priority"] })}
                />
                <InlineSelect
                    label="Element"
                    value={task.itemId ?? ""}
                    options={itemLinkOptions}
                    includeUnassigned
                    onChange={(value) =>
                        onUpdate({
                            taskId: task._id,
                            itemId: value ? (value as Id<"projectItems">) : undefined,
                            itemSubtaskId: undefined,
                        })
                    }
                />
                <InlineSelect
                    label="Section"
                    value={task.accountingSectionId ?? ""}
                    options={sectionOptions}
                    includeUnassigned
                    onChange={(value) =>
                        onUpdate({
                            taskId: task._id,
                            accountingSectionId: value ? (value as Id<"sections">) : undefined,
                            accountingLineType: undefined,
                            accountingLineId: undefined,
                        })
                    }
                />
                <InlineSelect
                    label="Element"
                    value={itemValue}
                    options={itemOptions}
                    includeUnassigned
                    onChange={(value) => {
                        if (!value) {
                            onUpdate({
                                taskId: task._id,
                                accountingLineType: undefined,
                                accountingLineId: undefined,
                            });
                            return;
                        }
                        const [type, id] = value.split(":");
                        onUpdate({
                            taskId: task._id,
                            accountingSectionId: task.accountingSectionId,
                            accountingLineType: type as "material" | "work",
                            accountingLineId: id as Id<"materialLines"> | Id<"workLines">,
                        });
                    }}
                />
                <InlineSelect
                    label="Status"
                    value={task.status}
                    options={columns.map((col) => ({ label: col.title, value: col.id }))}
                    onChange={(value) =>
                        onUpdate({
                            taskId: task._id,
                            status: value as Doc<"tasks">["status"],
                        })
                    }
                />
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-100 mt-3">
                <button
                    onClick={() => {
                        if (confirm("Delete task?")) onDelete({ taskId: task._id });
                    }}
                    className="text-xs text-gray-400 hover:text-red-500"
                >
                    Delete
                </button>
            </div>
        </div>
    );
}

function InlineSelect({
    label,
    value,
    options,
    includeUnassigned,
    onChange,
}: {
    label: string;
    value: string;
    options: Array<string | { label: string; value: string }>;
    includeUnassigned?: boolean;
    onChange: (value: string) => void;
}) {
    const normalized = options.map((option) =>
        typeof option === "string" ? { label: option, value: option } : option,
    );

    return (
        <label className="flex flex-col gap-1 text-gray-600">
            <span className="text-[10px] uppercase tracking-wide">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
                {includeUnassigned && <option value="">Unassigned</option>}
                {normalized.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
}

function TaskControlsBar({
    sections,
    items,
    filterField,
    filterValue,
    onChangeFilterField,
    onChangeFilterValue,
    sortField,
    sortOrder,
    onChangeSortField,
    onChangeSortOrder,
    totalTasks,
}: {
    sections: Doc<"sections">[];
    items: Array<Doc<"projectItems">>;
    filterField: FilterField;
    filterValue: string;
    onChangeFilterField: (field: FilterField) => void;
    onChangeFilterValue: (value: string) => void;
    sortField: SortField;
    sortOrder: SortOrder;
    onChangeSortField: (field: SortField) => void;
    onChangeSortOrder: (order: SortOrder) => void;
    totalTasks: number;
}) {
    const filterOptions = (() => {
        if (filterField === "none") return [{ label: "All", value: "" }];
        if (filterField === "section") {
            return [
                { label: "All", value: "" },
                { label: "Unassigned", value: "unassigned" },
                ...sections.map((section) => ({ label: `[${section.group}] ${section.name}`, value: section._id })),
            ];
        }
        if (filterField === "item") {
            return [
                { label: "All", value: "" },
                { label: "Unassigned", value: "unassigned" },
                ...items.map((item) => ({ label: item.title, value: item._id })),
            ];
        }
        if (filterField === "priority") return [{ label: "All", value: "" }, ...priorityOptions.map((p) => ({ label: p, value: p }))];
        if (filterField === "category") return [{ label: "All", value: "" }, ...categoryOptions.map((c) => ({ label: c, value: c }))];
        if (filterField === "status") return [{ label: "All", value: "" }, ...columns.map((col) => ({ label: col.title, value: col.id }))];
        if (filterField === "source") return [{ label: "All", value: "" }, { label: "AI generated", value: "agent" }, { label: "User task", value: "user" }];
        return [];
    })();

    return (
        <div className="bg-white border rounded-lg p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center text-sm text-gray-500">
                <span>Filter & sort</span>
                <span>{totalTasks} tasks</span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
                <div className="flex gap-2 items-end">
                    <InlineSelect
                        label="Filter field"
                        value={filterField}
                        options={[
                            { label: "None", value: "none" },
                            { label: "Section", value: "section" },
                            { label: "Element", value: "item" },
                            { label: "Priority", value: "priority" },
                            { label: "Category", value: "category" },
                            { label: "Status", value: "status" },
                            { label: "Source", value: "source" },
                        ]}
                        onChange={(value) => onChangeFilterField(value as FilterField)}
                    />
                    <InlineSelect
                        label="Filter value"
                        value={filterValue}
                        options={filterOptions}
                        onChange={(value) => onChangeFilterValue(value)}
                    />
                </div>

                <div className="flex gap-2 items-end">
                    <InlineSelect
                        label="Sort field"
                        value={sortField}
                        options={[
                            { label: "Updated", value: "updatedAt" },
                            { label: "Created", value: "createdAt" },
                            { label: "Priority", value: "priority" },
                            { label: "Title", value: "title" },
                            { label: "Category", value: "category" },
                            { label: "Section", value: "section" },
                        ]}
                        onChange={(value) => onChangeSortField(value as SortField)}
                    />
                    <InlineSelect
                        label="Order"
                        value={sortOrder}
                        options={[
                            { label: "Descending", value: "desc" },
                            { label: "Ascending", value: "asc" },
                        ]}
                        onChange={(value) => onChangeSortOrder(value as SortOrder)}
                    />
                </div>
            </div>
        </div>
    );
}

function SectionTaskPanel({
    sections,
    tasks,
    sectionLabelById,
}: {
    sections: Doc<"sections">[];
    tasks: Doc<"tasks">[];
    sectionLabelById: Map<string, string>;
}) {
    if (sections.length === 0 && tasks.length === 0) {
        return null;
    }

    const unassignedTasks = tasks.filter((task) => !task.accountingSectionId);

    return (
        <div className="bg-white border rounded-lg p-6 space-y-4">
            <div>
                <h2 className="text-lg font-semibold text-gray-800">Tasks by Accounting Section</h2>
                <p className="text-sm text-gray-500">Group tasks by where they originated in Accounting.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                {sections.map((section) => {
                    const sectionTasks = tasks.filter((task) => task.accountingSectionId === section._id);
                    const label = sectionLabelById.get(section._id) ?? section.name;
                    return (
                        <div key={section._id} className="border rounded-lg p-4 space-y-3">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="font-semibold text-gray-800">{label}</p>
                                    <p className="text-xs text-gray-500">{sectionTasks.length} tasks</p>
                                </div>
                                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">Section</span>
                            </div>
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {sectionTasks.map((task) => (
                                    <SectionTaskRow key={task._id} task={task} />
                                ))}
                                {sectionTasks.length === 0 && (
                                    <p className="text-xs text-gray-400 text-center border border-dashed rounded py-4">
                                        No tasks linked yet
                                    </p>
                                )}
                            </div>
                        </div>
                    );
                })}

                <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="font-semibold text-gray-800">Unassigned</p>
                            <p className="text-xs text-gray-500">{unassignedTasks.length} tasks</p>
                        </div>
                        <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">Needs triage</span>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {unassignedTasks.map((task) => (
                            <SectionTaskRow key={task._id} task={task} />
                        ))}
                        {unassignedTasks.length === 0 && (
                            <p className="text-xs text-gray-400 text-center border border-dashed rounded py-4">
                                All tasks linked to sections
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function SectionTaskRow({ task }: { task: Doc<"tasks"> }) {
    const statusColors: Record<Doc<"tasks">["status"], string> = {
        todo: "bg-gray-300",
        in_progress: "bg-blue-400",
        blocked: "bg-red-400",
        done: "bg-green-500",
    };

    return (
        <div className="flex items-center gap-2 border rounded px-3 py-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${statusColors[task.status]}`}></span>
            <span className="flex-1 text-gray-800 truncate">{task.title}</span>
            <span className="text-xs text-gray-500">{task.priority}</span>
        </div>
    );
}
