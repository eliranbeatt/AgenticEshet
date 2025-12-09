"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

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
    
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [lastAnalysis, setLastAnalysis] = useState<AnalysisResult | null>(null);

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

            // The agent returns the structural analysis, but we want to display a text message too.
            // We'll construct a message from the analysis.
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

    return (
        <div className="flex h-[calc(100vh-12rem)] gap-6">
            {/* Left: Chat */}
            <div className="flex-1 flex flex-col bg-white rounded shadow-sm border">
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

            {/* Right: Analysis Panel */}
            <div className="w-1/3 bg-white rounded shadow-sm border p-4 overflow-y-auto">
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
        </div>
    );
}
