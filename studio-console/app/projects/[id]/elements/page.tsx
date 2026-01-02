"use client";

import { FlowItemsPanel } from "../_components/planning/FlowItemsPanel";
import { StructuredEditorPanel } from "../_components/planning/StructuredEditorPanel";

export default function ElementsPage() {
    return (
        <div className="h-[calc(100vh-64px)] flex flex-col gap-4 p-4 overflow-hidden bg-gray-50">
            <div className="flex items-center justify-between flex-none">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Elements</h2>
                    <p className="text-sm text-gray-500">
                        Manage project elements and review suggestions.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-[320px_1fr] gap-4 flex-1 min-h-0">
                <div className="min-h-0 overflow-hidden">
                    <FlowItemsPanel />
                </div>
                <div className="min-h-0 overflow-hidden shadow-sm border rounded-lg bg-white">
                    <StructuredEditorPanel />
                </div>
            </div>
        </div>
    );
}