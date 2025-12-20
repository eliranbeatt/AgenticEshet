"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { useItemsContext } from "./ItemsContext";

type SidebarItem = Doc<"projectItems"> & {
    draftRevisionId?: Id<"itemRevisions"> | null;
    draftRevisionNumber?: number | null;
};

export function ItemsTreeSidebar() {
    const { projectId, selectedItemId, setSelectedItemId, tabScope, showDraftItems, setShowDraftItems } =
        useItemsContext();

    const sidebarData = useQuery(api.items.listTreeSidebar, {
        projectId,
        includeTab: tabScope,
        includeDrafts: showDraftItems,
    });
    const templates = useQuery(api.items.listTemplates, {});

    const createManual = useMutation(api.items.createManual);
    const createFromTemplate = useMutation(api.items.createFromTemplate);
    const renameItem = useMutation(api.items.renameItem);
    const archiveItem = useMutation(api.items.archiveItem);
    const restoreItem = useMutation(api.items.restoreItem);

    const [search, setSearch] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

    const items = useMemo<SidebarItem[]>(() => sidebarData?.items ?? [], [sidebarData?.items]);
    const itemsById = useMemo(() => new Map(items.map((item) => [item._id, item])), [items]);
    const childrenByParent = useMemo(() => {
        const map = new Map<string | null, SidebarItem[]>();
        for (const item of items) {
            const parentKey = item.parentItemId ?? null;
            const bucket = map.get(parentKey) ?? [];
            bucket.push(item);
            map.set(parentKey, bucket);
        }
        return map;
    }, [items]);

    useEffect(() => {
        if (!items) return;
        if (selectedItemId && items.some((item) => item._id === selectedItemId)) return;
        const rootItems = childrenByParent.get(null) ?? [];
        if (rootItems.length > 0) {
            setSelectedItemId(rootItems[0]._id);
        } else {
            setSelectedItemId(null);
        }
    }, [childrenByParent, items, selectedItemId, setSelectedItemId]);

    const visibleIds = useMemo(() => {
        if (!search.trim()) return null;
        const query = search.trim().toLowerCase();
        const matching = new Set<string>();
        for (const item of items) {
            const title = item.title.toLowerCase();
            const typeKey = item.typeKey.toLowerCase();
            if (title.includes(query) || typeKey.includes(query)) {
                matching.add(item._id);
            }
        }
        if (matching.size === 0) return new Set<string>();
        const include = new Set<string>();
        for (const id of matching) {
            let current: SidebarItem | undefined = itemsById.get(id);
            while (current) {
                include.add(current._id);
                current = current.parentItemId ? itemsById.get(current.parentItemId) : undefined;
            }
        }
        return include;
    }, [items, itemsById, search]);

    const handleCreateManual = async () => {
        const title = prompt("Item title?") ?? "";
        if (!title.trim()) return;
        const typeKey = prompt("Item type? (e.g. build, rental, logistics)", "general") ?? "general";
        if (!typeKey.trim()) return;
        setIsCreating(true);
        try {
            const result = await createManual({
                projectId,
                title: title.trim(),
                typeKey: typeKey.trim(),
            });
            setSelectedItemId(result.itemId);
        } finally {
            setIsCreating(false);
        }
    };

    const toggleExpanded = (itemId: Id<"projectItems">) => {
        setExpandedIds((prev) => ({
            ...prev,
            [itemId]: !prev[itemId],
        }));
    };

    const renderTree = (parentId: Id<"projectItems"> | null, depth: number) => {
        const siblings = childrenByParent.get(parentId) ?? [];
        if (siblings.length === 0) return null;
        return (
            <div className="space-y-1">
                {siblings.map((item) => {
                    const isSelected = selectedItemId === item._id;
                    const draftLabel = item.draftRevisionId ? `Draft v${item.draftRevisionNumber ?? ""}` : null;
                    const children = childrenByParent.get(item._id) ?? [];
                    const isExpanded = expandedIds[item._id] ?? depth < 1;
                    const isVisible = !visibleIds || visibleIds.has(item._id);
                    if (!isVisible) return null;
                    return (
                        <div key={item._id}>
                            <div
                                className={`flex items-start gap-2 px-2 py-2 rounded cursor-pointer hover:bg-gray-50 ${isSelected ? "bg-blue-50" : ""}`}
                                style={{ paddingLeft: `${depth * 16 + 8}px` }}
                                onClick={() => setSelectedItemId(item._id)}
                            >
                                <button
                                    type="button"
                                    className="mt-0.5 text-xs text-gray-400 hover:text-gray-600"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        if (children.length > 0) toggleExpanded(item._id);
                                    }}
                                    aria-label={isExpanded ? "Collapse item" : "Expand item"}
                                >
                                    {children.length > 0 ? (isExpanded ? "▾" : "▸") : "•"}
                                </button>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-gray-900 truncate">{item.title}</div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {item.typeKey} - {item.status}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            {draftLabel && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                                    {draftLabel}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                className="text-[11px] text-blue-700 hover:underline"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    const next = prompt("Rename item:", item.title) ?? "";
                                                    if (!next.trim() || next.trim() === item.title) return;
                                                    void renameItem({ itemId: item._id, newTitle: next.trim() });
                                                }}
                                            >
                                                Rename
                                            </button>
                                            {item.status === "archived" ? (
                                                <button
                                                    type="button"
                                                    className="text-[11px] text-green-700 hover:underline"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void restoreItem({ itemId: item._id });
                                                    }}
                                                >
                                                    Restore
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="text-[11px] text-gray-500 hover:underline"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        if (!confirm("Archive this item?")) return;
                                                        void archiveItem({ itemId: item._id });
                                                    }}
                                                >
                                                    Archive
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {children.length > 0 && isExpanded && (
                                <div className="mt-1">{renderTree(item._id, depth + 1)}</div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="bg-white border rounded-lg shadow-sm flex flex-col min-h-0">
            <div className="p-3 border-b">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Items</div>
                <div className="mt-2">
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        placeholder="Search items..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                    <input
                        type="checkbox"
                        checked={showDraftItems}
                        onChange={(e) => setShowDraftItems(e.target.checked)}
                    />
                    Show draft items
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={handleCreateManual}
                        disabled={isCreating}
                        className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isCreating ? "Creating..." : "New item"}
                    </button>
                    {(templates ?? []).map((template) => (
                        <button
                            key={template._id}
                            type="button"
                            onClick={async () => {
                                const result = await createFromTemplate({
                                    projectId,
                                    templateKey: template.key,
                                });
                                setSelectedItemId(result.itemId);
                            }}
                            className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                            {template.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {sidebarData === undefined ? (
                    <div className="p-4 text-sm text-gray-500">Loading items...</div>
                ) : items.length === 0 ? (
                    <div className="p-4 text-sm text-gray-500">No items found.</div>
                ) : visibleIds && visibleIds.size === 0 ? (
                    <div className="p-4 text-sm text-gray-500">No items found.</div>
                ) : (
                    <div className="py-2">{renderTree(null, 0)}</div>
                )}
            </div>
        </div>
    );
}

