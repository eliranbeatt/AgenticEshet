"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type AgentRun = {
    _id: string;
    agent: string;
    status: "queued" | "running" | "succeeded" | "failed";
    stage?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
    events?: Array<{ ts: number; level: "info" | "warn" | "error"; message: string; stage?: string }>;
};

function formatRelativeTime(ts: number) {
    const deltaSec = Math.floor((Date.now() - ts) / 1000);
    if (deltaSec < 5) return "just now";
    if (deltaSec < 60) return `${deltaSec}s ago`;
    const deltaMin = Math.floor(deltaSec / 60);
    if (deltaMin < 60) return `${deltaMin}m ago`;
    const deltaHr = Math.floor(deltaMin / 60);
    return `${deltaHr}h ago`;
}

function statusPill(status: AgentRun["status"]) {
    if (status === "succeeded") return "bg-green-100 text-green-800";
    if (status === "failed") return "bg-red-100 text-red-800";
    if (status === "running") return "bg-blue-100 text-blue-800";
    return "bg-gray-100 text-gray-700";
}

export function AgentActivityPanel({ projectId }: { projectId: Id<"projects"> }) {
    const runs = useQuery(api.agentRuns.listByProject, { projectId, limit: 12 }) as unknown as AgentRun[] | undefined;
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const activeCount = useMemo(() => {
        return (runs ?? []).filter((r) => r.status === "queued" || r.status === "running").length;
    }, [runs]);

    const selected = useMemo(() => {
        if (!runs || runs.length === 0) return null;
        if (selectedId) return runs.find((r) => r._id === selectedId) ?? runs[0];
        return runs[0];
    }, [runs, selectedId]);

    const headerLabel = useMemo(() => {
        if (activeCount > 0) return `Agent activity (${activeCount} running)`;
        return "Agent activity";
    }, [activeCount]);

    return (
        <div className="h-full flex flex-col bg-white">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-800">{headerLabel}</div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex flex-col h-full">
                    {/* List of Runs */}
                    <div className="flex-1 overflow-auto border-b min-h-[200px]">
                        {(runs ?? []).length === 0 ? (
                            <div className="p-4 text-sm text-gray-500">No agent runs yet.</div>
                        ) : (
                            <div className="divide-y">
                                {(runs ?? []).map((run) => (
                                    <button
                                        key={run._id}
                                        type="button"
                                        onClick={() => setSelectedId(run._id)}
                                        className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${selected?._id === run._id ? "bg-blue-50" : ""
                                            }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="text-sm font-medium text-gray-800 truncate">
                                                {run.agent}
                                            </div>
                                            <span
                                                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusPill(
                                                    run.status
                                                )}`}
                                            >
                                                {run.status}
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1 flex items-center justify-between gap-2">
                                            <span className="truncate">{run.stage ?? "-"}</span>
                                            <span>{formatRelativeTime(run.updatedAt ?? run.createdAt)}</span>
                                        </div>
                                        {run.status === "failed" && run.error && (
                                            <div className="text-xs text-red-700 mt-1 line-clamp-2">
                                                {run.error}
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Selected Run Details */}
                    <div className="flex-1 overflow-auto bg-gray-50/50 min-h-[200px]">
                        {!selected ? (
                            <div className="p-4 text-sm text-gray-500">Select a run.</div>
                        ) : (
                            <div className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <div className="text-sm font-semibold text-gray-800">{selected.agent}</div>
                                        <div className="text-xs text-gray-500">
                                            {new Date(selected.createdAt).toLocaleString()}
                                        </div>
                                    </div>
                                    <span
                                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusPill(
                                            selected.status
                                        )}`}
                                    >
                                        {selected.status}
                                    </span>
                                </div>

                                {selected.stage && (
                                    <div className="text-xs text-gray-700">
                                        <span className="font-semibold">Stage:</span> {selected.stage}
                                    </div>
                                )}

                                {selected.status === "failed" && selected.error && (
                                    <div className="text-xs text-red-700 whitespace-pre-wrap">{selected.error}</div>
                                )}

                                <div className="border rounded bg-white overflow-auto max-h-[400px]">
                                    {(selected.events ?? []).length === 0 ? (
                                        <div className="p-3 text-xs text-gray-500">No events recorded.</div>
                                    ) : (
                                        <div className="divide-y">
                                            {(selected.events ?? []).map((event, idx) => (
                                                <div key={`${event.ts}-${idx}`} className="px-3 py-2 text-xs">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-gray-600">
                                                            {new Date(event.ts).toLocaleTimeString()}
                                                        </span>
                                                        <span
                                                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${event.level === "error"
                                                                    ? "bg-red-100 text-red-800"
                                                                    : event.level === "warn"
                                                                        ? "bg-yellow-100 text-yellow-800"
                                                                        : "bg-gray-200 text-gray-700"
                                                                }`}
                                                        >
                                                            {event.level}
                                                        </span>
                                                    </div>
                                                    <div className="text-gray-800 mt-1 whitespace-pre-wrap">
                                                        {event.message}
                                                    </div>
                                                    {event.stage && (
                                                        <div className="text-gray-500 mt-1">
                                                            stage: {event.stage}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="text-[11px] text-gray-500">
                                    Live updates via Convex subscriptions.
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
