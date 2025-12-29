"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { useItemsContext } from "../items/ItemsContext";
import { ItemEditorPanel } from "../items/ItemEditorPanel";

type TabKey = "specs" | "tasks" | "costs" | "history";

export function ElementsInspectorPanel() {
    const { selectedItemId } = useItemsContext();
    const [activeTab, setActiveTab] = useState<TabKey>("specs");
    const publishElementVersion = useMutation(api.elementVersions.publishElementVersion);

    const details = useQuery(
        api.items.getItemDetails,
        selectedItemId ? { itemId: selectedItemId as Id<"projectItems"> } : "skip",
    ) as
        | {
            item: Doc<"projectItems">;
            tasks: Doc<"tasks">[];
            materialLines: Doc<"materialLines">[];
            workLines: Doc<"workLines">[];
            accountingLines: Doc<"accountingLines">[];
            revisions: Doc<"itemRevisions">[];
        }
        | null
        | undefined;

    const content = useMemo(() => {
        if (!details) return null;
        const { item, tasks, materialLines, workLines, accountingLines, revisions } = details;
        return { item, tasks, materialLines, workLines, accountingLines, revisions };
    }, [details]);

    if (!selectedItemId) {
        return (
            <div className="bg-white border rounded-lg shadow-sm p-4 text-sm text-gray-500">
                Select an element to review details, tasks, costs, or history.
            </div>
        );
    }

    return (
        <div className="bg-white border rounded-lg shadow-sm flex flex-col min-h-0">
            <div className="p-4 border-b flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-xs text-gray-500">Element inspector</div>
                    <div className="text-lg font-semibold text-gray-900 truncate">
                        {content?.item.name ?? content?.item.title ?? "Element"}
                    </div>
                    {content?.item.category && (
                        <div className="text-xs text-gray-500 mt-1">
                            {content.item.category} - {content.item.status}
                        </div>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => {
                            if (!content?.item) return;
                            void publishElementVersion({ elementId: content.item._id, createdBy: "user" });
                        }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-full border border-blue-600 text-blue-700 hover:bg-blue-50"
                    >
                        Publish update
                    </button>
                    <TabButton tab="specs" activeTab={activeTab} onClick={setActiveTab}>
                        Specs
                    </TabButton>
                    <TabButton tab="tasks" activeTab={activeTab} onClick={setActiveTab}>
                        Tasks
                    </TabButton>
                    <TabButton tab="costs" activeTab={activeTab} onClick={setActiveTab}>
                        Costs
                    </TabButton>
                    <TabButton tab="history" activeTab={activeTab} onClick={setActiveTab}>
                        History
                    </TabButton>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {activeTab === "specs" && (
                    <div className="p-4">
                        <ItemEditorPanel />
                    </div>
                )}

                {activeTab === "tasks" && (
                    <div className="p-4 space-y-3">
                        {!content && <div className="text-sm text-gray-500">Loading element tasks...</div>}
                        {content && content.tasks.length === 0 && (
                            <div className="text-sm text-gray-500">No tasks linked to this element yet.</div>
                        )}
                        {content && content.tasks.length > 0 && (
                            <div className="space-y-2">
                                {content.tasks.map((task) => (
                                    <div key={task._id} className="border rounded p-3">
                                        <div className="text-sm font-semibold text-gray-900">{task.title}</div>
                                        {task.status} -{" "}
                                        {task.durationHours ??
                                            (task.effortDays ? task.effortDays * 8 : undefined) ??
                                            (task.estimatedMinutes
                                                ? (task.estimatedMinutes / 60).toFixed(1)
                                                : "n/a")}{" "}
                                        hrs
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "costs" && (
                    <div className="p-4 space-y-3">
                        {!content && <div className="text-sm text-gray-500">Loading element costs...</div>}
                        {content &&
                            content.accountingLines.length === 0 &&
                            content.materialLines.length === 0 &&
                            content.workLines.length === 0 && (
                                <div className="text-sm text-gray-500">No costs linked to this element yet.</div>
                            )}
                        {content && (
                            <div className="space-y-2 text-sm">
                                {content.accountingLines.map((line) => (
                                    <LineRow
                                        key={line._id}
                                        label={line.title}
                                        meta={`accounting - ${line.lineType}`}
                                    />
                                ))}
                                {content.materialLines.map((line) => (
                                    <LineRow key={line._id} label={line.label} meta="material line" />
                                ))}
                                {content.workLines.map((line) => (
                                    <LineRow key={line._id} label={line.role} meta="work line" />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "history" && (
                    <div className="p-4 space-y-3">
                        {!content && <div className="text-sm text-gray-500">Loading element history...</div>}
                        {content && content.revisions.length === 0 && (
                            <div className="text-sm text-gray-500">No revisions yet.</div>
                        )}
                        {content && content.revisions.length > 0 && (
                            <div className="space-y-2 text-xs text-gray-600">
                                {content.revisions
                                    .slice()
                                    .sort((a, b) => b.revisionNumber - a.revisionNumber)
                                    .map((rev) => (
                                        <div key={rev._id} className="border rounded p-2">
                                            <div className="font-semibold text-gray-700">
                                                v{rev.revisionNumber} - {rev.tabScope} - {rev.state}
                                            </div>
                                            <div>{new Date(rev.createdAt).toLocaleString()}</div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function TabButton({
    tab,
    activeTab,
    onClick,
    children,
}: {
    tab: TabKey;
    activeTab: TabKey;
    onClick: (tab: TabKey) => void;
    children: React.ReactNode;
}) {
    const isActive = tab === activeTab;
    return (
        <button
            type="button"
            onClick={() => onClick(tab)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full border ${isActive
                    ? "bg-blue-600 text-white border-blue-600"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
        >
            {children}
        </button>
    );
}

function LineRow({ label, meta }: { label: string; meta: string }) {
    return (
        <div className="border rounded p-2">
            <div className="font-semibold text-gray-800">{label}</div>
            <div className="text-xs text-gray-500">{meta}</div>
        </div>
    );
}
