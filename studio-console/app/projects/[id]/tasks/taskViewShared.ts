import { useMemo } from "react";
import { TASK_STATUSES } from "../../../../convex/constants";
import { Doc } from "../../../../convex/_generated/dataModel";

export type KanbanColumn = {
    id: Doc<"tasks">["status"];
    title: string;
    color: string;
};

const STATUS_LABELS: Record<Doc<"tasks">["status"], string> = {
    todo: "To Do",
    in_progress: "In Progress",
    blocked: "Blocked",
    done: "Done",
};

const STATUS_COLORS: Record<Doc<"tasks">["status"], string> = {
    todo: "bg-gray-100",
    in_progress: "bg-blue-50",
    blocked: "bg-red-50",
    done: "bg-green-50",
};

export const KANBAN_COLUMNS: KanbanColumn[] = TASK_STATUSES.map((status) => ({
    id: status,
    title: STATUS_LABELS[status],
    color: STATUS_COLORS[status],
}));

export type TaskFilterField =
    | "none"
    | "section"
    | "item"
    | "priority"
    | "category"
    | "status"
    | "source"
    | "assignee"
    | "date";
export type TaskSortField =
    | "updatedAt"
    | "createdAt"
    | "priority"
    | "title"
    | "category"
    | "section"
    | "startDate"
    | "endDate";
export type TaskSortOrder = "asc" | "desc";

export function useFilteredSortedTasks({
    tasks,
    filterField,
    filterValue,
    sortField,
    sortOrder,
    sectionLabelById,
}: {
    tasks: Array<Doc<"tasks">> | undefined;
    filterField: TaskFilterField;
    filterValue: string;
    sortField: TaskSortField;
    sortOrder: TaskSortOrder;
    sectionLabelById: Map<string, string>;
}) {
    const filteredTasks = useMemo(() => {
        if (!tasks) return null;
        if (filterField === "none" || !filterValue) return tasks;

        if (filterField === "section") {
            if (filterValue === "unassigned") return tasks.filter((task) => !task.accountingSectionId);
            return tasks.filter((task) => task.accountingSectionId === filterValue);
        }

        if (filterField === "item") {
            if (filterValue === "unassigned") return tasks.filter((task) => !task.itemId);
            return tasks.filter((task) => task.itemId === filterValue);
        }

        if (filterField === "priority") return tasks.filter((task) => task.priority === filterValue);
        if (filterField === "category") return tasks.filter((task) => task.category === filterValue);
        if (filterField === "status") return tasks.filter((task) => task.status === filterValue);
        if (filterField === "source") return tasks.filter((task) => task.source === filterValue);
        if (filterField === "assignee") {
            if (filterValue === "unassigned") return tasks.filter((task) => !task.assignee);
            return tasks.filter((task) => task.assignee === filterValue);
        }
        if (filterField === "date") {
            if (filterValue === "scheduled") return tasks.filter((task) => task.startDate || task.endDate);
            if (filterValue === "unscheduled") return tasks.filter((task) => !task.startDate && !task.endDate);
        }

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
            if (sortField === "startDate") return ((a.startDate ?? 0) - (b.startDate ?? 0)) * factor;
            if (sortField === "endDate") return ((a.endDate ?? 0) - (b.endDate ?? 0)) * factor;
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
        (sortedTasks ?? []).forEach((task) => {
            grouped[task.status].push(task);
        });
        return grouped;
    }, [sortedTasks]);

    return { filteredTasks, sortedTasks, tasksByStatus };
}

export function buildFilterOptions({
    filterField,
    sections,
    items,
    tasks,
}: {
    filterField: TaskFilterField;
    sections: Doc<"sections">[];
    items: Array<Doc<"projectItems">>;
    tasks: Array<Doc<"tasks">>;
}) {
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
    if (filterField === "priority") {
        return [
            { label: "All", value: "" },
            { label: "High", value: "High" },
            { label: "Medium", value: "Medium" },
            { label: "Low", value: "Low" },
        ];
    }
    if (filterField === "category") {
        return [
            { label: "All", value: "" },
            { label: "Logistics", value: "Logistics" },
            { label: "Creative", value: "Creative" },
            { label: "Finance", value: "Finance" },
            { label: "Admin", value: "Admin" },
            { label: "Studio", value: "Studio" },
        ];
    }
    if (filterField === "status") return [{ label: "All", value: "" }, ...KANBAN_COLUMNS.map((col) => ({ label: col.title, value: col.id }))];
    if (filterField === "source") return [{ label: "All", value: "" }, { label: "AI generated", value: "agent" }, { label: "User task", value: "user" }];
    if (filterField === "assignee") {
        const assigneeValues = Array.from(new Set(tasks.map((task) => task.assignee).filter(Boolean))) as string[];
        return [
            { label: "All", value: "" },
            { label: "Unassigned", value: "unassigned" },
            ...assigneeValues.map((assignee) => ({ label: assignee, value: assignee })),
        ];
    }
    if (filterField === "date") {
        return [
            { label: "All", value: "" },
            { label: "Scheduled", value: "scheduled" },
            { label: "Unscheduled", value: "unscheduled" },
        ];
    }

    return [{ label: "All", value: "" }];
}

export const STATUS_COLOR_TOKENS = STATUS_COLORS;
