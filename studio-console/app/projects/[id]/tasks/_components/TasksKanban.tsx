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
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { KANBAN_COLUMNS, KanbanColumn as KanbanColumnType } from "../taskViewShared";
import { useState } from "react";
import clsx from "clsx";
import { InlineSelect } from "./TaskControlsBar";

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

export type TaskCardProps = {
    task: Doc<"tasks">;
    sections: any[];
    items: Array<Doc<"projectItems">>;
    sectionLabelById: Map<string, string>;
    accountingItemById: Map<string, { label: string; type: "material" | "work"; sectionId: Id<"sections"> }>;
    onUpdate: (input: UpdateTaskInput) => Promise<void>;
    onDelete: (input: DeleteTaskInput) => Promise<void>;
    onOpenTask: (taskId: Id<"tasks">) => void;
    taskNumberById: Map<Id<"tasks">, number>;
    allowInlineEdits: boolean;
    draftOnlyMode: boolean;
    isDragging?: boolean;
    // content props
    dragHandleProps?: any; // attributes + listeners
    dragRef?: (element: HTMLElement | null) => void;
    dragStyle?: React.CSSProperties;
};

export function TaskCard({
    task,
    sections,
    items,
    sectionLabelById,
    accountingItemById,
    onUpdate,
    onDelete,
    onOpenTask,
    taskNumberById,
    allowInlineEdits,
    draftOnlyMode,
    isDragging,
    dragHandleProps,
    dragRef,
    dragStyle,
}: TaskCardProps) {
    const sectionLabel = task.accountingSectionId ? sectionLabelById.get(task.accountingSectionId) : null;
    const accountingItem = task.accountingLineId ? accountingItemById.get(task.accountingLineId) : null;
    const itemLabel = task.itemId ? items.find((item) => item._id === task.itemId)?.title ?? null : null;
    const accountingChipLabel = (() => {
        if (sectionLabel && accountingItem) return `Accounting: ${sectionLabel} / ${accountingItem.label}`;
        if (sectionLabel) return `Accounting: ${sectionLabel}`;
        return "Unassigned";
    })();

    const itemLinkOptions = items.map((item) => ({ label: item.title, value: item._id }));
    const categoryOptions = ["Logistics", "Creative", "Finance", "Admin", "Studio"];
    const priorityOptions = ["High", "Medium", "Low"];

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
        <div ref={dragRef} style={dragStyle} className={clsx("bg-white p-3 rounded shadow-sm border hover:shadow-md transition group relative", isDragging && "opacity-50")}>
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                    {task.taskNumber && <span className="text-xs font-mono text-gray-500">#{task.taskNumber}</span>}
                    <span
                        className={clsx(
                            "text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border",
                            task.category === "Creative"
                                ? "bg-pink-50 text-pink-700 border-pink-200"
                                : task.category === "Logistics"
                                    ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                                    : "bg-gray-50 text-gray-600 border-gray-200"
                        )}
                    >
                        {task.category}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="text-xs text-blue-600 hover:text-blue-800"
                        onClick={() => {
                            if (!allowInlineEdits) {
                                alert("Enable draft editing to edit tasks.");
                                return;
                            }
                            onOpenTask(task._id);
                        }}
                        disabled={!allowInlineEdits}
                    >
                        Edit
                    </button>
                    {dragHandleProps && (
                        <button
                            type="button"
                            className="text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing"
                            {...dragHandleProps}
                            aria-label="Drag task"
                        >
                            <GripVertical className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            <p className="text-sm font-medium text-gray-800 mb-1">{task.title}</p>
            <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 mb-2">
                {task.priority && <span className="px-2 py-0.5 rounded-full bg-gray-100">{task.priority} priority</span>}
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
                    value={task.category ?? "Studio"}
                    options={categoryOptions}
                    disabled={!allowInlineEdits || draftOnlyMode}
                    onChange={(value) => onUpdate({ taskId: task._id, category: value as Doc<"tasks">["category"] })}
                />
                <InlineSelect
                    label="Priority"
                    value={task.priority ?? "Medium"}
                    options={priorityOptions}
                    disabled={!allowInlineEdits || draftOnlyMode}
                    onChange={(value) => onUpdate({ taskId: task._id, priority: value as Doc<"tasks">["priority"] })}
                />
                <InlineSelect
                    label="Element"
                    value={task.itemId ?? ""}
                    options={[{ label: "None", value: "" }, ...itemLinkOptions]}
                    disabled={!allowInlineEdits || draftOnlyMode}
                    onChange={(value) => onUpdate({ taskId: task._id, itemId: value ? value as Id<"projectItems"> : undefined })}
                />
            </div>
        </div>
    );
}

function DraggableTaskCard({
    task,
    isDragging,
    allowInlineEdits,
    draftOnlyMode,
    ...props
}: TaskCardProps) {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: task._id,
        data: { taskId: task._id },
        disabled: !allowInlineEdits || draftOnlyMode,
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
    };

    // Combine listeners and attributes for handle
    const handleProps = { ...listeners, ...attributes };

    return (
        <TaskCard
            task={task}
            allowInlineEdits={allowInlineEdits}
            draftOnlyMode={draftOnlyMode}
            isDragging={isDragging}
            dragRef={setNodeRef}
            dragStyle={style}
            dragHandleProps={handleProps}
            {...props}
        />
    );
}

// Omit 'task' from generic props to avoid conflicts and ensure it's passed explicitly in loop
type ColumnProps = Omit<TaskCardProps, "task" | "isDragging"> & {
    column: KanbanColumnType;
    tasks: Doc<"tasks">[];
    activeTaskId: Id<"tasks"> | null;
};

function KanbanColumn({
    column,
    tasks,
    activeTaskId,
    ...props
}: ColumnProps) {
    const { setNodeRef, isOver } = useDroppable({ id: column.id });
    return (
        <div
            ref={setNodeRef}
            className={clsx("w-80 flex flex-col rounded-lg p-4 transition", column.color, isOver && "ring-2 ring-purple-400")}
        >
            <h3 className="font-bold text-gray-700 mb-4 uppercase text-xs flex justify-between">
                {column.title}
                <span className="bg-white px-2 rounded-full text-gray-500">{tasks.length}</span>
            </h3>
            <div className="flex-1 overflow-y-auto space-y-3">
                {tasks.map((task) => (
                    <DraggableTaskCard
                        key={task._id}
                        task={task}
                        isDragging={activeTaskId === task._id}
                        {...props}
                    />
                ))}
            </div>
        </div>
    );
}

export function TasksKanban({
    tasksByStatus,
    onOpenTask,
    onUpdate,
    onDelete,
    sections,
    items,
    sectionLabelById,
    accountingItemById,
    taskNumberById,
    allowInlineEdits,
    draftOnlyMode,
    onDragEnd,
}: {
    tasksByStatus: Record<string, Doc<"tasks">[]>;
    onOpenTask: (taskId: Id<"tasks">) => void;
    onUpdate: (input: UpdateTaskInput) => Promise<void>;
    onDelete: (input: DeleteTaskInput) => Promise<void>;
    sections: any[];
    items: Array<Doc<"projectItems">>;
    sectionLabelById: Map<string, string>;
    accountingItemById: Map<string, { label: string; type: "material" | "work"; sectionId: Id<"sections"> }>;
    taskNumberById: Map<Id<"tasks">, number>;
    allowInlineEdits: boolean;
    draftOnlyMode: boolean;
    onDragEnd: (event: DragEndEvent) => Promise<void>;
}) {
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
    const [activeTaskId, setActiveTaskId] = useState<Id<"tasks"> | null>(null);

    const handleDragStart = (event: DragStartEvent) => {
        const taskId = event.active.data.current?.taskId as Id<"tasks"> | undefined;
        setActiveTaskId(taskId ?? null);
    };

    const handleDragEndInternal = async (event: DragEndEvent) => {
        setActiveTaskId(null);
        await onDragEnd(event);
    };

    const commonProps = {
        onOpenTask,
        onUpdate,
        onDelete,
        sections,
        items,
        sectionLabelById,
        accountingItemById,
        taskNumberById,
        allowInlineEdits,
        draftOnlyMode,
    };

    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEndInternal}>
            <div className="flex-1 overflow-x-auto h-full">
                <div className="flex gap-4 h-full min-w-max">
                    {KANBAN_COLUMNS.map((col) => (
                        <KanbanColumn
                            key={col.id}
                            column={col}
                            tasks={tasksByStatus[col.id] || []}
                            activeTaskId={activeTaskId}
                            {...commonProps}
                        />
                    ))}
                </div>
            </div>
        </DndContext>
    );
}
