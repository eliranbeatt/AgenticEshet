"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useItemsContext } from "../items/ItemsContext";
import { Send, Edit2, Check, X, CheckSquare, List, Info, Database } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Doc, Id } from "@/convex/_generated/dataModel";

export function RightAgentPanel() {
    const { projectId, selectedItemId, selectedItemIds } = useItemsContext();
    const [activeTab, setActiveTab] = useState<"overview" | "suggestions" | "elements">("overview");

    // --- OVERVIEW TAB DATA ---
    const [isEditingOverview, setIsEditingOverview] = useState(false);
    const [overviewDraft, setOverviewDraft] = useState("");
    const memoryMarkdown = useQuery(api.memory.getRunningMemoryMarkdown, { projectId });
    const updateMemory = useMutation(api.memory.updateRunningMemoryMarkdown);

    // --- SUGGESTIONS TAB DATA ---
    const suggestionDrafts = useQuery(api.revisions.listSuggestionDrafts, { projectId });
    const approveRevision = useMutation(api.revisions.approve);
    const discardRevision = useMutation(api.revisions.discard);

    // --- ELEMENTS TAB DATA ---
    // We fetch the selected item to show its details
    const selectedItem = useQuery(api.items.get, selectedItemId ? { itemId: selectedItemId } : "skip");
    // Also fetch relevant revisions for this specific item if any
    // We can filter suggestionDrafts for this item
    const itemDrafts = useMemo(() => {
        if (!selectedItemId || !suggestionDrafts) return [];
        return suggestionDrafts.filter(d =>
            d.changes.some(c => c.elementId === selectedItemId)
        );
    }, [selectedItemId, suggestionDrafts]);

    const handleDiscardAll = async () => {
        if (!suggestionDrafts || suggestionDrafts.length === 0) return;
        if (!confirm(`Discard all ${suggestionDrafts.length} suggestions?`)) return;
        try {
            await Promise.all(suggestionDrafts.map(d => discardRevision({ revisionId: d._id })));
        } catch (e) {
            alert("Failed to discard all: " + e);
        }
    };

    const handleStartEditOverview = () => {
        setOverviewDraft(memoryMarkdown ?? "");
        setIsEditingOverview(true);
    };

    const handleSaveOverview = async () => {
        await updateMemory({ projectId, markdown: overviewDraft });
        setIsEditingOverview(false);
    };

    return (
        <div className="bg-white border rounded-lg shadow-sm flex flex-col h-full overflow-hidden">
            {/* Tabs Header */}
            <div className="flex items-center border-b bg-gray-50/50">
                <button
                    className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'overview' ? 'border-blue-500 text-blue-600 bg-white' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                    onClick={() => setActiveTab('overview')}
                >
                    Overview
                </button>
                <button
                    className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'suggestions' ? 'border-blue-500 text-blue-600 bg-white' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                    onClick={() => setActiveTab('suggestions')}
                >
                    Suggestions
                    {suggestionDrafts && suggestionDrafts.length > 0 && (
                        <span className="ml-1 px-1 py-px rounded-full bg-blue-100 text-blue-700 text-[9px]">
                            {suggestionDrafts.length}
                        </span>
                    )}
                </button>
                <button
                    className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'elements' ? 'border-blue-500 text-blue-600 bg-white' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                    onClick={() => setActiveTab('elements')}
                >
                    Element
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative bg-white">

                {/* 1. OVERVIEW */}
                {activeTab === 'overview' && (
                    <div className="absolute inset-0 flex flex-col">
                        <div className="flex items-center justify-between p-2 border-b bg-gray-50/30">
                            <span className="text-[10px] font-semibold text-gray-500 flex items-center gap-1">
                                <Database size={10} /> AI Knowledge
                            </span>
                            {!isEditingOverview ? (
                                <button
                                    onClick={handleStartEditOverview}
                                    className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                >
                                    <Edit2 size={10} /> Edit
                                </button>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setIsEditingOverview(false)}
                                        className="text-[10px] text-gray-500 hover:text-gray-700"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSaveOverview}
                                        className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700"
                                    >
                                        Save
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 text-sm text-gray-800">
                            {isEditingOverview ? (
                                <textarea
                                    className="w-full h-full p-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                                    value={overviewDraft}
                                    onChange={(e) => setOverviewDraft(e.target.value)}
                                />
                            ) : (
                                memoryMarkdown ? (
                                    <div className="prose prose-sm prose-blue max-w-none [&>ul]:list-disc [&>ul]:pl-5 [&>li]:mt-0.5 text-xs">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {memoryMarkdown}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-center p-4">
                                        <Info size={24} className="text-gray-200 mb-2" />
                                        <div className="text-xs text-gray-400 italic">
                                            No knowledge accumulated yet. <br />Chat to build the project overview.
                                        </div>
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                )}

                {/* 2. SUGGESTIONS */}
                {activeTab === 'suggestions' && (
                    <div className="absolute inset-0 flex flex-col bg-slate-50 overflow-y-auto p-2 space-y-2">
                        {suggestionDrafts && suggestionDrafts.length > 0 ? (
                            <>
                                <div className="flex items-center justify-between px-1">
                                    <div className="text-[10px] font-bold text-gray-500 uppercase">Pending Actions</div>
                                    <button
                                        onClick={handleDiscardAll}
                                        className="text-[10px] text-red-600 hover:bg-red-50 px-2 py-0.5 rounded border border-transparent hover:border-red-100 transition-colors"
                                    >
                                        Discard All
                                    </button>
                                </div>
                                {suggestionDrafts.map(draft => (
                                    <div
                                        key={draft._id}
                                        className="p-2 border border-blue-200 bg-white rounded-lg shadow-sm flex flex-col gap-1.5 relative overflow-hidden"
                                    >
                                        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                        <div className="flex items-start justify-between pl-2">
                                            <div className="text-xs font-semibold text-gray-800 leading-tight">
                                                {draft.summary || "Agent Suggestion"}
                                            </div>
                                            <span className="text-[9px] text-gray-400 whitespace-nowrap ml-1">
                                                {new Date(draft.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>

                                        <div className="pl-2 space-y-1">
                                            {draft.changes.map((change, idx) => (
                                                <div key={idx} className="text-[10px] text-gray-600 flex items-center gap-2 bg-gray-50 p-1 rounded border border-gray-100">
                                                    <span className={`w-1.5 h-1.5 rounded-full ${change.changeType === 'create' ? 'bg-green-500' : 'bg-blue-500'}`}></span>
                                                    <span className="font-medium text-gray-900 truncate flex-1">{change.elementTitle}</span>
                                                    <span className="text-gray-400 text-[9px] uppercase tracking-wide">
                                                        {change.changeType}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="flex items-center gap-2 mt-1 pt-2 border-t border-gray-100 pl-2">
                                            <button
                                                className="flex-1 bg-blue-600 text-white py-1 rounded text-[10px] font-medium hover:bg-blue-700 flex items-center justify-center gap-1 transition-colors"
                                                onClick={async () => {
                                                    try {
                                                        await approveRevision({ revisionId: draft._id });
                                                    } catch (e) {
                                                        alert("Failed to approve: " + e);
                                                    }
                                                }}
                                            >
                                                <Check size={12} /> Approve
                                            </button>
                                            <button
                                                className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-[10px] font-medium hover:bg-gray-200 hover:text-red-600 transition-colors"
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
                                ))}
                            </>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
                                <CheckSquare size={32} className="opacity-20" />
                                <div className="text-xs text-center">No pending suggestions.</div>
                                <div className="text-[10px] opacity-60 text-center px-4">The agent will propose changes here when you discuss plans.</div>
                            </div>
                        )}
                    </div>
                )}

                {/* 3. ELEMENT (INSPECTOR) */}
                {activeTab === 'elements' && (
                    <div className="absolute inset-0 flex flex-col bg-slate-50 p-3">
                        {selectedItem ? (
                            <div className="flex flex-col gap-3 h-full overflow-y-auto">
                                <div className="bg-white p-3 rounded-lg border shadow-sm">
                                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Selected Element</div>
                                    <div className="text-sm font-bold text-gray-900">{selectedItem.title}</div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded border border-gray-200">
                                            {selectedItem.typeKey}
                                        </span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${selectedItem.status === 'approved' ? 'bg-green-50 text-green-700 border-green-200' :
                                                selectedItem.status === 'draft' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                                    'bg-gray-50 text-gray-600 border-gray-200'
                                            }`}>
                                            {selectedItem.status}
                                        </span>
                                    </div>
                                    {selectedItem.description && (
                                        <div className="mt-2 text-xs text-gray-600 bg-gray-50 p-2 rounded border border-gray-100">
                                            {selectedItem.description}
                                        </div>
                                    )}
                                </div>

                                {itemDrafts.length > 0 && (
                                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                                        <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-2 flex items-center gap-1">
                                            <Info size={10} /> Pending Changes
                                        </div>
                                        <div className="space-y-2">
                                            {itemDrafts.map(d => (
                                                <div key={d._id} className="bg-white p-2 rounded border border-blue-200 text-xs shadow-sm">
                                                    <div className="mb-1 text-gray-800">{d.summary}</div>
                                                    <button
                                                        className="w-full py-1 bg-blue-600 text-white rounded text-[10px] font-medium hover:bg-blue-700"
                                                        onClick={() => setActiveTab('suggestions')} // Go to suggestions to approve
                                                    >
                                                        Review in Suggestions
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="p-4 text-center">
                                    <div className="text-[10px] text-gray-400 italic">
                                        Edit details in the bottom panel.
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2">
                                <List size={32} className="opacity-20" />
                                <div className="text-xs">No element selected.</div>
                                <div className="text-[10px] opacity-60">Select an element from the left sidebar to view details.</div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
