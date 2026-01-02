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

type TurnBundle = {
    _id: string;
    stage: string;
    scope: { type: string; itemIds?: string[] };
    source: { type: string; sourceIds: string[] };
    bundleText: string;
    bundleHash: string;
    createdAt: number;
};

type ActivityEntry =
    | ({ kind: "run"; key: string } & AgentRun)
    | ({ kind: "bundle"; key: string } & TurnBundle);

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

function copyText(value: string) {
    if (!value) return;
    void navigator.clipboard.writeText(value);
}

export function AgentActivityPanel({ projectId }: { projectId: Id<"projects"> }) {
    const runs = useQuery(api.agentRuns.listByProject, { projectId, limit: 12 }) as unknown as AgentRun[] | undefined;
    const bundles = useQuery(api.turnBundles.listByProject, { projectId, limit: 20 }) as unknown as
        | TurnBundle[]
        | undefined;
    const [selectedKey, setSelectedKey] = useState<string | null>(null);

    const activeCount = useMemo(() => {
        return (runs ?? []).filter((r) => r.status === "queued" || r.status === "running").length;
    }, [runs]);

    const activity = useMemo<ActivityEntry[]>(() => {
        const runEntries = (runs ?? []).map((run) => ({
            kind: "run" as const,
            key: `run:${run._id}`,
            ...run,
        }));
        const bundleEntries = (bundles ?? []).map((bundle) => ({
            kind: "bundle" as const,
            key: `bundle:${bundle._id}`,
            ...bundle,
        }));
        return [...runEntries, ...bundleEntries]
            .sort((a, b) => {
                const aTime = "updatedAt" in a ? a.updatedAt : a.createdAt;
                const bTime = "updatedAt" in b ? b.updatedAt : b.createdAt;
                return bTime - aTime;
            })
            .slice(0, 12);
    }, [bundles, runs]);

    const selected = useMemo<ActivityEntry | null>(() => {
        if (activity.length === 0) return null;
        if (selectedKey) return activity.find((entry) => entry.key === selectedKey) ?? activity[0];
        return activity[0];
    }, [activity, selectedKey]);

    const getCopyPayload = (entry: ActivityEntry) => {
        if (entry.kind === "bundle") return entry.bundleText;
        if (entry.error) return entry.error;
        if (!entry.events || entry.events.length === 0) return "";
        return entry.events.map((event) => `${new Date(event.ts).toISOString()} ${event.message}`).join("\n");
    };

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
                        {activity.length === 0 ? (
                            <div className="p-4 text-sm text-gray-500">No agent runs yet.</div>
                        ) : (
                            <div className="divide-y">
                                {activity.map((entry) => (
                                    <div
                                        key={entry.key}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setSelectedKey(entry.key)}
                                        className={`w-full text-left px-4 py-3 hover:bg-gray-50 cursor-pointer ${selected?.key === entry.key ? "bg-blue-50" : ""
                                            }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="text-sm font-medium text-gray-800 truncate">
                                                {entry.kind === "run" ? entry.agent : "Turn bundle"}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {entry.kind === "run" ? (
                                                    <span
                                                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusPill(
                                                            entry.status
                                                        )}`}
                                                    >
                                                        {entry.status}
                                                    </span>
                                                ) : (
                                                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                                                        bundle
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        copyText(getCopyPayload(entry));
                                                    }}
                                                    className="text-[10px] px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                                                >
                                                    Copy
                                                </button>
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1 flex items-center justify-between gap-2">
                                            <span className="truncate">
                                                {entry.kind === "run"
                                                    ? entry.stage ?? "-"
                                                    : `${entry.stage} / ${entry.source.type} / ${entry.scope.type}`}
                                            </span>
                                            <span>
                                                {formatRelativeTime(
                                                    "updatedAt" in entry ? entry.updatedAt ?? entry.createdAt : entry.createdAt
                                                )}
                                            </span>
                                        </div>
                                        {entry.kind === "run" && entry.status === "failed" && entry.error && (
                                            <div className="text-xs text-red-700 mt-1 line-clamp-2">
                                                {entry.error}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Selected Run Details */}
                    <div className="flex-1 overflow-auto bg-gray-50/50 min-h-[200px]">
                        {!selected ? (
                            <div className="p-4 text-sm text-gray-500">Select a run.</div>
                        ) : selected.kind === "run" ? (
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
                                    <div className="text-xs text-red-700 whitespace-pre-wrap">
                                        {selected.error}
                                        <button
                                            type="button"
                                            onClick={() => copyText(selected.error ?? "")}
                                            className="ml-2 text-[10px] px-2 py-0.5 rounded border border-red-200 text-red-700 hover:bg-red-50"
                                        >
                                            Copy error
                                        </button>
                                    </div>
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
                                                        <div className="flex items-center gap-2">
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
                                                            <button
                                                                type="button"
                                                                onClick={() => copyText(event.message)}
                                                                className="text-[10px] px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                                                            >
                                                                Copy
                                                            </button>
                                                        </div>
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
                        ) : (
                            <div className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <div className="text-sm font-semibold text-gray-800">Turn bundle</div>
                                        <div className="text-xs text-gray-500">
                                            {new Date(selected.createdAt).toLocaleString()}
                                        </div>
                                    </div>
                                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                                        bundle
                                    </span>
                                </div>

                                <div className="text-xs text-gray-700">
                                    <span className="font-semibold">Stage:</span> {selected.stage}
                                </div>
                                <div className="text-xs text-gray-700">
                                    <span className="font-semibold">Source:</span> {selected.source.type}
                                </div>
                                <div className="text-xs text-gray-700">
                                    <span className="font-semibold">Scope:</span> {selected.scope.type}
                                </div>

                                <div className="border rounded bg-white overflow-auto max-h-[400px] p-3 text-xs whitespace-pre-wrap text-gray-800">
                                    {selected.bundleText}
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => copyText(selected.bundleText)}
                                        className="text-[10px] px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                                    >
                                        Copy bundle text
                                    </button>
                                    <span className="text-[11px] text-gray-400">hash: {selected.bundleHash}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
