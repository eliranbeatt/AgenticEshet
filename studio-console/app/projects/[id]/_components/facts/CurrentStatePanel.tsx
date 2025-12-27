"use client";

import ReactMarkdown from "react-markdown";
import { useState } from "react";

type SaveStatus = "idle" | "saving" | "saved";

type CurrentStatePanelProps = {
    derivedMarkdown: string;
    text: string;
    onChange: (next: string) => void;
    saveStatus: SaveStatus;
    updatedAt?: number;
    hasRemoteUpdate: boolean;
    onApplyRemote: () => void;
};

function formatTimestamp(value?: number) {
    if (!value) return "Not saved yet";
    return new Date(value).toLocaleTimeString();
}

export function CurrentStatePanel({
    derivedMarkdown,
    text,
    onChange,
    saveStatus,
    updatedAt,
    hasRemoteUpdate,
    onApplyRemote,
}: CurrentStatePanelProps) {
    const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");

    return (
        <div className="flex flex-col h-full bg-white">
            <div className="p-3 border-b bg-gray-50">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">Current State</h3>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500">
                        <span>
                            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Idle"}
                        </span>
                        <span className="text-gray-400">Last: {formatTimestamp(updatedAt)}</span>
                    </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                    <div className="flex items-center bg-white rounded border p-1 gap-1">
                        <button
                            type="button"
                            onClick={() => setViewMode("edit")}
                            className={`px-2 py-1 text-[10px] rounded font-semibold uppercase tracking-wide ${
                                viewMode === "edit" ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-900"
                            }`}
                        >
                            Edit
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("preview")}
                            className={`px-2 py-1 text-[10px] rounded font-semibold uppercase tracking-wide ${
                                viewMode === "preview" ? "bg-blue-600 text-white" : "text-gray-600 hover:text-gray-900"
                            }`}
                        >
                            Preview
                        </button>
                    </div>
                    {hasRemoteUpdate && (
                        <button
                            type="button"
                            onClick={onApplyRemote}
                            className="px-2 py-1 text-[10px] rounded uppercase bg-yellow-100 text-yellow-800 hover:bg-yellow-200"
                        >
                            Load latest update
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                        Derived View (Facts + Elements)
                    </div>
                    <div className="prose prose-sm max-w-none bg-gray-50 border rounded p-3">
                        <ReactMarkdown>{derivedMarkdown || "No derived state yet."}</ReactMarkdown>
                    </div>
                </div>

                <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                        Manual Notes
                    </div>
                    {viewMode === "edit" ? (
                        <textarea
                            className="w-full min-h-[240px] border rounded p-3 text-xs font-mono text-gray-800 resize-none"
                            value={text}
                            onChange={(event) => onChange(event.target.value)}
                            placeholder="Add manual notes or decisions here. This section is never auto-edited."
                        />
                    ) : (
                        <div className="prose prose-sm max-w-none">
                            <ReactMarkdown>{text || "No manual notes yet."}</ReactMarkdown>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
