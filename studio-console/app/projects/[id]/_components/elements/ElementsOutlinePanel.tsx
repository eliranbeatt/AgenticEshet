"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ChevronDown, ChevronRight, FileText, Folder, ListChecks, ShieldAlert } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useItemsContext } from "../items/ItemsContext";

type OutlineSectionKey =
    | "overview"
    | "configuration"
    | "tasks"
    | "budget"
    | "files"
    | "history"
    | "conflicts";

const SECTION_ORDER: Array<{ key: OutlineSectionKey; label: string; icon: React.ReactNode }> = [
    { key: "overview", label: "Overview", icon: <Folder size={14} /> },
    { key: "configuration", label: "Configuration", icon: <FileText size={14} /> },
    { key: "tasks", label: "Tasks", icon: <ListChecks size={14} /> },
    { key: "budget", label: "Budget", icon: <FileText size={14} /> },
    { key: "files", label: "Files", icon: <Folder size={14} /> },
    { key: "history", label: "History / Versions", icon: <FileText size={14} /> },
    { key: "conflicts", label: "Conflicts / Warnings", icon: <ShieldAlert size={14} /> },
];

const DEFAULT_EXPANDED: OutlineSectionKey[] = ["overview", "tasks", "budget"];

type ItemDetails = {
    item: Doc<"projectItems">;
    tasks: Doc<"tasks">[];
    materialLines: Doc<"materialLines">[];
    workLines: Doc<"workLines">[];
    accountingLines: Doc<"accountingLines">[];
    revisions: Doc<"itemRevisions">[];
};

export function ElementsOutlinePanel() {
    const { projectId, selectedItemId } = useItemsContext();
    const [expandedSections, setExpandedSections] = useState<Set<OutlineSectionKey>>(
        () => new Set(DEFAULT_EXPANDED),
    );
    const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

    const details = useQuery(
        api.items.getItemDetails,
        selectedItemId ? { itemId: selectedItemId } : "skip",
    ) as ItemDetails | null | undefined;

    const content = useMemo(() => {
        if (!details) return null;
        return details;
    }, [details]);

    const tasks = content?.tasks ?? [];
    const materialLines = content?.materialLines ?? [];
    const workLines = content?.workLines ?? [];
    const accountingLines = content?.accountingLines ?? [];
    const revisions = content?.revisions ?? [];

    const taskStats = useMemo(() => {
        const blocked = tasks.filter((task) => task.status === "blocked").length;
        const done = tasks.filter((task) => task.status === "done").length;
        return { total: tasks.length, blocked, done };
    }, [tasks]);

    const budgetStats = useMemo(() => {
        const materialTotal = materialLines.reduce(
            (sum, line) => sum + line.plannedQuantity * line.plannedUnitCost,
            0,
        );
        const laborTotal = workLines.reduce(
            (sum, line) => sum + line.plannedQuantity * line.plannedUnitCost,
            0,
        );
        return {
            materialTotal,
            laborTotal,
            materialCount: materialLines.length,
            laborCount: workLines.length,
            accountingCount: accountingLines.length,
        };
    }, [accountingLines.length, materialLines, workLines]);

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
            <SummaryChip label={`${budgetStats.accountingCount} accounting`} />
        </div>
    );

    const filesSummary = <SummaryChip label="No files" />;
    const historySummary = <SummaryChip label={`${revisions.length} revisions`} />;
    const conflictsSummary = <SummaryChip label="0 conflicts" tone="success" />;

    return (
        <div className="bg-white border rounded-lg shadow-sm flex flex-col h-full overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50/70">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Outline</div>
                <div className="text-lg font-semibold text-gray-900 truncate">
                    {content.item.title}
                </div>
                <div className="text-xs text-gray-500">
                    {content.item.typeKey} • {content.item.status}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {SECTION_ORDER.map(({ key, label, icon }) => {
                    const isOpen = expandedSections.has(key);
                    let summary: React.ReactNode = null;
                    let body: React.ReactNode = null;

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
                        body = tasks.length === 0 ? (
                            <div className="text-xs text-gray-500">No tasks linked yet.</div>
                        ) : (
                            <div className="space-y-2">
                                {tasks.map((task) => (
                                    <OutlineRow
                                        key={task._id}
                                        isActive={selectedRowId === task._id}
                                        title={task.title}
                                        subtitle={`${task.status} • ${formatTaskHours(task)}`}
                                        onClick={() => setSelectedRowId(task._id)}
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
                                    {materialLines.length === 0 ? (
                                        <div className="text-xs text-gray-500">No materials yet.</div>
                                    ) : (
                                        <div className="space-y-2">
                                            {materialLines.map((line) => (
                                                <OutlineRow
                                                    key={line._id}
                                                    isActive={selectedRowId === line._id}
                                                    title={line.label}
                                                    subtitle={`${line.plannedQuantity} ${line.unit} • ${formatCurrency(
                                                        line.plannedQuantity * line.plannedUnitCost,
                                                        "ILS",
                                                    )}`}
                                                    onClick={() => setSelectedRowId(line._id)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                        Labor
                                    </div>
                                    {workLines.length === 0 ? (
                                        <div className="text-xs text-gray-500">No labor lines yet.</div>
                                    ) : (
                                        <div className="space-y-2">
                                            {workLines.map((line) => (
                                                <OutlineRow
                                                    key={line._id}
                                                    isActive={selectedRowId === line._id}
                                                    title={line.role}
                                                    subtitle={`${line.plannedQuantity} ${line.rateType} • ${formatCurrency(
                                                        line.plannedQuantity * line.plannedUnitCost,
                                                        "ILS",
                                                    )}`}
                                                    onClick={() => setSelectedRowId(line._id)}
                                                />
                                            ))}
                                        </div>
                                    )}
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
                                                v{rev.revisionNumber} • {rev.tabScope} • {rev.state}
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

                    return (
                        <OutlineSection
                            key={key}
                            label={label}
                            icon={icon}
                            summary={summary}
                            isOpen={isOpen}
                            onToggle={() => toggleSection(key)}
                        >
                            {body}
                        </OutlineSection>
                    );
                })}
            </div>
        </div>
    );
}

function OutlineSection({
    label,
    icon,
    summary,
    isOpen,
    onToggle,
    children,
}: {
    label: string;
    icon: React.ReactNode;
    summary: React.ReactNode;
    isOpen: boolean;
    onToggle: () => void;
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

function OutlineRow({
    title,
    subtitle,
    isActive,
    onClick,
}: {
    title: string;
    subtitle?: string;
    isActive: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full text-left border rounded-md px-3 py-2 transition ${
                isActive ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
            }`}
        >
            <div className="text-sm font-semibold text-gray-800 truncate">{title}</div>
            {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
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

function formatTaskHours(task: Doc<"tasks">) {
    if (task.durationHours) return `${task.durationHours}h`;
    if (task.effortDays) return `${task.effortDays * 8}h`;
    if (task.estimatedMinutes) return `${(task.estimatedMinutes / 60).toFixed(1)}h`;
    return "n/a";
}
