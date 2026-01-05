"use client";

import { useMemo, useState } from "react";
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

export type ActivityEntry =
    | ({ kind: "run"; key: string } & AgentRun)
    | ({ kind: "bundle"; key: string } & TurnBundle);

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

export function ActivityDetailsModal({
    entry,
    onClose,
}: {
    entry: ActivityEntry;
    onClose: () => void;
}) {
    const [activeTab, setActiveTab] = useState<"overview" | "logs" | "raw">("overview");

    const content = useMemo(() => {
        if (entry.kind === "run") {
            const logs = entry.events ?? [];
            return (
                <div className="space-y-4">
                    {activeTab === "overview" && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="font-semibold text-gray-600 block">Agent</span>
                                    {entry.agent}
                                </div>
                                <div>
                                    <span className="font-semibold text-gray-600 block">Status</span>
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusPill(entry.status)}`}>
                                        {entry.status}
                                    </span>
                                </div>
                                <div>
                                    <span className="font-semibold text-gray-600 block">Stage</span>
                                    {entry.stage ?? "-"}
                                </div>
                                <div>
                                    <span className="font-semibold text-gray-600 block">Created At</span>
                                    {new Date(entry.createdAt).toLocaleString()}
                                </div>
                            </div>

                            {entry.status === "failed" && entry.error && (
                                <div className="p-3 bg-red-50 border border-red-100 rounded text-red-800 text-sm whitespace-pre-wrap font-mono">
                                    <div className="font-bold mb-1">Error</div>
                                    {entry.error}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "logs" && (
                        <div className="border rounded bg-gray-50 overflow-auto max-h-[60vh] p-2 font-mono text-xs">
                            {logs.length === 0 ? (
                                <div className="text-gray-500 italic p-2">No logs available.</div>
                            ) : (
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="p-2 w-24">Time</th>
                                            <th className="p-2 w-16">Level</th>
                                            <th className="p-2">Message</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {logs.map((event, idx) => (
                                            <tr key={idx} className="border-b last:border-0 hover:bg-gray-100">
                                                <td className="p-2 text-gray-500 align-top">
                                                    {new Date(event.ts).toLocaleTimeString()}
                                                </td>
                                                <td className="p-2 align-top">
                                                    <span
                                                        className={`px-1 rounded ${event.level === "error"
                                                                ? "bg-red-100 text-red-800"
                                                                : event.level === "warn"
                                                                    ? "bg-yellow-100 text-yellow-800"
                                                                    : "bg-gray-200 text-gray-700"
                                                            }`}
                                                    >
                                                        {event.level}
                                                    </span>
                                                </td>
                                                <td className="p-2 align-top whitespace-pre-wrap">{event.message}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}

                    {activeTab === "raw" && (
                        <div className="border rounded bg-slate-900 text-slate-50 overflow-auto max-h-[60vh] p-4 font-mono text-xs">
                            <pre>{JSON.stringify(entry, null, 2)}</pre>
                        </div>
                    )}
                </div>
            );
        } else {
            // Bundle
            return (
                <div className="space-y-4">
                    {activeTab === "overview" && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="font-semibold text-gray-600 block">Type</span>
                                    Turn Bundle
                                </div>
                                <div>
                                    <span className="font-semibold text-gray-600 block">Stage</span>
                                    {entry.stage}
                                </div>
                                <div>
                                    <span className="font-semibold text-gray-600 block">Scope</span>
                                    {entry.scope.type}
                                </div>
                                <div>
                                    <span className="font-semibold text-gray-600 block">Source</span>
                                    {entry.source.type}
                                </div>
                                <div>
                                    <span className="font-semibold text-gray-600 block">Created At</span>
                                    {new Date(entry.createdAt).toLocaleString()}
                                </div>
                                <div className="col-span-2">
                                    <span className="font-semibold text-gray-600 block">Hash</span>
                                    <span className="font-mono bg-gray-100 px-1 rounded">{entry.bundleHash}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {(activeTab === "logs" || activeTab === "raw") && (
                        <div className="space-y-2">
                            {activeTab === "logs" && (
                                <div className="border rounded bg-white overflow-auto max-h-[60vh] p-4 text-sm font-mono whitespace-pre-wrap">
                                    {entry.bundleText}
                                </div>
                            )}
                            {activeTab === "raw" && (
                                <div className="border rounded bg-slate-900 text-slate-50 overflow-auto max-h-[60vh] p-4 font-mono text-xs">
                                    <pre>{JSON.stringify(entry, null, 2)}</pre>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
        }
    }, [entry, activeTab]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="Close modal"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-xl shadow-2xl w-[min(900px,95vw)] max-h-[92vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b bg-white z-10">
                    <div>
                        <div className="text-xl font-bold text-gray-900">
                            {entry.kind === "run" ? `Agent Run: ${entry.agent}` : "Turn Bundle Detail"}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                            ID: {entry._id}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
                        >
                            <span className="text-2xl leading-none">&times;</span>
                        </button>
                    </div>
                </div>

                <div className="flex border-b bg-gray-50">
                    <TabButton label="Overview" isActive={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
                    <TabButton label={entry.kind === "run" ? "Logs & Events" : "Bundle Content"} isActive={activeTab === "logs"} onClick={() => setActiveTab("logs")} />
                    <TabButton label="Raw JSON Results" isActive={activeTab === "raw"} onClick={() => setActiveTab("raw")} />
                </div>

                <div className="p-6 overflow-y-auto flex-1 bg-white">
                    {content}
                </div>
            </div>
        </div>
    );
}

function TabButton({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${isActive ? "border-blue-600 text-blue-600 bg-white" : "border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-100"
                }`}
        >
            {label}
        </button>
    );
}
