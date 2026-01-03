import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { TASK_CATEGORIES } from "../../../../../convex/constants";
import { TaskCard } from "./TasksKanban";

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

export function TasksByCategory({
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
    // Group tasks by category
    const tasksByCategory = tasks.reduce((acc, task) => {
        const cat = task.category ?? "Studio"; // Default/Fallback
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(task);
        return acc;
    }, {} as Record<string, Doc<"tasks">[]>);

    return (
        <div className="flex gap-4 overflow-x-auto h-full pb-4">
            {TASK_CATEGORIES.map((category) => {
                const categoryTasks = tasksByCategory[category] || [];
                return (
                    <div key={category} className="min-w-[320px] max-w-[320px] flex flex-col bg-gray-50 rounded-lg p-4 h-full border">
                        <h3 className="font-bold text-gray-700 mb-4 uppercase text-xs flex justify-between items-center sticky top-0 bg-gray-50 z-10 py-2">
                            {category}
                            <span className="bg-white px-2 py-0.5 rounded-full text-gray-500 border text-[10px]">{categoryTasks.length}</span>
                        </h3>
                        <div className="flex-1 overflow-y-auto space-y-3">
                            {categoryTasks.map((task) => (
                                <TaskCard
                                    key={task._id}
                                    task={task}
                                    sections={sections}
                                    items={items}
                                    sectionLabelById={sectionLabelById}
                                    accountingItemById={accountingItemById}
                                    onUpdate={onUpdate}
                                    onDelete={onDelete}
                                    onOpenTask={onOpenTask}
                                    taskNumberById={taskNumberById}
                                    allowInlineEdits={allowInlineEdits}
                                    draftOnlyMode={draftOnlyMode}

                                />
                            ))}
                            {categoryTasks.length === 0 && (
                                <div className="text-center text-gray-400 text-sm py-4 italic">
                                    No tasks
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
