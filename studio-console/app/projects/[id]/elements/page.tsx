"use client";

import { FlowItemsPanel } from "../_components/planning/FlowItemsPanel";
import { ElementsOutlinePanel } from "../_components/elements/ElementsOutlinePanel";

export default function ElementsPage() {
    return (
        <div className="h-[calc(100vh-64px)] flex flex-col gap-4 p-4 overflow-hidden bg-gray-50">
            <div className="flex items-center justify-between flex-none">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Element Explorer</h2>
                    <p className="text-sm text-gray-500">
                        Navigate elements, inspect details, and edit drafts in context.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-4 flex-1 min-h-0">
                <div className="min-h-0 overflow-hidden">
                    <FlowItemsPanel />
                </div>
                <div className="min-h-0 overflow-hidden">
                    <ElementsOutlinePanel />
                </div>
            </div>
        </div>
    );
}
