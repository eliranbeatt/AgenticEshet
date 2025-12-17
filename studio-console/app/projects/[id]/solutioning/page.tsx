"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function SolutioningPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    // --- State ---
    const [selectedItemId, setSelectedItemId] = useState<Id<"materialLines"> | null>(null);
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const [useWebSearch, setUseWebSearch] = useState(false);

    // Editor State
    const [solutionDraft, setSolutionDraft] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    // --- Data ---
    const items = useQuery(api.agents.solutioning.getPlanningItems, { projectId });

    // We only fetch conversation if an item is selected
    const conversation = useQuery(
        api.agents.solutioning.getConversation,
        selectedItemId ? { projectId, itemId: selectedItemId } : "skip" // "skip" if null
    );

    const chatMutation = useMutation(api.agents.solutioning.chat);
    const updateSolutionMutation = useMutation(api.agents.solutioning.updateSolution);

    // --- Effects ---
    // Update draft when selection changes to the saved plan
    useEffect(() => {
        if (selectedItemId && items) {
            const item = items.find(i => i._id === selectedItemId);
            if (item) {
                setSolutionDraft(item.solutionPlan || "");
            }
        }
    }, [selectedItemId, items]);

    // Scroll to bottom of chat
    const messagesEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [conversation, isTyping]);

    // --- Handlers ---

    const handleSend = async () => {
        if (!input.trim() || !selectedItemId) return;

        const msg = input;
        setInput("");
        setIsTyping(true);

        try {
            const result = await chatMutation({
                projectId,
                itemId: selectedItemId,
                message: msg,
                useWebSearch
            });

            // If the agent suggested a plan and the box is empty or user wants to overwrite?
            // Let's just append it or notify. 
            // Better: If result.suggestedPlan is present, we CAN explicitly set it, or maybe just show it in the chat?
            // The prompt says "Output JSON... suggestedPlan...".
            if (result.suggestedPlan) {
                // We'll update the draft if it's empty, otherwise maybe prompt? 
                // For now, let's just update if the user hasn't edited much, or append?
                // Safest is to let the user see it in chat or auto-fill if empty.
                // Let's auto-fill if empty, or append to chat? 
                // Actually, let's update the draft state directly so the user sees the proposal in the "Selected Solution" window.
                setSolutionDraft(result.suggestedPlan);
            }
        } catch (e) {
            console.error(e);
            alert("Failed to send message: " + (e instanceof Error ? e.message : String(e)));
        } finally {
            setIsTyping(false);
        }
    };

    const handleSaveSolution = async () => {
        if (!selectedItemId || !solutionDraft.trim()) return;
        setIsSaving(true);
        try {
            await updateSolutionMutation({
                itemId: selectedItemId,
                solutionPlan: solutionDraft,
            });
            // Maybe show a toast?
        } catch (e) {
            alert("Failed to save: " + e);
        } finally {
            setIsSaving(false);
        }
    };

    // Derived
    const selectedItem = items?.find(i => i._id === selectedItemId);

    return (
        <div className="h-[calc(100vh-6rem)] flex flex-col gap-4">
            <header className="flex justify-between items-center py-2 border-b">
                <h1 className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                    Solutioning Studio
                </h1>
                <div className="text-sm text-gray-500">
                    Define production methods for {items?.length || 0} items
                </div>
            </header>

            <div className="flex-1 flex gap-6 overflow-hidden">
                {/* LEFT: Item List */}
                <div className="w-1/4 flex flex-col bg-white border rounded shadow-sm">
                    <div className="p-3 border-b bg-gray-50 font-semibold text-sm text-gray-700">
                        Planning Items
                    </div>
                    <div className="overflow-y-auto flex-1 p-2 space-y-2">
                        {items?.map((item) => (
                            <div
                                key={item._id}
                                onClick={() => setSelectedItemId(item._id)}
                                className={`p-3 rounded cursor-pointer border transition-colors ${selectedItemId === item._id
                                        ? "bg-blue-50 border-blue-400 ring-1 ring-blue-200"
                                        : "bg-white border-gray-100 hover:bg-gray-50 hover:border-gray-200"
                                    }`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-medium text-gray-800 text-sm line-clamp-2">{item.label}</span>
                                    {item.solutioned && (
                                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                            Fixed
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-gray-500 flex justify-between">
                                    <span>{item.category}</span>
                                    <span>{item.plannedQuantity} {item.unit}</span>
                                </div>
                                <div className="text-[10px] text-gray-400 mt-1 truncate">
                                    In: {item.sectionName}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* MIDDLE: Conversation */}
                <div className="w-2/5 flex flex-col bg-white border rounded shadow-sm">
                    <div className="p-3 border-b bg-gray-50 font-semibold text-sm text-gray-700 flex justify-between items-center">
                        <span>Agent Conversation</span>
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useWebSearch}
                                    onChange={e => setUseWebSearch(e.target.checked)}
                                    className="rounded border-gray-300"
                                />
                                Enable Web Search
                            </label>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                        {!selectedItem ? (
                            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                                Select an item to start solutioning
                            </div>
                        ) : (
                            <>
                                {conversation?.map((msg, idx) => (
                                    <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                                        <div className={`max-w-[85%] p-3 rounded-lg text-sm shadow-sm ${msg.role === "user"
                                                ? "bg-blue-600 text-white rounded-br-none"
                                                : "bg-white border text-gray-800 rounded-bl-none"
                                            }`}>
                                            <div className="whitespace-pre-wrap">{msg.content}</div>
                                        </div>
                                    </div>
                                ))}
                                {isTyping && (
                                    <div className="flex justify-start">
                                        <div className="bg-gray-200 text-gray-500 text-xs px-3 py-2 rounded-full animate-pulse">
                                            Agent is thinking...
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </>
                        )}
                    </div>

                    <div className="p-3 border-t bg-white">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                className="flex-1 border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={selectedItem ? "Ask about materials, dimensions, vendors..." : "Select an item..."}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                                disabled={!selectedItem || isTyping}
                            />
                            <button
                                onClick={handleSend}
                                disabled={!selectedItem || isTyping || !input.trim()}
                                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>

                {/* RIGHT: Solution Editor */}
                <div className="flex-1 flex flex-col bg-white border rounded shadow-sm">
                    <div className="p-3 border-b bg-gray-50 font-semibold text-sm text-gray-700 flex justify-between items-center">
                        <span>Selected Solution</span>
                        {selectedItem && (
                            <button
                                onClick={handleSaveSolution}
                                disabled={isSaving || !solutionDraft.trim()}
                                className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 disabled:opacity-50"
                            >
                                {isSaving ? "Applying..." : "Apply to Plan"}
                            </button>
                        )}
                    </div>

                    {!selectedItem ? (
                        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm bg-gray-50">
                            Select an item to view or edit its plan
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col h-full">
                            <div className="p-2 bg-blue-50 border-b text-xs text-blue-800 flex flex-col gap-1">
                                <div><strong>Item:</strong> {selectedItem.label}</div>
                                <div><strong>Original Plan:</strong> {selectedItem.note || "No specific note"}</div>
                            </div>
                            <textarea
                                className="flex-1 w-full p-4 resize-none focus:outline-none text-sm font-mono leading-relaxed"
                                placeholder="# Production Plan\n\n1. Cut material...\n2. Assemble..."
                                value={solutionDraft}
                                onChange={(e) => setSolutionDraft(e.target.value)}
                                dir="auto"
                            />
                            <div className="p-2 border-t bg-gray-50 text-[10px] text-gray-400">
                                This text will be saved as the official production method for accounting.
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
