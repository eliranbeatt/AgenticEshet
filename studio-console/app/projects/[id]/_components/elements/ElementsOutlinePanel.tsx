"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
    ChevronDown,
    ChevronRight,
    FileText,
    Folder,
    ListChecks,
    Pencil,
    Plus,
    Save,
    ShieldAlert,
    Trash2,
    X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useItemsContext } from "../items/ItemsContext";

import {
    createEmptyItemSpec,
    type ItemSpecV2,
    type LaborSpec,
    type MaterialSpec,
    type SubtaskSpec,
} from "../../../../../lib/items";
import { mergeItemSpec } from "../../../../../lib/itemsMerge";



type OutlineSectionKey =
    | "details"
    | "overview"
    | "configuration"
    | "tasks"
    | "budget"
    | "files"
    | "history"
    | "conflicts";

const SECTION_ORDER: Array<{ key: OutlineSectionKey; label: string; icon: React.ReactNode }> = [
    { key: "details", label: "Details", icon: <FileText size={14} /> },
    { key: "overview", label: "Overview", icon: <Folder size={14} /> },
    { key: "configuration", label: "Configuration", icon: <FileText size={14} /> },
    { key: "tasks", label: "Tasks", icon: <ListChecks size={14} /> },
    { key: "budget", label: "Budget", icon: <FileText size={14} /> },
    { key: "files", label: "Files", icon: <Folder size={14} /> },
    { key: "history", label: "History / Versions", icon: <FileText size={14} /> },
    { key: "conflicts", label: "Conflicts / Warnings", icon: <ShieldAlert size={14} /> },
];

const DEFAULT_EXPANDED: OutlineSectionKey[] = ["details", "overview", "tasks", "budget"];

type ItemDetails = {
    item: Doc<"projectItems">;
    tasks: Doc<"tasks">[];
    materialLines: Doc<"materialLines">[];
    workLines: Doc<"workLines">[];
    accountingLines: Doc<"accountingLines">[];
    revisions: Doc<"itemRevisions">[];
};

type DraftTask = {
    id: string;
    title: string;
    status: "todo" | "in_progress" | "done" | "blocked";
    estMinutes: string;
};

type DraftMaterial = {
    id: string;
    label: string;
    category: string;
    unit: string;
    qty: string;
    unitCostEstimate: string;
    status: string;
};

type DraftLabor = {
    id: string;
    role: string;
    workType: string;
    rateType: string;
    quantity: string;
    unitCost: string;
    description: string;
};

