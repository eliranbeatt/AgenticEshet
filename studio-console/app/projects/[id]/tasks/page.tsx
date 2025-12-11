"use client";

import { useMemo, useState } from "react";
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

type UpdateTaskInput = {
    taskId: Id<"tasks">;
    title?: string;
    description?: string;
    status?: Doc<"tasks">["status"];
    category?: Doc<"tasks">["category"];
    priority?: Doc<"tasks">["priority"];
    questId?: Id<"quests">;
};

type DeleteTaskInput = {
    taskId: Id<"tasks">;
};

type QuestFilter = "all" | "unassigned" | Id<"quests">;

type QuestProgress = {
    questId: Id<"quests">;
    title: string;
    percent: number;
    done: number;
    total: number;
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

    const tasks = useQuery(api.tasks.listByProject, { projectId });
    const quests = useQuery(api.quests.list, { projectId });
    const questStats = useQuery(api.quests.getStats, { projectId });
    const runArchitect = useAction(api.agents.architect.run);
    const updateTask = useMutation(api.tasks.updateTask);
    const createTask = useMutation(api.tasks.createTask);
    const deleteTask = useMutation(api.tasks.deleteTask);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
    const [isGenerating, setIsGenerating] = useState(false);
    const [newTaskTitle, setNewTaskTitle] = useState("");
    const [questFilter, setQuestFilter] = useState<QuestFilter>("all");
    const [activeTaskId, setActiveTaskId] = useState<Id<"tasks"> | null>(null);

    const questProgress = useMemo<QuestProgress[]>(() => {
        if (!quests || !questStats) return [];
        return quests.map((quest: Doc<"quests">) => {
            const stat = questStats.find((s: { questId: Id<"quests">; percent: number; done: number; total: number }) => s.questId === quest._id);
            return {
                questId: quest._id,
                title: quest.title,
                percent: stat?.percent ?? 0,
                done: stat?.done ?? 0,
                total: stat?.total ?? 0,
            };
        });
    }, [quests, questStats]);

    const filteredTasks = useMemo(() => {
        if (!tasks) return null;
        if (questFilter === "all") return tasks;
        if (questFilter === "unassigned") return tasks.filter((task: Doc<"tasks">) => !task.questId);
        return tasks.filter((task: Doc<"tasks">) => task.questId === questFilter);
    }, [tasks, questFilter]);

    const tasksByStatus = useMemo(() => {
        const grouped: Record<Doc<"tasks">["status"], Doc<"tasks">[]> = {
            todo: [],
            in_progress: [],
            blocked: [],
            done: [],
        };
        (filteredTasks ?? []).forEach((task: Doc<"tasks">) => {
            grouped[task.status].push(task);
        });
        return grouped;
    }, [filteredTasks]);

    const handleAutoGenerate = async () => {
        setIsGenerating(true);
        try {
            await runArchitect({ projectId });
        } catch (err) {
            console.error(err);
            alert("Failed to generate tasks. Make sure a plan exists.");
        } finally {
            setIsGenerating(false);
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
                    disabled={isGenerating}
                    className="bg-purple-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                >
                    {isGenerating ? "Thinking..." : "Auto-Generate from Plan"}
                </button>
            </div>

            <QuestFilterBar
                quests={questProgress}
                selected={questFilter}
                onSelect={setQuestFilter}
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
                                onUpdate={async (input) => {
                                    await updateTask(input);
                                }}
                                onDelete={async (input) => {
                                    await deleteTask(input);
                                }}
                                quests={quests ?? []}
                            />
                        ))}
                    </div>
                </div>
            </DndContext>

            <QuestTaskPanel quests={questProgress} tasks={tasks ?? []} />
        </div>
    );
}

function KanbanColumn({
    column,
    tasks,
    onUpdate,
    onDelete,
    quests,
    activeTaskId,
}: {
    column: (typeof columns)[number];
    tasks: Doc<"tasks">[];
    onUpdate: (input: UpdateTaskInput) => Promise<void>;
    onDelete: (input: DeleteTaskInput) => Promise<void>;
    quests: Doc<"quests">[];
    activeTaskId: Id<"tasks"> | null;
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
                        quests={quests}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        isDragging={activeTaskId === task._id}
                    />
                ))}
            </div>
        </div>
    );
}

