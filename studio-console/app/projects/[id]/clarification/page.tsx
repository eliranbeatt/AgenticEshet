"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

type Message = {
    role: "user" | "assistant" | "system";
    content: string;
};

type AnalysisResult = {
    briefSummary: string;
    openQuestions: string[];
    suggestedNextPhase: "stay_in_clarification" | "move_to_planning";
};

export default function ClarificationPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    
    const runClarification = useAction(api.agents.clarification.run);
    const saveClarificationDoc = useMutation(api.clarificationDocs.save);
    const planMeta = useQuery(api.projects.getPlanPhaseMeta, { projectId });
    const plans = useQuery(api.projects.getPlans, { projectId });
    const transcript = useQuery(api.conversations.recentByPhase, { projectId, phase: "clarification", limit: 10 });
    const clarificationDoc = useQuery(api.clarificationDocs.getLatest, { projectId });
    
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [lastAnalysis, setLastAnalysis] = useState<AnalysisResult | null>(null);
    const [clarificationMarkdown, setClarificationMarkdown] = useState("");
    const [isSavingDoc, setIsSavingDoc] = useState(false);

    useEffect(() => {
        if (clarificationDoc === undefined) return;
        setClarificationMarkdown(clarificationDoc?.contentMarkdown ?? "");
    }, [clarificationDoc]);

    const activePlan = useMemo<Doc<"plans"> | null>(
        () => plans?.find((plan: Doc<"plans">) => plan.isActive) ?? null,
        [plans],
    );

    const handleSend = async () => {
        if (!input.trim()) return;

        const newMessages: Message[] = [...messages, { role: "user", content: input }];
        setMessages(newMessages);
        setInput("");
        setIsLoading(true);

        try {
            const result = await runClarification({
                projectId,
                chatHistory: newMessages,
            });

            let replyContent = "";
            if (result.openQuestions && result.openQuestions.length > 0) {
                replyContent += "**Follow-up Questions:**\n" + result.openQuestions.map((q: string) => `- ${q}`).join("\n");
            } else {
                replyContent += "Clarification complete! Check the summary.";
            }

            setMessages((prev) => [...prev, { role: "assistant", content: replyContent }]);
            setLastAnalysis(result as AnalysisResult);
        } catch (err) {
            console.error(err);
            setMessages((prev) => [...prev, { role: "system", content: "Error running agent. Please try again." }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveDoc = async () => {
        setIsSavingDoc(true);
        try {
            await saveClarificationDoc({
                projectId,
                contentMarkdown: clarificationMarkdown,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to save clarification document";
            alert(message);
        } finally {
            setIsSavingDoc(false);
        }
    };

    return (
        <div className="space-y-6">
            <PhaseBadges
                projectReady={Boolean(clarificationDoc?.contentMarkdown?.trim())}
                activePlanLabel={
                    planMeta?.activePlan ? `Active plan v${planMeta.activePlan.version}` : "Plan pending approval"
                }
            />
            <div className="grid gap-6 lg:grid-cols-[3fr,2fr]">
                <div className="space-y-6">
                    <div className="flex flex-col bg-white rounded shadow-sm border h-[520px]">
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {messages.length === 0 && (
                                <div className="text-center text-gray-500 mt-10">
                                    <p>Start the clarification process by describing the project requirements.</p>
                                </div>
                            )}
                            {messages.map((msg, i) => (
                                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                                    <div className={`max-w-[80%] rounded-lg p-3 ${
                                        msg.role === "user" 
                                            ? "bg-blue-600 text-white" 
                                            : "bg-gray-100 text-gray-800"
                                    }`}>
                                        <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div className="flex justify-start">
                                    <div className="bg-gray-50 text-gray-400 text-xs p-2 rounded">Agent is thinking...</div>
                                </div>
                            )}
                        </div>
                        
                        <div className="p-4 border-t">
                            <div className="flex gap-2">
                                <textarea
                                    className="flex-1 border rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    rows={3}
                                    placeholder="Describe requirements, budget, or timeline..."
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={isLoading}
                                    className="bg-blue-600 text-white px-4 py-2 rounded font-medium disabled:opacity-50 hover:bg-blue-700"
                                >
                                    Send
                                </button>
                            </div>
                        </div>
                    </div>

                    <TranscriptPanel conversations={transcript || []} emptyCopy="No logged clarification runs yet." />
                </div>

                <div className="space-y-6">
                    <div className="bg-white rounded shadow-sm border p-4">
                        <h2 className="text-lg font-bold mb-4 text-gray-800">Current Analysis</h2>
                        
                        {!lastAnalysis ? (
                            <div className="text-gray-400 text-sm">No analysis yet. Chat to generate.</div>
                        ) : (
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-xs font-bold uppercase text-gray-500 mb-2">Brief Summary</h3>
                                    <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded border">
                                        {lastAnalysis.briefSummary}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-xs font-bold uppercase text-gray-500 mb-2">Open Questions</h3>
                                    {lastAnalysis.openQuestions.length === 0 ? (
                                        <p className="text-sm text-green-600">All clear!</p>
                                    ) : (
                                        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                            {lastAnalysis.openQuestions.map((q, i) => (
                                                <li key={i}>{q}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                <div>
                                    <h3 className="text-xs font-bold uppercase text-gray-500 mb-2">Status</h3>
                                    <div className={`text-sm font-medium px-2 py-1 rounded inline-block ${
                                        lastAnalysis.suggestedNextPhase === "move_to_planning"
                                            ? "bg-green-100 text-green-800"
                                            : "bg-yellow-100 text-yellow-800"
                                    }`}>
                                        {lastAnalysis.suggestedNextPhase === "move_to_planning" ? "Ready for Planning" : "Needs Clarification"}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <ActivePlanCard plan={activePlan} />
                </div>

                <div className="space-y-6">
                    <div className="bg-white rounded shadow-sm border overflow-hidden flex flex-col h-[520px]">
                        <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                            <div>
                                <h2 className="text-sm font-bold uppercase text-gray-600">Clarification document (Markdown)</h2>
                                <p className="text-xs text-gray-500">This is the editable source used by planning.</p>
                            </div>
                            <button
                                onClick={handleSaveDoc}
                                disabled={isSavingDoc}
                                className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
                            >
                                {isSavingDoc ? "Saving..." : "Save"}
                            </button>
                        </div>
                        <div className="flex-1 p-4">
                            <textarea
                                className="w-full h-full border rounded p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={`# Clarifications\n\n## Goals\n- ...\n\n## Scope\n- In scope: ...\n- Out of scope: ...\n\n## Assumptions\n- ...\n\n## Open questions\n- ...\n`}
                                value={clarificationMarkdown}
                                onChange={(e) => setClarificationMarkdown(e.target.value)}
                            />
                        </div>
                    </div>

                    <TranscriptPanel
                        conversations={transcript || []}
                        emptyCopy="No clarification transcripts yet."
                    />
                </div>
            </div>
        </div>
    );
}

function PhaseBadges({ projectReady, activePlanLabel }: { projectReady: boolean; activePlanLabel: string }) {
    return (
        <div className="flex flex-wrap gap-3">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${projectReady ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                Clarification {projectReady ? "captured" : "pending"}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                {activePlanLabel}
            </span>
        </div>
    );
}

function TranscriptPanel({ conversations, emptyCopy }: { conversations: Doc<"conversations">[]; emptyCopy: string }) {
    return (
        <div className="bg-white rounded shadow-sm border p-4">
            <h3 className="text-sm font-semibold text-gray-600 uppercase mb-4">Transcript history</h3>
            <div className="space-y-3 max-h-60 overflow-y-auto">
                {conversations.map((conversation) => {
                    const lastAssistant = parseLastAssistant(conversation.messagesJson);
                    return (
                        <div key={conversation._id} className="border rounded p-3 text-sm">
                            <div className="text-xs text-gray-500 flex justify-between mb-1">
                                <span>{new Date(conversation.createdAt).toLocaleString()}</span>
                                <span className="capitalize">{conversation.agentRole.replace("_", " ")}</span>
                            </div>
                            <p className="text-gray-800 line-clamp-3 whitespace-pre-line">{lastAssistant || "No assistant output"}</p>
                        </div>
                    );
                })}
                {conversations.length === 0 && <p className="text-sm text-gray-400">{emptyCopy}</p>}
            </div>
        </div>
    );
}

function parseLastAssistant(messagesJson: string) {
    try {
        const parsed = JSON.parse(messagesJson) as { role: string; content: string }[];
        return [...parsed].reverse().find((msg) => msg.role === "assistant")?.content ?? "";
    } catch {
        return "";
    }
}

function ActivePlanCard({ plan }: { plan: Doc<"plans"> | null }) {
    if (!plan) {
        return (
            <div className="bg-white rounded shadow-sm border p-6 text-sm text-gray-500">
                <p>No approved plan yet. Approve one in the Planning tab to expose it here.</p>
            </div>
        );
    }
    return (
        <div className="bg-white rounded shadow-sm border p-6 space-y-3">
            <div className="flex justify-between items-center">
                <div>
                    <h3 className="text-sm font-bold text-gray-800">Active Plan v{plan.version}</h3>
                    <p className="text-xs text-gray-500">Approved {new Date(plan.createdAt).toLocaleString()}</p>
                </div>
                <span className="text-xs uppercase bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Active</span>
            </div>
            {plan.reasoning && (
                <p className="text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded p-2">
                    {plan.reasoning}
                </p>
            )}
            <p className="text-sm text-gray-800 whitespace-pre-line line-clamp-6">{plan.contentMarkdown}</p>
        </div>
    );
}
