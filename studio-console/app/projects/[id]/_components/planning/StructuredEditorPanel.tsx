"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useItemsContext } from "../items/ItemsContext";
import { ItemEditorPanel } from "../items/ItemEditorPanel";
import { X } from "lucide-react";

export function StructuredEditorPanel() {
    const { 
        selectedItemId, 
        selectedItemIds, 
        setSelectedItemId, 
        toggleItemSelection 
    } = useItemsContext();

    const projectId = useItemsContext().projectId; // Get projectId from context

    // We need to fetch titles for the tabs. 
    // Optimization: The sidebar already fetches them. We could maybe access them if we lifted state or used a query here.
    // listTreeSidebar is cached, so calling it here again should be cheap/instant if already loaded in sidebar.
    const sidebar = useQuery(api.items.listTreeSidebar, { projectId, includeDrafts: true });
    
    const selectedItemsDetails = useMemo(() => {
        if (!sidebar?.items) return [];
        return sidebar.items.filter(item => selectedItemIds.includes(item._id));
    }, [sidebar, selectedItemIds]);

    if (!selectedItemId && selectedItemIds.length === 0) {
        return (
            <div className="bg-white border rounded-lg shadow-sm p-8 text-center text-gray-400 h-full flex flex-col justify-center items-center">
                <div className="mb-2">Select an element to edit</div>
                <div className="text-xs">Choose from the list above to view details</div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white border rounded-lg shadow-sm overflow-hidden">
            {/* Header / Tabs */}
            <div className="bg-gray-50 border-b flex flex-col">
                <div className="px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wide">
                    STRUCTURED EDITOR {selectedItemId && <span className="font-normal normal-case text-gray-400 ml-2">- {selectedItemsDetails.find(i => i._id === selectedItemId)?.title ?? "Loading..."}</span>}
                </div>
                
                {/* Multi-selection Tabs */}
                {selectedItemIds.length > 0 && (
                    <div className="flex overflow-x-auto px-2 gap-1 pb-0 scrollbar-hide">
                        {selectedItemsDetails.map(item => {
                            const isActive = selectedItemId === item._id;
                            return (
                                <div 
                                    key={item._id}
                                    onClick={() => setSelectedItemId(item._id)}
                                    className={`
                                        flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-t-lg border-t border-x cursor-pointer min-w-[100px] max-w-[200px]
                                        ${isActive 
                                            ? "bg-white border-gray-200 border-b-white text-blue-700 -mb-px z-10" 
                                            : "bg-gray-100 border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                                        }
                                    `}
                                >
                                    <span className="truncate flex-1">{item.title}</span>
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleItemSelection(item._id);
                                            // If we closed the active one, logic in Context or Effect should probably handle switching to another
                                            // But for now, let's just let it close.
                                            if (isActive && selectedItemIds.length > 1) {
                                                const next = selectedItemIds.find(id => id !== item._id);
                                                if (next) setSelectedItemId(next);
                                                else setSelectedItemId(null);
                                            } else if (isActive) {
                                                setSelectedItemId(null);
                                            }
                                        }}
                                        className="text-gray-400 hover:text-red-500 p-0.5 rounded-full hover:bg-gray-200"
                                    >
                                        <X size={10} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                 <ItemEditorPanel />
            </div>
        </div>
    );
}
