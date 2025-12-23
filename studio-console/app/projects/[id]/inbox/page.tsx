"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id, type Doc } from "@/convex/_generated/dataModel";
import { useParams } from "next/navigation";
import { useState } from "react";

export default function ProjectInboxPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const inboxItems = useQuery(api.inbox.list, { projectId }) as Array<Doc<"inboxItems">> | undefined;
    const [selectedItemId, setSelectedItemId] = useState<Id<"inboxItems"> | null>(null);

    const selectedItem = inboxItems?.find((item) => item._id === selectedItemId);

    return (
        <div className="flex h-full">
            {/* List View */}
            <div className="w-1/3 border-r border-gray-200 overflow-y-auto">
                <div className="p-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold">Inbox</h2>
                </div>
                <div className="divide-y divide-gray-200">
                    {inboxItems?.map((item) => (
                        <div 
                            key={item._id} 
                            onClick={() => setSelectedItemId(item._id)}
                            className={`p-4 cursor-pointer hover:bg-gray-50 ${selectedItemId === item._id ? 'bg-blue-50' : ''}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-medium text-sm truncate">{item.fromName || item.fromAddressOrPhone || "Unknown"}</span>
                                <span className="text-xs text-gray-500">{new Date(item.receivedAt).toLocaleDateString()}</span>
                            </div>
                            <div className="text-sm font-medium text-gray-900 truncate">{item.subject || "(No Subject)"}</div>
                            <div className="text-xs text-gray-500 truncate mt-1">{item.bodyText}</div>
                            <div className="mt-2 flex gap-2">
                                <span className={`px-2 py-0.5 text-xs rounded-full ${
                                    item.status === 'new' ? 'bg-blue-100 text-blue-800' : 
                                    item.status === 'triaged' ? 'bg-green-100 text-green-800' : 
                                    'bg-gray-100 text-gray-800'
                                }`}>
                                    {item.status}
                                </span>
                                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full capitalize">
                                    {item.source}
                                </span>
                            </div>
                        </div>
                    ))}
                    {inboxItems?.length === 0 && (
                        <div className="p-8 text-center text-gray-500">No items in inbox</div>
                    )}
                </div>
            </div>

            {/* Detail View */}
            <div className="w-2/3 overflow-y-auto p-6">
                {selectedItem ? (
                    <InboxItemDetail item={selectedItem} />
                ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                        Select an item to view details
                    </div>
                )}
            </div>
        </div>
    );
}

function InboxItemDetail({ item }: { item: Doc<"inboxItems"> }) {
    const acceptSuggestions = useMutation(api.inbox.acceptSuggestions);
    const [accepting, setAccepting] = useState(false);

    const handleAccept = async (tasks: number[], decisions: number[] = [], questions: number[] = []) => {
        setAccepting(true);
        try {
            await acceptSuggestions({
                inboxItemId: item._id,
                acceptedTasks: tasks,
                acceptedDecisions: decisions,
                acceptedQuestions: questions,
            });
        } catch (e) {
            console.error("Failed to accept", e);
            alert("Failed to accept suggestions");
        } finally {
            setAccepting(false);
        }
    };

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold mb-2">{item.subject || "(No Subject)"}</h1>
                <div className="text-sm text-gray-600 mb-4">
                    From: <span className="font-medium">{item.fromName}</span> ({item.fromAddressOrPhone})
                    <span className="mx-2">•</span>
                    {new Date(item.receivedAt).toLocaleString()}
                </div>
                <div className="prose max-w-none bg-gray-50 p-4 rounded-lg text-sm">
                    {item.bodyText}
                </div>
                {item.attachments?.length > 0 && (
                    <div className="mt-4">
                        <h4 className="text-sm font-medium mb-2">Attachments</h4>
                        <div className="flex gap-2 flex-wrap">
                            {item.attachments.map((att: { name: string; sizeBytes?: number }, i: number) => (
                                <div key={i} className="border rounded px-3 py-2 text-sm bg-white flex items-center gap-2">
                                    <span className="text-gray-500">📎</span>
                                    {att.name}
                                    <span className="text-xs text-gray-400">({(((att.sizeBytes ?? 0) / 1024)).toFixed(0)} KB)</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Triage Section */}
            <div className="border-t border-gray-200 pt-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    AI Suggestions
                    {item.suggestions?.triage?.status === "running" && <span className="text-xs font-normal text-blue-600">(Analyzing...)</span>}
                </h3>

                {item.suggestions?.tasksDraft?.length > 0 && (
                    <div className="mb-6">
                        <h4 className="text-sm font-medium text-gray-700 mb-2 uppercase tracking-wide">Suggested Tasks</h4>
                        <div className="space-y-3">
                            {item.suggestions.tasksDraft.map(
                                (
                                    task: { title: string; details: string; tags: string[]; priority?: string },
                                    i: number,
                                ) => (
                                <div key={i} className="border border-blue-100 bg-blue-50 rounded-lg p-4">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-medium text-blue-900">{task.title}</div>
                                            <div className="text-sm text-blue-700 mt-1">{task.details}</div>
                                            <div className="flex gap-2 mt-2">
                                                {task.tags.map((tag: string) => (
                                                    <span key={tag} className="text-xs bg-white text-blue-600 px-2 py-0.5 rounded border border-blue-200">{tag}</span>
                                                ))}
                                                {task.priority && <span className="text-xs bg-white text-orange-600 px-2 py-0.5 rounded border border-orange-200">{task.priority}</span>}
                                            </div>
                                        </div>
                                        {item.status !== "triaged" && (
                                            <button 
                                                onClick={() => handleAccept([i])}
                                                disabled={accepting}
                                                className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                Accept
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {item.suggestions?.decisionsDraft?.length > 0 && (
                    <div className="mb-6">
                        <h4 className="text-sm font-medium text-gray-700 mb-2 uppercase tracking-wide">Suggested Decisions</h4>
                        <div className="space-y-3">
                            {item.suggestions.decisionsDraft.map(
                                (
                                    decision: { title: string; details?: string; options?: string[] },
                                    i: number,
                                ) => (
                                <div key={i} className="border border-purple-100 bg-purple-50 rounded-lg p-4">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-medium text-purple-900">{decision.title}</div>
                                            {decision.details && <div className="text-sm text-purple-700 mt-1">{decision.details}</div>}
                                            {decision.options && decision.options.length > 0 && (
                                                <ul className="mt-2 list-disc list-inside text-xs text-purple-800">
                                                    {decision.options.map((opt, idx) => (
                                                        <li key={idx}>{opt}</li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                        {item.status !== "triaged" && (
                                            <button 
                                                onClick={() => handleAccept([], [i], [])}
                                                disabled={accepting}
                                                className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded hover:bg-purple-700 disabled:opacity-50"
                                                title="Creates a task to make this decision"
                                            >
                                                Accept
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {item.suggestions?.questionsDraft?.length > 0 && (
                    <div className="mb-6">
                        <h4 className="text-sm font-medium text-gray-700 mb-2 uppercase tracking-wide">Suggested Questions</h4>
                        <div className="space-y-3">
                            {item.suggestions.questionsDraft.map(
                                (
                                    question: { question: string; reason?: string; priority?: string },
                                    i: number,
                                ) => (
                                <div key={i} className="border border-orange-100 bg-orange-50 rounded-lg p-4">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-medium text-orange-900">{question.question}</div>
                                            {question.reason && <div className="text-sm text-orange-700 mt-1">{question.reason}</div>}
                                            {question.priority && (
                                                <div className="mt-2">
                                                    <span className="text-xs bg-white text-orange-600 px-2 py-0.5 rounded border border-orange-200">{question.priority}</span>
                                                </div>
                                            )}
                                        </div>
                                        {item.status !== "triaged" && (
                                            <button 
                                                onClick={() => handleAccept([], [], [i])}
                                                disabled={accepting}
                                                className="text-xs bg-orange-600 text-white px-3 py-1.5 rounded hover:bg-orange-700 disabled:opacity-50"
                                                title="Creates a task to answer this question"
                                            >
                                                Accept
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {item.status === "triaged" && (
                    <div className="text-center p-4 bg-green-50 text-green-800 rounded-lg">
                        ✓ This item has been triaged
                    </div>
                )}
            </div>
        </div>
    );
}
