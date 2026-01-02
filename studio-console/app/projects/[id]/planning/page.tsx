"use client";

import { FlowItemsPanel } from "../_components/planning/FlowItemsPanel";
import { PlanningChat } from "../_components/planning/PlanningChat";
import { StructuredEditorPanel } from "../_components/planning/StructuredEditorPanel";
import { useItemsContext } from "../_components/items/ItemsContext";

export default function PlanningPage() {
    // const { projectId, selectedAllProject, selectedItemIds } = useItemsContext();

    return (
        <div className="h-[calc(100vh-64px)] flex flex-col gap-4 p-4 overflow-hidden bg-gray-50">
            {/* Top Section: Sidebar, Chat, Context */}
            <div className="grid grid-cols-[300px_1fr_300px] gap-4 min-h-0 flex-1">
                {/* Left Column: Elements */}
                <div className="flex flex-col gap-4 min-h-0 overflow-hidden">
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <FlowItemsPanel />
                    </div>
                </div>

                {/* Center Column: Chat */}
                <div className="min-h-0 overflow-hidden">
                    <PlanningChat />
                </div>

                {/* Right Column: Context / Details */}
                <div className="bg-white border rounded-lg shadow-sm p-4 min-h-0 overflow-hidden flex flex-col">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Context</div>
                    <div className="flex-1 text-sm text-gray-500 overflow-y-auto">
                        <p>Project context and knowledge will appear here.</p>
                        {/* Future: Add AgentActivityPanel or KnowledgeView here */}
                    </div>
                </div>
            </div>

            {/* Bottom Section: Editor */}
            <div className="h-[40%] flex-none min-h-[300px] max-h-[600px]">
                <StructuredEditorPanel />
            </div>
        </div>
    );
}