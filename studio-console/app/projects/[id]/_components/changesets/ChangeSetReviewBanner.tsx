"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";

type Phase =
    | "planning"
    | "solutioning"
    | "accounting"
    | "tasks"
    | "item_edit"
    | "convert"
    | "element_edit"
    | "procurement"
    | "runbook"
    | "closeout";

export function ChangeSetReviewBanner({
    projectId,
    phase,
}: {
    projectId: Id<"projects">;
    phase: Phase;
}) {
    const pending = useQuery(api.changeSets.listByProject, { projectId, phase, status: "pending" }) as
        | Array<Doc<"itemChangeSets">>
        | undefined;
    const [activeId, setActiveId] = useState<Id<"itemChangeSets"> | null>(null);
    const [isOpen, setIsOpen] = useState(false);

    const activeDetail = useQuery(
        api.changeSets.getWithOps,
        activeId ? { changeSetId: activeId } : "skip",
    );

    const applyChangeSet = useMutation(api.changeSets.apply);
    const rejectChangeSet = useMutation(api.changeSets.reject);
    const runRules = useMutation(api.agents.rules.run);

    const count = pending?.length ?? 0;
    const active = activeDetail?.changeSet ?? null;

    const opsByType = useMemo(() => {
        const groups = new Map<string, Doc<"itemChangeSetOps">[]>();
        if (!activeDetail?.ops) return groups;
        for (const op of activeDetail.ops) {
            const bucket = groups.get(op.entityType) ?? [];
            bucket.push(op);
            groups.set(op.entityType, bucket);
        }
        return groups;
    }, [activeDetail]);

    if (!pending) return null;

    return (
        <>
            {count > 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
                    <div className="text-sm text-amber-900">
                        {count} pending ChangeSet{count === 1 ? "" : "s"} in {phase}.
                    </div>
                    <button
                        type="button"
                        className="text-sm px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700"
                        onClick={() => {
                            setIsOpen(true);
                            if (!activeId && pending[0]) {
                                setActiveId(pending[0]._id);
                            }
                        }}
                    >
                        Review
                    </button>
                </div>
            ) : (
                <div className="flex justify-end p-2">
                    <button
                        type="button"
                        className="text-sm px-3 py-1.5 rounded bg-white border text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        onClick={async () => {
                            if (!confirm("Run companion rules check?")) return;
                            try {
                                const result = await runRules({ projectId });
                                if (result.count === 0) {
                                    alert("No suggestions found.");
                                } else {
                                    alert(`Created ChangeSet with ${result.count} suggestions.`);
                                }
                            } catch (e) {
                                alert("Failed: " + e);
                            }
                        }}
                    >
                        Check Rules
                    </button>
                </div>
            )}

            {isOpen && (
                <div className="fixed inset-0 z-50 flex">
                    <div className="flex-1 bg-black/40" onClick={() => setIsOpen(false)} />
                    <div className="w-full max-w-3xl bg-white shadow-xl border-l flex flex-col">
                        <div className="p-4 border-b flex items-start justify-between gap-4">
                            <div>
                                <div className="text-xs text-gray-500">ChangeSet review</div>
                                <div className="text-lg font-semibold text-gray-900">Phase: {phase}</div>
                            </div>
                            <button
                                type="button"
                                className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                                onClick={() => setIsOpen(false)}
                            >
                                Close
                            </button>
                        </div>

                        <div className="flex-1 grid grid-cols-[220px_minmax(0,1fr)] divide-x">
                            <div className="p-3 border-r overflow-y-auto">
                                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                    Pending
                                </div>
                                <div className="space-y-2">
                                    {pending.map((changeSet) => (
                                        <button
                                            key={changeSet._id}
                                            type="button"
                                            className={`w-full text-left border rounded p-2 text-sm ${activeId === changeSet._id ? "border-blue-500 bg-blue-50" : "hover:bg-gray-50"}`}
                                            onClick={() => setActiveId(changeSet._id)}
                                        >
                                            <div className="font-semibold text-gray-800">{changeSet.title ?? "Untitled"}</div>
                                            <div className="text-xs text-gray-500">{new Date(changeSet.createdAt).toLocaleString()}</div>
                                        </button>
                                    ))}
                                    {pending.length === 0 && (
                                        <div className="text-xs text-gray-400">No pending ChangeSets.</div>
                                    )}
                                </div>
                            </div>

                            <div className="p-4 overflow-y-auto">
                                {!active && <div className="text-sm text-gray-500">Select a ChangeSet to review.</div>}
                                {active && (
                                    <div className="space-y-4">
                                        <div>
                                            <div className="text-xs text-gray-500">Summary</div>
                                            <div className="text-lg font-semibold text-gray-900">{active.title ?? "Untitled"}</div>
                                            <div className="text-xs text-gray-500 mt-1">Agent: {active.agentName}</div>
                                        </div>

                                        <div className="grid gap-3 sm:grid-cols-2 text-sm">
                                            <InfoCard label="Elements" value={String(active.counts?.items ?? 0)} />
                                            <InfoCard label="Tasks" value={String(active.counts?.tasks ?? 0)} />
                                            <InfoCard label="Materials" value={String(active.counts?.materialLines ?? 0)} />
                                            <InfoCard label="Accounting" value={String(active.counts?.accountingLines ?? 0)} />
                                            <InfoCard label="Dependencies" value={String(active.counts?.dependencies ?? 0)} />
                                        </div>

                                        <Section title="Assumptions" lines={active.assumptions ?? []} />
                                        <Section title="Warnings" lines={active.warnings ?? []} />
                                        <Section title="Open questions" lines={active.openQuestions ?? []} />

                                        <div className="space-y-3">
                                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Operations</div>
                                            {[...opsByType.entries()].map(([type, ops]) => (
                                                <div key={type} className="border rounded p-3">
                                                    <div className="text-sm font-semibold text-gray-800 capitalize">{type}</div>
                                                    <div className="mt-2 space-y-2 text-xs text-gray-600">
                                                        {ops.map((op) => (
                                                            <div key={op._id} className="border rounded p-2 bg-gray-50">
                                                                <div className="font-semibold text-gray-700">{op.opType}</div>
                                                                <pre className="whitespace-pre-wrap break-words text-[11px] text-gray-600">
                                                                    {op.payloadJson}
                                                                </pre>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                            {opsByType.size === 0 && (
                                                <div className="text-xs text-gray-400">No operations recorded.</div>
                                            )}
                                        </div>

                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                className="text-sm px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700"
                                                onClick={async () => {
                                                    await applyChangeSet({ changeSetId: active._id });
                                                    setActiveId(null);
                                                }}
                                            >
                                                Approve
                                            </button>
                                            <button
                                                type="button"
                                                className="text-sm px-3 py-2 rounded border border-red-200 text-red-700 hover:bg-red-50"
                                                onClick={async () => {
                                                    await rejectChangeSet({ changeSetId: active._id });
                                                    setActiveId(null);
                                                }}
                                            >
                                                Reject
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function InfoCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="border rounded p-3">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-semibold text-gray-900">{value}</div>
        </div>
    );
}

function Section({ title, lines }: { title: string; lines: string[] }) {
    if (!lines || lines.length === 0) return null;
    return (
        <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</div>
            <ul className="mt-2 space-y-1 text-sm text-gray-700">
                {lines.map((line, index) => (
                    <li key={`${title}-${index}`}>- {line}</li>
                ))}
            </ul>
        </div>
    );
}
