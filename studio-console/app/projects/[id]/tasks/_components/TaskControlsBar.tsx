import { Doc } from "../../../../../convex/_generated/dataModel";
import {
    TaskFilterField,
    TaskSortField,
    TaskSortOrder,
    buildFilterOptions,
} from "../taskViewShared";

export function InlineSelect({
    label,
    value,
    options,
    includeUnassigned,
    onChange,
    disabled,
}: {
    label: string;
    value: string;
    options: Array<string | { label: string; value: string }>;
    includeUnassigned?: boolean;
    onChange: (value: string) => void;
    disabled?: boolean;
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
                className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:bg-gray-100"
                disabled={disabled}
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


export function TaskControlsBar({
    sections,
    items,
    tasks,
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
    tasks: Array<Doc<"tasks">>;
    filterField: TaskFilterField;
    filterValue: string;
    onChangeFilterField: (field: TaskFilterField) => void;
    onChangeFilterValue: (value: string) => void;
    sortField: TaskSortField;
    sortOrder: TaskSortOrder;
    onChangeSortField: (field: TaskSortField) => void;
    onChangeSortOrder: (order: TaskSortOrder) => void;
    totalTasks: number;
}) {
    const filterOptions = buildFilterOptions({ filterField, sections, items, tasks });

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
                            { label: "Assignee", value: "assignee" },
                            { label: "Schedule", value: "date" },
                        ]}
                        onChange={(value) => onChangeFilterField(value as TaskFilterField)}
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
                            { label: "Start date", value: "startDate" },
                            { label: "End date", value: "endDate" },
                        ]}
                        onChange={(value) => onChangeSortField(value as TaskSortField)}
                    />
                    <InlineSelect
                        label="Order"
                        value={sortOrder}
                        options={[
                            { label: "Descending", value: "desc" },
                            { label: "Ascending", value: "asc" },
                        ]}
                        onChange={(value) => onChangeSortOrder(value as TaskSortOrder)}
                    />
                </div>
            </div>
        </div>
    );
}