export function ElementsOutlinePanel() {
    const { projectId, selectedItemId } = useItemsContext();
    const [expandedSections, setExpandedSections] = useState<Set<OutlineSectionKey>>(
        () => new Set(DEFAULT_EXPANDED),
    );
    const [editingTask, setEditingTask] = useState<DraftTask | null>(null);
    const [editingMaterial, setEditingMaterial] = useState<DraftMaterial | null>(null);
    const [editingWork, setEditingWork] = useState<DraftLabor | null>(null);

    const details = useQuery(
        api.items.getItemDetails,
        selectedItemId ? { itemId: selectedItemId } : "skip",
    ) as ItemDetails | null | undefined;
    const draftData = useQuery(
        api.elementDrafts.get,
        selectedItemId ? { projectId, elementId: selectedItemId } : "skip",
    );
    const upsertDraft = useMutation(api.elementDrafts.upsert);

    const content = useMemo(() => {
        if (!details) return null;
        return details;
    }, [details]);

    const revisions = content?.revisions ?? [];
    const approvedRevision = useMemo(() => {
        if (!content?.item.approvedRevisionId) return null;
        return revisions.find((rev) => rev._id === content.item.approvedRevisionId) ?? null;
    }, [content?.item.approvedRevisionId, revisions]);

    const baseSpec = useMemo<ItemSpecV2 | null>(() => {
        if (!content) return null;
        const base = createEmptyItemSpec(content.item.title, content.item.typeKey);
        const sourceSpec = (draftData?.data ?? approvedRevision?.data) as ItemSpecV2 | undefined;
        return sourceSpec ? mergeItemSpec(base, sourceSpec) : base;
    }, [approvedRevision?.data, content, draftData?.data]);

    const [localSpec, setLocalSpec] = useState<ItemSpecV2 | null>(null);
    const [isSavingDraft, setIsSavingDraft] = useState(false);

    const lastElementIdRef = useRef<string | null>(null);

    useEffect(() => {
        const nextId = selectedItemId ? String(selectedItemId) : null;
        if (!baseSpec) {
            setLocalSpec(null);
            lastElementIdRef.current = nextId;
            return;
        }
        if (lastElementIdRef.current !== nextId) {
            setLocalSpec(baseSpec);
            lastElementIdRef.current = nextId;
            return;
        }
        if (!localSpec) {
            setLocalSpec(baseSpec);
        }
    }, [baseSpec, localSpec, selectedItemId]);

    const viewSpec = localSpec ?? baseSpec;
    const subtasks = viewSpec?.breakdown.subtasks ?? [];
    const materials = viewSpec?.breakdown.materials ?? [];
    const labor = viewSpec?.breakdown.labor ?? [];

    const baseSpecString = useMemo(() => (baseSpec ? JSON.stringify(baseSpec) : ""), [baseSpec]);
    const localSpecString = useMemo(() => (localSpec ? JSON.stringify(localSpec) : ""), [localSpec]);
    const isDirty = Boolean(localSpec && baseSpec && localSpecString !== baseSpecString);

    const taskStats = useMemo(() => {
        const flat = flattenSubtasks(subtasks);
        const blocked = flat.filter((task) => task.status === "blocked").length;
        const done = flat.filter((task) => task.status === "done").length;
        return { total: flat.length, blocked, done };
    }, [subtasks]);

    const budgetStats = useMemo(() => {
        const materialTotal = materials.reduce(
            (sum, line) => sum + (line.qty ?? 0) * (line.unitCostEstimate ?? 0),
            0,
        );
        const laborTotal = labor.reduce(
            (sum, line) => sum + (line.quantity ?? 0) * (line.unitCost ?? 0),
            0,
        );
        return {
            materialTotal,
            laborTotal,
            materialCount: materials.length,
            laborCount: labor.length,
        };
    }, [labor, materials]);

    const toggleSection = (key: OutlineSectionKey) => {
        setExpandedSections((prev) => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    const expandAll = () => {
        setExpandedSections(new Set(SECTION_ORDER.map((s) => s.key)));
    };

    const collapseAll = () => {
        setExpandedSections(new Set());
    };

    const startEditTask = (task: SubtaskSpec) => {
        setEditingTask({
            id: task.id,
            title: task.title,
            status: (task.status as "todo" | "in_progress" | "done" | "blocked") ?? "todo",
            estMinutes: task.estMinutes?.toString() ?? "",
        });
    };

    const startEditMaterial = (line: MaterialSpec) => {
        setEditingMaterial({
            id: line.id,
            label: line.label,
            category: line.category ?? "",
            unit: line.unit ?? "",
            qty: line.qty?.toString() ?? "",
            unitCostEstimate: line.unitCostEstimate?.toString() ?? "",
            status: line.status ?? "",
        });
    };

    const startEditWork = (line: LaborSpec) => {
        setEditingWork({
            id: line.id,
            role: line.role,
            workType: line.workType,
            rateType: line.rateType,
            quantity: line.quantity?.toString() ?? "",
            unitCost: line.unitCost?.toString() ?? "",
            description: line.description ?? "",
        });
    };

    const saveDraftSpec = async (nextSpec: ItemSpecV2) => {
        if (!selectedItemId) return;
        setIsSavingDraft(true);
        try {
            await upsertDraft({
                projectId,
                elementId: selectedItemId,
                data: nextSpec,
            });
        } finally {
            setIsSavingDraft(false);
        }
    };

    const updateLocalSpec = (updater: (spec: ItemSpecV2) => ItemSpecV2) => {
        setLocalSpec((prev) => {
            const base = prev ?? baseSpec;
            if (!base) return prev;
            return updater(base);
        });
    };

    const visibleSubtasks = useMemo(() => {
        if (!viewSpec) return [];
        if (!editingTask) return viewSpec.breakdown.subtasks;
        if (viewSpec.breakdown.subtasks.some((entry) => entry.id === editingTask.id)) {
            return viewSpec.breakdown.subtasks;
        }
        return [draftToSubtask(editingTask), ...viewSpec.breakdown.subtasks];
    }, [editingTask, viewSpec]);

    const visibleMaterials = useMemo(() => {
        if (!viewSpec) return [];
        if (!editingMaterial) return viewSpec.breakdown.materials;
        if (viewSpec.breakdown.materials.some((entry) => entry.id === editingMaterial.id)) {
            return viewSpec.breakdown.materials;
        }
        return [draftToMaterial(editingMaterial), ...viewSpec.breakdown.materials];
    }, [editingMaterial, viewSpec]);

    const visibleLabor = useMemo(() => {
        if (!viewSpec) return [];
        if (!editingWork) return viewSpec.breakdown.labor;
        if (viewSpec.breakdown.labor.some((entry) => entry.id === editingWork.id)) {
            return viewSpec.breakdown.labor;
        }
        return [draftToLabor(editingWork), ...viewSpec.breakdown.labor];
    }, [editingWork, viewSpec]);

    if (!selectedItemId) {
        return (
            <div className="bg-white border rounded-lg shadow-sm p-6 text-center text-sm text-gray-400 h-full flex flex-col justify-center items-center">
                <div className="font-semibold text-gray-500">Element Explorer</div>
                <div className="text-xs">Select an element on the left to view its outline.</div>
            </div>
        );
    }

    if (!content) {
        return (
            <div className="bg-white border rounded-lg shadow-sm p-6 text-center text-sm text-gray-400 h-full flex flex-col justify-center items-center">
                <div className="font-semibold text-gray-500">Loading element...</div>
                <div className="text-xs">Fetching outline data.</div>
            </div>
        );
    }


    const detailsSummary = (
        <div className="flex flex-wrap gap-2">
            <SummaryChip label={draftData ? "Draft saved" : "No draft"} />
            <SummaryChip label="Approve to publish" />
        </div>
    );

    const overviewSummary = (
        <div className="flex flex-wrap gap-2">
            <SummaryChip label={content.item.status} />
            <SummaryChip label={`${taskStats.total} tasks`} />
            <SummaryChip label={`${budgetStats.materialCount + budgetStats.laborCount} cost lines`} />
        </div>
    );

    const configurationSummary = (
        <div className="flex flex-wrap gap-2">
            <SummaryChip label={content.item.typeKey} />
            {content.item.category && <SummaryChip label={content.item.category} />}
            {content.item.flags?.requiresPurchase && <SummaryChip label="Purchases" />}
            {content.item.flags?.requiresStudio && <SummaryChip label="Studio" />}
        </div>
    );

    const taskSummary = (
        <div className="flex flex-wrap gap-2">
            <SummaryChip label={`${taskStats.total} total`} />
            {taskStats.blocked > 0 && <SummaryChip label={`${taskStats.blocked} blocked`} tone="warning" />}
            {taskStats.done > 0 && <SummaryChip label={`${taskStats.done} done`} tone="success" />}
        </div>
    );

    const budgetSummary = (
        <div className="flex flex-wrap gap-2">
            <SummaryChip label={`${budgetStats.materialCount} materials`} />
            <SummaryChip label={`${budgetStats.laborCount} labor`} />
        </div>
    );

    const filesSummary = <SummaryChip label="No files" />;
    const historySummary = <SummaryChip label={`${revisions.length} revisions`} />;
    const conflictsSummary = <SummaryChip label="0 conflicts" tone="success" />;

    return (
        <div className="bg-white border rounded-lg shadow-sm flex flex-col h-full overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50/70 flex justify-between items-start">
                <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Outline</div>
                    <div className="text-lg font-semibold text-gray-900 truncate">
                        {content.item.title}
                    </div>
                    <div className="text-xs text-gray-500">
                        {content.item.typeKey} - {content.item.status}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 flex-none ml-4 items-center">
                    {isDirty && (
                        <span className="text-[10px] uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                            Unsaved changes
                        </span>
                    )}
                    <button
                        onClick={async () => {
                            if (!viewSpec) return;
                            await saveDraftSpec(viewSpec);
                        }}
                        disabled={!isDirty || isSavingDraft}
                        className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded shadow-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isSavingDraft ? "Saving..." : "Save element draft"}
                    </button>
                    <button
                        onClick={expandAll}
                        className="text-xs px-2 py-1 bg-white border rounded shadow-sm hover:bg-gray-50 text-gray-600 font-medium"
                    >
                        Expand All
                    </button>
                    <button
                        onClick={collapseAll}
                        className="text-xs px-2 py-1 bg-white border rounded shadow-sm hover:bg-gray-50 text-gray-600 font-medium"
                    >
                        Collapse All
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {SECTION_ORDER.map(({ key, label, icon }) => {
                    const isOpen = expandedSections.has(key);
                    let summary: React.ReactNode = null;
                    let body: React.ReactNode = null;

                    if (key === "details") {
                        summary = detailsSummary;
                        body = (
                            <div className="space-y-3">
                                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                                    <div className="text-gray-500 font-medium">Title</div>
                                    <div className="text-gray-900 font-semibold">{content.item.title}</div>

                                    <div className="text-gray-500 font-medium">Type</div>
                                    <div className="text-gray-900">{content.item.typeKey}</div>

                                    <div className="text-gray-500 font-medium">Status</div>
                                    <div className="text-gray-900">
                                        <SummaryChip label={content.item.status} tone={content.item.status === "approved" ? "success" : "default"} />
                                    </div>

                                    <div className="text-gray-500 font-medium">Updated</div>
                                    <div className="text-gray-900">{new Date(content.item.updatedAt).toLocaleString()}</div>
                                </div>

                                {content.item.description ? (
                                    <div className="bg-gray-50 p-2 rounded text-sm text-gray-700 whitespace-pre-wrap border border-gray-100">
                                        {content.item.description}
                                    </div>
                                ) : (
                                    <div className="text-xs text-gray-400 italic">No description provided.</div>
                                )}
                            </div>
                        );
                    }

                    if (key === "overview") {
                        summary = overviewSummary;
                        body = (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <SummaryCard title="Status" value={content.item.status} />
                                <SummaryCard title="Tasks" value={`${taskStats.done}/${taskStats.total} done`} />
                                <SummaryCard
                                    title="Materials (planned)"
                                    value={formatCurrency(budgetStats.materialTotal, "ILS")}
                                />
                                <SummaryCard
                                    title="Labor (planned)"
                                    value={formatCurrency(budgetStats.laborTotal, "ILS")}
                                />
                            </div>
                        );
                    }

                    if (key === "configuration") {
                        summary = configurationSummary;
                        body = (
                            <div className="space-y-3 text-sm text-gray-700">
                                <div>
                                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                        Type
                                    </div>
                                    <div className="mt-1">{content.item.typeKey}</div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                        Constraints
                                    </div>
                                    <div className="mt-1 text-xs text-gray-500">
                                        {content.item.scope?.constraints?.length
                                            ? content.item.scope?.constraints.join(", ")
                                            : "No constraints listed."}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                        Assumptions
                                    </div>
                                    <div className="mt-1 text-xs text-gray-500">
                                        {content.item.scope?.assumptions?.length
                                            ? content.item.scope?.assumptions.join(", ")
                                            : "No assumptions listed."}
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    if (key === "tasks") {
                        summary = taskSummary;
                        body = visibleSubtasks.length === 0 ? (
                            <div className="text-xs text-gray-500">No tasks linked yet.</div>
                        ) : (
                            <div className="space-y-2">
                                {visibleSubtasks.map((task) => (
                                    <TaskRow
                                        key={task.id}
                                        task={task}
                                        isEditing={editingTask?.id === task.id}
                                        draft={editingTask}
                                        onEdit={() => startEditTask(task)}
                                        onCancel={() => setEditingTask(null)}
                                        onChange={setEditingTask}
                                        onSave={async () => {
                                            if (!editingTask) return;
                                            const nextTask = draftToSubtask(editingTask);
                                            updateLocalSpec((spec) => {
                                                const nextSubtasks = upsertById(spec.breakdown.subtasks, nextTask);
                                                return {
                                                    ...spec,
                                                    breakdown: { ...spec.breakdown, subtasks: nextSubtasks },
                                                };
                                            });
                                            setEditingTask(null);
                                        }}
                                        onDelete={async () => {
                                            if (!viewSpec) return;
                                            const exists = viewSpec.breakdown.subtasks.some(
                                                (entry) => entry.id === task.id,
                                            );
                                            if (!exists) {
                                                setEditingTask(null);
                                                return;
                                            }
                                            if (!confirm("Delete this task?")) return;
                                            updateLocalSpec((spec) => {
                                                const nextSubtasks = removeById(spec.breakdown.subtasks, task.id);
                                                return {
                                                    ...spec,
                                                    breakdown: { ...spec.breakdown, subtasks: nextSubtasks },
                                                };
                                            });
                                            setEditingTask(null);
                                        }}
                                    />
                                ))}
                            </div>
                        );
                    }

                    if (key === "budget") {
                        summary = budgetSummary;
                        body = (
                            <div className="space-y-4">
                                <div>
                                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                        Materials
                                    </div>
                                    {visibleMaterials.length === 0 ? (
                                        <div className="text-xs text-gray-500">No materials yet.</div>
                                    ) : (
                                        <div className="space-y-2">
                                            {visibleMaterials.map((line) => (
                                                <MaterialRow
                                                    key={line.id}
                                                    line={line}
                                                    isEditing={editingMaterial?.id === line.id}
                                                    draft={editingMaterial}
                                                    onEdit={() => startEditMaterial(line)}
                                                    onCancel={() => setEditingMaterial(null)}
                                                    onChange={setEditingMaterial}
                                                    onSave={async () => {
                                                        if (!editingMaterial) return;
                                                        const nextLine = draftToMaterial(editingMaterial);
                                                        updateLocalSpec((spec) => {
                                                            const nextMaterials = upsertById(spec.breakdown.materials, nextLine);
                                                            return {
                                                                ...spec,
                                                                breakdown: { ...spec.breakdown, materials: nextMaterials },
                                                            };
                                                        });
                                                        setEditingMaterial(null);
                                                    }}
                                                    onDelete={async () => {
                                                        if (!viewSpec) return;
                                                        const exists = viewSpec.breakdown.materials.some(
                                                            (entry) => entry.id === line.id,
                                                        );
                                                        if (!exists) {
                                                            setEditingMaterial(null);
                                                            return;
                                                        }
                                                        if (!confirm("Delete this material line?")) return;
                                                        updateLocalSpec((spec) => {
                                                            const nextMaterials = removeById(spec.breakdown.materials, line.id);
                                                            return {
                                                                ...spec,
                                                                breakdown: { ...spec.breakdown, materials: nextMaterials },
                                                            };
                                                        });
                                                        setEditingMaterial(null);
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    <div className="mt-3">
                                        <AddRowButton
                                            label="Add material"
                                            onClick={() => {
                                                const newId = createLocalId("material");
                                                setEditingMaterial({
                                                    id: newId,
                                                    label: "New material",
                                                    category: "General",
                                                    unit: "unit",
                                                    qty: "1",
                                                    unitCostEstimate: "0",
                                                    status: "planned",
                                                });
                                            }}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                        Labor
                                    </div>
                                    {visibleLabor.length === 0 ? (
                                        <div className="text-xs text-gray-500">No labor lines yet.</div>
                                    ) : (
                                        <div className="space-y-2">
                                            {visibleLabor.map((line) => (
                                                <WorkRow
                                                    key={line.id}
                                                    line={line}
                                                    isEditing={editingWork?.id === line.id}
                                                    draft={editingWork}
                                                    onEdit={() => startEditWork(line)}
                                                    onCancel={() => setEditingWork(null)}
                                                    onChange={setEditingWork}
                                                    onSave={async () => {
                                                        if (!editingWork) return;
                                                        const nextLine = draftToLabor(editingWork);
                                                        updateLocalSpec((spec) => {
                                                            const nextLabor = upsertById(spec.breakdown.labor, nextLine);
                                                            return {
                                                                ...spec,
                                                                breakdown: { ...spec.breakdown, labor: nextLabor },
                                                            };
                                                        });
                                                        setEditingWork(null);
                                                    }}
                                                    onDelete={async () => {
                                                        if (!viewSpec) return;
                                                        const exists = viewSpec.breakdown.labor.some(
                                                            (entry) => entry.id === line.id,
                                                        );
                                                        if (!exists) {
                                                            setEditingWork(null);
                                                            return;
                                                        }
                                                        if (!confirm("Delete this labor line?")) return;
                                                        updateLocalSpec((spec) => {
                                                            const nextLabor = removeById(spec.breakdown.labor, line.id);
                                                            return {
                                                                ...spec,
                                                                breakdown: { ...spec.breakdown, labor: nextLabor },
                                                            };
                                                        });
                                                        setEditingWork(null);
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    <div className="mt-3">
                                        <AddRowButton
                                            label="Add labor"
                                            onClick={() => {
                                                const newId = createLocalId("labor");
                                                setEditingWork({
                                                    id: newId,
                                                    role: "New role",
                                                    workType: "studio",
                                                    rateType: "day",
                                                    quantity: "1",
                                                    unitCost: "0",
                                                    description: "",
                                                });
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    if (key === "files") {
                        summary = filesSummary;
                        body = <div className="text-xs text-gray-500">No files linked to this element yet.</div>;
                    }

                    if (key === "history") {
                        summary = historySummary;
                        body = revisions.length === 0 ? (
                            <div className="text-xs text-gray-500">No revisions yet.</div>
                        ) : (
                            <div className="space-y-2 text-xs">
                                {revisions
                                    .slice()
                                    .sort((a, b) => b.revisionNumber - a.revisionNumber)
                                    .slice(0, 5)
                                    .map((rev) => (
                                        <div key={rev._id} className="border rounded-md px-3 py-2">
                                            <div className="font-semibold text-gray-700">
                                                v{rev.revisionNumber} - {rev.tabScope} - {rev.state}
                                            </div>
                                            <div className="text-gray-500">
                                                {new Date(rev.createdAt).toLocaleString()}
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        );
                    }

                    if (key === "conflicts") {
                        summary = conflictsSummary;
                        body = (
                            <div className="text-xs text-gray-500">
                                No conflicts detected. Conflict signals will appear here.
                            </div>
                        );
                    }

                    const sectionActions =
                        key === "tasks"
                            ? {
                                label: "Add task",
                                onClick: () => {
                                    const id = createLocalId("task");
                                    setEditingTask({
                                        id,
                                        title: "New task",
                                        status: "todo",
                                        estMinutes: "",
                                    });
                                },
                            }
                            : null;

                    return (
                        <OutlineSection
                            key={key}
                            label={label}
                            icon={icon}
                            summary={summary}
                            isOpen={isOpen}
                            onToggle={() => toggleSection(key)}
                            actions={sectionActions ?? undefined}
                        >
                            {body}
                        </OutlineSection>
                    );
                })}
            </div>
        </div>
    );
}

function parseOptionalNumber(value: string) {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function createLocalId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
    if (items.some((entry) => entry.id === item.id)) {
        return items.map((entry) => (entry.id === item.id ? item : entry));
    }
    return [item, ...items];
}

function removeById<T extends { id: string }>(items: T[], id: string) {
    return items.filter((entry) => entry.id !== id);
}

function flattenSubtasks(subtasks: SubtaskSpec[]) {
    const flattened: SubtaskSpec[] = [];
    const walk = (items: SubtaskSpec[]) => {
        for (const item of items) {
            flattened.push(item);
            if (item.children?.length) {
                walk(item.children);
            }
        }
    };
    walk(subtasks);
    return flattened;
}

function draftToSubtask(draft: DraftTask): SubtaskSpec {
    return {
        id: draft.id,
        title: draft.title.trim() || "Untitled task",
        status: draft.status,
        estMinutes: parseOptionalNumber(draft.estMinutes),
    };
}

function draftToMaterial(draft: DraftMaterial): MaterialSpec {
    return {
        id: draft.id,
        label: draft.label.trim() || "Untitled material",
        category: draft.category.trim() || undefined,
        unit: draft.unit.trim() || "unit",
        qty: parseOptionalNumber(draft.qty),
        unitCostEstimate: parseOptionalNumber(draft.unitCostEstimate),
        status: draft.status.trim() || undefined,
    };
}

function draftToLabor(draft: DraftLabor): LaborSpec {
    const rateType = draft.rateType.trim() || "day";
    return {
        id: draft.id,
        role: draft.role.trim() || "Untitled role",
        workType: draft.workType.trim() || "studio",
        rateType: rateType as LaborSpec["rateType"],
        quantity: parseOptionalNumber(draft.quantity),
        unitCost: parseOptionalNumber(draft.unitCost),
        description: draft.description.trim() || undefined,
    };
}

function OutlineSection({
    label,
    icon,
    summary,
    isOpen,
    onToggle,
    actions,
    children,
}: {
    label: string;
    icon: React.ReactNode;
    summary: React.ReactNode;
    isOpen: boolean;
    onToggle: () => void;
    actions?: { label: string; onClick: () => void };
    children: React.ReactNode;
}) {
    return (
        <div className="border-b last:border-0">
            <button
                type="button"
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50"
                onClick={onToggle}
            >
                <div className="flex items-center gap-2">
                    <span className="text-gray-400">{icon}</span>
                    <span className="text-sm font-semibold text-gray-800">{label}</span>
                </div>
                <div className="flex items-center gap-3">
                    {actions && (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                actions.onClick();
                            }}
                            className="text-[10px] px-2 py-1 rounded-full bg-blue-600 text-white flex items-center gap-1 hover:bg-blue-700"
                        >
                            <Plus size={12} />
                            {actions.label}
                        </button>
                    )}
                    {!isOpen && <div className="hidden sm:flex">{summary}</div>}
                    <span className="text-gray-400">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                </div>
            </button>
            {isOpen && (
                <div className="px-4 pb-4">
                    <div className="mb-3">{summary}</div>
                    {children}
                </div>
            )}
        </div>
    );
}

function SummaryChip({ label, tone = "default" }: { label: string; tone?: "default" | "warning" | "success" }) {
    const toneClasses =
        tone === "warning"
            ? "bg-amber-100 text-amber-700"
            : tone === "success"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-600";
    return (
        <span className={`text-[10px] px-2 py-1 rounded-full font-semibold uppercase tracking-wide ${toneClasses}`}>
            {label}
        </span>
    );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
    return (
        <div className="border rounded-lg px-3 py-2 bg-white shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{title}</div>
            <div className="text-sm font-semibold text-gray-800 mt-1">{value}</div>
        </div>
    );
}

function TaskRow({
    task,
    isEditing,
    draft,
    onEdit,
    onCancel,
    onChange,
    onSave,
    onDelete,
}: {
    task: SubtaskSpec;
    isEditing: boolean;
    draft: DraftTask | null;
    onEdit: () => void;
    onCancel: () => void;
    onChange: (next: DraftTask | null) => void;
    onSave: () => void;
    onDelete: () => void;
}) {
    if (isEditing && draft) {
        return (
            <div className="border rounded-md px-3 py-3 space-y-2 bg-white">
                <div className="grid gap-2 sm:grid-cols-[1.5fr_auto_auto]">
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.title}
                        onChange={(event) => onChange({ ...draft, title: event.target.value })}
                    />
                    <select
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.status}
                        onChange={(event) =>
                            onChange({
                                ...draft,
                                status: event.target.value as "todo" | "in_progress" | "done" | "blocked",
                            })
                        }
                    >
                        <option value="todo">todo</option>
                        <option value="in_progress">in progress</option>
                        <option value="done">done</option>
                        <option value="blocked">blocked</option>
                    </select>
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        placeholder="Est minutes"
                        value={draft.estMinutes}
                        onChange={(event) => onChange({ ...draft, estMinutes: event.target.value })}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="text-xs px-2 py-1 rounded bg-blue-600 text-white flex items-center gap-1 hover:bg-blue-700"
                        onClick={onSave}
                    >
                        <Save size={12} />
                        Save row
                    </button>
                    <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 flex items-center gap-1"
                        onClick={onCancel}
                    >
                        <X size={12} />
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 flex items-center gap-1"
                        onClick={onDelete}
                    >
                        <Trash2 size={12} />
                        Delete row
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="group border rounded-md px-3 py-2 hover:bg-gray-50 transition flex items-center justify-between gap-3">
            <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800 truncate">{task.title}</div>
                <div className="text-xs text-gray-500 mt-1">
                    {task.status ?? "todo"} - {formatTaskHours(task)}
                </div>
            </div>
            <div className="hidden group-hover:flex items-center gap-2">
                <button
                    type="button"
                    className="text-gray-500 hover:text-gray-700"
                    onClick={onEdit}
                >
                    <Pencil size={14} />
                </button>
                <button
                    type="button"
                    className="text-red-500 hover:text-red-600"
                    onClick={onDelete}
                >
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
}

function MaterialRow({
    line,
    isEditing,
    draft,
    onEdit,
    onCancel,
    onChange,
    onSave,
    onDelete,
}: {
    line: MaterialSpec;
    isEditing: boolean;
    draft: DraftMaterial | null;
    onEdit: () => void;
    onCancel: () => void;
    onChange: (next: DraftMaterial | null) => void;
    onSave: () => void;
    onDelete: () => void;
}) {
    if (isEditing && draft) {
        return (
            <div className="border rounded-md px-3 py-3 space-y-2 bg-white">
                <div className="grid gap-2 sm:grid-cols-[1.2fr_0.8fr_0.5fr_0.6fr_0.6fr]">
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.label}
                        onChange={(event) => onChange({ ...draft, label: event.target.value })}
                    />
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.category}
                        onChange={(event) => onChange({ ...draft, category: event.target.value })}
                    />
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.unit}
                        onChange={(event) => onChange({ ...draft, unit: event.target.value })}
                    />
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.qty}
                        onChange={(event) => onChange({ ...draft, qty: event.target.value })}
                    />
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.unitCostEstimate}
                        onChange={(event) => onChange({ ...draft, unitCostEstimate: event.target.value })}
                    />
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-center">
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.status}
                        onChange={(event) => onChange({ ...draft, status: event.target.value })}
                    />
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="text-xs px-2 py-1 rounded bg-blue-600 text-white flex items-center gap-1 hover:bg-blue-700"
                            onClick={onSave}
                        >
                            <Save size={12} />
                            Save row
                        </button>
                        <button
                            type="button"
                            className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 flex items-center gap-1"
                            onClick={onCancel}
                        >
                            <X size={12} />
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 flex items-center gap-1"
                            onClick={onDelete}
                        >
                            <Trash2 size={12} />
                            Delete row
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="group border rounded-md px-3 py-2 hover:bg-gray-50 transition flex items-center justify-between gap-3">
            <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800 truncate">{line.label}</div>
                <div className="text-xs text-gray-500 mt-1">
                    {line.qty ?? 0} {line.unit ?? ""} - {formatCurrency((line.qty ?? 0) * (line.unitCostEstimate ?? 0), "ILS")}
                </div>
            </div>
            <div className="hidden group-hover:flex items-center gap-2">
                <button
                    type="button"
                    className="text-gray-500 hover:text-gray-700"
                    onClick={onEdit}
                >
                    <Pencil size={14} />
                </button>
                <button
                    type="button"
                    className="text-red-500 hover:text-red-600"
                    onClick={onDelete}
                >
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
}

function WorkRow({
    line,
    isEditing,
    draft,
    onEdit,
    onCancel,
    onChange,
    onSave,
    onDelete,
}: {
    line: LaborSpec;
    isEditing: boolean;
    draft: DraftLabor | null;
    onEdit: () => void;
    onCancel: () => void;
    onChange: (next: DraftLabor | null) => void;
    onSave: () => void;
    onDelete: () => void;
}) {
    if (isEditing && draft) {
        return (
            <div className="border rounded-md px-3 py-3 space-y-2 bg-white">
                <div className="grid gap-2 sm:grid-cols-[1fr_0.6fr_0.6fr_0.6fr_0.6fr]">
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.role}
                        onChange={(event) => onChange({ ...draft, role: event.target.value })}
                    />
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.workType}
                        onChange={(event) => onChange({ ...draft, workType: event.target.value })}
                    />
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.rateType}
                        onChange={(event) => onChange({ ...draft, rateType: event.target.value })}
                    />
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.quantity}
                        onChange={(event) => onChange({ ...draft, quantity: event.target.value })}
                    />
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.unitCost}
                        onChange={(event) => onChange({ ...draft, unitCost: event.target.value })}
                    />
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-center">
                    <input
                        className="border rounded px-2 py-1 text-sm"
                        value={draft.description}
                        onChange={(event) => onChange({ ...draft, description: event.target.value })}
                    />
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="text-xs px-2 py-1 rounded bg-blue-600 text-white flex items-center gap-1 hover:bg-blue-700"
                            onClick={onSave}
                        >
                            <Save size={12} />
                            Save row
                        </button>
                        <button
                            type="button"
                            className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 flex items-center gap-1"
                            onClick={onCancel}
                        >
                            <X size={12} />
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 flex items-center gap-1"
                            onClick={onDelete}
                        >
                            <Trash2 size={12} />
                            Delete row
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="group border rounded-md px-3 py-2 hover:bg-gray-50 transition flex items-center justify-between gap-3">
            <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800 truncate">{line.role}</div>
                <div className="text-xs text-gray-500 mt-1">
                    {line.quantity ?? 0} {line.rateType} - {formatCurrency((line.quantity ?? 0) * (line.unitCost ?? 0), "ILS")}
                </div>
            </div>
            <div className="hidden group-hover:flex items-center gap-2">
                <button
                    type="button"
                    className="text-gray-500 hover:text-gray-700"
                    onClick={onEdit}
                >
                    <Pencil size={14} />
                </button>
                <button
                    type="button"
                    className="text-red-500 hover:text-red-600"
                    onClick={onDelete}
                >
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="text-xs px-2 py-1 rounded border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 flex items-center gap-1"
        >
            <Plus size={12} />
            {label}
        </button>
    );
}

function formatCurrency(value: number, currency: string) {
    const formatter = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
    });
    return formatter.format(value);
}

function formatTaskHours(task: SubtaskSpec) {
    if (task.estMinutes !== undefined && task.estMinutes !== null) {
        return `${(task.estMinutes / 60).toFixed(1)}h`;
    }
    return "n/a";
}

