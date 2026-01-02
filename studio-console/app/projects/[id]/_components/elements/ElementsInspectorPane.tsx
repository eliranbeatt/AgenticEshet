"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useItemsContext } from "../items/ItemsContext";
import { ItemEditorPanel } from "../items/ItemEditorPanel";

export function ElementsInspectorPane() {
    const { selectedItemId } = useItemsContext();

    const item = useQuery(
        api.items.getItem,
        selectedItemId ? { itemId: selectedItemId } : "skip",
    );

    if (!selectedItemId) {
        return (
            <div className="bg-white border rounded-lg shadow-sm p-6 text-center text-sm text-gray-400 h-full flex flex-col justify-center items-center">
                <div className="font-semibold text-gray-500">Inspector</div>
                <div className="text-xs">Pick a node to edit its details.</div>
            </div>
        );
    }

    return (
        <div className="bg-white border rounded-lg shadow-sm flex flex-col h-full overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50/70">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Inspector</div>
                <div className="text-lg font-semibold text-gray-900 truncate">
                    {item?.item?.title ?? "Element"}
                </div>
                <div className="text-xs text-gray-500">
                    {item?.item?.typeKey ?? "Type"} • {item?.item?.status ?? "Status"}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
                <ItemEditorPanel />
            </div>
        </div>
    );
}
