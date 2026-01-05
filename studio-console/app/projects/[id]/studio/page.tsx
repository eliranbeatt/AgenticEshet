"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AgentChatThread } from "../_components/chat/AgentChatThread";
import { useThinkingMode } from "@/app/_context/ThinkingModeContext";
import { useModel } from "@/app/_context/ModelContext";

import { PrintingPanel } from "./_components/PrintingPanel";
import { TrelloPanel } from "./_components/TrelloPanel";
import { ArtifactInspector } from "../_components/inspector/ArtifactInspector";

// ... (existing imports)

const STAGES = [
    "auto",
    "ideation",
    "planning",
    "solutioning",
    "procurement",
    "scheduling",
    "critique",
    "retro",
    "printing",
    "trello",
] as const;

type StagePin = typeof STAGES[number];

function StageSelector({
    current,
    onChange,
}: {
    current?: string | null;
    onChange?: (next: StagePin) => void;
}) {
    const normalized: StagePin = STAGES.includes(current as StagePin) ? (current as StagePin) : "auto";

    return (
        <select
            className="text-xs border rounded p-1 bg-white"
            value={normalized}
            onChange={(e) => {
                const next = e.target.value as StagePin;
                onChange?.(next);
            }}
        >
            {STAGES.map((stage) => (
                <option key={stage} value={stage}>
                    {stage}
                </option>
            ))}
        </select>
    );
}

function TimelineEvent({ event }: { event: any }) {
    return (
        <div className="flex gap-2 text-xs py-2 border-b last:border-0">
            <div className={`w-2 h-2 mt-1 rounded-full ${event.level === "error" ? "bg-red-500" : "bg-blue-400"}`} />
            <div>
                <div className="font-semibold text-gray-700">{new Date(event.ts).toLocaleTimeString()}</div>
                <div className="text-gray-600">{event.message}</div>
            </div>
        </div>
    );
}

// --- Main Page ---

export default function StudioPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    
    // State
    const [activeTab, setActiveTab] = useState("Overview");
    const [isAutoRunning, setIsAutoRunning] = useState(false);
    
    // Data
    const workspace = useQuery(api.agents.controller.getWorkspaceState, { projectId });
    const runControllerStep = useAction(api.agents.controller.runControllerStep); // The new action
    
    // If no workspace yet, we might want to ensure one exists (mutation). 
    // For now assuming existing project creates one lazily or we handle null.

    // Thread for chat
    const threadId = workspace?.threadId;

    const handleContinueAuto = async () => {
        if (!threadId) return; // Should ensure thread exists
        setIsAutoRunning(true);
        try {
             // In a real loop, we might call this repeatedly until "STOP_*" status is returned.
             // For the prototype, one step.
             const result = await runControllerStep({ projectId, threadId });
             console.log("Controller Step Result:", result);
             // TODO: Handle STOP_QUESTIONS (open modal), STOP_APPROVAL (open banner)
        } catch (e) {
            console.error(e);
        } finally {
            setIsAutoRunning(false);
        }
    };

    return (
        <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-gray-50">
            {/* Left: Chat & Timeline */}
            <div className="flex-1 flex flex-col min-w-0">
                
                {/* Top Bar */}
                <div className="h-12 border-b bg-white px-4 flex items-center justify-between shadow-sm z-10">
                    <div className="flex items-center gap-3">
                        <span className="font-bold text-gray-700">Studio Agent</span>
                        <div className="h-4 w-px bg-gray-300" />
                        <span className="text-xs text-gray-500">Stage:</span>
                        <StageSelector current={workspace?.stagePinned} onChange={() => {}} />
                        <span className="text-xs text-gray-500">Skill:</span>
                        <select className="text-xs border rounded p-1 bg-white" disabled>
                            <option>Auto</option>
                        </select>
                    </div>
                    <div>
                        <button
                            onClick={handleContinueAuto}
                            disabled={isAutoRunning}
                            className={`px-4 py-1.5 rounded text-xs font-bold text-white shadow-sm transition-colors ${
                                isAutoRunning ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
                            }`}
                        >
                            {isAutoRunning ? "Thinking..." : "Continue (Auto)"}
                        </button>
                    </div>
                </div>

                {/* Main Split: Chat vs Timeline */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Chat Area */}
                    <div className="flex-1 flex flex-col border-r bg-white">
                        {threadId ? (
                            <AgentChatThread
                                threadId={threadId}
                                heightClassName="h-full border-none shadow-none"
                                placeholder="Give instructions or answer questions..."
                                onSend={async (txt) => {
                                    // Manual chat turn
                                    console.log("Send", txt);
                                }}
                            />
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                                Initializing Workspace...
                            </div>
                        )}
                    </div>

                    {/* Timeline (Hidden on small screens maybe, or collapsible) */}
                    <div className="w-[250px] bg-gray-50 border-r flex flex-col">
                        <div className="p-2 border-b text-xs font-bold text-gray-500 uppercase">Run Timeline</div>
                        <div className="flex-1 overflow-y-auto p-2">
                             {/* Mock Timeline Events */}
                             <TimelineEvent event={{ ts: Date.now(), level: "info", message: "Agent started" }} />
                             <TimelineEvent event={{ ts: Date.now(), level: "info", message: "Checked 5 facts" }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Right: Artifact Inspector */}
            <ArtifactInspector
                activeTab={activeTab}
                onChangeTab={setActiveTab}
                tabs={[
                    {
                        key: "Overview",
                        label: "Overview",
                        content: (
                            <div className="p-4 text-gray-400 text-center mt-10 text-sm">
                                Overview Content Area
                                <br />
                                (Coming Soon)
                            </div>
                        ),
                    },
                    {
                        key: "Elements",
                        label: "Elements",
                        content: (
                            <div className="p-4 text-gray-400 text-center mt-10 text-sm">
                                Elements Content Area
                                <br />
                                (Coming Soon)
                            </div>
                        ),
                    },
                    {
                        key: "Tasks",
                        label: "Tasks",
                        content: (
                            <div className="p-4 text-gray-400 text-center mt-10 text-sm">
                                Tasks Content Area
                                <br />
                                (Coming Soon)
                            </div>
                        ),
                    },
                    { key: "Printing", label: "Printing", content: <PrintingPanel projectId={projectId} /> },
                    { key: "Trello", label: "Trello", content: <TrelloPanel projectId={projectId} /> },
                ]}
            />
        </div>
    );
}
