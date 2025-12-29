"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

type Props = {
    projectId: Id<"projects">;
    selectedAllProject: boolean;
    selectedItemIds: Array<Id<"projectItems">>;
    multiSelectEnabled: boolean;
    onToggleMultiSelect: (enabled: boolean) => void;
    onSelectAllProject: () => void;
    onSetSelectedItemIds: (ids: Array<Id<"projectItems">>) => void;
};

export function FlowItemsPanel(props: Props) {
    const sidebarData = useQuery(api.items.listTreeSidebar, {
        projectId: props.projectId,
        includeDrafts: true,
    });
    const pendingUpdates = useQuery(api.elementVersions.getPendingElementUpdates, {
        projectId: props.projectId,
    });

    const templates = useQuery(api.items.listTemplates);
    const createManual = useMutation(api.items.createManual);
    const createFromTemplate = useMutation(api.items.createFromTemplate);
    const renameItem = useMutation(api.items.renameItem);
    const requestDelete = useMutation(api.items.requestDelete);
    const confirmDelete = useMutation(api.items.confirmDelete);

    const [search, setSearch] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState("");

    const allItems = useMemo(() => (sidebarData?.items ?? []) as Array<Doc<"projectItems">>, [sidebarData?.items]);
    const items = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return allItems;
        return allItems.filter((item) => {
            const title = (item.title ?? "").toLowerCase();
            const description = (item.description ?? "").toLowerCase();
            const typeKey = (item.typeKey ?? "").toLowerCase();
            const status = (item.status ?? "").toLowerCase();
            return (
                title.includes(query) ||
                description.includes(query) ||
                typeKey.includes(query) ||
                status.includes(query)
            );
        });
    }, [allItems, search]);

    const selectedSet = useMemo(() => new Set(props.selectedItemIds.map(String)), [props.selectedItemIds]);
    const pendingById = useMemo(
        () => new Map((pendingUpdates ?? []).map((entry) => [String(entry.elementId), entry.count])),
        [pendingUpdates],
    );

    const DEFAULT_ITEMS = [
        { title: "הובלה", typeKey: "logistics", description: "Moving from studio to set" },
        { title: "התקנה", typeKey: "installation", description: "Installation work" },
        { title: "פירוק", typeKey: "teardown", description: "Teardown work" },
    ];

    const missingDefaultItems = useMemo(() => {
        if (!allItems) return [];
        return DEFAULT_ITEMS.filter(
            (def) => !allItems.some((item) => item.title === def.title)
        );
    }, [allItems]);

    const handleRowClick = (itemId: Id<"projectItems">) => {
        props.onSetSelectedItemIds([itemId]);
    };

    const handleCheckboxChange = (itemId: Id<"projectItems">) => {
        const idString = String(itemId);
        const next = new Set(props.selectedItemIds.map(String));
        if (next.has(idString)) next.delete(idString);
        else next.add(idString);
        props.onSetSelectedItemIds(Array.from(next) as Array<Id<"projectItems">>);
    };

    const handleCreate = async () => {
        if (isCreating) return;
        setIsCreating(true);
        try {
            let result;
            if (selectedTemplateId) {
                result = await createFromTemplate({
                    projectId: props.projectId,
                    templateId: selectedTemplateId,
                });
            } else {
                result = await createManual({
                    projectId: props.projectId,
                    title: "Untitled element",
                    typeKey: "general",
                });
            }
            props.onSetSelectedItemIds([result.itemId]);
            setSelectedTemplateId(""); // Reset
        } catch (e) {
            alert("Failed to create: " + e);
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="bg-white border rounded-lg shadow-sm flex flex-col min-h-0">
            <div className="p-3 border-b space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Elements</div>
                </div>

                <div className="flex gap-2">
                    <select 
                        className="flex-1 border rounded px-2 py-1 text-xs bg-white text-gray-700"
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                    >
                        <option value="">Empty (Manual)</option>
                        {templates?.map(t => (
                            <option key={t.templateId} value={t.templateId}>
                                {t.name} (v{t.version})
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                        onClick={handleCreate}
                        disabled={isCreating}
                    >
                        {isCreating ? "..." : "+ Add"}
                    </button>
                </div>

                <input
                    className="w-full border rounded px-2 py-1 text-sm"
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            <div className="flex-1 overflow-y-auto">
                <button
                    type="button"
                    className={`w-full text-left px-3 py-2 border-b text-sm hover:bg-gray-50 ${
                        props.selectedAllProject ? "bg-blue-50" : ""
                    }`}
                    onClick={props.onSelectAllProject}
                >
                    <div className="font-semibold text-gray-900">All Project</div>
                    <div className="text-xs text-gray-500">Scope everything in this project</div>
                </button>

                {sidebarData === undefined ? (
                    <div className="p-4 text-sm text-gray-500">Loading elements...</div>
                ) : items.length === 0 ? (
                    <div className="p-4 text-sm text-gray-500">No elements found.</div>
                ) : (
                    <div className="divide-y">
                        {items.map((item) => {
                            const checked = selectedSet.has(String(item._id));
                            return (
                                <div
                                    key={item._id}
                                    className={`px-3 py-2 hover:bg-gray-50 cursor-pointer ${
                                        checked && !props.selectedAllProject ? "bg-blue-50" : ""
                                    }`}
                                    onClick={() => {
                                        if (props.selectedAllProject) {
                                            props.onSetSelectedItemIds([item._id]);
                                            return;
                                        }
                                        handleRowClick(item._id);
                                    }}
                                >
                                    <div className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            className="mt-1"
                                            checked={checked && !props.selectedAllProject}
                                            onChange={() => {
                                                if (props.selectedAllProject) {
                                                    props.onSetSelectedItemIds([item._id]);
                                                    return;
                                                }
                                                handleCheckboxChange(item._id);
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-semibold text-gray-900 truncate">
                                                        {item.title}
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        {item.typeKey} · {item.status}
                                                    </div>
                                                    {item.description ? (
                                                        <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                                                            {item.description}
                                                        </div>
                                                    ) : null}
                                                </div>
                                                <div className="flex flex-col items-end gap-1 shrink-0">
                                                    {pendingById.get(String(item._id)) ? (
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                                                            Pending update
                                                        </span>
                                                    ) : null}
                                                    <button
                                                        type="button"
                                                        className="text-[11px] text-blue-700 hover:underline"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const next = prompt("Rename element:", item.title) ?? "";
                                                            if (!next.trim() || next.trim() === item.title) return;
                                                            void renameItem({ itemId: item._id, newTitle: next.trim() });
                                                        }}
                                                    >
                                                        Rename
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="text-[11px] text-red-700 hover:underline"
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            if (!confirm("Delete this element? This cannot be undone.")) return;
                                                            if (!confirm("Confirm delete (second confirmation)") ) return;
                                                            await requestDelete({ itemId: item._id });
                                                            await confirmDelete({ itemId: item._id });
                                                        }}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Default Elements Section */}
                {missingDefaultItems.length > 0 && !search && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                        <div className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                            Suggested Elements
                        </div>
                        {missingDefaultItems.map((def) => (
                            <div
                                key={def.title}
                                className="px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-gray-50 opacity-60 hover:opacity-100 group transition-opacity"
                                onClick={async () => {
                                    if (isCreating) return;
                                    setIsCreating(true);
                                    try {
                                        const result = await createManual({
                                            projectId: props.projectId,
                                            title: def.title,
                                            typeKey: def.typeKey,
                                        });
                                        props.onSetSelectedItemIds([result.itemId]);
                                    } finally {
                                        setIsCreating(false);
                                    }
                                }}
                            >
                                <div className="w-4 text-center text-gray-300">•</div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-gray-500 group-hover:text-gray-900 truncate">
                                        {def.title}
                                    </div>
                                    <div className="text-xs text-gray-400 group-hover:text-gray-600">
                                        {def.description}
                                    </div>
                                </div>
                                <button className="text-[10px] px-2 py-1 rounded border border-gray-200 text-gray-400 group-hover:border-blue-200 group-hover:text-blue-600 group-hover:bg-blue-50">
                                    Add
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
