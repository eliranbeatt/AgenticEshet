import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { TaskCard, TaskCardProps } from "./TasksKanban";

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

export function TasksByElement({
    tasks,
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
}: {
    tasks: Doc<"tasks">[];
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
}) {
    // Group tasks by itemId
    const tasksByElement = tasks.reduce((acc, task) => {
        const key = task.itemId ? String(task.itemId) : "unassigned";
        if (!acc[key]) acc[key] = [];
        acc[key].push(task);
        return acc;
    }, {} as Record<string, Doc<"tasks">[]>);

    // Get all relevant elements (those with tasks) plus "Unassigned"
    const elementIdsWithTasks = Object.keys(tasksByElement);

    // Create a list of groups to render
    const groups = elementIdsWithTasks.map(id => {
        if (id === "unassigned") {
            return {
                id: "unassigned",
                title: "Unassigned Tasks",
                tasks: tasksByElement[id],
                sortKey: "zzz" // Put at bottom
            };
        }
        const item = items.find(i => String(i._id) === id);
        return {
            id,
            title: item?.title ?? "Unknown Element",
            tasks: tasksByElement[id],
            sortKey: item?.title ?? "zzz"
        };
    }).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    return (
        <div className="flex-1 overflow-x-auto h-full">
            <div className="flex gap-4 h-full min-w-max px-4 pb-4">
                {groups.map((group) => (
                    <ElementColumn
                        key={group.id}
                        title={group.title}
                        tasks={group.tasks}
                        onOpenTask={onOpenTask}
                        onUpdate={onUpdate}
                        onDelete={onDelete}
                        sections={sections}
                        items={items}
                        sectionLabelById={sectionLabelById}
                        accountingItemById={accountingItemById}
                        taskNumberById={taskNumberById}
                        allowInlineEdits={allowInlineEdits}
                        draftOnlyMode={draftOnlyMode}
                    />
                ))}
                {groups.length === 0 && (
                    <div className="text-center text-gray-500 mt-10 w-full">No tasks found.</div>
                )}
            </div>
        </div>
    );
}

// Omit task and isDragging since ElementColumn doesn't pass them to itself, but passes them to TaskCard children
type ElementColumnProps = Omit<TaskCardProps, "task" | "isDragging"> & {
    title: string;
    tasks: Doc<"tasks">[];
};

function ElementColumn({
    title,
    tasks,
    ...props
}: ElementColumnProps) {
    return (
        <div className="w-80 flex flex-col rounded-lg bg-gray-50 border border-gray-200 p-4 max-h-full shrink-0">
            <h3 className="font-bold text-gray-700 mb-4 uppercase text-xs flex justify-between items-center sticky top-0 bg-gray-50 z-10">
                <span className="truncate mr-2" title={title}>{title}</span>
                <span className="bg-white px-2 py-0.5 rounded-full text-gray-500 border text-[10px] shrink-0">{tasks.length}</span>
            </h3>
            <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
                {tasks.map((task) => (
                    <TaskCard
                        key={task._id}
                        task={task}
                        {...props}
                    />
                ))}
            </div>
        </div>
    );
}