function TaskCard({
    task,
    quests,
    onUpdate,
    onDelete,
    isDragging,
}: {
    task: Doc<"tasks">;
    quests: Doc<"quests">[];
    onUpdate: (input: UpdateTaskInput) => Promise<void>;
    onDelete: (input: DeleteTaskInput) => Promise<void>;
    isDragging: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: task._id,
        data: { taskId: task._id },
    });
    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
    };

    const questLabel = task.questId ? quests.find((quest) => quest._id === task.questId)?.title : null;

    return (
        <div ref={setNodeRef} style={style} className="bg-white p-3 rounded shadow-sm border hover:shadow-md transition group relative">
            <div className="flex justify-between items-center mb-2">
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

            <p className="text-sm font-medium text-gray-800 mb-1">{task.title}</p>
            {task.description && <p className="text-xs text-gray-500 line-clamp-2 mb-2 whitespace-pre-line">{task.description}</p>}

            <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 mb-2">
                <span className="px-2 py-0.5 rounded-full bg-gray-100">{task.priority} priority</span>
                <span className="px-2 py-0.5 rounded-full bg-gray-100">{task.source === "agent" ? "AI generated" : "User task"}</span>
                <span className="px-2 py-0.5 rounded-full bg-gray-50">
                    {questLabel ? `Quest: ${questLabel}` : "Unassigned"}
                </span>
            </div>

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
                    label="Quest"
                    value={task.questId ?? ""}
                    options={quests.map((quest) => ({ label: quest.title, value: quest._id }))}
                    includeUnassigned
                    onChange={(value) =>
                        onUpdate({
                            taskId: task._id,
                            questId: value ? (value as Id<"quests">) : undefined,
                        })
                    }
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

function QuestFilterBar({
    quests,
    selected,
    onSelect,
    totalTasks,
}: {
    quests: QuestProgress[];
    selected: QuestFilter;
    onSelect: (filter: QuestFilter) => void;
    totalTasks: number;
}) {
    if (totalTasks === 0 && quests.length === 0) {
        return null;
    }

    return (
        <div className="bg-white border rounded-lg p-4 space-y-3">
            <div className="flex justify-between items-center text-sm text-gray-500">
                <span>Filter board by quest</span>
                <span>{totalTasks} tasks</span>
            </div>
            <div className="flex flex-wrap gap-2">
                <FilterChip label="All tasks" active={selected === "all"} onClick={() => onSelect("all")} />
                <FilterChip label="Unassigned" active={selected === "unassigned"} onClick={() => onSelect("unassigned")} />
                {quests.map((quest) => (
                    <FilterChip
                        key={quest.questId}
                        label={`${quest.title} (${quest.done}/${quest.total})`}
                        active={selected === quest.questId}
                        onClick={() => onSelect(quest.questId)}
                    />
                ))}
            </div>
        </div>
    );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`text-xs px-3 py-1.5 rounded-full border ${
                active ? "bg-purple-600 text-white border-purple-600" : "border-gray-200 text-gray-600 hover:border-purple-300"
            }`}
        >
            {label}
        </button>
    );
}

function QuestTaskPanel({ quests, tasks }: { quests: QuestProgress[]; tasks: Doc<"tasks">[] }) {
    if (quests.length === 0 && tasks.length === 0) {
        return null;
    }

    const unassignedTasks = tasks.filter((task) => !task.questId);

    return (
        <div className="bg-white border rounded-lg p-6 space-y-4">
            <div>
                <h2 className="text-lg font-semibold text-gray-800">Tasks by Quest</h2>
                <p className="text-sm text-gray-500">Review how each quest is progressing and spot gaps quickly.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                {quests.map((quest) => {
                    const questTasks = tasks.filter((task) => task.questId === quest.questId);
                    return (
                        <div key={quest.questId} className="border rounded-lg p-4 space-y-3">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="font-semibold text-gray-800">{quest.title}</p>
                                    <p className="text-xs text-gray-500">{questTasks.length} tasks</p>
                                </div>
                                <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">{quest.percent}%</span>
                            </div>
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {questTasks.map((task) => (
                                    <QuestTaskRow key={task._id} task={task} />
                                ))}
                                {questTasks.length === 0 && (
                                    <p className="text-xs text-gray-400 text-center border border-dashed rounded py-4">
                                        No tasks assigned yet
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
                            <QuestTaskRow key={task._id} task={task} />
                        ))}
                        {unassignedTasks.length === 0 && (
                            <p className="text-xs text-gray-400 text-center border border-dashed rounded py-4">
                                All tasks linked to quests
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function QuestTaskRow({ task }: { task: Doc<"tasks"> }) {
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
