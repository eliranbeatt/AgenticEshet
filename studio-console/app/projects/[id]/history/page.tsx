"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

type ConversationMessage = {
    role: string;
    content: string;
};

export default function HistoryPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const project = useQuery(api.projects.getProject, { projectId });
    const elementsCanonical = project?.features?.elementsCanonical ?? false;

    if (elementsCanonical) {
        return <ElementVersionHistory projectId={projectId} />;
    }

    return <ConversationHistory projectId={projectId} />;
}

function ElementVersionHistory({ projectId }: { projectId: Id<"projects"> }) {
    const versions = useQuery(api.elementVersions.listProjectElementVersions, { projectId });
    const itemsData = useQuery(api.items.listSidebarTree, { projectId, includeDrafts: true });
    const revertElementVersion = useMutation(api.elementVersions.revertElementVersion);
    const [selectedVersionId, setSelectedVersionId] = useState<Id<"elementVersions"> | null>(null);

    const elementById = useMemo(() => {
        const items = itemsData?.items ?? [];
        return new Map(items.map((item) => [String(item._id), item]));
    }, [itemsData?.items]);

    const selectedVersion = useMemo(() => {
        if (!versions || !selectedVersionId) return null;
        return versions.find((version) => version._id === selectedVersionId) ?? null;
    }, [versions, selectedVersionId]);

    const selectedElement = selectedVersion ? elementById.get(String(selectedVersion.elementId)) ?? null : null;
    const isActive = selectedElement?.activeVersionId === selectedVersion?._id;

    return (
        <div className="flex h-[calc(100vh-12rem)] gap-6">
            <div className="w-1/3 bg-white p-4 rounded shadow-sm border overflow-y-auto">
                <h2 className="text-lg font-bold mb-4">Element Version History</h2>
                {versions && versions.length === 0 && (
                    <p className="text-gray-400 text-sm">No element versions recorded yet.</p>
                )}
                {!versions && <p className="text-gray-400 text-sm">Loading versions...</p>}
                {versions && versions.length > 0 && (
                    <div className="space-y-2">
                        {versions.map((version) => {
                            const element = elementById.get(String(version.elementId));
                            return (
                                <button
                                    key={version._id}
                                    type="button"
                                    onClick={() => setSelectedVersionId(version._id)}
                                    className={`w-full text-left p-3 rounded border text-sm hover:bg-gray-50 transition ${
                                        selectedVersionId === version._id ? "bg-blue-50 border-blue-300" : ""
                                    }`}
                                >
                                    <div className="font-medium text-gray-800">
                                        {element?.title ?? "Element"} - {version.summary ?? "Element version"}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {new Date(version.createdAt).toLocaleString()}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="flex-1 bg-white p-6 rounded shadow-sm border overflow-y-auto">
                {selectedVersion ? (
                    <div className="space-y-3">
                        <div className="border-b pb-3">
                            <div className="text-xs text-gray-500">Element</div>
                            <div className="text-xl font-bold">{selectedElement?.title ?? "Element"}</div>
                            <div className="text-sm text-gray-500">
                                {new Date(selectedVersion.createdAt).toString()}
                            </div>
                        </div>
                        <div className="text-sm text-gray-700">
                            <div className="font-semibold">Summary</div>
                            <div>{selectedVersion.summary ?? "Element version"}</div>
                        </div>
                        {selectedVersion.tags && selectedVersion.tags.length > 0 && (
                            <div className="text-sm text-gray-700">
                                <div className="font-semibold">Tags</div>
                                <div className="text-xs text-gray-500">{selectedVersion.tags.join(", ")}</div>
                            </div>
                        )}
                        {selectedVersion.changeStats && (
                            <div className="text-sm text-gray-700">
                                <div className="font-semibold">Change stats</div>
                                <pre className="text-xs text-gray-600 whitespace-pre-wrap">
                                    {JSON.stringify(selectedVersion.changeStats, null, 2)}
                                </pre>
                            </div>
                        )}
                        {selectedElement && !isActive && (
                            <button
                                type="button"
                                className="text-xs bg-white border border-gray-300 rounded px-3 py-2 hover:bg-gray-100"
                                onClick={() =>
                                    void revertElementVersion({
                                        elementId: selectedElement._id,
                                        versionId: selectedVersion._id,
                                        createdBy: "user",
                                    })
                                }
                            >
                                Revert to this version
                            </button>
                        )}
                        {isActive && (
                            <div className="text-xs text-green-700">This is the active version.</div>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        Select a version to view details.
                    </div>
                )}
            </div>
        </div>
    );
}

function ConversationHistory({ projectId }: { projectId: Id<"projects"> }) {
    const conversations = useQuery(api.conversations.listByProject, { projectId });
    const [selectedConv, setSelectedConv] = useState<Id<"conversations"> | null>(null);

    const grouped = useMemo(() => {
        if (!conversations) {
            return undefined;
        }

        return conversations.reduce<Record<string, Doc<"conversations">[]>>((acc, curr) => {
            const phase = curr.phase || "other";
            if (!acc[phase]) {
                acc[phase] = [];
            }
            acc[phase].push(curr);
            return acc;
        }, {});
    }, [conversations]);

    return (
        <div className="flex h-[calc(100vh-12rem)] gap-6">
            <div className="w-1/3 bg-white p-4 rounded shadow-sm border overflow-y-auto">
                <h2 className="text-lg font-bold mb-4">Agent Interaction Log</h2>

                {grouped && Object.keys(grouped).map((phase) => (
                    <div key={phase} className="mb-6">
                        <h3 className="text-xs font-bold uppercase text-gray-500 mb-2 border-b pb-1">{phase}</h3>
                        <div className="space-y-2">
                            {grouped[phase].map((conv) => (
                                <div
                                    key={conv._id}
                                    onClick={() => setSelectedConv(conv._id)}
                                    className={`p-3 rounded border cursor-pointer text-sm hover:bg-gray-50 transition ${
                                        selectedConv === conv._id ? "bg-blue-50 border-blue-300" : ""
                                    }`}
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-medium text-gray-800 capitalize">{conv.agentRole}</span>
                                        <span className="text-xs text-gray-400">
                                            {new Date(conv.createdAt).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-500 truncate">Click to view transcript</div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}

                {(!conversations || conversations.length === 0) && (
                    <p className="text-gray-400 text-sm">No history recorded yet.</p>
                )}
            </div>

            <div className="flex-1 bg-white p-6 rounded shadow-sm border overflow-y-auto">
                {selectedConv ? (
                    <ConversationViewer
                        conversation={conversations?.find((c) => c._id === selectedConv)}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        Select a session to view details.
                    </div>
                )}
            </div>
        </div>
    );
}

function ConversationViewer({ conversation }: { conversation?: Doc<"conversations"> }) {
    if (!conversation) return null;
    const parsed = (() => {
        try {
            const value = JSON.parse(conversation.messagesJson);
            if (!Array.isArray(value)) {
                return [];
            }
            return value;
        } catch {
            return [];
        }
    })();

    const messages: ConversationMessage[] = parsed.map((message) => ({
        role: typeof message.role === "string" ? message.role : "assistant",
        content: typeof message.content === "string" ? message.content : "",
    }));

    return (
        <div className="space-y-4">
            <div className="border-b pb-4 mb-4">
                <h2 className="text-xl font-bold capitalize">{conversation.agentRole} Session</h2>
                <p className="text-sm text-gray-500">{new Date(conversation.createdAt).toString()}</p>
            </div>

            <div className="space-y-4">
                {messages.map((msg, index) => (
                    <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                            className={`max-w-[80%] rounded-lg p-4 ${
                                msg.role === "user"
                                    ? "bg-blue-600 text-white"
                                    : msg.role === "system"
                                        ? "bg-red-50 text-red-800 text-xs font-mono"
                                        : "bg-gray-100 text-gray-800"
                            }`}
                        >
                            <div className="text-xs opacity-70 mb-1 capitalize">{msg.role}</div>
                            <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
