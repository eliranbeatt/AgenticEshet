"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useItemsContext } from "../items/ItemsContext";
import { Search, Plus, Trash2, Edit2, CheckSquare, Square, Check, X } from "lucide-react";

const DEFAULT_ITEMS = [
    { title: "הובלה", typeKey: "logistics", description: "Moving from studio to set" },
    { title: "התקנה", typeKey: "installation", description: "Installation work" },
    { title: "פירוק", typeKey: "teardown", description: "Teardown work" },
];

export function FlowItemsPanel() {
    const { 
        projectId, 
        selectedItemId, 
        selectedItemIds, 
        setSelectedItemId, 
        toggleItemSelection, 
        selectAllItems, 
        deselectAllItems, 
        selectedAllProject,
        setSelectedAllProject
    } = useItemsContext();
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedTemplateId, setSelectedTemplateId] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    const sidebar = useQuery(api.items.listTreeSidebar, { projectId, includeDrafts: true });
    const templates = useQuery(api.items.listTemplates);
    const createManual = useMutation(api.items.createManual);
    const createFromTemplate = useMutation(api.items.createFromTemplate);
    const renameItem = useMutation(api.items.renameItem);
    const requestDelete = useMutation(api.items.requestDelete);
    const confirmDelete = useMutation(api.items.confirmDelete);
    const pendingUpdates = useQuery(api.elementVersions.getPendingElementUpdates, { projectId });

    // Revisions / Suggestions
    const suggestionDrafts = useQuery(api.revisions.listSuggestionDrafts, { projectId });
    const approveRevision = useMutation(api.revisions.approve);
    const discardRevision = useMutation(api.revisions.discard);

    const pendingById = useMemo(
        () => new Map((pendingUpdates ?? []).map((entry) => [String(entry.elementId), entry.count])),
        [pendingUpdates],
    );
    
    // Flatten items for list view
    const items = useMemo(() => sidebar?.items ?? [], [sidebar]);

    const filteredItems = useMemo(() => {
        if (!searchQuery) return items;
        return items.filter(item => 
            item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.typeKey.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [items, searchQuery]);

    const missingDefaultItems = useMemo(() => {
        if (!items) return [];
        return DEFAULT_ITEMS.filter(
            (def) => !items.some((item) => item.title === def.title)
        );
    }, [items]);

    const handleCreate = async () => {
        if (isCreating) return;
        setIsCreating(true);
        try {
            let result;
            if (selectedTemplateId) {
                result = await createFromTemplate({
                    projectId,
                    templateId: selectedTemplateId,
                });
            } else {
                result = await createManual({
                    projectId,
                    title: "Untitled element",
                    typeKey: "general",
                });
            }
            setSelectedItemId(result.itemId);
            setSelectedTemplateId(""); // Reset
        } catch (e) {
            alert("Failed to create: " + e);
        } finally {
            setIsCreating(false);
        }
    };

    const handleQuickAdd = async (def: typeof DEFAULT_ITEMS[0]) => {
        if (isCreating) return;
        setIsCreating(true);
        try {
            const result = await createManual({
                projectId,
                title: def.title,
                typeKey: def.typeKey,
            });
            setSelectedItemId(result.itemId);
        } catch (e) {
            alert("Failed to create: " + e);
        } finally {
            setIsCreating(false);
        }
    };

    const handleRename = (item: Doc<"projectItems">) => {
        const next = prompt("Rename element:", item.title) ?? "";
        if (!next.trim() || next.trim() === item.title) return;
        void renameItem({ itemId: item._id, newTitle: next.trim() });
    };

    const handleDelete = async (itemId: Id<"projectItems">) => {
        if (!confirm("Delete this element? This cannot be undone.")) return;
        if (!confirm("Confirm delete (second confirmation)")) return;
        await requestDelete({ itemId });
        await confirmDelete({ itemId });
        if (selectedItemId === itemId) setSelectedItemId(null);
    };

    const handleSelectAll = () => {
        if (selectedAllProject) {
            deselectAllItems();
        } else {
            selectAllItems(items.map(i => i._id));
            setSelectedAllProject(true);
        }
    };

    return (
        <div className="bg-white border rounded-lg shadow-sm flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="p-3 border-b space-y-2 bg-gray-50/50">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ELEMENTS</span>
                    <div className="flex gap-1">
                        <select 
                            className="text-xs border rounded px-1 py-0.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[120px]"
                            value={selectedTemplateId}
                            onChange={(e) => setSelectedTemplateId(e.target.value)}
                        >
                            <option value="">Empty</option>
                            {templates?.map(t => (
                                <option key={t.templateId} value={t.templateId}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                        <button 
                            className="bg-blue-600 text-white p-0.5 rounded hover:bg-blue-700 flex items-center justify-center w-6 h-6 disabled:opacity-50"
                            title="Add Element"
                            onClick={handleCreate}
                            disabled={isCreating}
                        >
                            <Plus size={14} />
                        </button>
                    </div>
                </div>
                <div className="relative">
                    <Search className="absolute left-2 top-1.5 text-gray-400" size={12} />
                    <input 
                        type="text" 
                        placeholder="Filter by title, type..." 
                        className="w-full pl-6 pr-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
                {/* All Project Row */}
                <div 
                    className={`flex items-center p-2 border-b cursor-pointer hover:bg-gray-50 transition-colors ${selectedAllProject ? "bg-blue-50 border-blue-100" : "border-gray-100"}`}
                    onClick={handleSelectAll}
                >
                    <div className="mr-2 text-gray-400">
                        {selectedAllProject ? <CheckSquare size={14} className="text-blue-600" /> : <Square size={14} />}
                    </div>
                    <span className={`text-sm font-medium ${selectedAllProject ? "text-blue-900" : "text-gray-800"}`}>All Project</span>
                </div>

                {/* Element Rows */}
                {filteredItems.length === 0 ? (
                    <div className="p-4 text-center text-xs text-gray-400">
                        {items.length === 0 ? "No elements yet." : "No matches found."}
                    </div>
                ) : (
                    filteredItems.map(item => {
                        const isSelected = selectedItemIds.includes(item._id);
                        const isActive = selectedItemId === item._id;
                        const isPending = pendingById.has(String(item._id));
                        
                        return (
                            <div 
                                key={item._id} 
                                className={`group flex items-center p-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors cursor-pointer ${isActive ? "bg-blue-50 border-l-2 border-l-blue-500 pl-[calc(0.5rem-2px)]" : ""}`}
                                onClick={() => setSelectedItemId(item._id)}
                            >
                                <div 
                                    className="mr-2 text-gray-400 cursor-pointer hover:text-gray-600"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleItemSelection(item._id);
                                    }}
                                >
                                    {isSelected ? <CheckSquare size={14} className="text-blue-600" /> : <Square size={14} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className={`font-semibold truncate text-xs ${isActive ? "text-blue-900" : "text-gray-900"}`}>{item.title}</span>
                                        <span className="text-[10px] text-gray-500 whitespace-nowrap">{item.typeKey} · {item.status}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                         {isPending && (
                                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                                                Pending update
                                            </span>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Actions on Hover */}
                                <div className="hidden group-hover:flex items-center gap-1 pl-1 bg-gray-50 shadow-sm rounded-l">
                                    <button 
                                        className="text-blue-600 hover:text-blue-800 p-1" 
                                        title="Rename"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRename(item);
                                        }}
                                    >
                                        <Edit2 size={12} />
                                    </button>
                                    <button 
                                        className="text-red-600 hover:text-red-800 p-1" 
                                        title="Delete"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDelete(item._id);
                                        }}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}

                {/* Suggested Elements (Agent Drafts) */}
                {suggestionDrafts && suggestionDrafts.length > 0 && (
                    <div className="p-3 mt-2 border-t border-gray-100 bg-blue-50/30">
                        <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2 pl-1">
                            Pending Suggestions
                        </div>
                        <div className="space-y-2">
                            {suggestionDrafts.map(draft => (
                                <div 
                                    key={draft._id}
                                    className="p-2 border border-blue-200 bg-white rounded shadow-sm flex flex-col gap-1"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="text-xs font-medium text-gray-800 line-clamp-2" title={draft.summary}>
                                            {draft.summary || "Agent Suggestion"}
                                        </div>
                                        <div className="flex items-center gap-1 ml-2">
                                            <button 
                                                className="p-1 rounded bg-green-100 text-green-700 hover:bg-green-200"
                                                title="Approve"
                                                onClick={async () => {
                                                    try {
                                                        await approveRevision({ revisionId: draft._id });
                                                    } catch (e) {
                                                        alert("Failed to approve: " + e);
                                                    }
                                                }}
                                            >
                                                <Check size={12} />
                                            </button>
                                            <button 
                                                className="p-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                                title="Discard"
                                                onClick={async () => {
                                                    if (!confirm("Discard this suggestion?")) return;
                                                    try {
                                                        await discardRevision({ revisionId: draft._id });
                                                    } catch (e) {
                                                        alert("Failed to discard: " + e);
                                                    }
                                                }}
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-gray-500">
                                        {draft.changes.length} change{draft.changes.length !== 1 ? 's' : ''} · {new Date(draft.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                    </div>
                                    <div className="space-y-0.5 mt-1">
                                        {draft.changes.slice(0, 3).map(change => (
                                            <div key={change._id} className="text-[10px] text-gray-600 flex items-center gap-1">
                                                <span className={`w-1 h-1 rounded-full ${change.changeType === 'create' ? 'bg-green-500' : 'bg-blue-500'}`}></span>
                                                <span className="truncate max-w-[150px]">{change.elementTitle}</span>
                                            </div>
                                        ))}
                                        {draft.changes.length > 3 && (
                                            <div className="text-[9px] text-gray-400 pl-2">
                                                +{draft.changes.length - 3} more
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Default Elements (Quick Add) - Only show if no search and no agent drafts to avoid clutter */}
                {missingDefaultItems.length > 0 && !searchQuery && (!suggestionDrafts || suggestionDrafts.length === 0) && (
                    <div className="p-3 mt-2 border-t border-gray-100">
                        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 pl-1">Quick Add</div>
                        <div className="space-y-1.5 opacity-70 hover:opacity-100 transition-opacity">
                            {missingDefaultItems.map(def => (
                                <div 
                                    key={def.title}
                                    className="flex items-center justify-between p-1.5 border border-dashed border-gray-300 rounded text-xs text-gray-500 hover:bg-gray-50 hover:border-blue-300 cursor-pointer group"
                                    onClick={() => handleQuickAdd(def)}
                                >
                                    <span>{def.title}</span>
                                    <button className="hidden group-hover:block text-blue-600 font-medium text-[10px] uppercase tracking-wide">Add</button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
