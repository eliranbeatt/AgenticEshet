import { FlowItemsPanel } from "../_components/planning/FlowItemsPanel";
import { PlanningChat } from "../_components/planning/PlanningChat";
import { StructuredEditorPanel } from "../_components/planning/StructuredEditorPanel";
import { StructuredQuestionsPanel } from "../_components/flow/StructuredQuestionsPanel";
import { useItemsContext } from "../_components/items/ItemsContext";

export default function PlanningPage() {
    const { projectId } = useItemsContext();

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

                {/* Right Column: Context / QUESTIONS */}
                <div className="bg-white border rounded-lg shadow-sm min-h-0 overflow-hidden flex flex-col">
                    {/* We removed the static header to let the panel own the header or full space */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <StructuredQuestionsPanel projectId={projectId} stage="planning" />
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