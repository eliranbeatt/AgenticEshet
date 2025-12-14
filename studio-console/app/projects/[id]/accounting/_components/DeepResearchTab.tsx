"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id, type Doc } from "../../../../../convex/_generated/dataModel";

export default function DeepResearchTab({ projectId }: { projectId: Id<"projects"> }) {
    const runs = useQuery(api.deepResearch.listByProject, { projectId });
    const [selectedId, setSelectedId] = useState<Id<"deepResearchRuns"> | null>(null);

    const selected = useMemo<Doc<"deepResearchRuns"> | null>(() => {
        if (!runs || runs.length === 0) return null;
        if (!selectedId) return runs[0];
        return runs.find((r) => r._id === selectedId) ?? runs[0];
    }, [runs, selectedId]);

    if (runs === undefined) {
        return <div className="p-4 text-sm text-gray-500">Loading deep research...</div>;
    }

    return (
        <div className="flex gap-4 h-full">
            <div className="w-80 border rounded-lg overflow-hidden bg-white flex flex-col">
                <div className="px-4 py-3 border-b bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-700">Runs</h3>
                    <p className="text-xs text-gray-500">Newest first</p>
                </div>
                <div className="flex-1 overflow-auto">
                    {runs.length === 0 ? (
                        <div className="p-4 text-sm text-gray-500">No deep research runs yet.</div>
                    ) : (
                        <div className="divide-y">
                            {runs.map((run) => (
                                <button
                                    key={run._id}
                                    onClick={() => setSelectedId(run._id)}
                                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                                        selected?._id === run._id ? "bg-blue-50" : ""
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-medium text-gray-800">
                                            {new Date(run.createdAt).toLocaleString()}
                                        </div>
                                        <span
                                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                                run.status === "completed"
                                                    ? "bg-green-100 text-green-800"
                                                    : "bg-red-100 text-red-800"
                                            }`}
                                        >
                                            {run.status}
                                        </span>
                                    </div>
                                    {run.status === "failed" && run.error && (
                                        <div className="text-xs text-red-700 mt-1 line-clamp-2">{run.error}</div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 border rounded-lg bg-white overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-700">Deep-Research Output</h3>
                    <p className="text-xs text-gray-500">Markdown with links and citations</p>
                </div>
                <div className="flex-1 overflow-auto p-6 prose prose-sm max-w-none">
                    {!selected ? (
                        <div className="text-sm text-gray-500">Select a run.</div>
                    ) : selected.status === "failed" ? (
                        <div className="text-sm text-red-700 whitespace-pre-wrap">{selected.error ?? "Failed."}</div>
                    ) : (
                        <div className="whitespace-pre-wrap text-gray-900">{selected.reportMarkdown ?? "(empty)"}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

